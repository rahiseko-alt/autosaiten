const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeText, gradeAuto } = require('../src/AutoGrader.js');

function q(over) {
  return Object.assign({
    question_type: 'SHORT_TEXT', points: 5, auto_rule: 'EXACT',
    correct_answer: 'google drive', alternatives: '', tolerance: '', options: ''
  }, over);
}

test('normalizeText は前後空白・連続空白・英字大小・全角を整える', () => {
  assert.equal(normalizeText(' Google   Drive '), 'google drive');
  assert.equal(normalizeText('ＡＢＣ　１２３'), 'abc 123');
});

test('EXACT は前処理後の完全一致で満点', () => {
  assert.equal(gradeAuto(q(), ' Google Drive ').score, 5);
  assert.equal(gradeAuto(q(), 'Google Docs').score, 0);
});

test('短答で、正答と同じ文字（日本語）の誤答は0点で確定する', () => {
  const r = gradeAuto(q({ auto_rule: 'ANY_OF', correct_answer: '東京', alternatives: '東京都' }), '大阪');
  assert.deepEqual([r.score, r.status], [0, 'AUTO_GRADED']);
  assert.equal(gradeAuto(q({ auto_rule: 'ANY_OF', correct_answer: '東京' }), 'おおさか').status, 'AUTO_GRADED');
});

test('短答で、正答と違う文字（別の言語）の回答だけ要確認（仮に0点）', () => {
  const tokyo = q({ auto_rule: 'ANY_OF', correct_answer: '東京' });
  assert.deepEqual([gradeAuto(tokyo, 'Tokyo').score, gradeAuto(tokyo, 'Tokyo').status], [0, 'REVIEW_REQUIRED']);
  assert.equal(gradeAuto(tokyo, '도쿄').status, 'REVIEW_REQUIRED');
  assert.equal(gradeAuto(tokyo, 'Токио').status, 'REVIEW_REQUIRED');
  assert.equal(gradeAuto(q({ auto_rule: 'CONTAINS', correct_answer: '価格' }), 'price').status, 'REVIEW_REQUIRED');
});

test('別解に英語があれば、英語の誤答は0点で確定する', () => {
  const r = gradeAuto(q({ auto_rule: 'ANY_OF', correct_answer: '東京', alternatives: 'Tokyo' }), 'Osaka');
  assert.equal(r.status, 'AUTO_GRADED');
});

test('簡体字は日本語と同じ漢字の仲間として扱う（別解に書かなければ0点）', () => {
  assert.equal(gradeAuto(q({ auto_rule: 'ANY_OF', correct_answer: '東京' }), '东京').status, 'AUTO_GRADED');
});

test('正規化: どの言語でも大文字小文字をそろえ、ラテン文字のアクセントを外す', () => {
  assert.equal(normalizeText('TŌKYŌ'), 'tokyo');
  assert.equal(normalizeText('МОСКВА'), 'москва');
  assert.equal(normalizeText('São Paulo'), 'sao paulo');
});

test('正規化: 日本語の濁点・半濁点は外さない', () => {
  assert.equal(normalizeText('ガパ'), 'ガパ');
  assert.equal(normalizeText('ｶﾞ'), 'ガ');
});

test('数値: 各国の数字を読み取る', () => {
  const question = q({ auto_rule: 'NUMBER', correct_answer: '25', tolerance: '0' });
  assert.equal(gradeAuto(question, '٢٥').score, 5);  // アラビア・インド数字
  assert.equal(gradeAuto(question, '२५').score, 5);  // デーヴァナーガリー数字
  assert.equal(gradeAuto(question, '２５').score, 5);
});

test('数値: 小数点のコンマ（3,14）と桁区切り（1,200）を読み分ける', () => {
  assert.equal(gradeAuto(q({ auto_rule: 'NUMBER', correct_answer: '3.14', tolerance: '0' }), '3,14').score, 5);
  assert.equal(gradeAuto(q({ auto_rule: 'NUMBER', correct_answer: '1200', tolerance: '0' }), '1,200').score, 5);
});

test('数値: 数として読めて許容差の外なら不正解で確定、日本語で読めない回答も確定、別の言語の言葉だけ要確認', () => {
  const question = q({ auto_rule: 'NUMBER', correct_answer: '25', tolerance: '0.1' });
  assert.deepEqual([gradeAuto(question, '26').score, gradeAuto(question, '26').status], [0, 'AUTO_GRADED']);
  assert.equal(gradeAuto(question, '二十五').status, 'AUTO_GRADED');
  assert.equal(gradeAuto(question, 'twenty-five').status, 'REVIEW_REQUIRED');
});

test('未回答は「未回答」として0点で確定する', () => {
  const result = gradeAuto(q(), '   ');
  assert.equal(result.score, 0);
  assert.equal(result.status, 'UNANSWERED');
  assert.equal(gradeAuto(q({ question_type: 'CHECKBOX', auto_rule: 'NATIVE' }), []).status, 'UNANSWERED');
});

test('正解は AUTO_GRADED で max を返す', () => {
  const result = gradeAuto(q(), 'google drive');
  assert.deepEqual([result.status, result.max], ['AUTO_GRADED', 5]);
});

test('選択式の不正解は、選択肢が決まっているので AUTO_GRADED で確定', () => {
  const question = q({ question_type: 'MULTIPLE_CHOICE', auto_rule: 'NATIVE', correct_answer: 'Price', options: 'Product||Price' });
  assert.equal(gradeAuto(question, 'Product').status, 'AUTO_GRADED');
});
