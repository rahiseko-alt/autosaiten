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
  if (row.status === 'UNANSWERED') return { final_score: 0, confirmed: true };
  if (row.grading_mode === 'AUTO') return { final_score: Number(row.auto_score), confirmed: true };
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

/** 信頼度が閾値以上なら LLM_GRADED、未満または不明なら REVIEW_REQUIRED。 */
function decideLlmStatus(confidence, threshold) {
  return (typeof confidence === 'number' && confidence >= threshold) ? 'LLM_GRADED' : 'REVIEW_REQUIRED';
}

if (typeof module !== 'undefined') {
  module.exports = { resolveFinalScore: resolveFinalScore, isResponseFinalized: isResponseFinalized, decideLlmStatus: decideLlmStatus };
}
