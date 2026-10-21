/**
 * 最終点・確定判定・LLM結果の状態判定。Apps Script の API には依存しない。
 */

function scIsBlank_(v) {
  return v === undefined || v === null || String(v).trim() === '';
}

/**
 * 設計書 §26 と補足: manual_score があれば常にそれが最終点。
 * @param {{grading_mode: string, status: string, auto_score?: number, llm_score?: number, manual_score?: *}} row
 * @return {{final_score: (number|null), confirmed: boolean}}
 */
function resolveFinalScore(row) {
  if (!scIsBlank_(row.manual_score)) return { final_score: Number(row.manual_score), confirmed: true };
  if (row.status === 'UNANSWERED' || row.status === 'NO_POINTS') return { final_score: 0, confirmed: true };
  if (row.grading_mode === 'AUTO') return { final_score: Number(row.auto_score), confirmed: row.status !== 'REVIEW_REQUIRED' };
  if (row.grading_mode === 'LLM') {
    var provisional = scIsBlank_(row.llm_score) ? null : Number(row.llm_score);
    return { final_score: provisional, confirmed: row.status === 'LLM_GRADED' };
  }
  return { final_score: null, confirmed: false };
}

/** 回答内の全問題が確定したときだけ true。問題が無ければ false。 */
function isResponseFinalized(rows) {
  return rows.length > 0 && rows.every(function (r) { return resolveFinalScore(r).confirmed; });
}

/** 教師が入れた manual_score が、0以上で配点以下の数値か。 */
function validManualScore(value, max) {
  if (scIsBlank_(value)) return false;
  var n = Number(value);
  return isFinite(n) && n >= 0 && (max === undefined || max === '' || n <= Number(max));
}

/** 信頼度が閾値以上なら LLM_GRADED、未満または不明なら REVIEW_REQUIRED。 */
function decideLlmStatus(confidence, threshold) {
  return (typeof confidence === 'number' && confidence >= threshold) ? 'LLM_GRADED' : 'REVIEW_REQUIRED';
}

if (typeof module !== 'undefined') {
  module.exports = {
    resolveFinalScore: resolveFinalScore, isResponseFinalized: isResponseFinalized,
    decideLlmStatus: decideLlmStatus, validManualScore: validManualScore
  };
}
