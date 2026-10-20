/**
 * テスト用の提供元。実APIを呼ばず、与えた固定の結果を返す。
 * 共通インターフェース: gradeBatch(payload) -> GradeResult[]
 */
function MockProvider(responder) {
  this.calls = [];
  this.responder = responder;
}

MockProvider.prototype.gradeBatch = function (payload) {
  this.calls.push(payload);
  return this.responder(payload);
};

if (typeof module !== 'undefined') module.exports = { MockProvider: MockProvider };
