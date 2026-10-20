const test = require('node:test');
const assert = require('node:assert/strict');
const { gradeResponse, mergeResults, latestRubricCriteria } = require('../src/ResponseGrader.js');
const { MockProvider } = require('../src/providers/MockProvider.js');

const questions = [
  { enabled: true, question_id: 'Q001', question_text: '首都は？', question_type: 'SHORT_TEXT', points: 5, grading_mode: 'AUTO', auto_rule: 'ANY_OF', correct_answer: '東京', alternatives: '東京都' },
  { enabled: true, question_id: 'Q003', question_text: '理由を述べよ', question_type: 'PARAGRAPH', points: 10, grading_mode: 'LLM', rubric_id: 'R001' },
  { enabled: true, question_id: 'Q004', question_text: '意見を述べよ', question_type: 'PARAGRAPH', points: 5, grading_mode: 'MANUAL' }
];
const rubrics = [
  { rubric_id: 'R001', rubric_version: 1, criterion_id: 'C01', criterion: 'a', max_points: 10, description: 'd' }
];
const settings = { LLM_PROVIDER: 'ANTHROPIC', LLM_MODEL: 'm', PROMPT_VERSION: 1, LLM_CONFIDENCE_THRESHOLD: 0.8, LLM_BATCH_SIZE: 10, COLLECT_EMAIL: false };
const now = new Date('2026-10-20T10:00:00Z');
const response = {
  response_id: 'r1', form_version: 1, submitted_at: now, respondent_email: 'a@b.jp',
  answers: { Q001: '東京都', Q003: '顧客ごとに違うから', Q004: '意見です' }
};
function llmOk() {
  return new MockProvider((p) => p.items.map((i) => ({
    question_id: i.question_id, score: 9, max_score: 10, confidence: 0.9, reason: 'よい', criteria: [{ criterion_id: 'C01', score: 9 }]
  })));
}
const run = (over) => gradeResponse(Object.assign({ response, questions, rubrics, settings, provider: llmOk(), now }, over || {}));

test('AUTO・LLM・MANUAL を振り分けて、問題ごとに1行にする', () => {
  const { rows } = run();
  assert.deepEqual(rows.map((r) => [r.question_id, r.status, r.final_score]),
    [['Q001', 'AUTO_GRADED', 5], ['Q003', 'LLM_GRADED', 9], ['Q004', 'MANUAL_PENDING', '']]);
});

test('MANUAL が残る回答は確定しない', () => {
  assert.equal(run().finalized, false);
});

test('MANUAL が無く全問が確定すれば確定する', () => {
  const { finalized } = run({ questions: questions.slice(0, 2) });
  assert.equal(finalized, true);
});

test('要確認が残れば確定しない。LLM結果の記録（提供元・モデル・版）が付く', () => {
  const lowConf = new MockProvider((p) => p.items.map((i) => ({
    question_id: i.question_id, score: 9, max_score: 10, confidence: 0.2, reason: 'ふあん', criteria: [{ criterion_id: 'C01', score: 9 }]
  })));
  const { rows, finalized } = run({ questions: questions.slice(0, 2), provider: lowConf });
  assert.equal(finalized, false);
  const r = rows[1];
  assert.deepEqual([r.status, r.provider, r.model, r.prompt_version, r.rubric_id, r.rubric_version],
    ['REVIEW_REQUIRED', 'ANTHROPIC', 'm', 1, 'R001', 1]);
});

test('LLM の問題が無ければ提供元を呼ばない', () => {
  const provider = llmOk();
  run({ questions: [questions[0]], provider });
  assert.equal(provider.calls.length, 0);
});

test('メールは COLLECT_EMAIL が TRUE のときだけ記録する', () => {
  assert.equal(run().rows[0].respondent_email, '');
  assert.equal(run({ settings: Object.assign({}, settings, { COLLECT_EMAIL: true }) }).rows[0].respondent_email, 'a@b.jp');
});

test('ルーブリックが見つからない LLM 問題は REVIEW_REQUIRED（0点にしない）', () => {
  const { rows } = run({ rubrics: [] });
  assert.equal(rows[1].status, 'REVIEW_REQUIRED');
  assert.equal(rows[1].final_score, '');
});

test('未回答は全モードで UNANSWERED の0点で確定する', () => {
  const { rows, finalized } = run({ response: Object.assign({}, response, { answers: {} }) });
  assert.deepEqual(rows.map((r) => r.status), ['UNANSWERED', 'UNANSWERED', 'UNANSWERED']);
  assert.equal(finalized, true);
});

test('配列の回答は || でつないで記録する', () => {
  const q = [{ enabled: true, question_id: 'Q9', question_text: 'x', question_type: 'CHECKBOX', points: 2, grading_mode: 'AUTO', auto_rule: 'NATIVE', correct_answer: 'A||B', options: 'A||B||C' }];
  const { rows } = run({ questions: q, response: Object.assign({}, response, { answers: { Q9: ['B', 'A'] } }) });
  assert.equal(rows[0].answer, 'B||A');
  assert.equal(rows[0].final_score, 2);
});

test('最新の版のルーブリックを使う', () => {
  const rs = rubrics.concat([{ rubric_id: 'R001', rubric_version: 2, criterion_id: 'C09', criterion: 'z', max_points: 10, description: '' }]);
  const r = latestRubricCriteria(rs, 'R001');
  assert.equal(r.version, 2);
  assert.deepEqual(r.criteria.map((c) => c.criterion_id), ['C09']);
  assert.equal(latestRubricCriteria(rs, 'RX'), null);
});

test('再採点は既存の行を更新し、教師が入れた manual_score を守る', () => {
  const fresh = run().rows;
  const existing = [{ response_id: 'r1', question_id: 'Q003', manual_score: 6, status: 'REVIEW_REQUIRED', grading_mode: 'LLM' }];
  const merged = mergeResults(existing, fresh);
  assert.equal(merged.length, 3);
  const q3 = merged.filter((m) => m.row.question_id === 'Q003')[0];
  assert.equal(q3.existed, true);
  assert.equal(q3.row.manual_score, 6);
  assert.equal(q3.row.final_score, 6);
  assert.equal(merged.filter((m) => m.existed).length, 1);
});
