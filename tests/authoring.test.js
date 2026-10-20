const test = require('node:test');
const assert = require('node:assert/strict');
const { assignQuestionIds, toQuestionRows, fromQuestionRows, toTeacherMessage, mergeWithExisting } = require('../src/Authoring.js');

function row(over) {
  return Object.assign({ 掲載: true, 問題文: '日本の首都は？', 種類: '短答', 配点: 5, 正答: '東京', 別解: '東京都', 選択肢: '', 採点の観点: '', 必須: true, 問題番号: '' }, over);
}

test('問題番号が無い行に、既知の最大の次から番号を付ける', () => {
  const ids = assignQuestionIds([row({ 問題番号: 'Q002' }), row(), row()], ['Q001', 'Q002', 'Q007']);
  assert.deepEqual(ids, ['Q002', 'Q008', 'Q009']);
});

test('番号が重なった行（行のコピー）は、後ろの行を振り直す', () => {
  const ids = assignQuestionIds([row({ 問題番号: 'Q003' }), row({ 問題番号: 'Q003' })], ['Q003']);
  assert.deepEqual(ids, ['Q003', 'Q004']);
});

test('問題文も種類も無い空行には番号を付けない', () => {
  const ids = assignQuestionIds([row({ 問題文: '', 種類: '', 配点: '', 正答: '', 別解: '', 掲載: false, 必須: false }), row()], []);
  assert.deepEqual(ids, ['', 'Q001']);
});

test('並べ替えても番号は行についたまま', () => {
  const ids = assignQuestionIds([row({ 問題番号: 'Q002' }), row({ 問題番号: 'Q001' })], ['Q001', 'Q002']);
  assert.deepEqual(ids, ['Q002', 'Q001']);
});

test('種類から、問題タイプ・採点方式・判定方式を決める', () => {
  const kinds = ['短答', '数値', '記述', '選択', '複数選択', 'プルダウン'];
  const { rows, errors } = toQuestionRows(kinds.map((k, i) => row({ 種類: k, 問題番号: 'Q00' + (i + 1), 選択肢: 'A||B', 正答: k === '数値' ? '3' : 'A', 別解: k === '数値' ? '0.1' : '' })));
  assert.deepEqual(errors, []);
  assert.deepEqual(rows.map((r) => [r.question_type, r.grading_mode, r.auto_rule]), [
    ['SHORT_TEXT', 'AUTO', 'ANY_OF'],
    ['SHORT_TEXT', 'AUTO', 'NUMBER'],
    ['PARAGRAPH', 'MANUAL', ''],
    ['MULTIPLE_CHOICE', 'AUTO', 'NATIVE'],
    ['CHECKBOX', 'AUTO', 'NATIVE'],
    ['DROPDOWN', 'AUTO', 'NATIVE']
  ]);
  assert.equal(rows[1].tolerance, '0.1');
  assert.equal(rows[1].alternatives, '');
});

test('掲載・必須・配点・正答・別解・選択肢・採点の観点を写す', () => {
  const { rows } = toQuestionRows([row({ 問題番号: 'Q001', 掲載: false, 必須: false, 採点の観点: '観点' })]);
  const r = rows[0];
  assert.deepEqual([r.enabled, r.required, r.points, r.correct_answer, r.alternatives, r.question_id, r.notes],
    [false, false, 5, '東京', '東京都', 'Q001', '観点']);
});

test('記述の正答は模範解答として残す', () => {
  const { rows } = toQuestionRows([row({ 種類: '記述', 問題番号: 'Q001', 正答: '模範', 採点の観点: '理由で2点' })]);
  assert.deepEqual([rows[0].correct_answer, rows[0].notes, rows[0].rubric_id], ['模範', '理由で2点', '']);
});

test('掲載している行の種類が不正なら、行番号つきのエラー', () => {
  const { errors } = toQuestionRows([row({ 種類: 'なぞ', 問題番号: 'Q001' })], 11);
  assert.ok(errors.some((e) => e.includes('11行目') && e.includes('種類')));
});

test('空行は写さない', () => {
  const { rows } = toQuestionRows([row({ 問題文: '', 種類: '', 配点: '', 正答: '', 別解: '', 問題番号: '', 掲載: false, 必須: false })]);
  assert.equal(rows.length, 0);
});

