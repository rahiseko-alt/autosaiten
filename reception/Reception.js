/**
 * 受付ページの判断（資料番号の割り当て、名簿の整理）。Apps Script の API には依存しない。
 */

function rcText_(v) {
  return v === undefined || v === null ? '' : String(v).trim();
}

/** 受付日時を比べられる数にする。無ければ0（シートの並び順で後ろのものを新しいとみなす）。 */
function rcTime_(v) {
  if (v instanceof Date) return v.getTime();
  var t = Date.parse(v);
  return isNaN(t) ? 0 : t;
}

/**
 * 資料番号を決める。同じクラス・氏名なら前と同じ番号、初めてなら直前に振った番号の次（資料の数を超えたら1に戻る）。
 * 件数ではなく、受付日時がいちばん新しい行の番号から数えるので、行を消したり並べ替えたりしても番号は重ならない。
 * @param {Object[]} assignments 割り当てシートの行（クラス・氏名・資料番号）
 * @param {string} cls クラス
 * @param {string} name 氏名
 * @param {number} materialCount 用意した資料の数
 * @return {{number: number, isNew: boolean}}
 */
function planAssignment(assignments, cls, name, materialCount) {
  var found = assignments.filter(function (r) {
    return rcText_(r.クラス) === rcText_(cls) && rcText_(r.氏名) === rcText_(name);
  })[0];
  if (found) return { number: Number(found.資料番号), isNew: false };
  if (!(materialCount >= 1)) throw new Error('資料シートに資料がありません。先生に連絡してください');
  var latest = null;
  assignments.forEach(function (r) {
    if (!latest || rcTime_(r.受付日時) >= rcTime_(latest.受付日時)) latest = r;
  });
  var last = latest ? Number(latest.資料番号) || 0 : 0;
  return { number: (last % materialCount) + 1, isNew: true };
}

/** 名簿の行を、クラスごとに名簿の順のまま分ける。クラスか氏名が空の行は使わない。 */
function rosterByClass(rows) {
  var classes = [];
  var byName = {};
  rows.forEach(function (r) {
    var cls = rcText_(r.クラス);
    var name = rcText_(r.氏名);
    if (cls === '' || name === '') return;
    if (!byName[cls]) {
      byName[cls] = { name: cls, students: [] };
      classes.push(byName[cls]);
    }
    byName[cls].students.push(name);
  });
  return classes;
}

/** チェックの欄の値。true のほか、文字の TRUE も印とみなす。 */
function rcChecked_(v) {
  return v === true || rcText_(v).toUpperCase() === 'TRUE';
}

/**
 * 受付ページの案内先を決める（ADR 0012）。集計表のテスト一覧で「受付ページを使う」と「実施中」の両方に
 * 印の付いた行がちょうど1つのときだけ、そのテストのスプレッドシートの ID を返す。
 * 0個・2個以上、または ID が空なら、どのテストへも案内しない。
 * @param {Object[]} tests テスト一覧の行（受付ページを使う・実施中・スプレッドシートのID）
 * @return {string} 案内先のスプレッドシートの ID
 */
function chooseReceptionTest(tests) {
  var marked = tests.filter(function (r) { return rcChecked_(r.受付ページを使う) && rcChecked_(r.実施中); });
  var id = marked.length === 1 ? rcText_(marked[0].スプレッドシートのID) : '';
  if (id === '') throw new Error('受付の準備ができていません。先生に連絡してください');
  return id;
}

if (typeof module !== 'undefined') {
  module.exports = { planAssignment: planAssignment, rosterByClass: rosterByClass, chooseReceptionTest: chooseReceptionTest };
}
