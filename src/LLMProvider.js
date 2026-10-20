/**
 * 設定から LLM 提供元（adapter）を選ぶ。提供元固有の処理は providers/ にだけ置く。
 * 使えない提供元のときは、呼ぶと失敗する代役を返す（採点は REVIEW_REQUIRED になる）。
 */
function createProvider(settings) {
  var name = String(settings.LLM_PROVIDER || '').trim();
  if (name === 'ANTHROPIC' && typeof AnthropicProvider === 'function') {
    return new AnthropicProvider(settings);
  }
  return {
    gradeBatch: function () {
      throw new Error('LLM提供元 ' + name + ' はまだ使えません');
    }
  };
}
