const test = require('node:test');
const assert = require('node:assert/strict');
const { practiceFormSpec, practiceMaterial, planFormSetup, planAnswerSheet, rosterByClass } = require('../practice/Practice.js');
const reception = require('../reception/Reception.js');

test('練習フォームは、氏名欄・クラス欄・問題文・タグ名・結果欄の順に並ぶ', () => {
  const spec = practiceFormSpec(['国際', '総合']);
  assert.equal(spec.nameItem.required, true);
  assert.deepEqual(spec.classItem.choices, ['国際', '総合']);
  assert.equal(spec.classItem.required, true);
  assert.deepEqual(spec.items.map(i => i.kind), ['INFO', 'TEXT', 'PARAGRAPH']);
  assert.equal(spec.items[1].required, true);
  assert.equal(spec.items[2].required, true);
});

test('練習フォームの問題文は、法律違反にならない正しい答えを求め、判断できないときは正直に伝えさせる', () => {
  const titles = practiceFormSpec(['国際']).items.map(i => i.title);
  assert.deepEqual(titles, [
    'Bさんが法律違反にならないように正しい答えを作ってください。ただしBさんの計画だけでは正確に答えられないならば、その旨も正直に伝えてください。',
    '判断できない箇所に貼るタグの名前を決めてください。',
    'Bさんの正しい答えを貼り付けてください。',
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

test('練習の資料は、Bさんの計画とAIの回答を含み、いつも同じ本文を返す', () => {
  const text = practiceMaterial();
  assert.equal(typeof text, 'string');
  assert.ok(text.startsWith('以下はBさんの今後の計画です。'));
  assert.ok(text.includes('【AIの回答】'));
  assert.equal(practiceMaterial(), text);
});

test('練習の資料に、ファクトチェックをするという手がかりを入れない', () => {
  const text = practiceMaterial();
  assert.equal(text.includes('ファクトチェック'), false);
  assert.equal(text.includes('誤りを含む'), false);
  assert.equal(text.includes('前提ではなく'), false);
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

test('練習の回答を入れるシートは、無ければ新しく作り、あればそれを使う（本番のスプレッドシートは使わない）', () => {
  assert.deepEqual(planAnswerSheet({}), { action: 'create' });
  assert.deepEqual(planAnswerSheet(undefined), { action: 'create' });
  assert.deepEqual(planAnswerSheet({ sheetId: 'xyz' }), { action: 'reuse', sheetId: 'xyz' });
});
