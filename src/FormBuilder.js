/**
 * Questions からGoogleフォーム（クイズ）を作る。計画の判断は FormPlan.js にある。
 * 回答済みのフォームは変更せず、新しい版を作る（ADR 0002）。
 */

var PROP_ACTIVE_FORM_ID = 'ACTIVE_FORM_ID';
var PROP_FORM_VERSION = 'FORM_VERSION';
var PROP_DEFINITION_HASH = 'DEFINITION_HASH';
var PROP_NAME_MODE = 'NAME_MODE';

/** 直前の buildOrVersionForm で、メールアドレスの収集を「確認済み」にできなかったか。Control が案内に使う。 */
var fbVerifiedEmailFailed_ = false;
/** 直前の buildOrVersionForm で、名簿の有無で氏名欄の形（手入力／プルダウン）が変わって新しい版になったか。Control が案内に使う。 */
var fbNameModeChanged_ = false;

/** @return {'CREATE'|'NOOP'|'SYNC'|'NEW_VERSION'} 行ったこと */
function buildOrVersionForm() {
  var props = PropertiesService.getDocumentProperties();
  var settings = readSettings();
  var questions = readTable(SHEET_NAMES.QUESTIONS);
  var classes = rosterClasses_();
  // 氏名は名簿から選ぶプルダウンにする。名簿が空のときは手入力のまま（ADR 0014）
  var names = rosterNameChoices(readTable(SHEET_NAMES.ROSTER));
  var nameMode = names.length > 0 ? 'DROPDOWN' : 'TEXT';
  var hash = definitionHash(questions, settings, classes, names);

  var formId = props.getProperty(PROP_ACTIVE_FORM_ID);
  var form = null;
  if (formId) {
    // 開けないときに「フォームが無い」と決めつけて新しく作ると、回答済みのフォームを置き去りにする。
    try {
      form = FormApp.openById(formId);
    } catch (e) {
      throw new Error('現在のフォームを開けませんでした。少し待ってもう一度試すか、導入担当者に連絡してください');
    }
  }
  var version = Number(props.getProperty(PROP_FORM_VERSION)) || 0;

  var action = decideFormAction({
    hasForm: form !== null,
    responseCount: form ? form.getResponses().length : 0,
    sameDefinition: props.getProperty(PROP_DEFINITION_HASH) === hash
  });

  fbVerifiedEmailFailed_ = false;
  fbNameModeChanged_ = false;
  if (action === 'NOOP') {
    // 手で「回答の概要を表示する」をオンにされても、押し直せば戻る（ADR 0011）
    form.setPublishingSummary(false);
    requireVerifiedEmail_(form, settings);
    syncClassChoices_(form, version, classes);
    syncNameChoices_(form, version, names);
    showFormInfo_(form, version);
    return action;
  }
  var spec = buildFormSpec(questions, settings, classes, names);
  // 名簿が空から埋まった（または空になった）ときは氏名欄の形が変わる。回答があれば新しい版になるので、案内に使う
  var previousMode = props.getProperty(PROP_NAME_MODE) || currentNameMode_(form, version);
  if (action === 'NEW_VERSION' && previousMode && previousMode !== nameMode) fbNameModeChanged_ = true;

  var oldForm = null;
  if (action === 'CREATE' || action === 'NEW_VERSION') {
    // 旧フォームは、新しいフォームが出来上がってから閉じる。途中で Google が止まっても、
    // 旧フォームが閉じたまま新しいフォームが無い、という状態にしないため。
    if (action === 'NEW_VERSION' && fbIsTrue_(settings.AUTO_CLOSE_OLD_FORM)) oldForm = form;
    version += 1;
    form = FormApp.create(spec.title + (version > 1 ? ' (第' + version + '版)' : ''));
    form.setDestination(FormApp.DestinationType.SPREADSHEET, SpreadsheetApp.getActive().getId());
  } else {
    clearMappingFor_(version);
    form.getItems().slice().reverse().forEach(function (item) { form.deleteItem(item); });
  }

  populateForm_(form, spec, version);
  requireVerifiedEmail_(form, settings);
  props.setProperty(PROP_ACTIVE_FORM_ID, form.getId());
  props.setProperty(PROP_FORM_VERSION, String(version));
  props.setProperty(PROP_DEFINITION_HASH, hash);
  props.setProperty(PROP_NAME_MODE, nameMode);
  if (oldForm) {
    oldForm.setAcceptingResponses(false);
    writeLog('INFO', 'FORM_CLOSED', oldForm.getId(), '旧フォームの回答受付を停止しました', { form_version: version - 1 });
  }
  showFormInfo_(form, version);
  return action;
}

/**
 * クラス欄の選択肢を名簿に合わせる。フォームを手で触って選択肢が欠けたときに、「これでOK」を押し直すだけで戻せるようにする。
 * 選択肢の名前だけを直し、回答は消えず、新しい版も作らない（ADR 0002）。名簿にクラスが無いとき、クラス欄が無いときは何もしない。
 */
