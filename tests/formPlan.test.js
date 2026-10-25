const test = require('node:test');
const assert = require('node:assert/strict');
const { definitionHash, decideFormAction, buildFormSpec } = require('../src/FormPlan.js');

function q(over) {
  return Object.assign({
    enabled: true, question_id: 'Q001', section: '基礎', question_text: '日本の首都は？',
    question_type: 'SHORT_TEXT', required: true, points: 5, grading_mode: 'AUTO', auto_rule: 'EXACT',
    correct_answer: '東京', alternatives: '', options: '', feedback_correct: '', feedback_incorrect: ''
  }, over);
}
const settings = { FORM_TITLE: 'テスト', FORM_DESCRIPTION: '', COLLECT_EMAIL: false };

test('同じ定義なら同じハッシュ、問題文が違えば別のハッシュ', () => {
  assert.equal(definitionHash([q()], settings), definitionHash([q()], settings));
  assert.notEqual(definitionHash([q()], settings), definitionHash([q({ question_text: '別' })], settings));
  assert.notEqual(definitionHash([q()], settings), definitionHash([q()], Object.assign({}, settings, { FORM_TITLE: '別' })));
});

test('無効な問題や、フォームに影響しない列の違いはハッシュに影響しない', () => {
  const base = definitionHash([q()], settings);
  assert.equal(definitionHash([q(), q({ enabled: false, question_id: 'Q9' })], settings), base);
  assert.equal(definitionHash([q({ notes: 'メモ', rubric_id: 'R1', tolerance: '1' })], settings), base);
});

test('問題の順番が変わればハッシュも変わる', () => {
  const a = q({ question_id: 'Q1' });
  const b = q({ question_id: 'Q2' });
  assert.notEqual(definitionHash([a, b], settings), definitionHash([b, a], settings));
});

test('フォームが無ければ新規作成', () => {
  assert.equal(decideFormAction({ hasForm: false }), 'CREATE');
});

test('定義が同じなら何もしない（版も増えない）', () => {
  assert.equal(decideFormAction({ hasForm: true, responseCount: 3, sameDefinition: true }), 'NOOP');
  assert.equal(decideFormAction({ hasForm: true, responseCount: 0, sameDefinition: true }), 'NOOP');
});

test('回答が無ければ既存フォームを同期、あれば新しい版', () => {
  assert.equal(decideFormAction({ hasForm: true, responseCount: 0, sameDefinition: false }), 'SYNC');
  assert.equal(decideFormAction({ hasForm: true, responseCount: 1, sameDefinition: false }), 'NEW_VERSION');
});

test('フォーム仕様: 問題タイプごとの種類・必須・選択肢（問題の項目には点数も正解も付けない）', () => {
  const spec = buildFormSpec([
    q(),
    q({ question_id: 'Q2', question_type: 'MULTIPLE_CHOICE', auto_rule: 'NATIVE', correct_answer: 'Price', options: 'Product||Price||Place', section: '基礎' }),
    q({ question_id: 'Q3', question_type: 'CHECKBOX', auto_rule: 'NATIVE', correct_answer: 'A||C', options: 'A||B||C', section: '応用' }),
    q({ question_id: 'Q4', question_type: 'PARAGRAPH', grading_mode: 'LLM', auto_rule: '', correct_answer: '', points: 10, required: false, section: '応用' })
  ], settings);
  assert.equal(spec.items.length, 4);
  assert.deepEqual(spec.items.map(i => i.kind), ['TEXT', 'MULTIPLE_CHOICE', 'CHECKBOX', 'PARAGRAPH']);
  assert.deepEqual(spec.items[1].choices, [
    { value: 'Product', correct: false }, { value: 'Price', correct: false }, { value: 'Place', correct: false }]);
  assert.deepEqual(spec.items[2].choices.map(c => c.correct), [false, false, false]);
  assert.equal(spec.items.some(i => i.points !== undefined), false);
  assert.equal(spec.items[3].required, false);
});

