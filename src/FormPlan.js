/**
 * フォーム生成の計画（何をするか、何を作るか）。Apps Script の API には依存しない。
 */

var FORM_PLAN_TYPE_KIND_ = {
  SHORT_TEXT: 'TEXT', PARAGRAPH: 'PARAGRAPH', MULTIPLE_CHOICE: 'MULTIPLE_CHOICE',
  CHECKBOX: 'CHECKBOX', DROPDOWN: 'DROPDOWN', INFO: 'INFO'
};

function fpSplit_(value) {
  var list = (typeof splitList === 'function') ? splitList : require('./Utils.js').splitList;
  return list(value);
}

function fpEnabled_(q) {
  return q.enabled === true || String(q.enabled).trim().toUpperCase() === 'TRUE';
}

function fpRequired_(q) {
  return q.required === true || String(q.required).trim().toUpperCase() === 'TRUE';
}

/**
 * 設定を組み立てた、フォームの仕様。順番どおりに並んだ項目と、フォーム全体の設定を返す。
 * @param {string[]} [classes] 名簿のクラス。あれば氏名欄の次にクラス欄を付ける
 */
function buildFormSpec(questions, settings, classes) {
  var previousSection = null;
  var items = questions.filter(fpEnabled_).map(function (q) {
    var section = String(q.section || '').trim();
    var header = (section !== '' && section !== previousSection) ? section : null;
    if (section !== '') previousSection = section;

    var nativeChoice = String(q.auto_rule || '').trim() === 'NATIVE';
    var correct = fpSplit_(q.correct_answer);
    var choices = fpSplit_(q.options).map(function (value) {
      return { value: value, correct: nativeChoice && correct.indexOf(value) >= 0 };
    });
    // フォームの質問の見出しは1行しか出ないので、最初の改行より後ろは見出しの下の説明欄に入れる
    var text = String(q.question_text).replace(/\r\n?/g, '\n');
    var cut = text.indexOf('\n');
    return {
      question_id: String(q.question_id),
      kind: FORM_PLAN_TYPE_KIND_[q.question_type],
      title: cut < 0 ? text : text.slice(0, cut).trim(),
      help_text: cut < 0 ? '' : text.slice(cut + 1).trim(),
      required: q.question_type === 'INFO' ? false : fpRequired_(q),
      points: q.question_type === 'INFO' ? 0 : (Number(q.points) || 0),
      choices: choices,
      section_header: header,
      feedback_correct: String(q.feedback_correct || ''),
      feedback_incorrect: String(q.feedback_incorrect || '')
    };
  });
  var spec = {
    title: String(settings.FORM_TITLE || ''),
    description: String(settings.FORM_DESCRIPTION || ''),
    collectEmail: settings.COLLECT_EMAIL === true || String(settings.COLLECT_EMAIL).toUpperCase() === 'TRUE',
    // 既定は1人1回。Settings で FALSE にしたときだけ外す
    limitOneResponse: !(settings.LIMIT_ONE_RESPONSE === false || String(settings.LIMIT_ONE_RESPONSE).toUpperCase() === 'FALSE'),
    nameItem: { title: '氏名（Name）', required: true },
    items: items
  };
  // クラス欄が無いときは項目ごと入れない（定義の指紋を、クラス欄ができる前と同じに保つ）
  if (classes && classes.length > 0) spec.classItem = { title: 'クラス（Class）', required: true, choices: classes.slice() };
  return spec;
}

/** フォームに影響する定義だけから、短い指紋を作る（FNV-1a 32bit + 長さ）。 */
function definitionHash(questions, settings, classes) {
  var spec = buildFormSpec(questions, settings, classes);
  var raw = JSON.stringify(spec);
  var h = 0x811c9dc5;
  for (var i = 0; i < raw.length; i++) {
    h ^= raw.charCodeAt(i);
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return ('00000000' + h.toString(16)).slice(-8) + '-' + raw.length;
}

/**
 * 回答済みフォームは変更せず、新しい版を作る（ADR 0002）。
 * @param {{hasForm: boolean, responseCount?: number, sameDefinition?: boolean}} state
 * @return {'CREATE'|'NOOP'|'SYNC'|'NEW_VERSION'}
 */
function decideFormAction(state) {
  if (!state.hasForm) return 'CREATE';
  if (state.sameDefinition) return 'NOOP';
  return (state.responseCount || 0) > 0 ? 'NEW_VERSION' : 'SYNC';
}

if (typeof module !== 'undefined') {
  module.exports = { buildFormSpec: buildFormSpec, definitionHash: definitionHash, decideFormAction: decideFormAction };
}
