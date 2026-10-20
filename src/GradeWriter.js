/**
 * 採点結果の書き込み。Results シートへの保存と、フォームへの書き戻し。
 */

var RESULTS_TEXT_COLUMNS = ['respondent_email', 'question_text_snapshot', 'answer', 'grading_reason'];

/** 既存の Results 行を、行番号つきで返す。 */
function readResultsWithRows_() {
  var sheet = SpreadsheetApp.getActive().getSheetByName(SHEET_NAMES.RESULTS);
  if (sheet.getLastRow() < 2) return [];
  var headers = SHEET_HEADERS.Results;
  var values = sheet.getRange(2, 1, sheet.getLastRow() - 1, headers.length).getValues();
  return values.map(function (row, i) {
    var obj = { __row: i + 2 };
    headers.forEach(function (h, c) { obj[h] = row[c]; });
    return obj;
  });
}

/**
 * 採点結果の行を保存する。同じ response_id + question_id は更新し、無ければ追加する。
 * 回答は常に文字列として書く（数式として評価させない）。
 */
function saveResultRows(freshRows) {
  var sheet = SpreadsheetApp.getActive().getSheetByName(SHEET_NAMES.RESULTS);
  var headers = SHEET_HEADERS.Results;
  var existing = readResultsWithRows_().filter(function (r) { return r.response_id === freshRows[0].response_id; });
  var merged = mergeResults(existing, freshRows);
  var rowOf = {};
  existing.forEach(function (r) { rowOf[r.question_id] = r.__row; });

  var append = [];
  merged.forEach(function (m) {
    var values = headers.map(function (h) { return m.row[h]; });
    if (m.existed) {
      writeResultValues_(sheet, rowOf[m.row.question_id], [values]);
    } else {
      append.push(values);
    }
  });
  if (append.length > 0) writeResultValues_(sheet, sheet.getLastRow() + 1, append);
  return merged.map(function (m) { return m.row; });
}

function writeResultValues_(sheet, startRow, valueRows) {
  var headers = SHEET_HEADERS.Results;
  RESULTS_TEXT_COLUMNS.forEach(function (name) {
    sheet.getRange(startRow, headers.indexOf(name) + 1, valueRows.length, 1).setNumberFormat('@');
  });
  sheet.getRange(startRow, 1, valueRows.length, headers.length).setValues(valueRows);
}

/**
 * 確定した回答の点数をフォームへ書き戻す。T9 で実装する。
 * 確定していない回答では呼ばない（ADR 0003）。
 */
function writeBackScores(formId, responseId, rows) {
  // 未実装
}
