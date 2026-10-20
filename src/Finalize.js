/**
 * Manual 採点の反映と、フォームへの書き戻し対象の決定。Apps Script の API には依存しない。
 */

function fnFn_(name, file) {
  return (typeof globalThis[name] === 'function') ? globalThis[name] : require(file)[name];
}

function fnBlank_(v) {
  return v === undefined || v === null || String(v).trim() === '';
}

/**
 * Results の行を回答ごとにまとめ直して、最終点と確定を計算し直す。
 * manual_score が入った MANUAL_PENDING・REVIEW_REQUIRED は MANUAL_GRADED にする。
 * 不正な manual_score は無いものとして扱い、errors に理由を返す。
 * @return {Object} response_id -> {rows, finalized, errors}
 */
function recomputeResponses(resultRows) {
  var resolve = fnFn_('resolveFinalScore', './Scoring.js');
  var isFinalized = fnFn_('isResponseFinalized', './Scoring.js');
  var valid = fnFn_('validManualScore', './Scoring.js');
  var grouped = {};
  var errors = {};
  resultRows.forEach(function (r) {
    var copy = Object.assign({}, r);
    if (!fnBlank_(copy.manual_score) && !valid(copy.manual_score, copy.max_score)) {
      (errors[copy.response_id] = errors[copy.response_id] || []).push(
        copy.question_id + ' の manual_score「' + copy.manual_score + '」は 0〜' + copy.max_score + ' の数値ではありません');
      copy.manual_score = '';
    } else if (!fnBlank_(copy.manual_score) && (copy.status === 'MANUAL_PENDING' || copy.status === 'REVIEW_REQUIRED')) {
      copy.status = 'MANUAL_GRADED';
    }
    var f = resolve(copy);
    copy.final_score = f.final_score === null ? '' : f.final_score;
    (grouped[copy.response_id] = grouped[copy.response_id] || []).push(copy);
  });
  var out = {};
  Object.keys(grouped).forEach(function (id) {
    out[id] = { rows: grouped[id], finalized: isFinalized(grouped[id]), errors: errors[id] || [] };
  });
  return out;
}

/** フォームへ書き戻す点数（最終点が入っている問題だけ）。 */
function scoresToWriteBack(rows) {
  return rows
    .filter(function (r) { return !fnBlank_(r.final_score); })
    .map(function (r) { return { question_id: r.question_id, score: Number(r.final_score) }; });
}

if (typeof module !== 'undefined') {
  module.exports = { recomputeResponses: recomputeResponses, scoresToWriteBack: scoresToWriteBack };
}