function syncClassChoices_(form, version, classes) {
  if (classes.length === 0) return;
  var mapped = readTable(SHEET_NAMES.FORM_MAPPING).filter(function (r) {
    return Number(r.form_version) === version && r.question_id === CLASS_QUESTION_ID;
  })[0];
  if (!mapped) return;
  var item = form.getItemById(Number(mapped.form_item_id));
  if (!item) return;
  var choiceItem = item.asMultipleChoiceItem();
  var current = choiceItem.getChoices().map(function (c) { return c.getValue(); });
  if (current.join('\n') === classes.join('\n')) return;
  choiceItem.setChoices(classes.map(function (c) { return choiceItem.createChoice(c); }));
  writeLog('INFO', 'FORM_CLASS_CHOICES_SYNCED', form.getId(), 'クラス欄の選択肢を名簿に合わせました', { before: current, after: classes });
}

/**
 * 氏名欄（プルダウン）の選択肢を名簿に合わせる。名簿に学生を足したあと「これでOK」を押し直すだけで反映する。
 * 選択肢だけを直し、回答は消えず、新しい版も作らない（ADR 0014）。氏名欄が手入力のとき・氏名欄が無いとき・選択肢が同じときは何もしない。
 */
function syncNameChoices_(form, version, names) {
  if (names.length === 0) return;
  var mapped = readTable(SHEET_NAMES.FORM_MAPPING).filter(function (r) {
    return Number(r.form_version) === version && r.question_id === NAME_QUESTION_ID;
  })[0];
  if (!mapped) return;
  var item = form.getItemById(Number(mapped.form_item_id));
  if (!item || item.getType() !== FormApp.ItemType.LIST) return;
  var listItem = item.asListItem();
  var current = listItem.getChoices().map(function (c) { return c.getValue(); });
  if (sameChoices(current, names)) return;
  listItem.setChoices(names.map(function (n) { return listItem.createChoice(n); }));
  writeLog('INFO', 'FORM_NAME_CHOICES_SYNCED', form.getId(), '氏名欄の選択肢を名簿に合わせました', { before: current.length, after: names.length });
}

/** 名簿に同じ氏名の人がいるとき、先生に伝えるエラー文（直し方つき）。いなければ空の配列。 */
function rosterNameErrors_() {
  var dup = findDuplicateNames(readTable(SHEET_NAMES.ROSTER));
  if (dup.length === 0) return [];
  return ['・名簿に同じ氏名の人がいます（' + dup.map(function (n) { return '「' + n + '」'; }).join('、') +
    '）。プルダウンで見分けられるよう、名簿の氏名を直してから（例「山田 太郎（2）」）、もう一度「これでOK」を押してください。'];
}

/** 今のフォームの氏名欄の形（'DROPDOWN'／'TEXT'）。記録が無い（この仕組みの前に作った）フォームの案内に使う。フォームが無ければ空。 */
function currentNameMode_(form, version) {
  if (!form) return '';
  var mapped = readTable(SHEET_NAMES.FORM_MAPPING).filter(function (r) {
    return Number(r.form_version) === version && r.question_id === NAME_QUESTION_ID;
  })[0];
  var item = mapped ? form.getItemById(Number(mapped.form_item_id)) : null;
  if (!item) return '';
  return item.getType() === FormApp.ItemType.LIST ? 'DROPDOWN' : 'TEXT';
}

/** 名簿シートのクラスを、出てきた順に重複なく返す。名簿が無ければ空。 */
function rosterClasses_() {
  var seen = {};
  var out = [];
  readTable(SHEET_NAMES.ROSTER).forEach(function (r) {
    var c = String(r.クラス || '').trim();
    if (c !== '' && !seen[c]) { seen[c] = true; out.push(c); }
  });
  return out;
}

/**
 * メールアドレスの収集を「確認済み」（ログイン中のアカウントが自動で入る）にする。
 * FormApp の setCollectEmail(true) では「回答者からの入力」になり、照合に使えないため、Forms API で指定する（ADR 0011）。
 * 失敗しても止めず、先生に手で直してもらう案内を出す。
 */
function requireVerifiedEmail_(form, settings) {
  if (!fbIsTrue_(settings.COLLECT_EMAIL)) return;
  var res;
  try {
    res = UrlFetchApp.fetch('https://forms.googleapis.com/v1/forms/' + form.getId() + ':batchUpdate', {
      method: 'post',
      contentType: 'application/json',
      headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() },
      payload: JSON.stringify({ requests: [{ updateSettings: {
        settings: { emailCollectionType: 'VERIFIED' }, updateMask: 'emailCollectionType'
      } }] }),
      muteHttpExceptions: true
    });
  } catch (e) {
    res = null;
  }
  if (res && res.getResponseCode() === 200) return;
  fbVerifiedEmailFailed_ = true;
  writeLog('WARN', 'VERIFIED_EMAIL_FAILED', form.getId(), 'メールアドレスの収集を「確認済み」にできませんでした',
    { status: res ? res.getResponseCode() : 'error', body: res ? String(res.getContentText()).slice(0, 300) : '' });
}

function fbIsTrue_(value) {
  return value === true || String(value).trim().toUpperCase() === 'TRUE';
}

