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

/** 集計表の「保管する」で、Settings に保管の印（ARCHIVED が TRUE）が付いているか。 */
function isArchived(settings) {
  var v = settings[ARCHIVED_KEY];
  return v === true || String(v).trim().toUpperCase() === 'TRUE';
}

function setControl(key, value) {
  var ss = SpreadsheetApp.getActive();
  ss.getSheetByName(SHEET_NAMES.CONTROL).getRange(CONTROL_CELLS[key]).setValue(value);
  // 先生が見る試験作成シートにも同じ表示を出す
  var authoring = ss.getSheetByName(SHEET_NAMES.AUTHORING);
  if (authoring && AUTHORING_CELLS[key]) {
    var shown = key === 'STATUS' ? (AUTHORING_STATUS_LABELS[value] || value) : value;
    authoring.getRange(AUTHORING_CELLS[key]).setValue(shown);
  }
}

function setSetting(key, value) {
  var sheet = SpreadsheetApp.getActive().getSheetByName(SHEET_NAMES.SETTINGS);
  var keys = sheet.getRange(1, 1, Math.max(1, sheet.getLastRow()), 1).getValues();
  for (var r = 1; r < keys.length; r++) {
    if (keys[r][0] === key) {
      sheet.getRange(r + 1, 2).setValue(value);
      return;
    }
  }
  sheet.appendRow([key, value, '']);
}

function getControl(key) {
  return SpreadsheetApp.getActive().getSheetByName(SHEET_NAMES.CONTROL).getRange(CONTROL_CELLS[key]).getValue();
}
