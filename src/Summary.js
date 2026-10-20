/**
 * Control に出す集計（問題数・合計点・採点方式ごとの配点）。
 * @param {Object[]} questions Questionsの行
 */
function summarizeQuestions(questions) {
  var out = { total: 0, points: 0, auto: 0, llm: 0, manual: 0 };
  (questions || []).forEach(function (q) {
    if (!(q.enabled === true || String(q.enabled).trim().toUpperCase() === 'TRUE')) return;
    var p = Number(q.points) || 0;
    out.total += 1;
    out.points += p;
    var key = String(q.grading_mode || '').toLowerCase();
    if (key === 'auto' || key === 'llm' || key === 'manual') out[key] += p;
  });
  return out;
}

if (typeof module !== 'undefined') module.exports = { summarizeQuestions: summarizeQuestions };
