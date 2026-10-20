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