function populateForm_(form, spec, version) {
  form.setTitle(spec.title);
  form.setDescription(spec.description);
  form.setIsQuiz(true);
  // 他の学生の回答が見えないよう、「回答の概要を表示する」は常にオフ（ADR 0011）
  form.setPublishingSummary(false);
  // 先生のアカウントの初期設定で既に集める設定（「確認済み」など）なら触らない。
  // setCollectEmail(true) は「回答者からの入力」に切り替えてしまうため、集めていないときだけ呼ぶ（ADR 0011）
  if (!spec.collectEmail) form.setCollectEmail(false);
  else if (!form.collectsEmail()) form.setCollectEmail(true);
  form.setAllowResponseEdits(false);
  form.setLimitOneResponsePerUser(spec.limitOneResponse);
  form.setAcceptingResponses(true);

  var now = new Date();
  var mapping = [];
  // 先頭に氏名欄。採点の対象ではないが、誰の答案かを結果に出すため対応表に記録する。配点は付けない
  // 名簿があるテストは、名簿の氏名を選ぶプルダウン。無いときは手入力（ADR 0014）
  var nameItem;
  if (spec.nameItem.kind === 'DROPDOWN') {
    nameItem = form.addListItem();
    nameItem.setChoices(spec.nameItem.choices.map(function (n) { return nameItem.createChoice(n); }));
  } else {
    nameItem = form.addTextItem();
  }
  nameItem.setTitle(spec.nameItem.title).setRequired(spec.nameItem.required);
  mapping.push([version, form.getId(), NAME_QUESTION_ID, String(nameItem.getId()), now]);
  if (spec.classItem) {
    var classItem = form.addMultipleChoiceItem().setTitle(spec.classItem.title).setRequired(spec.classItem.required);
    classItem.setChoices(spec.classItem.choices.map(function (c) { return classItem.createChoice(c); }));
    mapping.push([version, form.getId(), CLASS_QUESTION_ID, String(classItem.getId()), now]);
  }
  spec.items.forEach(function (it) {
    if (it.section_header) form.addSectionHeaderItem().setTitle(it.section_header);
    if (it.kind === 'INFO') {
      // 答えのない説明の欄。採点しないので対応表には記録しない
      var info = form.addSectionHeaderItem().setTitle(it.title);
      if (it.help_text) info.setHelpText(it.help_text);
      return;
    }
    var item = addItem_(form, it);
    item.setTitle(it.title);
    if (it.help_text) item.setHelpText(it.help_text);
    item.setRequired(it.required);
    // 問題の項目には点数もフィードバックも付けない。採点は仕組みの中で行い、合計点と講評は採点結果の欄に出す（ADR 0013）。
    // 選択肢の正解を設定しないので、フィードバックを付けると全員に「不正解」のほうが出てしまう
    mapping.push([version, form.getId(), it.question_id, String(item.getId()), now]);
  });
  // 一番最後に採点結果の欄。合計点と講評の受け皿なので、必須にして配点を満点にする（ADR 0013。フォームは0点の設定を受け付けない）
  // 選択肢が1つだけの選択式。学生は押すだけで済み、押した回答に点と講評を書き込める
  var resultItem = form.addMultipleChoiceItem().setTitle(spec.resultItem.title).setHelpText(spec.resultItem.help_text)
    .setRequired(spec.resultItem.required);
  resultItem.setChoices([resultItem.createChoice(spec.resultItem.choice, false)]);
  if (spec.resultItem.points > 0) resultItem.setPoints(spec.resultItem.points);
  mapping.push([version, form.getId(), RESULT_QUESTION_ID, String(resultItem.getId()), now]);
  var sheet = SpreadsheetApp.getActive().getSheetByName(SHEET_NAMES.FORM_MAPPING);
  if (mapping.length > 0) sheet.getRange(sheet.getLastRow() + 1, 1, mapping.length, 5).setValues(mapping);
}

function addItem_(form, it) {
  var choiceFor = function (item) {
    item.setChoices(it.choices.map(function (c) { return item.createChoice(c.value, c.correct); }));
    return item;
  };
  switch (it.kind) {
    case 'TEXT': return form.addTextItem();
    case 'PARAGRAPH': return form.addParagraphTextItem();
    case 'MULTIPLE_CHOICE': return choiceFor(form.addMultipleChoiceItem());
    case 'CHECKBOX': return choiceFor(form.addCheckboxItem());
    case 'DROPDOWN': return choiceFor(form.addListItem());
    default: throw new Error('未対応の問題タイプ: ' + it.kind);
  }
}

/** 同じ版の対応表の行を消す（回答が無いフォームを同期し直すとき）。 */
function clearMappingFor_(version) {
  var sheet = SpreadsheetApp.getActive().getSheetByName(SHEET_NAMES.FORM_MAPPING);
  var values = sheet.getDataRange().getValues();
  for (var r = values.length - 1; r >= 1; r--) {
    if (Number(values[r][0]) === version) sheet.deleteRow(r + 1);
  }
}

function showFormInfo_(form, version) {
  setControl('FORM_URL', form.getPublishedUrl());
  setControl('EDIT_URL', form.getEditUrl());
  setControl('FORM_VERSION', version);
}
