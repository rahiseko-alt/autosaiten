const test = require('node:test');
const assert = require('node:assert/strict');
const { buildCommentary, totalScore } = require('../src/Commentary.js');

function row(over) {
  return Object.assign({
    question_id: 'Q001', question_text_snapshot: '日本の首都は？', final_score: 5, max_score: 5,
    status: 'AUTO_GRADED', grading_reason: ''
  }, over);
}

test('講評には、問題ごとに問題文・点数・満点・採点の理由が順に並ぶ', () => {
  const text = buildCommentary([
    row(),
    row({ question_id: 'Q002', question_text_snapshot: '理由を説明せよ', final_score: 7, max_score: 10, status: 'MANUAL_GRADED', grading_reason: '例が足りません。' })
  ]);
  assert.equal(text, '日本の首都は？：5 / 5点\n\n理由を説明せよ：7 / 10点\n例が足りません。');
});

test('問題文が複数行なら、最初の行だけを見出しに使う', () => {
  const text = buildCommentary([row({ question_text_snapshot: '資料を読め。\n確認する項目：A／B' })]);
  assert.equal(text, '資料を読め。：5 / 5点');
});

test('氏名欄・クラス欄・採点結果の欄・加点なしの欄は、内訳に出さない', () => {
  const text = buildCommentary([
    row({ question_id: '__NAME__', question_text_snapshot: '氏名（Name）' }),
    row({ question_id: '__CLASS__', question_text_snapshot: 'クラス（Class）' }),
    row({ question_id: '__RESULT__', question_text_snapshot: '採点結果（「確認しました」を選んでください）' }),
    row({ question_id: 'Q003', question_text_snapshot: 'タグの名前', final_score: 0, max_score: 0, status: 'NO_POINTS', grading_reason: '加点なしの欄' }),
    row()
  ]);
  assert.equal(text, '日本の首都は？：5 / 5点');
});

test('授業外の提出で自動で抑えた行は内訳に出さず、最後に上限点を書き添える（上限点は行の問題文から読む）', () => {
  const rows = [
    row({ final_score: 5 }),
    row({ question_id: 'Q002', question_text_snapshot: '理由を説明せよ', final_score: 10, max_score: 10, status: 'MANUAL_GRADED' }),
    row({ question_id: '__LATE__', question_text_snapshot: '授業時間外の提出（上限12点）', final_score: -3, max_score: 0, status: 'AUTO_GRADED', manual_score: '' })
  ];
  assert.equal(buildCommentary(rows),
    '日本の首都は？：5 / 5点\n\n理由を説明せよ：10 / 10点\n\n授業時間外の提出のため、合計点は上限の12点までです');
  assert.equal(totalScore(rows), 12);
});

test('上限点は呼び出し側から渡してもよく、渡した値を使う', () => {
  const rows = [row({ final_score: 5 }), row({ question_id: '__LATE__', question_text_snapshot: '', final_score: -2, max_score: 0, status: 'AUTO_GRADED', manual_score: '' })];
  assert.ok(buildCommentary(rows, 3).endsWith('授業時間外の提出のため、合計点は上限の3点までです'));
});

test('先生が manual_score で抑えたときは、抑えた後の合計点を書き添える', () => {
  const rows = [
    row({ final_score: 5 }),
    row({ question_id: '__LATE__', question_text_snapshot: '授業時間外の提出（上限2点）', final_score: -1, max_score: 0, status: 'MANUAL_GRADED', manual_score: -1 })
  ];
  assert.ok(buildCommentary(rows).endsWith('授業時間外の提出のため、合計点は4点です'), buildCommentary(rows));
});

test('授業外でも抑えなかった（0点の）行なら、書き添えない', () => {
  const text = buildCommentary([row(), row({ question_id: '__LATE__', final_score: 0, max_score: '', status: 'MANUAL_GRADED' })]);
  assert.equal(text, '日本の首都は？：5 / 5点');
});

test('合計点は最終点の和で、空の最終点は数えない', () => {
  assert.equal(totalScore([row(), row({ question_id: 'Q002', final_score: '' }), row({ question_id: 'Q003', final_score: 2 })]), 7);
  assert.equal(totalScore([]), 0);
});
