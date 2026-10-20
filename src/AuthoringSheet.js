/**
 * 試験作成シート（先生が触る唯一のシート）と、結果シートの用意と同期（ADR 0007）。
 * 変換の判断は Authoring.js にある。
 */

function setupAuthoringSheet_(ss) {
  var sheet = ss.getSheetByName(SHEET_NAMES.AUTHORING);
  var isNew = !sheet;
  if (isNew) sheet = ss.insertSheet(SHEET_NAMES.AUTHORING, 0);

  if (isNew) {
    sheet.getRange(1, 1, AUTHORING_LABELS.length, 2).setValues(AUTHORING_LABELS);
    var settings = readSettings();
    sheet.getRange(AUTHORING_CELLS.FORM_TITLE).setValue(settings.FORM_TITLE || '');
    sheet.getRange(AUTHORING_CELLS.FORM_DESCRIPTION).setValue(settings.FORM_DESCRIPTION || '');
    var imported = fromQuestionRows(readTable(SHEET_NAMES.QUESTIONS), readTable(SHEET_NAMES.RUBRICS));
    if (imported.length > 0) writeAuthoringRows_(sheet, imported);
  }
  sheet.getRange('A1').setFontWeight('bold').setFontSize(14);
  sheet.getRange(AUTHORING_CELLS.OK).setDataValidation(SpreadsheetApp.newDataValidation().requireCheckbox().build());
  sheet.getRange('B3:B6').setBackground('#eeeeee').setWrap(true);
  sheet.getRange('B7:B8').setBackground('#fff2cc');

  var h = AUTHORING_HEADER_ROW;
  sheet.getRange(h, 1, 1, AUTHORING_HEADERS.length).setValues([AUTHORING_HEADERS])
    .setFontWeight('bold').setBackground('#d9eaff');
  ['A', 'B', 'C', 'D'].forEach(function (c) { sheet.getRange(c + h).setBackground('#ffff00'); });
  var notes = {
    C: '短答・数値・記述・選択・複数選択・プルダウン から選ぶ',
    E: '記述は模範解答（空欄可）。複数選択は || 区切り',
    F: '短答で、ほかに正解とする答え（|| 区切り）。数値は許容差',
    G: '選択・複数選択・プルダウンのとき必須（|| 区切り）',
    H: '記述のとき、何が書けていれば何点かを書く',
    J: '自動で付きます。書き換えないでください'
  };
  Object.keys(notes).forEach(function (c) { sheet.getRange(c + h).setNote(notes[c]); });
  sheet.getRange('J' + h + ':J1000').setBackground('#eeeeee');
  sheet.setFrozenRows(h);

  var first = h + 1;
  var rule = function (a1, builder) { sheet.getRange(a1).setDataValidation(builder.build()); };
  rule('A' + first + ':A1000', SpreadsheetApp.newDataValidation().requireCheckbox());
  rule('I' + first + ':I1000', SpreadsheetApp.newDataValidation().requireCheckbox());
  rule('C' + first + ':C1000', SpreadsheetApp.newDataValidation()
    .requireValueInList(['短答', '数値', '記述', '選択', '複数選択', 'プルダウン'], true));
  sheet.getRange('B' + first + ':H1000').setWrap(true);
  [[1, 50], [2, 360], [3, 90], [4, 50], [5, 160], [6, 140], [7, 160], [8, 240], [9, 50], [10, 70]]
    .forEach(function (w) { sheet.setColumnWidth(w[0], w[1]); });

  setupAuthoringHighlights_(sheet, first);
  return sheet;
}

/** 書き始めた行で、まだ埋めていない必須の欄を黄色にする。 */
function setupAuthoringHighlights_(sheet, first) {
  var inUse = 'COUNTA($B' + first + ':$H' + first + ')>0';
  var choice = 'OR($C' + first + '="選択",$C' + first + '="複数選択",$C' + first + '="プルダウン")';
  var rule = function (a1s, formula) {
    return SpreadsheetApp.newConditionalFormatRule().whenFormulaSatisfied(formula).setBackground('#ffff00')
      .setRanges(a1s.map(function (a1) { return sheet.getRange(a1); })).build();
  };
  var rows = first + ':';
  sheet.setConditionalFormatRules([
    rule(['A' + first + ':A1000'], '=AND(' + inUse + ',$A' + first + '<>TRUE)'),
    rule(['B' + first + ':D1000'], '=AND(' + inUse + ',LEN(B' + first + ')=0)'),
    rule(['E' + first + ':E1000'], '=AND(' + inUse + ',$C' + first + '<>"記述",LEN(E' + first + ')=0)'),
    rule(['G' + first + ':G1000'], '=AND(' + choice + ',LEN(G' + first + ')=0)'),
    rule(['H' + first + ':H1000'], '=AND($C' + first + '="記述",LEN(H' + first + ')=0)')
  ]);
  return rows;
}

