/**
 * Logs シートへの記録。キーや認可ヘッダは sanitizeLogDetails が伏せる。
 * それでも、学生の氏名・回答・メールなどを details に入れないこと。
 */
function writeLog(level, event, entityId, message, details) {
  try {
    var sheet = SpreadsheetApp.getActive().getSheetByName(SHEET_NAMES.LOGS);
    if (!sheet) return;
    var safe = details ? JSON.stringify(sanitizeLogDetails(details)) : '';
    sheet.appendRow([new Date(), level, event, entityId || '', sanitizeLogDetails(String(message || '')), safe]);
  } catch (e) {
    console.error('writeLog failed: ' + e.message);
  }
}
