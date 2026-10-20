/**
 * Logs シートへの記録。APIキーや認可ヘッダ、個人情報を details に入れないこと。
 */
function writeLog(level, event, entityId, message, details) {
  try {
    var sheet = SpreadsheetApp.getActive().getSheetByName(SHEET_NAMES.LOGS);
    if (!sheet) return;
    sheet.appendRow([new Date(), level, event, entityId || '', message || '', details ? JSON.stringify(details) : '']);
  } catch (e) {
    console.error('writeLog failed: ' + e.message);
  }
}
