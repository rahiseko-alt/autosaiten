/**
 * エントリポイント。スプレッドシートを開いたときにメニューを出す。
 */

function onOpen() {
  SpreadsheetApp.getUi().createMenu('AI Grader')
    .addItem('初期セットアップ', 'setupSystem')
    .addItem('設定検証', 'menuValidate')
    .addItem('フォーム生成', 'menuBuildForm')
    .addItem('Queueを今すぐ処理', 'processGradingQueue')
    .addItem('選択回答を再採点', 'menuRegradeSelected')
    .addItem('Manual採点を反映', 'finalizeManualGrades')
    .addItem('トリガー再構築', 'installRequiredTriggers')
    .addItem('システム診断', 'runDiagnostics')
    .addToUi();
}

function menuValidate() {
  var errors = validateConfiguration({
    questions: readTable(SHEET_NAMES.QUESTIONS),
    rubrics: readTable(SHEET_NAMES.RUBRICS),
    settings: readSettings()
  });
  setControl('STATUS', errors.length > 0 ? 'ERROR' : 'IDLE');
  setControl('MESSAGE', errors.length > 0 ? errors.join('\n') : '設定に問題はありません');
}

function menuBuildForm() {
  var lock = LockService.getDocumentLock();
  if (!lock.tryLock(1000)) {
    SpreadsheetApp.getActive().toast('別の処理が実行中です。しばらくしてからもう一度お試しください', 'AI Grader', 6);
    return;
  }
  try {
    runBuildFlow_();
  } finally {
    lock.releaseLock();
  }
}
