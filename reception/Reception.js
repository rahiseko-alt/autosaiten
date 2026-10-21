/**
 * 受付ページの判断（資料番号の割り当て、名簿の整理）。Apps Script の API には依存しない。
 */

function rcText_(v) {
  return v === undefined || v === null ? '' : String(v).trim();
}

/**
 * 資料番号を決める。同じクラス・氏名なら前と同じ番号、初めてなら直前に振った番号の次（資料の数を超えたら1に戻る）。
 * 件数ではなく直前の番号から数えるので、割り当ての行を消しても番号は重ならない。
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
  var last = assignments.length > 0 ? Number(assignments[assignments.length - 1].資料番号) || 0 : 0;
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

if (typeof module !== 'undefined') module.exports = { planAssignment: planAssignment, rosterByClass: rosterByClass };
