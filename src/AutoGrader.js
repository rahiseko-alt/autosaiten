/**
 * ルールだけで採点する（AUTO）。Apps Script の API には依存しない。
 */

function agSplit_(value) {
  var list = (typeof splitList === 'function') ? splitList : require('./Utils.js').splitList;
  return list(value);
}

/**
 * 前処理: NFKC、ラテン文字のアクセント記号を外す、前後の空白除去、連続空白を1つに、
 * 全言語の大文字を小文字に（ADR 0008）。日本語の濁点・半濁点は外さない。意味の変換はしない。
 * @param {*} value
 * @return {string}
 */
function normalizeText(value) {
  if (value === undefined || value === null) return '';
  return String(value)
    .normalize('NFKC')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .normalize('NFC')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/** 各国の十進数字（アラビア・インド数字など）を半角の 0〜9 に直す。 */
function agAsciiDigits_(text) {
  return text.replace(/\p{Nd}/gu, function (ch) {
    var cp = ch.codePointAt(0);
    var zero = cp;
    while (cp - zero < 9 && /\p{Nd}/u.test(String.fromCodePoint(zero - 1))) zero -= 1;
    return String(cp - zero);
  });
}

/** 数として読む。読めなければ NaN。「3,14」は小数、「1,200」は桁区切りとみなす。 */
function agParseNumber_(text) {
  var t = agAsciiDigits_(text).replace(/\s+/g, '');
  if (/^[+-]?\d+,\d{1,2}$/.test(t)) t = t.replace(',', '.');
  else t = t.replace(/,/g, '');
  return t === '' ? NaN : Number(t);
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
  // 一致しなくても、別の言語で正しく答えている可能性があるか（ADR 0008）
  var mayBeOtherLanguage = false;

  if (question.question_type === 'CHECKBOX') {
    var selected = Array.isArray(answer) ? answer : agSplit_(answer);
    correct = agSameSet_(selected, agSplit_(question.correct_answer));
  } else {
    var text = normalizeText(Array.isArray(answer) ? answer[0] : answer);
    if (rule === 'NATIVE') {
      correct = text === normalizeText(question.correct_answer);
    } else if (rule === 'EXACT') {
      correct = text === normalizeText(question.correct_answer);
      mayBeOtherLanguage = true;
    } else if (rule === 'ANY_OF') {
      var accepted = [question.correct_answer].concat(agSplit_(question.alternatives));
      correct = accepted.some(function (a) { return text === normalizeText(a); });
      mayBeOtherLanguage = true;
    } else if (rule === 'CONTAINS') {
      var keywords = agSplit_(question.correct_answer).map(normalizeText);
      correct = keywords.length > 0 && keywords.every(function (k) { return text.indexOf(k) >= 0; });
      mayBeOtherLanguage = true;
    } else if (rule === 'NUMBER') {
      var value = agParseNumber_(text);
      var tolerance = Number(question.tolerance) || 0;
      correct = isFinite(value) && Math.abs(value - Number(question.correct_answer)) <= tolerance;
      // 数として読めない回答（「二十五」「twenty-five」など）だけ、意味の確認に回す
      mayBeOtherLanguage = !isFinite(value);
    }
  }
  if (correct) return { score: max, max: max, status: 'AUTO_GRADED' };
  return { score: 0, max: max, status: mayBeOtherLanguage ? 'REVIEW_REQUIRED' : 'AUTO_GRADED' };
}

if (typeof module !== 'undefined') module.exports = { normalizeText: normalizeText, gradeAuto: gradeAuto };
