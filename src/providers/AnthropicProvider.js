/**
 * Anthropic（Claude）の提供元 adapter。共通インターフェース gradeBatch(payload) を実装する。
 * キーは Script Properties の ANTHROPIC_API_KEY から読む。ログや例外に、キーと応答本文を出さない。
 */

var ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
var ANTHROPIC_BACKOFF_MS = [2000, 5000, 10000];

var ANTHROPIC_TOOL_ = {
  name: 'submit_grades',
  description: '各問題の採点結果を提出する',
  input_schema: {
    type: 'object',
    properties: {
      results: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            question_id: { type: 'string' },
            score: { type: 'number' },
            max_score: { type: 'number' },
            confidence: { type: 'number' },
            reason: { type: 'string' },
            criteria: {
              type: 'array',
              items: {
                type: 'object',
                properties: { criterion_id: { type: 'string' }, score: { type: 'number' } },
                required: ['criterion_id', 'score']
              }
            }
          },
          required: ['question_id', 'score', 'max_score', 'confidence', 'reason', 'criteria']
        }
      }
    },
    required: ['results']
  }
};

/** 問題・ルーブリック・回答を1つの文章にする。回答は JSON の文字列として区切りの間に置く。 */
function renderUserPrompt(payload) {
  return payload.items.map(function (it) {
    var rubric = it.rubric.map(function (c) {
      return '- ' + c.criterion_id + ' ' + c.criterion + '（' + c.max_points + '点）: ' + c.description;
    }).join('\n');
    return [
      '## 問題 ' + it.question_id + '（配点 ' + it.max_points + '点）',
      it.question_text,
      '### ルーブリック',
      rubric,
      '### 学生回答',
      payload.delimiters.start,
      JSON.stringify(it.answer),
      payload.delimiters.end
    ].join('\n');
  }).join('\n\n') + '\n\nsubmit_grades ツールで、すべての問題の結果を提出してください。';
}

function buildRequest(payload, settings, apiKey) {
  return {
    url: ANTHROPIC_URL,
    headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({
      model: settings.LLM_MODEL,
      max_tokens: 4096,
      temperature: 0,
      system: payload.system,
      tools: [ANTHROPIC_TOOL_],
      tool_choice: { type: 'tool', name: 'submit_grades' },
      messages: [{ role: 'user', content: renderUserPrompt(payload) }]
    })
  };
}

function parseResponse(bodyText) {
  var data;
  try {
    data = JSON.parse(bodyText);
  } catch (e) {
    throw new Error('Anthropic の応答がJSONではありません');
  }
  var block = (data.content || []).filter(function (b) { return b.type === 'tool_use' && b.name === 'submit_grades'; })[0];
  if (!block || !block.input || !Array.isArray(block.input.results)) {
    throw new Error('Anthropic の応答に採点結果がありません');
  }
  return block.input.results;
}

function isRetryable(statusCode) {
  return [429, 500, 502, 503, 504].indexOf(statusCode) >= 0;
}

function defaultAnthropicDeps_() {
  return {
    getKey: function () { return PropertiesService.getScriptProperties().getProperty('ANTHROPIC_API_KEY'); },
    fetch: function (url, options) {
      var res = UrlFetchApp.fetch(url, {
        method: 'post', headers: options.headers, payload: options.body, muteHttpExceptions: true
      });
      return { code: res.getResponseCode(), body: res.getContentText() };
    },
    sleep: function (ms) { Utilities.sleep(ms); }
  };
}

/**
 * @param {Object} settings LLM_MODEL, LLM_MAX_RETRIES
 * @param {{getKey: function, fetch: function, sleep: function}} [deps] テストで差し替える
 */
function AnthropicProvider(settings, deps) {
  this.settings = settings;
  this.deps = deps || defaultAnthropicDeps_();
}

AnthropicProvider.prototype.gradeBatch = function (payload) {
  var key = this.deps.getKey();
  if (!key) throw new Error('ANTHROPIC_API_KEY が設定されていません');
  var request = buildRequest(payload, this.settings, key);
  var maxRetries = Math.max(0, Number(this.settings.LLM_MAX_RETRIES) || 0);
  var lastError = '';

  for (var attempt = 0; attempt <= maxRetries; attempt++) {
    var res = null;
    try {
      res = this.deps.fetch(request.url, request);
    } catch (e) {
      lastError = '通信エラー';
    }
    if (res) {
      if (res.code === 200) return parseResponse(res.body);
      lastError = 'HTTP ' + res.code;
      if (!isRetryable(res.code)) break;
    }
    if (attempt < maxRetries) this.deps.sleep(ANTHROPIC_BACKOFF_MS[Math.min(attempt, ANTHROPIC_BACKOFF_MS.length - 1)]);
  }
  throw new Error('Anthropic への依頼に失敗しました（' + lastError + '）');
};

if (typeof module !== 'undefined') {
  module.exports = {
    AnthropicProvider: AnthropicProvider, buildRequest: buildRequest, parseResponse: parseResponse,
    isRetryable: isRetryable, renderUserPrompt: renderUserPrompt
  };
}
