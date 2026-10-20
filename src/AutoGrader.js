/**
 * ルールだけで採点する（AUTO）。Apps Script の API には依存しない。
 */

function agSplit_(value) {
  var list = (typeof splitList === 'function') ? splitList : require('./Utils.js').splitList;
  return list(value);
}

/**
 * 前処理: NFKC、前後の空白除去、連続空白を1つに、ASCII英字を小文字化。
 * 日本語の意味変換はしない。
 * @param {*} value
 * @return {string}
 */
function normalizeText(value) {
  if (value === undefined || value === null) return '';
  return String(value)
    .normalize('NFKC')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[A-Z]/g, function (c) { return c.toLowerCase(); });
}

function agIsUnanswered_(answer) {
  if (Array.isArray(answer)) return answer.every(function (a) { return normalizeText(a) === ''; });
  return normalizeText(answer) === '';
}

function agSameSet_(a, b) {
  var x = a.map(normalizeText).filter(Boolean).sort();
  var y = b.map(normalizeText).filter(Boolean).sort();
  return x.length === y.length && x.every(function (v, i) { return v === y[i]; });
}

/**
 * @param {Object} question 問題定義（Questionsの1行）
 * @param {(string|string[])} answer 学生の回答（CHECKBOX は配列）
 * @return {{score: number, max: number, status: string}}
 */
function gradeAuto(question, answer) {
  var max = Number(question.points) || 0;
  if (agIsUnanswered_(answer)) return { score: 0, max: max, status: 'UNANSWERED' };

  var rule = String(question.auto_rule || '').trim();
  var correct = false;

  if (question.question_type === 'CHECKBOX') {
    var selected = Array.isArray(answer) ? answer : agSplit_(answer);
    correct = agSameSet_(selected, agSplit_(question.correct_answer));
  } else {
    var text = normalizeText(Array.isArray(answer) ? answer[0] : answer);
    if (rule === 'EXACT' || rule === 'NATIVE') {
      correct = text === normalizeText(question.correct_answer);
    } else if (rule === 'ANY_OF') {
      var accepted = [question.correct_answer].concat(agSplit_(question.alternatives));
      correct = accepted.some(function (a) { return text === normalizeText(a); });
    } else if (rule === 'CONTAINS') {
      var keywords = agSplit_(question.correct_answer).map(normalizeText);
      correct = keywords.length > 0 && keywords.every(function (k) { return text.indexOf(k) >= 0; });
    } else if (rule === 'NUMBER') {
      var value = Number(text.replace(/,/g, ''));
      var tolerance = Number(question.tolerance) || 0;
      correct = text !== '' && isFinite(value) && Math.abs(value - Number(question.correct_answer)) <= tolerance;
    }
  }
  return { score: correct ? max : 0, max: max, status: 'AUTO_GRADED' };
}

if (typeof module !== 'undefined') module.exports = { normalizeText: normalizeText, gradeAuto: gradeAuto };
