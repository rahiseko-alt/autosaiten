/**
 * Control シートの「これでOK」。検証 -> フォーム生成 -> 表示更新 を一度に実行する。
 */

var PUBLISH_GRADES_GUIDE = 'フォームの設定で、成績の公開を『後で手動で公開』にしてください（確定前の点数が学生に見えないように）';

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
    if (isArchived(readSettings())) {
      // 保管したテストはフォームを閉じて保管用のフォルダへ移すので、作り直さない
      setControl('MESSAGE', ARCHIVED_MESSAGE);
      return;
    }
    setControl('STATUS', 'VALIDATING');
    setControl('MESSAGE', '設定を確認しています');
    var prepared = prepareAuthoring_();
    var questions = prepared ? prepared.questions : readTable(SHEET_NAMES.QUESTIONS);
    var errors = prepared ? prepared.errors.slice() : [];
    if (errors.length === 0) {
      errors = validateConfiguration({
        questions: questions,
        rubrics: readTable(SHEET_NAMES.RUBRICS),
        settings: readSettings()
      }).map(toTeacherMessage);
    }
    if (errors.length > 0) {
      // 不備があるときは裏方の Questions を書き換えない（採点中の答案に影響させない）
      setControl('STATUS', 'ERROR');
      setControl('MESSAGE', errors.join('\n'));
      writeLog('WARN', 'BUILD_FAILED', '', '設定の検証でエラーがありました', { count: errors.length });
      return;
    }
    if (prepared) commitAuthoring_(prepared);

    setControl('STATUS', 'BUILDING');
    setControl('MESSAGE', 'フォームを作っています');
    writeLog('INFO', 'BUILD_STARTED', '', 'フォーム生成を開始しました');
    var action = buildOrVersionForm();
    installRequiredTriggers();
    updateControlSummary(questions);
    setControl('STATUS', 'READY');
    var message = '準備ができました。フォームURLを学生に配ってください';
    // 成績の公開の設定は仕組みから変えられないので、新しいフォームのたびに先生に頼む（ADR 0013）
    if (action === 'CREATE' || action === 'NEW_VERSION') message += '\n' + PUBLISH_GRADES_GUIDE;
    setControl('MESSAGE', message);
    writeLog('INFO', 'BUILD_COMPLETED', '', 'フォーム生成が完了しました');
  } catch (err) {
    setControl('STATUS', 'ERROR');
    setControl('MESSAGE', '処理中に問題が起きました。' + (err && /^[^A-Za-z]/.test(err.message) ? err.message : '導入担当者に連絡してください（詳細は裏方の記録 Logs に残っています）'));
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
