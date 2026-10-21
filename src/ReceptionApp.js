/**
 * 受付ページ（ウェブアプリ）。学生はクラスと名前を選び、資料番号の資料と、氏名・クラスを入れたフォームへの入口を受け取る。
 * 作成者として動くので、開いた人のメールアドレスは使わない。判断は Reception.js にある。
 */

var PROP_SPREADSHEET_ID = 'SPREADSHEET_ID';
var MATERIAL_HEADERS = ['資料番号', '本文', '家賃', '貯金額', '必要額', '不足額', '必要日数', '開始期限'];
var ASSIGNMENT_HEADERS = ['クラス', '氏名', '資料番号', '受付日時'];
var ROSTER_HEADERS = ['クラス', 'No.', '氏名', '呼び名'];

function doGet() {
  return HtmlService.createHtmlOutputFromFile('ReceptionPage')
    .setTitle('受付')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

/** ウェブアプリと時間主導の処理からも、このスプレッドシートとフォームを開けるよう、ID を控える。 */
function rememberIds_(formId) {
  var props = PropertiesService.getScriptProperties();
  var ss = SpreadsheetApp.getActive();
  if (ss) props.setProperty(PROP_SPREADSHEET_ID, ss.getId());
  if (formId) props.setProperty(PROP_ACTIVE_FORM_ID, formId);
}

/** 画面が最初に呼ぶ。クラスごとの名簿を返す。 */
function getReceptionRoster() {
  return rosterByClass(readTable(SHEET_NAMES.ROSTER));
}

/**
 * 資料番号を確保し、その資料と、氏名・クラスを入れたフォームのURLを返す。
 * 採点処理が持つロックとは別のロックを使い、短く待つ。
 */
function claimMaterial(cls, name) {
  var roster = getReceptionRoster();
  var group = roster.filter(function (g) { return g.name === cls; })[0];
  if (!group || group.students.indexOf(name) < 0) throw new Error('名簿にない名前です。選び直してください');

  var materials = readTable(SHEET_NAMES.MATERIALS).filter(function (m) { return String(m.本文 || '').trim() !== ''; });
  var lock = LockService.getUserLock();
  lock.waitLock(20000);
  var plan;
  try {
    plan = planAssignment(readTable(SHEET_NAMES.ASSIGNMENTS), cls, name, materials.length);
    if (plan.isNew) activeSpreadsheet_().getSheetByName(SHEET_NAMES.ASSIGNMENTS).appendRow([cls, name, plan.number, new Date()]);
  } finally {
    lock.releaseLock();
  }
  var material = materials.filter(function (m) { return Number(m.資料番号) === plan.number; })[0];
  if (!material) throw new Error('資料番号 ' + plan.number + ' の資料がありません。先生に連絡してください');
  return { number: plan.number, text: String(material.本文), formUrl: prefilledFormUrl_(cls, name) };
}

/** 氏名欄とクラス欄を入れた状態のフォームのURL。フォームが無ければ空。 */
function prefilledFormUrl_(cls, name) {
  var formId = PropertiesService.getScriptProperties().getProperty(PROP_ACTIVE_FORM_ID);
  if (!formId) return '';
  var form = FormApp.openById(formId);
  var itemOf = {};
  readTable(SHEET_NAMES.FORM_MAPPING).forEach(function (m) {
    if (m.form_id === formId) itemOf[m.question_id] = String(m.form_item_id);
  });
  var response = form.createResponse();
  if (itemOf[NAME_QUESTION_ID]) {
    response.withItemResponse(form.getItemById(Number(itemOf[NAME_QUESTION_ID])).asTextItem().createResponse(name));
  }
  if (itemOf[CLASS_QUESTION_ID]) {
    response.withItemResponse(form.getItemById(Number(itemOf[CLASS_QUESTION_ID])).asMultipleChoiceItem().createResponse(cls));
  }
  return response.toPrefilledUrl();
}