test('裏方の Questions から試験作成の行へ戻せる（既存データの引っ越し）', () => {
  const questions = [
    { enabled: true, question_id: 'Q001', question_text: '首都', question_type: 'SHORT_TEXT', required: true, points: 5, grading_mode: 'AUTO', auto_rule: 'ANY_OF', correct_answer: '東京', alternatives: '東京都', options: '', rubric_id: '' },
    { enabled: false, question_id: 'Q002', question_text: '数', question_type: 'SHORT_TEXT', required: true, points: 2, grading_mode: 'AUTO', auto_rule: 'NUMBER', correct_answer: '3', tolerance: '0.1' },
    { enabled: true, question_id: 'Q003', question_text: '説明', question_type: 'PARAGRAPH', required: true, points: 4, grading_mode: 'MANUAL', rubric_id: 'R1', correct_answer: '' }
  ];
  const rubrics = [
    { rubric_id: 'R1', rubric_version: 1, criterion_id: 'C01', criterion: '理由', max_points: 2, description: '理由がある' },
    { rubric_id: 'R1', rubric_version: 1, criterion_id: 'C02', criterion: '例', max_points: 2, description: '例がある' }
  ];
  const out = fromQuestionRows(questions, rubrics);
  assert.deepEqual(out.map((r) => [r.問題番号, r.種類, r.掲載]), [['Q001', '短答', true], ['Q002', '数値', false], ['Q003', '記述', true]]);
  assert.equal(out[1].別解, '0.1');
  assert.ok(out[2].採点の観点.includes('理由（2点）: 理由がある'));
  assert.ok(out[2].採点の観点.includes('例（2点）: 例がある'));
});

test('検証メッセージの英語の列名を、試験作成シートの列名にする', () => {
  assert.equal(toTeacherMessage('ERROR: Q004 pointsは0以上の整数で入力してください。'), '・Q004 配点は0以上の整数で入力してください。');
  assert.equal(toTeacherMessage('ERROR: Q005 MULTIPLE_CHOICEなのにoptionsがありません。'), '・Q005 選択なのに選択肢がありません。');
});

test('検証メッセージに英語の言葉を残さない', () => {
  const msgs = [
    'ERROR: 有効な問題がありません。Questionsシートで enabled を TRUE にした問題を入力してください。',
    'ERROR: Q001 NUMBERなのにcorrect_answerが数値ではありません。',
    'ERROR: Q001 NATIVEは選択式（MULTIPLE_CHOICE/CHECKBOX/DROPDOWN）の問題でだけ使えます。',
    'ERROR: Settings LLM_MODELが未設定です'
  ];
  msgs.map(toTeacherMessage).forEach((m) => {
    assert.ok(!/ERROR|Questions|enabled|TRUE|NUMBER|NATIVE|MULTIPLE_CHOICE|correct_answer/.test(m), m);
  });
});

test('番号は形に関係なく保つ（001 や q1 も付け替えない）', () => {
  assert.deepEqual(assignQuestionIds([row({ 問題番号: '001' }), row({ 問題番号: 'q1' }), row()], ['001', 'q1']), ['001', 'q1', 'Q001']);
});

test('999番の次は Q1000（重ならない）', () => {
  assert.deepEqual(assignQuestionIds([row()], ['Q999']), ['Q1000']);
});

test('裏方だけの設定を同じ問題番号から引き継ぎ、消えた問題は掲載なしで残す', () => {
  const fresh = toQuestionRows([row({ 問題番号: 'Q001' }), row({ 問題番号: 'Q002', 種類: '記述' })]).rows;
  const existing = [
    { question_id: 'Q001', question_type: 'SHORT_TEXT', auto_rule: 'CONTAINS', grading_mode: 'AUTO', section: '基礎', feedback_correct: 'よし', feedback_incorrect: '' },
    { question_id: 'Q002', question_type: 'PARAGRAPH', grading_mode: 'LLM', rubric_id: 'R1', section: '' },
    { question_id: 'Q009', question_type: 'SHORT_TEXT', grading_mode: 'AUTO', enabled: true, question_text: '消えた問題' }
  ];
  const merged = mergeWithExisting(fresh, existing);
  assert.deepEqual([merged[0].auto_rule, merged[0].section, merged[0].feedback_correct], ['CONTAINS', '基礎', 'よし']);
  assert.deepEqual([merged[1].grading_mode, merged[1].rubric_id], ['LLM', 'R1']);
  assert.deepEqual([merged[2].question_id, merged[2].enabled, merged[2].question_text], ['Q009', false, '消えた問題']);
});
