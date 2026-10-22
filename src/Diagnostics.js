/**
 * 手動の診断。実APIを呼ぶのはここだけ（自動テストでは呼ばない）。
 */

/** Anthropic に小さな採点を1件頼み、通るかどうかをトーストで知らせる。 */
function diagnoseAnthropic() {
  var settings = readSettings();
  var payload = buildGradingPayload([{
    question_id: 'DIAG', question_text: '1+1は？', max_points: 1,
    criteria: [{ criterion_id: 'C01', criterion: '正答', max_points: 1, description: '2と答えている' }],
    answer: '2'
  }], settings);
  try {
    var results = new AnthropicProvider(settings).gradeBatch(payload);
    SpreadsheetApp.getActive().toast('Anthropic への接続に成功しました（結果 ' + results.length + ' 件）', 'AI Grader', 8);
  } catch (err) {
    SpreadsheetApp.getActive().toast('接続に失敗しました: ' + err.message, 'AI Grader', 10);
  }
}

/** システムの状態を調べて、Control の MESSAGE に表示する。実APIは呼ばない。 */
function runDiagnostics() {
  var ss = SpreadsheetApp.getActive();
  var checks = [];

  var missing = Object.keys(SHEET_HEADERS).concat([SHEET_NAMES.CONTROL]).filter(function (name) {
    return !ss.getSheetByName(name);
  });
  checks.push({ name: '必要なシート', ok: missing.length === 0, detail: missing.length ? '不足: ' + missing.join(', ') : '' });

  var badHeader = Object.keys(SHEET_HEADERS).filter(function (name) {
    var sheet = ss.getSheetByName(name);
    if (!sheet) return false;
    var expected = SHEET_HEADERS[name];
    var actual = sheet.getRange(1, 1, 1, expected.length).getValues()[0];
    return expected.some(function (h, i) { return actual[i] !== h; });
  });
  checks.push({ name: 'シートの見出し', ok: badHeader.length === 0, detail: badHeader.length ? '違い: ' + badHeader.join(', ') : '' });

  var settings = readSettings();
  var provider = String(settings.LLM_PROVIDER || '');
  checks.push({ name: 'LLM提供元の設定', ok: LLM_PROVIDERS.indexOf(provider) >= 0, detail: provider ? '' : 'LLM_PROVIDER が空です' });
  var keyName = provider + '_API_KEY';
  var hasKey = !!PropertiesService.getScriptProperties().getProperty(keyName);
  checks.push({ name: 'APIキーの登録', ok: hasKey, detail: hasKey ? '' : keyName + ' が未設定です' });

  var props = PropertiesService.getDocumentProperties();
  var formId = props.getProperty(PROP_ACTIVE_FORM_ID);
  if (formId) {
    var formOk = true;
    try { FormApp.openById(formId); } catch (e) { formOk = false; }
    checks.push({ name: 'フォームへのアクセス', ok: formOk, detail: 'フォームID ' + formId });
  } else {
    checks.push({ name: 'フォームへのアクセス', ok: false, detail: 'フォームがまだ作られていません' });
  }

  var handlers = ScriptApp.getProjectTriggers().map(function (t) { return t.getHandlerFunction(); });
  ['handleControlEdit', 'processGradingQueue'].forEach(function (fn) {
    var n = handlers.filter(function (h) { return h === fn; }).length;
    checks.push({ name: 'トリガー ' + fn, ok: n === 1, detail: n + '本' });
  });

  var queued = {};
  readQueueRows_().forEach(function (j) { queued[j.job.response_id] = true; });
  var forms = trackedForms_();
  var notes = [];
  var allRegistered = true;
  Object.keys(forms).forEach(function (id) {
    try {
      var ids = FormApp.openById(id).getResponses().map(function (r) { return r.getId(); });
      var missing = ids.filter(function (rid) { return !queued[rid]; }).length;
      if (missing > 0) allRegistered = false;
      notes.push('第' + forms[id] + '版: 回答' + ids.length + '件・未登録 ' + missing + '件');
    } catch (e) {
      allRegistered = false;
      notes.push('第' + forms[id] + '版: フォームを開けません');
    }
  });
  checks.push({ name: 'フォームの回答の登録', ok: allRegistered, detail: notes.join(' / ') });

  var counts = {};
  readQueueRows_().forEach(function (j) { counts[j.job.status] = (counts[j.job.status] || 0) + 1; });
  checks.push({ name: 'Queueの状態', ok: !counts.FAILED, detail: JSON.stringify(counts) });

  setControl('MESSAGE', formatDiagnostics(checks));
  writeLog('INFO', 'DIAGNOSTICS', '', '診断を実行しました', { ng: checks.filter(function (c) { return !c.ok; }).length });
}
