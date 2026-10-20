const test = require('node:test');
const assert = require('node:assert/strict');
const { sanitizeLogDetails, formatDiagnostics } = require('../src/LogFormat.js');

test('キー・認可ヘッダ・トークンに当たる項目は伏せる', () => {
  const out = sanitizeLogDetails({ api_key: 'sk-abc', Authorization: 'Bearer x', token: 't', ok: 1, nested: { password: 'p', a: 2 } });
  const text = JSON.stringify(out);
  assert.ok(!text.includes('sk-abc') && !text.includes('Bearer') && !text.includes('"p"'));
  assert.equal(out.ok, 1);
  assert.equal(out.nested.a, 2);
});

test('値に sk- で始まるキーらしき文字列が含まれていても伏せる', () => {
  const out = sanitizeLogDetails({ message: 'failed with sk-ant-12345678901234567890 key' });
  assert.ok(!JSON.stringify(out).includes('sk-ant-12345678901234567890'));
});

test('長い文字列は切り詰める', () => {
  const out = sanitizeLogDetails({ text: 'あ'.repeat(1000) });
  assert.ok(out.text.length <= 301);
});

test('details が無ければ空文字', () => {
  assert.equal(sanitizeLogDetails(undefined), undefined);
});

test('診断結果を、成否つきの日本語の一覧にする', () => {
  const text = formatDiagnostics([
    { name: '必要なシート', ok: true },
    { name: 'APIキー', ok: false, detail: 'ANTHROPIC_API_KEY が未設定です' }
  ]);
  assert.equal(text, 'OK: 必要なシート\nNG: APIキー（ANTHROPIC_API_KEY が未設定です）');
});
