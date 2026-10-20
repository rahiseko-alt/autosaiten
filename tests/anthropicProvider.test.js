const test = require('node:test');
const assert = require('node:assert/strict');
const { AnthropicProvider, buildRequest, parseResponse, isRetryable } = require('../src/providers/AnthropicProvider.js');

const payload = {
  prompt_version: 1, nonce: 'abc', system: 'SYS abc',
  delimiters: { start: '--- STUDENT ANSWER START abc ---', end: '--- STUDENT ANSWER END abc ---' },
  items: [{ question_id: 'Q003', question_text: '理由は？', max_points: 10,
    rubric: [{ criterion_id: 'C01', criterion: 'a', max_points: 10, description: 'd' }], answer: '顧客ごとに違う' }]
};
const settings = { LLM_MODEL: 'test-model', LLM_MAX_RETRIES: 2 };
const result = { question_id: 'Q003', score: 9, max_score: 10, confidence: 0.9, reason: 'ok', criteria: [{ criterion_id: 'C01', score: 9 }] };
const okBody = JSON.stringify({ content: [{ type: 'tool_use', name: 'submit_grades', input: { results: [result] } }] });

function provider(responses, extra) {
  const calls = [];
  const sleeps = [];
  let i = 0;
  const p = new AnthropicProvider(settings, Object.assign({
    getKey: () => 'sk-secret',
    fetch: (url, options) => {
      calls.push({ url, options });
      const r = responses[Math.min(i++, responses.length - 1)];
      if (r instanceof Error) throw r;
      return r;
    },
    sleep: (ms) => sleeps.push(ms)
  }, extra));
  return { p, calls, sleeps };
}

test('依頼は公式APIだけに送り、温度0・強制ツールで構造化出力を求める', () => {
  const req = buildRequest(payload, settings, 'sk-secret');
  assert.equal(req.url, 'https://api.anthropic.com/v1/messages');
  assert.equal(req.headers['x-api-key'], 'sk-secret');
  const body = JSON.parse(req.body);
  assert.equal(body.model, 'test-model');
  assert.equal(body.temperature, 0);
  assert.equal(body.system, 'SYS abc');
  assert.deepEqual(body.tool_choice, { type: 'tool', name: 'submit_grades' });
  const text = body.messages[0].content;
  assert.ok(text.includes('--- STUDENT ANSWER START abc ---'));
  assert.ok(text.includes(JSON.stringify('顧客ごとに違う')));
});

test('応答からツールの入力を取り出す。形が違えば失敗する', () => {
  assert.deepEqual(parseResponse(okBody), [result]);
  assert.throws(() => parseResponse('{"content":[{"type":"text","text":"hi"}]}'));
  assert.throws(() => parseResponse('not json'));
});

test('429と5xxだけ再試行する', () => {
  [429, 500, 502, 503, 504].forEach((c) => assert.equal(isRetryable(c), true));
  [200, 400, 401, 403, 404].forEach((c) => assert.equal(isRetryable(c), false));
});

test('成功すれば結果を返す', () => {
  const { p, calls } = provider([{ code: 200, body: okBody }]);
  assert.deepEqual(p.gradeBatch(payload), [result]);
  assert.equal(calls.length, 1);
});

test('429のあと成功すれば、待ってから再試行して成功する', () => {
  const { p, calls, sleeps } = provider([{ code: 429, body: '' }, { code: 200, body: okBody }]);
  assert.deepEqual(p.gradeBatch(payload), [result]);
  assert.equal(calls.length, 2);
  assert.deepEqual(sleeps, [2000]);
});

test('通信エラーも再試行する', () => {
  const { p, calls } = provider([new Error('network'), { code: 200, body: okBody }]);
  assert.deepEqual(p.gradeBatch(payload), [result]);
  assert.equal(calls.length, 2);
});

test('再試行は LLM_MAX_RETRIES 回までで、超えたら失敗する', () => {
  const { p, calls, sleeps } = provider([{ code: 503, body: '' }]);
  assert.throws(() => p.gradeBatch(payload));
  assert.equal(calls.length, 3);
  assert.deepEqual(sleeps, [2000, 5000]);
});

test('400系は再試行しない', () => {
  const { p, calls } = provider([{ code: 400, body: 'bad' }]);
  assert.throws(() => p.gradeBatch(payload));
  assert.equal(calls.length, 1);
});

test('エラーメッセージにキーや応答本文を含めない', () => {
  const { p } = provider([{ code: 401, body: '{"error":"invalid key sk-secret student-answer"}' }]);
  try { p.gradeBatch(payload); assert.fail('should throw'); } catch (e) {
    assert.ok(!e.message.includes('sk-secret'));
    assert.ok(!e.message.includes('student-answer'));
    assert.ok(e.message.includes('401'));
  }
});

test('キーが無ければ失敗する', () => {
  const { p } = provider([{ code: 200, body: okBody }], { getKey: () => '' });
  assert.throws(() => p.gradeBatch(payload), /ANTHROPIC_API_KEY/);
});