function readAuthoringRows_(sheet) {
  var first = AUTHORING_HEADER_ROW + 1;
  var last = sheet.getLastRow();
  if (last < first) return [];
  return sheet.getRange(first, 1, last - first + 1, AUTHORING_HEADERS.length).getValues().map(function (values) {
    var obj = {};
    AUTHORING_HEADERS.forEach(function (h, i) { obj[h] = values[i]; });
    return obj;
  });
}

function writeAuthoringRows_(sheet, rows) {
  var values = rows.map(function (r) { return AUTHORING_HEADERS.map(function (h) { return r[h]; }); });
  sheet.getRange(AUTHORING_HEADER_ROW + 1, 1, values.length, AUTHORING_HEADERS.length).setValues(values);
}

/**
 * 試験作成シートの内容を、裏方の Questions と Settings へ写す。
 * @return {string[]} 先生向けのエラー（空なら写した）
 */
function syncAuthoringToBackend_() {
  var ss = SpreadsheetApp.getActive();
  var sheet = ss.getSheetByName(SHEET_NAMES.AUTHORING);
  if (!sheet) return [];
  var rows = readAuthoringRows_(sheet);

  var known = readTable(SHEET_NAMES.QUESTIONS).map(function (q) { return q.question_id; })
    .concat(readTable(SHEET_NAMES.FORM_MAPPING).map(function (m) { return m.question_id; }));
  var ids = assignQuestionIds(rows, known);
  rows.forEach(function (r, i) {
    if (String(r.問題番号) !== ids[i]) {
      r.問題番号 = ids[i];
      sheet.getRange(AUTHORING_HEADER_ROW + 1 + i, AUTHORING_HEADERS.length).setValue(ids[i]);
    }
  });

  var converted = toQuestionRows(rows, AUTHORING_HEADER_ROW + 1);
  if (converted.errors.length > 0) return converted.errors;

  var q = ss.getSheetByName(SHEET_NAMES.QUESTIONS);
  var headers = SHEET_HEADERS.Questions;
  if (q.getLastRow() >= 2) q.getRange(2, 1, q.getLastRow() - 1, headers.length).clearContent();
  if (converted.rows.length > 0) {
    q.getRange(2, 1, converted.rows.length, headers.length)
      .setValues(converted.rows.map(function (r) { return headers.map(function (h) { return r[h] === undefined ? '' : r[h]; }); }));
  }

  var title = sheet.getRange(AUTHORING_CELLS.FORM_TITLE).getValue();
  if (String(title).trim() !== '') setSetting('FORM_TITLE', title);
  setSetting('FORM_DESCRIPTION', sheet.getRange(AUTHORING_CELLS.FORM_DESCRIPTION).getValue());
  return [];
}

/** 先生が見る結果シート。裏方の Results から必要な列だけを数式で引く。 */
function setupResultsView_(ss) {
  var sheet = ss.getSheetByName(SHEET_NAMES.RESULTS_VIEW) || ss.insertSheet(SHEET_NAMES.RESULTS_VIEW, 1);
  sheet.getRange(1, 1, 1, 7).setValues([['送信日時', '問題番号', '回答', '点数', '満点', '状態', '採点の理由']])
    .setFontWeight('bold').setBackground('#d9eaff');
  sheet.getRange('A2').setFormula(
    '=IFERROR(FILTER({Results!C2:C,Results!E2:E,Results!G2:G,Results!L2:L,Results!M2:M,Results!N2:N,Results!P2:P},Results!A2:A<>""),"")');
  sheet.setFrozenRows(1);
  [[1, 140], [2, 70], [3, 320], [4, 50], [5, 50], [6, 120], [7, 360]].forEach(function (w) { sheet.setColumnWidth(w[0], w[1]); });
  return sheet;
}

function hideBackendSheets_(ss) {
  BACKEND_SHEETS.forEach(function (name) {
    var sheet = ss.getSheetByName(name);
    if (sheet && !sheet.isSheetHidden()) sheet.hideSheet();
  });
}
