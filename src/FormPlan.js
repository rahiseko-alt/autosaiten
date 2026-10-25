/**
 * フォーム生成の計画（何をするか、何を作るか）。Apps Script の API には依存しない。
 */

var FORM_PLAN_TYPE_KIND_ = {
  SHORT_TEXT: 'TEXT', PARAGRAPH: 'PARAGRAPH', MULTIPLE_CHOICE: 'MULTIPLE_CHOICE',
  CHECKBOX: 'CHECKBOX', DROPDOWN: 'DROPDOWN', INFO: 'INFO'
};

/** 氏名の比べ方。LateCap.js の lcName_・集計表の gbName_ と同じく、NFKC・大文字小文字・空白の違いをそろえる。 */
function fpNameKey_(v) {
  return String(v === undefined || v === null ? '' : v).normalize('NFKC').trim().toLowerCase().replace(/\s+/g, ' ').trim();
}

/** 名簿の氏名を、プルダウンの選択肢にする。名簿の順で、前後の空白を除き、空の行は捨てる（ADR 0014）。 */
function rosterNameChoices(roster) {
  return (roster || []).map(function (r) { return String(r.氏名 === undefined || r.氏名 === null ? '' : r.氏名).trim(); })
    .filter(function (name) { return name !== ''; });
}

/** 名簿で、同じ氏名（比べ方は fpNameKey_）が2人以上いるものを、最初に出た綴りで返す。 */
function findDuplicateNames(roster) {
  var count = {};
  var first = {};
  var order = [];
  rosterNameChoices(roster).forEach(function (name) {
    var key = fpNameKey_(name);
    if (count[key] === undefined) { count[key] = 0; first[key] = name; order.push(key); }
    count[key] += 1;
  });
  return order.filter(function (key) { return count[key] > 1; }).map(function (key) { return first[key]; });
}

/** 選択肢が、順序まで同じか。 */
function sameChoices(a, b) {
  return a.length === b.length && a.every(function (v, i) { return v === b[i]; });
}

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
 * @param {string[]} [names] 名簿の氏名（rosterNameChoices の結果）。あれば氏名欄を名簿から選ぶプルダウンにし、クラス欄は付けない（ADR 0014）
 */
function buildFormSpec(questions, settings, classes, names) {
  var previousSection = null;
  var items = questions.filter(fpEnabled_).map(function (q) {
    var section = String(q.section || '').trim();
    var header = (section !== '' && section !== previousSection) ? section : null;
    if (section !== '') previousSection = section;

    // 選択式もフォームの自動採点は使わず、仕組みの中で採点する（ADR 0013）。正解は設定しない
    var choices = fpSplit_(q.options).map(function (value) {
      return { value: value, correct: false };
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
      choices: choices,
      section_header: header,
      feedback_correct: String(q.feedback_correct || ''),
      feedback_incorrect: String(q.feedback_incorrect || '')
    };
  });
  // 問題の項目と氏名欄には点数を付けず、最後の採点結果の欄の配点を満点にする（フォームには合計点だけを出す。ADR 0013）
  var total = questions.filter(fpEnabled_).reduce(function (sum, q) {
    return sum + (q.question_type === 'INFO' ? 0 : (Number(q.points) || 0));
  }, 0);
  var spec = {
    title: String(settings.FORM_TITLE || ''),
    description: String(settings.FORM_DESCRIPTION || ''),
    collectEmail: settings.COLLECT_EMAIL === true || String(settings.COLLECT_EMAIL).toUpperCase() === 'TRUE',
    // 既定は1人1回。Settings で FALSE にしたときだけ外す
    limitOneResponse: !(settings.LIMIT_ONE_RESPONSE === false || String(settings.LIMIT_ONE_RESPONSE).toUpperCase() === 'FALSE'),
    nameItem: { title: '氏名（Name）', required: true, points: 0 },
    items: items,
    // 回答の無い項目には点を書き込めないので必須にする。学生は選択肢を1つ押すだけで済む
    resultItem: {
      title: '採点結果（「確認しました」を選んでください）', help_text: '返却のとき、ここに合計点と講評が表示されます',
      required: true, points: total, choice: '確認しました'
    }
  };
  // 氏名を名簿から選ぶときだけ nameItem に印を足す。名簿が空のときの spec は、従来と1文字も変えない（定義の指紋のため）
  if (names && names.length > 0) {
    spec.nameItem = { title: spec.nameItem.title, required: spec.nameItem.required, points: 0, kind: 'DROPDOWN', choices: names.slice() };
    return spec;
  }
  // クラス欄が無いときは項目ごと入れない（定義の指紋を、クラス欄ができる前と同じに保つ）
  if (classes && classes.length > 0) spec.classItem = { title: 'クラス（Class）', required: true, choices: classes.slice() };
  return spec;
}

/** フォームに影響する定義だけから、短い指紋を作る（FNV-1a 32bit + 長さ）。 */
function definitionHash(questions, settings, classes, names) {
  var spec = buildFormSpec(questions, settings, classes, names);
  // 氏名の選択肢の中身は入れない（名簿に学生を足しても新しい版にしない。押し直しで選択肢だけを直す。ADR 0014）
  if (spec.nameItem.choices) spec.nameItem = Object.assign({}, spec.nameItem, { choices: [] });
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
  module.exports = {
    buildFormSpec: buildFormSpec, definitionHash: definitionHash, decideFormAction: decideFormAction,
    rosterNameChoices: rosterNameChoices, findDuplicateNames: findDuplicateNames, sameChoices: sameChoices, fpNameKey_: fpNameKey_
  };
}