test('フォーム仕様: セクションが変わる問題にだけ見出しを付ける', () => {
  const spec = buildFormSpec([q(), q({ question_id: 'Q2' }), q({ question_id: 'Q3', section: '応用' }), q({ question_id: 'Q4', section: '' })], settings);
  assert.deepEqual(spec.items.map(i => i.section_header), ['基礎', null, '応用', null]);
});

test('フォーム仕様: タイトル・説明・メール収集と、question_id を各項目に持つ', () => {
  const spec = buildFormSpec([q({ feedback_correct: 'よし', feedback_incorrect: 'ざんねん' })], Object.assign({}, settings, { FORM_DESCRIPTION: '説明', COLLECT_EMAIL: true }));
  assert.deepEqual([spec.title, spec.description, spec.collectEmail], ['テスト', '説明', true]);
  assert.deepEqual([spec.items[0].question_id, spec.items[0].feedback_correct, spec.items[0].feedback_incorrect], ['Q001', 'よし', 'ざんねん']);
});

test('フォーム仕様: 問題文の最初の改行までを見出し、残りを説明欄にする', () => {
  const spec = buildFormSpec([q({ question_text: '資料を読め。\n確認する項目：A／B\n二行目' }), q({ question_id: 'Q2' })], settings);
  assert.equal(spec.items[0].title, '資料を読め。');
  assert.equal(spec.items[0].help_text, '確認する項目：A／B\n二行目');
  assert.equal(spec.items[1].title, '日本の首都は？');
  assert.equal(spec.items[1].help_text, '');
});

test('フォーム仕様: 既定で1人1回に制限し、先頭に必須の氏名欄を置く', () => {
  const spec = buildFormSpec([q()], settings);
  assert.equal(spec.limitOneResponse, true);
  assert.deepEqual([spec.nameItem.title, spec.nameItem.required], ['氏名（Name）', true]);
  assert.equal(buildFormSpec([q()], Object.assign({}, settings, { LIMIT_ONE_RESPONSE: 'FALSE' })).limitOneResponse, false);
});

test('説明の欄は答えのない項目になり、見出しと説明に分かれる', () => {
  const spec = buildFormSpec([q({ question_id: 'Q006', question_type: 'INFO', grading_mode: 'NONE', points: '', required: false,
    question_text: 'ただし書き\n2行目' })], settings);
  assert.equal(spec.items[0].kind, 'INFO');
  assert.equal(spec.items[0].title, 'ただし書き');
  assert.equal(spec.items[0].help_text, '2行目');
  assert.equal(spec.items[0].required, false);
});

test('クラスの一覧があれば、氏名欄の次に必須のクラス欄が付く', () => {
  const spec = buildFormSpec([q()], settings, ['国際', '総合']);
  assert.deepEqual(spec.classItem, { title: 'クラス（Class）', required: true, choices: ['国際', '総合'] });
  assert.notEqual(definitionHash([q()], settings, ['国際', '総合']), definitionHash([q()], settings));
});

test('クラスの一覧が無ければクラス欄は付かず、定義の指紋もクラス欄が無い場合と同じ', () => {
  assert.equal('classItem' in buildFormSpec([q()], settings), false);
  assert.equal('classItem' in buildFormSpec([q()], settings, []), false);
  assert.equal(definitionHash([q()], settings, []), definitionHash([q()], settings));
});

test('氏名欄の配点は満点（掲載した問題の配点の合計）になる', () => {
  const spec = buildFormSpec([
    q(),
    q({ question_id: 'Q2', points: 10 }),
    q({ question_id: 'Q3', points: 7, enabled: false }),
    q({ question_id: 'Q4', question_type: 'INFO', grading_mode: 'NONE', points: '' }),
    q({ question_id: 'Q5', question_type: 'PARAGRAPH', grading_mode: 'MANUAL', points: 0 })
  ], settings);
  assert.equal(spec.nameItem.points, 15);
});

test('配点を変えると、定義の指紋も変わる（氏名欄の満点を直すため）', () => {
  assert.notEqual(definitionHash([q()], settings), definitionHash([q({ points: 6 })], settings));
});
