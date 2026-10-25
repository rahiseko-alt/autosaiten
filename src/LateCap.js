/**
 * 授業外の提出の上限（ADR 0013）。回答の行から、合計点を上限点までに抑える `__LATE__` の行を決める。
 * Apps Script の API には依存しない。
 */

function lcLateId_() {
  return (typeof LATE_QUESTION_ID !== 'undefined') ? LATE_QUESTION_ID : require('./Commentary.js').LATE_QUESTION_ID;
}

function lcTotal_(rows) {
  var total = (typeof totalScore === 'function') ? totalScore : require('./Commentary.js').totalScore;
  return total(rows);
}

function lcBlank_(v) {
  return v === undefined || v === null || String(v).trim() === '';
}

/** クラスの比べ方。全角半角（NFKC）と前後の空白の違いをそろえる。 */
function lcNorm_(v) {
  return String(v === undefined || v === null ? '' : v).normalize('NFKC').trim();
}

/** 氏名の比べ方。集計表の照合（gradebook/Gradebook.js の gbName_）と同じく、NFKC・大文字小文字・空白の違いをそろえる。 */
function lcName_(v) {
  return lcNorm_(v).toLowerCase().replace(/\s+/g, ' ').trim();
}

function lcTime_(v) {
  if (lcBlank_(v)) return null;
  var t = new Date(v).getTime();
  return isNaN(t) ? null : t;
}

/**
 * __LATE__ の manual_score は、抑える点（0 以下の数）。0 なら抑えない。加点はしない。
 * 合計点より多くは抑えられない（抑えた後の合計が負にならない）。
 * @param {*} value manual_score
 * @param {number} total __LATE__ を除く最終点の和
 */
function validLateManualScore(value, total) {
  if (lcBlank_(value)) return false;
  var n = Number(value);
  return isFinite(n) && n <= 0 && n >= -(Number(total) || 0);
}

/** 名簿で氏名から引いたクラス。見つからない、または別々のクラスに同じ氏名があれば null。 */
function lcRosterClass_(roster, name) {
  var key = lcName_(name);
  var classes = {};
  (roster || []).forEach(function (r) {
    if (key !== '' && lcName_(r.氏名) === key) classes[lcNorm_(r.クラス)] = true;
  });
  var found = Object.keys(classes);
  return found.length === 1 ? found[0] : null;
}

/**
 * 1回答の `__LATE__` の行を決める。合計点は `__LATE__` を除く最終点の和。
 * - 上限点が空欄、授業内の提出、合計が上限以下 → 行なし（null）
 * - 名簿で見つからない、選んだクラスと名簿のクラスが違う、終わる日時が空欄 → 要確認（先生が manual_score で決める）
 * - 授業外で合計が上限を超える → 最終点「上限点 − 合計点」
 * manual_score が入った既存の `__LATE__` 行は、先生の判断としてそのまま残す。
 * @param {{rows: Object[], cap: *, classEnds: Object, roster: Object[], now: Date}} input
 *   rows は1回答分の Results の行（既存の __LATE__ を含んでよい）。classEnds はクラス -> 授業の終わる日時。
 *   roster は名簿の行（クラス・氏名）
 * @return {Object|null} __LATE__ の Results の行
 */
function planLateRow(input) {
  var lateId = lcLateId_();
  var existing = null;
  var rows = [];
  input.rows.forEach(function (r) {
    if (String(r.question_id) === lateId) existing = r;
    else rows.push(r);
  });
  if (existing && !lcBlank_(existing.manual_score)) return Object.assign({}, existing);
  if (lcBlank_(input.cap) || rows.length === 0) return null;

  var cap = Number(input.cap);
  var total = lcTotal_(rows);
  // 抑える分が無ければ、授業内か授業外かを決める必要もない
  if (total <= cap) return null;

  var base = rows[0];
  var reason = '';
  var rosterClass = lcRosterClass_(input.roster, base.respondent_name);
  var end = rosterClass === null ? null : lcTime_((input.classEnds || {})[rosterClass]);
  if (rosterClass === null) {
    reason = '名簿で氏名「' + base.respondent_name + '」のクラスが決められません';
  } else if (lcNorm_(base.respondent_class) !== rosterClass) {
    reason = '選んだクラス（' + base.respondent_class + '）と名簿のクラス（' + rosterClass + '）が違います';
  } else if (end === null) {
    reason = rosterClass + 'の授業の終わる日時が空欄です';
  }
  if (reason === '') {
    var submitted = lcTime_(base.submitted_at);
    if (submitted !== null && submitted <= end) return null;
  }

  var review = reason !== '';
  return {
    response_id: base.response_id, form_version: base.form_version, submitted_at: base.submitted_at,
    respondent_email: base.respondent_email, question_id: lateId,
    question_text_snapshot: '授業時間外の提出（上限' + cap + '点）', answer: '',
    grading_mode: review ? 'MANUAL' : 'AUTO', auto_score: review ? '' : cap - total, llm_score: '', manual_score: '',
    final_score: review ? '' : cap - total, max_score: 0, status: review ? 'REVIEW_REQUIRED' : 'AUTO_GRADED',
    confidence: '',
    grading_reason: review
      ? reason + '。授業外として抑えるなら manual_score に ' + (cap - total) + ' を、抑えないなら 0 を入れてください'
      : '授業時間外の提出のため、合計' + total + '点を上限の' + cap + '点に抑えました',
    provider: '', model: '', prompt_version: '', rubric_id: '', rubric_version: '', graded_at: input.now,
    respondent_name: base.respondent_name, respondent_class: base.respondent_class
  };
}

if (typeof module !== 'undefined') {
  module.exports = { planLateRow: planLateRow, validLateManualScore: validLateManualScore };
}
