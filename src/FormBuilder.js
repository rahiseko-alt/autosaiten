/**
 * Questions からGoogleフォーム（クイズ）を作る。計画の判断は FormPlan.js にある。
 * 回答済みのフォームは変更せず、新しい版を作る（ADR 0002）。
 */

var PROP_ACTIVE_FORM_ID = 'ACTIVE_FORM_ID';
var PROP_FORM_VERSION = 'FORM_VERSION';
var PROP_DEFINITION_HASH = 'DEFINITION_HASH';

function buildOrVersionForm() {
  var props = PropertiesService.getDocumentProperties();
  var settings = readSettings();
  var questions = readTable(SHEET_NAMES.QUESTIONS);
  var hash = definitionHash(questions, settings);

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

  if (action === 'NOOP') {
    showFormInfo_(form, version);
    return;
  }
  var spec = buildFormSpec(questions, settings);

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
  props.setProperty(PROP_ACTIVE_FORM_ID, form.getId());
  props.setProperty(PROP_FORM_VERSION, String(version));
  props.setProperty(PROP_DEFINITION_HASH, hash);
  if (oldForm) {
    oldForm.setAcceptingResponses(false);
    writeLog('INFO', 'FORM_CLOSED', oldForm.getId(), '旧フォームの回答受付を停止しました', { form_version: version - 1 });
  }
  showFormInfo_(form, version);
}

function fbIsTrue_(value) {
  return value === true || String(value).trim().toUpperCase() === 'TRUE';
}

function populateForm_(form, spec, version) {
  form.setTitle(spec.title);
  form.setDescription(spec.description);
  form.setIsQuiz(true);
  form.setCollectEmail(spec.collectEmail);
  form.setAllowResponseEdits(false);
  form.setLimitOneResponsePerUser(spec.limitOneResponse);
  form.setAcceptingResponses(true);

  var now = new Date();
  var mapping = [];
  // 先頭に氏名欄。採点の対象ではないが、誰の答案かを結果に出すため対応表に記録する
  var nameItem = form.addTextItem().setTitle(spec.nameItem.title).setRequired(spec.nameItem.required);
  mapping.push([version, form.getId(), NAME_QUESTION_ID, String(nameItem.getId()), now]);
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
    item.setPoints(it.points);
    applyFeedback_(item, it);
    mapping.push([version, form.getId(), it.question_id, String(item.getId()), now]);
  });
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

function applyFeedback_(item, it) {
  if (it.feedback_correct && typeof item.setFeedbackForCorrect === 'function') {
    item.setFeedbackForCorrect(FormApp.createFeedback().setText(it.feedback_correct).build());
  }
  if (it.feedback_incorrect && typeof item.setFeedbackForIncorrect === 'function') {
    item.setFeedbackForIncorrect(FormApp.createFeedback().setText(it.feedback_incorrect).build());
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
