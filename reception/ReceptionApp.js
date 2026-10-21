/**
 * 受付ページ（ウェブアプリ）。学生はクラスと名前を選び、資料番号の資料と、氏名・クラスを入れたフォームへの入口を受け取る。
 *
 * 採点の仕組み（src/）とは別の Apps Script プロジェクトにしてある。誰でも開けるウェブアプリでは、
 * 末尾が _ でない関数はすべて画面から呼べてしまうため、採点の仕組みの関数を同じプロジェクトに置かない（ADR 0009）。
 * 外から呼べるのは doGet・getReceptionRoster・claimMaterial と、Reception.js の害の無い判断だけ。
 * スプレッドシートの ID は、導入時に作る LocalSettings.js（GitHub には置かない）の SPREADSHEET_ID で受け取る。
 */

var RC_CONTROL_EDIT_URL_ = 'B7';
var RC_CACHE_SECONDS_ = 21600;

function doGet() {
  return HtmlService.createHtmlOutputFromFile('ReceptionPage')
    .setTitle('受付')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

/** 画面が最初に呼ぶ。クラスごとの名簿を返す。 */
function getReceptionRoster() {
  return rosterByClass(rcReadTable_('名簿'));
}

/**
 * 資料番号を確保し、その資料と、氏名・クラスを入れたフォームのURLを返す。
 * このプロジェクトのロックは採点の仕組みのロックとは別物なので、採点処理を待たない。
 */
function claimMaterial(cls, name) {
  var group = getReceptionRoster().filter(function (g) { return g.name === cls; })[0];
  if (!group || group.students.indexOf(name) < 0) throw new Error('名簿にない名前です。選び直してください');

  var materials = rcReadTable_('資料').filter(function (m) { return String(m.本文 || '').trim() !== ''; });
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  var plan;
  try {
    plan = planAssignment(rcReadTable_('割り当て'), cls, name, materials.length);
    if (plan.isNew) {
      rcSpreadsheet_().getSheetByName('割り当て').appendRow([cls, name, plan.number, new Date()]);
      // 次に待っている人が、この行を読んでから番号を決めるよう、ロックを外す前に書き込みを確定させる
      SpreadsheetApp.flush();
    }
  } finally {
    lock.releaseLock();
  }
  var material = materials.filter(function (m) { return Number(m.資料番号) === plan.number; })[0];
  if (!material) throw new Error('資料番号 ' + plan.number + ' の資料がありません。先生に連絡してください');
  return { number: plan.number, text: String(material.本文), formUrl: rcPrefilledFormUrl_(cls, name) };
}

var rcOpened_ = null;

/** 1回の呼び出しの中では、開いたスプレッドシートを使い回す。 */
function rcSpreadsheet_() {
  if (rcOpened_) return rcOpened_;
  var notReady = '受付ページの準備ができていません（スプレッドシートを開けません）。先生に連絡してください';
  if (typeof SPREADSHEET_ID === 'undefined' || !/^[A-Za-z0-9_-]{20,}$/.test(String(SPREADSHEET_ID))) throw new Error(notReady);
  try {
    rcOpened_ = SpreadsheetApp.openById(SPREADSHEET_ID);
  } catch (e) {
    throw new Error(notReady);
  }
  return rcOpened_;
}

function rcReadTable_(sheetName) {
  var sheet = rcSpreadsheet_().getSheetByName(sheetName);
  if (!sheet || sheet.getLastRow() < 2) return [];
  var values = sheet.getRange(1, 1, sheet.getLastRow(), sheet.getLastColumn()).getValues();
  var headers = values[0];
  return values.slice(1)
    .filter(function (row) { return row.some(function (v) { return v !== '' && v !== null; }); })
    .map(function (row) {
      var obj = {};
      headers.forEach(function (h, i) { obj[h] = row[i]; });
      return obj;
    });
}

/**
 * 氏名欄とクラス欄を入れた状態の、今のフォームのURL。作れなければ空（画面が先生への連絡を促す）。
 * フォームを開くのは重いので、クラスごとに「氏名だけ差し替えればよいURL」を覚えておく。
 * 「これでOK」で項目が作り直されると項目の番号が変わるので、覚える鍵に項目の番号を含める。
 */
function rcPrefilledFormUrl_(cls, name) {
  var control = rcSpreadsheet_().getSheetByName('Control');
  if (!control) return '';
  var m = String(control.getRange(RC_CONTROL_EDIT_URL_).getValue()).match(/\/forms\/d\/([^/]+)/);
  if (!m) return '';
  var formId = m[1];
  var itemOf = {};
  rcReadTable_('FormMapping').forEach(function (r) {
    if (r.form_id === formId) itemOf[r.question_id] = Number(r.form_item_id);
  });
  if (!itemOf.__NAME__) return '';
  var placeholder = 'RCNAMEPLACEHOLDER';
  var cache = CacheService.getScriptCache();
  var key = ['prefill', formId, itemOf.__NAME__, itemOf.__CLASS__ || 0,
    Utilities.base64EncodeWebSafe(Utilities.newBlob(cls).getBytes())].join(':');
  var template = cache.get(key);
  if (!template) {
    try {
      template = rcBuildTemplate_(formId, itemOf, cls, placeholder);
    } catch (e) {
      // 名簿にあってフォームに無いクラスなど。番号と資料は渡し、入口だけ出さない
      return '';
    }
    cache.put(key, template, RC_CACHE_SECONDS_);
  }
  return template.split(placeholder).join(encodeURIComponent(name));
}

function rcBuildTemplate_(formId, itemOf, cls, placeholder) {
  var form = FormApp.openById(formId);
  var response = form.createResponse()
    .withItemResponse(form.getItemById(itemOf.__NAME__).asTextItem().createResponse(placeholder));
  if (itemOf.__CLASS__) {
    response.withItemResponse(form.getItemById(itemOf.__CLASS__).asMultipleChoiceItem().createResponse(cls));
  }
  return response.toPrefilledUrl();
}
