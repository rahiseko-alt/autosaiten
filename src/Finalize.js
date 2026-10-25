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
 * late を渡せば、授業外の上限の `__LATE__` の行も毎回決め直す（不要になれば rows から外れる）。
 * @param {Object[]} resultRows
 * @param {{cap: *, classEnds: Object, roster: Object[], now: Date}} [late] 上限の決まり（LateCap.js の planLateRow を参照）
 * @return {Object} response_id -> {rows, finalized, errors}
 */
function recomputeResponses(resultRows, late) {
  var resolve = fnFn_('resolveFinalScore', './Scoring.js');
  var isFinalized = fnFn_('isResponseFinalized', './Scoring.js');
  var valid = fnFn_('validManualScore', './Scoring.js');
  var validLate = fnFn_('validLateManualScore', './LateCap.js');
  var planLate = fnFn_('planLateRow', './LateCap.js');
  var lateId = (typeof LATE_QUESTION_ID !== 'undefined') ? LATE_QUESTION_ID : require('./Commentary.js').LATE_QUESTION_ID;
  var grouped = {};
  var errors = {};
  resultRows.forEach(function (r) {
    var copy = Object.assign({}, r);
    var isLate = String(copy.question_id) === lateId;
    if (!fnBlank_(copy.manual_score) && !(isLate ? validLate(copy.manual_score) : valid(copy.manual_score, copy.max_score))) {
      (errors[copy.response_id] = errors[copy.response_id] || []).push(copy.question_id + ' の manual_score「' + copy.manual_score + '」は ' +
        (isLate ? '0 以下（抑える点。0 なら抑えない）' : '0〜' + copy.max_score) + ' の数値ではありません');
      copy.manual_score = '';
    } else if (!fnBlank_(copy.manual_score) && (isLate || copy.status === 'MANUAL_PENDING' || copy.status === 'REVIEW_REQUIRED')) {
      // __LATE__ は自動で決めた行でも、manual_score が入れば先生の判断になる
      copy.status = 'MANUAL_GRADED';
    }
    var f = resolve(copy);
    copy.final_score = f.final_score === null ? '' : f.final_score;
    (grouped[copy.response_id] = grouped[copy.response_id] || []).push(copy);
  });
  var out = {};
  Object.keys(grouped).forEach(function (id) {
    var rows = grouped[id];
    if (late) {
      var lateRow = planLate(Object.assign({ rows: rows }, late));
      rows = rows.filter(function (r) { return String(r.question_id) !== lateId; });
      if (lateRow) rows.push(lateRow);
    }
    // 要確認の __LATE__ が残る間も確定しない
    out[id] = { rows: rows, finalized: isFinalized(rows), errors: errors[id] || [] };
  });
  return out;
}

if (typeof module !== 'undefined') {
  module.exports = { recomputeResponses: recomputeResponses };
}
