/**
 * 学生に返す講評と合計点（ADR 0013）。フォームには合計点だけを出し、内訳は講評で伝える。
 * Apps Script の API には依存しない。
 */

/** 授業外の提出で合計点を抑えた分の行の問題番号。最終点は負の数。 */
var LATE_QUESTION_ID = '__LATE__';

/** 内訳に出さない行（氏名欄・クラス欄）。Results には通常入らないが、念のため除く。 */
var COMMENTARY_SKIP_IDS_ = { __NAME__: true, __CLASS__: true };

function cmBlank_(v) {
  return v === undefined || v === null || String(v).trim() === '';
}

/** 最終点の和。`__LATE__` の行も足すので、抑えた後の合計点になる。空の最終点は数えない。 */
function totalScore(rows) {
  return rows.reduce(function (sum, r) { return cmBlank_(r.final_score) ? sum : sum + Number(r.final_score); }, 0);
}

/**
 * 回答の各行から講評の全文を作る。問題ごとに「問題文：点 / 満点点」と採点の理由を並べ、
 * 授業外の提出で抑えたときは最後にその旨と上限の点を書き添える。加点なしの欄は出さない。
 * @param {Object[]} rows 1回答分の Results の行（question_text_snapshot・final_score・max_score・grading_reason・status）
 * @return {string}
 */
function buildCommentary(rows) {
  var blocks = [];
  var capped = false;
  rows.forEach(function (r) {
    var id = String(r.question_id);
    if (id === LATE_QUESTION_ID) {
      if (Number(r.final_score) < 0) capped = true;
      return;
    }
    if (COMMENTARY_SKIP_IDS_[id] || r.status === 'NO_POINTS') return;
    var title = String(r.question_text_snapshot || '').replace(/\r\n?/g, '\n').split('\n')[0].trim() || id;
    var line = title + '：' + (cmBlank_(r.final_score) ? 0 : Number(r.final_score)) + ' / ' + (Number(r.max_score) || 0) + '点';
    var reason = String(r.grading_reason || '').trim();
    blocks.push(reason === '' ? line : line + '\n' + reason);
  });
  if (capped) blocks.push('授業時間外の提出のため、合計点は上限の' + totalScore(rows) + '点までです');
  return blocks.join('\n\n');
}

if (typeof module !== 'undefined') {
  module.exports = { LATE_QUESTION_ID: LATE_QUESTION_ID, buildCommentary: buildCommentary, totalScore: totalScore };
}
