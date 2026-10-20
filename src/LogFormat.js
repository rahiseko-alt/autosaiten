/**
 * ログと診断の整形。秘密情報を出さない。Apps Script の API には依存しない。
 */

var LOG_SECRET_KEY_ = /key|authorization|token|secret|password/i;
var LOG_SECRET_VALUE_ = /sk-[A-Za-z0-9_-]{10,}/g;
var LOG_MAX_TEXT_ = 300;

/** details から、キー類を伏せ、長い文字列を切り詰めた複製を返す。 */
function sanitizeLogDetails(details) {
  if (details === undefined || details === null) return details;
  if (typeof details === 'string') {
    var t = details.replace(LOG_SECRET_VALUE_, '[伏せ字]');
    return t.length > LOG_MAX_TEXT_ ? t.slice(0, LOG_MAX_TEXT_) + '…' : t;
  }
  if (Array.isArray(details)) return details.map(sanitizeLogDetails);
  if (typeof details === 'object') {
    var out = {};
    Object.keys(details).forEach(function (k) {
      out[k] = LOG_SECRET_KEY_.test(k) ? '[伏せ字]' : sanitizeLogDetails(details[k]);
    });
    return out;
  }
  return details;
}

/** @param {{name: string, ok: boolean, detail?: string}[]} checks */
function formatDiagnostics(checks) {
  return checks.map(function (c) {
    return (c.ok ? 'OK: ' : 'NG: ') + c.name + (c.detail ? '（' + c.detail + '）' : '');
  }).join('\n');
}

if (typeof module !== 'undefined') {
  module.exports = { sanitizeLogDetails: sanitizeLogDetails, formatDiagnostics: formatDiagnostics };
}
