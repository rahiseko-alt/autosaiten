/**
 * 初期セットアップ。何度実行しても同じ状態になる（既存の入力は消さない）。
 */

function setupSystem() {
  var ss = SpreadsheetApp.getActive();
  var order = [SHEET_NAMES.CONTROL, SHEET_NAMES.QUESTIONS, SHEET_NAMES.RUBRICS, SHEET_NAMES.SETTINGS,
    SHEET_NAMES.RESULTS, SHEET_NAMES.QUEUE, SHEET_NAMES.FORM_MAPPING, SHEET_NAMES.LOGS];

  order.forEach(function (name, index) {
    var sheet = ss.getSheetByName(name) || ss.insertSheet(name, index);
    if (name !== SHEET_NAMES.CONTROL) writeHeader_(sheet, SHEET_HEADERS[name]);
  });
  var first = ss.getSheetByName('Sheet1') || ss.getSheetByName('シート1');
  if (first && first.getLastRow() === 0 && ss.getSheets().length > order.length) ss.deleteSheet(first);

  setupControl_(ss.getSheetByName(SHEET_NAMES.CONTROL));
  setupSettings_(ss.getSheetByName(SHEET_NAMES.SETTINGS));
  setupQuestionsValidation_(ss.getSheetByName(SHEET_NAMES.QUESTIONS));
  ss.getSheetByName(SHEET_NAMES.RUBRICS).getRange('G2:G1000').setDataValidation(
    SpreadsheetApp.newDataValidation().requireCheckbox().build());
  INTERNAL_SHEETS.forEach(function (name) { protectInternal_(ss.getSheetByName(name)); });

  installRequiredTriggers();
  writeLog('INFO', 'SETUP_COMPLETED', '', '初期セットアップが完了しました');
  ss.toast('初期セットアップが完了しました。API キーは Script Properties に別途設定してください。', 'AI Grader', 8);
}

function writeHeader_(sheet, headers) {
  sheet.getRange(1, 1, 1, headers.length).setValues([headers])
    .setFontWeight('bold').setBackground('#d9eaff');
  var name = sheet.getName();
  var required = REQUIRED_HEADERS[name] || [];
  var conditional = CONDITIONAL_HEADERS[name] || {};
  headers.forEach(function (h, i) {
    var cell = sheet.getRange(1, i + 1);
    if (required.indexOf(h) >= 0) cell.setBackground('#ffff00');
    if (conditional[h]) cell.setBackground('#fce5cd').setNote(conditional[h]);
  });
  sheet.setFrozenRows(1);
}

function setupControl_(sheet) {
  var existing = sheet.getRange(CONTROL_CELLS.STATUS).getValue();
  if (existing === '') {
    sheet.getRange(1, 1, CONTROL_LABELS.length, 2).setValues(CONTROL_LABELS);
    sheet.getRange(CONTROL_CELLS.MESSAGE).setValue('問題をQuestionsシートに入力してから、「これでOK」にチェックしてください');
  }
  sheet.getRange('A1').setFontWeight('bold').setFontSize(14);
  sheet.getRange(CONTROL_CELLS.OK).setDataValidation(SpreadsheetApp.newDataValidation().requireCheckbox().build());
  sheet.getRange('B4:B14').setBackground('#eeeeee').setWrap(true);
  sheet.setColumnWidth(1, 160);
  sheet.setColumnWidth(2, 420);
}

function setupSettings_(sheet) {
  if (sheet.getLastRow() < 2) {
    sheet.getRange(2, 1, DEFAULT_SETTINGS.length, 3).setValues(DEFAULT_SETTINGS);
  }
  sheet.getRange('B2').setDataValidation(
    SpreadsheetApp.newDataValidation().requireValueInList(LLM_PROVIDERS, true).build());
  sheet.getRange('B8:B9').setDataValidation(SpreadsheetApp.newDataValidation().requireCheckbox().build());
}

function setupQuestionsValidation_(sheet) {
  // question_id が「001」のような数字でも数値にされないよう、文字列の書式にする
  sheet.getRange('B2:B1000').setNumberFormat('@');
  var rule = function (a1, builder) { sheet.getRange(a1).setDataValidation(builder.build()); };
  rule('A2:A1000', SpreadsheetApp.newDataValidation().requireCheckbox());
  rule('F2:F1000', SpreadsheetApp.newDataValidation().requireCheckbox());
  rule('E2:E1000', SpreadsheetApp.newDataValidation().requireValueInList(QUESTION_TYPES, true));
  rule('H2:H1000', SpreadsheetApp.newDataValidation().requireValueInList(GRADING_MODES, true));
  rule('I2:I1000', SpreadsheetApp.newDataValidation().requireValueInList(AUTO_RULES, true));
}

function protectInternal_(sheet) {
  var existing = sheet.getProtections(SpreadsheetApp.ProtectionType.SHEET);
  var protection = existing.length > 0 ? existing[0] : sheet.protect();
  protection.setWarningOnly(true);
  protection.setDescription('システム管理用のシートです。編集しないでください');
  sheet.setTabColor('#999999');
}

/** 必要なトリガーだけを、重複なく作る。何度実行しても同じ結果になる。 */
function installRequiredTriggers() {
  var ss = SpreadsheetApp.getActive();
  var wanted = { handleControlEdit: false, processGradingQueue: false };
  ScriptApp.getProjectTriggers().forEach(function (t) {
    var fn = t.getHandlerFunction();
    if (!(fn in wanted)) return;
    if (wanted[fn]) { ScriptApp.deleteTrigger(t); return; }
    wanted[fn] = true;
  });
  if (!wanted.handleControlEdit) {
    ScriptApp.newTrigger('handleControlEdit').forSpreadsheet(ss).onEdit().create();
  }
  if (!wanted.processGradingQueue) {
    ScriptApp.newTrigger('processGradingQueue').timeBased().everyMinutes(1).create();
  }
}
