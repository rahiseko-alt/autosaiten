const test = require('node:test');
const assert = require('node:assert/strict');
const { validateConfiguration } = require('../src/Validation.js');

function q(over) {
  return Object.assign({
    enabled: true, question_id: 'Q001', question_text: '日本の首都は？',
    question_type: 'SHORT_TEXT', required: true, points: 5, grading_mode: 'AUTO',
    auto_rule: 'EXACT', correct_answer: '東京', alternatives: '', tolerance: '',
    options: '', rubric_id: ''
  }, over);
}
const settings = {
  LLM_PROVIDER: 'ANTHROPIC', LLM_MODEL: 'm', LLM_CONFIDENCE_THRESHOLD: 0.8,
  LLM_BATCH_SIZE: 10, LLM_MAX_RETRIES: 2, WORKER_BATCH_SIZE: 5
};
const rubrics = [
  { rubric_id: 'R001', rubric_version: 1, criterion_id: 'C01', max_points: 6 },
  { rubric_id: 'R001', rubric_version: 1, criterion_id: 'C02', max_points: 4 }
];
const llmQ = q({ question_id: 'Q003', question_type: 'PARAGRAPH', points: 10, grading_mode: 'LLM', auto_rule: '', correct_answer: '', rubric_id: 'R001' });

function run(questions, opt) {
  opt = opt || {};
  return validateConfiguration({
    questions: questions,
    rubrics: opt.rubrics || rubrics,
    settings: opt.settings || settings
  });
}

test('正しい設定ではエラーが無い', () => {
  assert.deepEqual(run([q(), llmQ]), []);
});

test('enabled が FALSE の行は検証しない', () => {
  assert.deepEqual(run([q(), q({ enabled: false, question_id: '', question_text: '' })]), []);
});

test('エラーは最初の1件で止まらず全件返る', () => {
  const errors = run([
    q({ question_id: 'Q004', points: -1 }),
    q({ question_id: 'Q005', question_type: 'MULTIPLE_CHOICE', auto_rule: 'NATIVE', options: '' })
  ]);
  assert.ok(errors.some(e => e.includes('Q004') && e.includes('points')));
  assert.ok(errors.some(e => e.includes('Q005') && e.includes('options')));
});

test('question_id の重複と未設定を検出する', () => {
  const dup = run([q(), q()]);
  assert.ok(dup.some(e => e.includes('Q001') && e.includes('重複')));
  const missing = run([q({ question_id: '' })]);
  assert.ok(missing.some(e => e.includes('question_id')));
});

test('問題文が空、列挙値が不正なら指摘する', () => {
  const errors = run([q({ question_text: '', question_type: 'XXX', grading_mode: 'YYY' })]);
  assert.ok(errors.some(e => e.includes('question_text')));
  assert.ok(errors.some(e => e.includes('question_type')));
  assert.ok(errors.some(e => e.includes('grading_mode')));
});

test('points は0以上の整数', () => {
  assert.ok(run([q({ points: 1.5 })]).some(e => e.includes('points')));
  assert.ok(run([q({ points: '' })]).some(e => e.includes('points')));
  assert.deepEqual(run([q({ points: 0 })]), []);
});

test('AUTO は auto_rule と correct_answer が必須', () => {
  const errors = run([q({ auto_rule: '', correct_answer: '' })]);
  assert.ok(errors.some(e => e.includes('auto_rule')));
  assert.ok(errors.some(e => e.includes('correct_answer')));
});

test('NATIVE は選択式の問題タイプだけ', () => {
  const errors = run([q({ auto_rule: 'NATIVE' })]);
  assert.ok(errors.some(e => e.includes('NATIVE')));
});

test('選択式は options 必須で、正答が options に含まれること', () => {
  const base = { question_type: 'MULTIPLE_CHOICE', auto_rule: 'NATIVE', options: 'A||B||C' };
  assert.deepEqual(run([q(Object.assign({ correct_answer: 'B' }, base))]), []);
  assert.ok(run([q(Object.assign({ correct_answer: 'Z' }, base))]).some(e => e.includes('correct_answer')));
});

test('CHECKBOX の正答は || 区切りで、すべて options に含まれること', () => {
  const base = { question_type: 'CHECKBOX', auto_rule: 'NATIVE', options: 'A||B||C' };
  assert.deepEqual(run([q(Object.assign({ correct_answer: 'A||C' }, base))]), []);
  assert.ok(run([q(Object.assign({ correct_answer: 'A||Z' }, base))]).some(e => e.includes('correct_answer')));
});

test('NUMBER は correct_answer と tolerance が数値であること', () => {
  assert.deepEqual(run([q({ auto_rule: 'NUMBER', correct_answer: '3.14', tolerance: '0.01' })]), []);
  assert.ok(run([q({ auto_rule: 'NUMBER', correct_answer: 'abc' })]).some(e => e.includes('NUMBER')));
  assert.ok(run([q({ auto_rule: 'NUMBER', correct_answer: '3', tolerance: '-1' })]).some(e => e.includes('tolerance')));
});

test('LLM は rubric_id が必須で、存在すること', () => {
  assert.ok(run([llmQ, q({ question_id: 'Q009', grading_mode: 'LLM', rubric_id: '', auto_rule: '', correct_answer: '' })])
    .some(e => e.includes('Q009') && e.includes('rubric_id')));
  assert.ok(run([Object.assign({}, llmQ, { rubric_id: 'R999' })]).some(e => e.includes('R999')));
});

test('ルーブリックの点数合計が配点と違えばエラー', () => {
  const errors = run([Object.assign({}, llmQ, { points: 12 })]);
  assert.ok(errors.some(e => e.includes('R001') && e.includes('10') && e.includes('12')));
});

test('同じ rubric_id が複数版あるときは最大の版で合計する', () => {
  const rs = rubrics.concat([
    { rubric_id: 'R001', rubric_version: 2, criterion_id: 'C01', max_points: 3 },
    { rubric_id: 'R001', rubric_version: 2, criterion_id: 'C02', max_points: 7 }
  ]);
  assert.deepEqual(run([llmQ], { rubrics: rs }), []);
});

test('Settings の不備を指摘する', () => {
  const bad = Object.assign({}, settings, { LLM_PROVIDER: 'FOO', LLM_CONFIDENCE_THRESHOLD: 1.5, WORKER_BATCH_SIZE: 0 });
  const errors = run([q()], { settings: bad });
  assert.ok(errors.some(e => e.includes('LLM_PROVIDER')));
  assert.ok(errors.some(e => e.includes('LLM_CONFIDENCE_THRESHOLD')));
  assert.ok(errors.some(e => e.includes('WORKER_BATCH_SIZE')));
});

test('LLM の問題があるのに LLM_MODEL が空ならエラー', () => {
  const noModel = Object.assign({}, settings, { LLM_MODEL: '' });
  assert.ok(run([llmQ], { settings: noModel }).some(e => e.includes('LLM_MODEL')));
  assert.deepEqual(run([q()], { settings: noModel }), []);
});

test('有効な問題が1つも無ければエラー', () => {
  assert.ok(run([]).some(e => e.includes('問題')));
});

test('LLM の問題があるのに、まだ使えない提供元を選んでいればエラー', () => {
  const openai = Object.assign({}, settings, { LLM_PROVIDER: 'OPENAI' });
  assert.ok(run([llmQ], { settings: openai }).some(e => e.includes('OPENAI') && e.includes('まだ使えません')));
  assert.deepEqual(run([q()], { settings: openai }), []);
});
