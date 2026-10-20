/**
 * シートの1セルに `||` 区切りで書かれた一覧を配列にする。
 * @param {*} value セルの値
 * @return {string[]}
 */
function splitList(value) {
  if (value === undefined || value === null) return [];
  return String(value)
    .split('||')
    .map(function (s) { return s.trim(); })
    .filter(function (s) { return s !== ''; });
}

if (typeof module !== 'undefined') module.exports = { splitList: splitList };
