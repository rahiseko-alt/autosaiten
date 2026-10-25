/**
 * 学生に返す講評と合計点（ADR 0013）。フォームには合計点だけを出し、内訳は講評で伝える。
 * Apps Script の API には依存しない。
 */

/** 授業外の提出で合計点を抑えた分の行の問題番号。最終点は負の数。 */
var LATE_QUESTION_ID = '__LATE__';

/** 内訳に出さない行（氏名欄・クラス欄・採点結果の欄）。Results には通常入らないが、念のため除く。 */
var COMMENTARY_SKIP_IDS_ = { __NAME__: true, __CLASS__: true, __RESULT__: true };

function cmBlank_(v) {
  return v === undefined || v === null || String(v).trim() === '';
}

/** 最終点の和。`__LATE__` の行も足すので、抑えた後の合計点になる。空の最終点は数えない。 */
function totalScore(rows) {
  return rows.reduce(function (sum, r) { return cmBlank_(r.final_score) ? sum : sum + Number(r.final_score); }, 0);
}

/** `__LATE__` の行の問題文「授業時間外の提出（上限○点）」から上限点を読む。読めなければ null。 */
function cmCapOf_(lateRow) {
  var m = String(lateRow.question_text_snapshot || '').normalize('NFKC').match(/上限(-?\d+(?:\.\d+)?)点/);
  return m ? Number(m[1]) : null;
}

/**
 * 回答の各行から講評の全文を作る。問題ごとに「問題文：点 / 満点点」と採点の理由を並べ、
 * 授業外の提出で抑えたときは最後にその旨を書き添える。自動で抑えたときは上限点を、
 * 先生が manual_score で決めたときは抑えた後の合計点を書く。加点なしの欄は出さない。
 * @param {Object[]} rows 1回答分の Results の行（question_text_snapshot・final_score・max_score・grading_reason・status・manual_score）
 * @param {*} [cap] 上限点。省くと `__LATE__` の行の問題文から読む
 * @return {string}
 */
function buildCommentary(rows, cap) {
  var blocks = [];
  var late = null;
  rows.forEach(function (r) {
    var id = String(r.question_id);
    if (id === LATE_QUESTION_ID) {
      if (Number(r.final_score) < 0) late = r;
      return;
    }
    if (COMMENTARY_SKIP_IDS_[id] || r.status === 'NO_POINTS') return;
    var title = String(r.question_text_snapshot || '').replace(/\r\n?/g, '\n').split('\n')[0].trim() || id;
    var line = title + '：' + (cmBlank_(r.final_score) ? 0 : Number(r.final_score)) + ' / ' + (Number(r.max_score) || 0) + '点';
    var reason = String(r.grading_reason || '').trim();
    blocks.push(reason === '' ? line : line + '\n' + reason);
  });
  if (late && cmBlank_(late.manual_score)) {
    var limit = cmBlank_(cap) ? cmCapOf_(late) : Number(cap);
    // 上限点が読めないときは、抑えた後の合計点で代える（自動で抑えたときは同じ値になる）
    blocks.push('授業時間外の提出のため、合計点は上限の' + (limit === null ? totalScore(rows) : limit) + '点までです');
  } else if (late) {
    blocks.push('授業時間外の提出のため、合計点は' + totalScore(rows) + '点です');
  }
  return blocks.join('\n\n');
}

if (typeof module !== 'undefined') {
  module.exports = { LATE_QUESTION_ID: LATE_QUESTION_ID, buildCommentary: buildCommentary, totalScore: totalScore };
}
