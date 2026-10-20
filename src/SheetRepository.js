/**
 * シートの読み書き。見出し名をキーにした行オブジェクトとして扱う。
 */

function readTable(sheetName) {
  var sheet = SpreadsheetApp.getActive().getSheetByName(sheetName);
  if (!sheet || sheet.getLastRow() < 2) return [];
  var values = sheet.getRange(1, 1, sheet.getLastRow(), sheet.getLastColumn()).getValues();
  var headers = values[0];
  return values.slice(1)
    .filter(function (row) { return row.some(function (v) { return v !== '' && v !== null; }); })
    .map(function (row) {
      var obj = {};
      headers.forEach(function (h, i) { obj[h] = row[i]; });
      return obj;
    });
}

/** Settings シートを key -> value の連想配列で返す。 */
function readSettings() {
  var out = {};
  readTable(SHEET_NAMES.SETTINGS).forEach(function (row) { out[row.key] = row.value; });
  return out;
}

function setControl(key, value) {
  SpreadsheetApp.getActive().getSheetByName(SHEET_NAMES.CONTROL).getRange(CONTROL_CELLS[key]).setValue(value);
}

function getControl(key) {
  return SpreadsheetApp.getActive().getSheetByName(SHEET_NAMES.CONTROL).getRange(CONTROL_CELLS[key]).getValue();
}
