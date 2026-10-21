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

/** 文字の種類（言語のまとまり）。日本語は漢字・ひらがな・カタカナをまとめて1つとする。 */
var AG_SCRIPTS_ = [
  ['ja', /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u],
  ['latin', /\p{Script=Latin}/u],
  ['hangul', /\p{Script=Hangul}/u],
  ['cyrillic', /\p{Script=Cyrillic}/u],
  ['arabic', /\p{Script=Arabic}/u],
  ['devanagari', /\p{Script=Devanagari}/u],
  ['thai', /\p{Script=Thai}/u],
  ['greek', /\p{Script=Greek}/u],
  ['hebrew', /\p{Script=Hebrew}/u]
];

/** 文字列に含まれる文字の種類の一覧。数字・記号だけなら空。上の一覧に無い文字は 'other'。 */
function agScripts_(text) {
  var found = {};
  Array.from(String(text)).forEach(function (ch) {
    if (!/\p{L}/u.test(ch)) return;
    for (var i = 0; i < AG_SCRIPTS_.length; i++) {
      if (AG_SCRIPTS_[i][1].test(ch)) { found[AG_SCRIPTS_[i][0]] = true; return; }
    }
    found.other = true;
  });
  return Object.keys(found);
}

/** 回答に、正答側（正答・別解）に無い種類の文字があるか。あれば別の言語で答えている可能性がある。 */
function agOtherScript_(answerText, acceptedTexts) {
  var accepted = [];
  acceptedTexts.forEach(function (t) { accepted = accepted.concat(agScripts_(t)); });
  return agScriptOutside_(answerText, accepted);
}

/** 回答に、allowed に無い種類の文字があるか。 */
function agScriptOutside_(answerText, allowed) {
  return agScripts_(answerText).some(function (s) { return allowed.indexOf(s) < 0; });
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
  // 一致しなくても、正答と違う文字（別の言語）で正しく答えている可能性があるか（ADR 0008）
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
      mayBeOtherLanguage = agOtherScript_(text, [question.correct_answer]);
    } else if (rule === 'ANY_OF') {
      var accepted = [question.correct_answer].concat(agSplit_(question.alternatives));
      correct = accepted.some(function (a) { return text === normalizeText(a); });
      mayBeOtherLanguage = agOtherScript_(text, accepted);
    } else if (rule === 'CONTAINS') {
      var keywords = agSplit_(question.correct_answer).map(normalizeText);
      correct = keywords.length > 0 && keywords.every(function (k) { return text.indexOf(k) >= 0; });
      mayBeOtherLanguage = agOtherScript_(text, keywords);
    } else if (rule === 'NUMBER') {
      var value = agParseNumber_(text);
      var tolerance = Number(question.tolerance) || 0;
      correct = isFinite(value) && Math.abs(value - Number(question.correct_answer)) <= tolerance;
      // 数として読めず、日本語以外の言葉で書かれた回答（twenty-five など）だけ意味の確認に回す
      mayBeOtherLanguage = !isFinite(value) && agScriptOutside_(text, ['ja']);
    }
  }
  if (correct) return { score: max, max: max, status: 'AUTO_GRADED' };
  return { score: 0, max: max, status: mayBeOtherLanguage ? 'REVIEW_REQUIRED' : 'AUTO_GRADED' };
}

if (typeof module !== 'undefined') module.exports = { normalizeText: normalizeText, gradeAuto: gradeAuto };
