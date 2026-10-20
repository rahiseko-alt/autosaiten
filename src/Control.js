/**
 * Control シートの「これでOK」。検証 -> フォーム生成 -> 表示更新 を一度に実行する。
 */

function handleControlEdit(e) {
  if (!e || !e.range) return;
  var sheet = e.range.getSheet();
  var a1 = e.range.getA1Notation();
  var isOk = (sheet.getName() === SHEET_NAMES.AUTHORING && a1 === AUTHORING_CELLS.OK) ||
    (sheet.getName() === SHEET_NAMES.CONTROL && a1 === CONTROL_CELLS.OK);
  if (!isOk) return;
  if (e.range.getValue() !== true) return;

  var lock = LockService.getDocumentLock();
  if (!lock.tryLock(1000)) {
    // 実行中の処理がある。二重実行はせず、チェックはそのままにしない。
    e.range.setValue(false);
    return;
  }
  try {
    runBuildFlow_();
  } finally {
    e.range.setValue(false);
    lock.releaseLock();
  }
}

function runBuildFlow_() {
  try {
    setControl('STATUS', 'VALIDATING');
    setControl('MESSAGE', '設定を確認しています');
    var syncErrors = syncAuthoringToBackend_();
    if (syncErrors.length > 0) {
      setControl('STATUS', 'ERROR');
      setControl('MESSAGE', syncErrors.join('\n'));
      writeLog('WARN', 'BUILD_FAILED', '', '試験作成シートの内容にエラーがありました', { count: syncErrors.length });
      return;
    }
    var questions = readTable(SHEET_NAMES.QUESTIONS);
    var errors = validateConfiguration({
      questions: questions,
      rubrics: readTable(SHEET_NAMES.RUBRICS),
      settings: readSettings()
    });
    if (errors.length > 0) {
      setControl('STATUS', 'ERROR');
      setControl('MESSAGE', errors.map(toTeacherMessage).join('\n'));
      writeLog('WARN', 'BUILD_FAILED', '', '設定の検証でエラーがありました', { count: errors.length });
      return;
    }

    setControl('STATUS', 'BUILDING');
    setControl('MESSAGE', 'フォームを作っています');
    writeLog('INFO', 'BUILD_STARTED', '', 'フォーム生成を開始しました');
    buildOrVersionForm();
    installRequiredTriggers();
    updateControlSummary(questions);
    setControl('STATUS', 'READY');
    setControl('MESSAGE', '準備ができました。FORM_URL を学生に配布してください');
    writeLog('INFO', 'BUILD_COMPLETED', '', 'フォーム生成が完了しました');
  } catch (err) {
    setControl('STATUS', 'ERROR');
    setControl('MESSAGE', '処理中に問題が起きました。導入担当者に連絡してください（詳細は Logs シート）');
    writeLog('ERROR', 'BUILD_FAILED', '', String(err && err.message), { stack: String(err && err.stack) });
  }
}

function updateControlSummary(questions) {
  var s = summarizeQuestions(questions);
  setControl('TOTAL_QUESTIONS', s.total);
  setControl('TOTAL_POINTS', s.points);
  setControl('AUTO_POINTS', s.auto);
  setControl('LLM_POINTS', s.llm);
  setControl('MANUAL_POINTS', s.manual);
  setControl('LAST_BUILD', new Date());
}
