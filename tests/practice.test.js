const test = require('node:test');
const assert = require('node:assert/strict');
const { practiceFormSpec, practiceMaterial, planFormSetup, rosterByClass } = require('../practice/Practice.js');
const reception = require('../reception/Reception.js');

test('練習フォームは、氏名欄・クラス欄・説明・ただし書き・タグ名・結果欄の順に並ぶ', () => {
  const spec = practiceFormSpec(['国際', '総合']);
  assert.equal(spec.nameItem.required, true);
  assert.deepEqual(spec.classItem.choices, ['国際', '総合']);
  assert.equal(spec.classItem.required, true);
  assert.deepEqual(spec.items.map(i => i.kind), ['INFO', 'INFO', 'TEXT', 'PARAGRAPH']);
  assert.equal(spec.items[2].required, true);
  assert.equal(spec.items[3].required, true);
});

test('練習フォームの文面は、本番の試験作成シートと同じ', () => {
  const titles = practiceFormSpec(['国際']).items.map(i => i.title);
  assert.deepEqual(titles, [
    '受付ページに表示された資料をファクトチェックしてください。',
    'ただし、AIだけでは判断できない情報がある場合は、その箇所にタグを付けさせなさい。',
    '判断できない箇所に貼るタグの名前を決めてください。',
    'ファクトチェックの結果を貼り付けてください。',
  ]);
});

test('練習フォームは、採点も回答の制限もしない', () => {
  const spec = practiceFormSpec(['国際']);
  assert.equal(spec.isQuiz, false);
  assert.equal(spec.limitOneResponse, false);
  assert.equal(spec.collectEmail, false);
  assert.equal(spec.allowResponseEdits, false);
  assert.equal(spec.items.some(i => i.points !== undefined), false);
});

test('名簿にクラスがなければ、フォームを作らず先生に知らせる', () => {
  assert.throws(() => practiceFormSpec([]), /名簿/);
});

test('練習の資料は、条件文とAIの説明を含み、いつも同じ本文を返す', () => {
  const text = practiceMaterial();
  assert.equal(typeof text, 'string');
  assert.ok(text.includes('【条件文】'));
  assert.ok(text.includes('【AIの説明】'));
  assert.equal(practiceMaterial(), text);
});

test('保存済みのフォームがあれば、新しく作らず中身だけ作り直す（外から何度呼ばれてもフォームは増えない）', () => {
  assert.deepEqual(planFormSetup({}), { action: 'create' });
  assert.deepEqual(planFormSetup(undefined), { action: 'create' });
  assert.deepEqual(planFormSetup({ formId: 'abc' }), { action: 'update', formId: 'abc' });
});

test('名簿の整理は本番の受付と同じ結果になる', () => {
  const rows = [
    { クラス: '国際', 氏名: 'A' }, { クラス: '総合', 氏名: 'B' },
    { クラス: '国際', 氏名: ' C ' }, { クラス: '', 氏名: 'D' }, { クラス: '総合', 氏名: '' },
  ];
  assert.deepEqual(rosterByClass(rows), reception.rosterByClass(rows));
});
