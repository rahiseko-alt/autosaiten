/**
 * 受付ページ（ウェブアプリ）。学生はクラスと名前を選び、資料番号の資料と、氏名・クラスを入れたフォームへの入口を受け取る。
 *
 * 採点の仕組み（src/）とは別の Apps Script プロジェクトにしてある。誰でも開けるウェブアプリでは、
 * 末尾が _ でない関数はすべて画面から呼べてしまうため、採点の仕組みの関数を同じプロジェクトに置かない（ADR 0009）。
 * 外から呼べるのは doGet・getReceptionRoster・claimMaterial と、Reception.js の害の無い判断だけ。
 * 導入時に作る LocalSettings.js（GitHub には置かない）では、テストではなく集計表の ID（GRADEBOOK_ID）を受け取る。
 * 案内先のテストは、集計表のテスト一覧で「受付ページを使う」と「実施中」の両方に印の付いた行で決まる（ADR 0012）。
 */

var RC_CONTROL_EDIT_URL_ = 'B7';
var RC_CACHE_SECONDS_ = 21600;
var RC_TESTS_CACHE_SECONDS_ = 60;
// 集計表のテスト一覧で読む列（gradebook/Gradebook.js の GB_SHEETS の見出しと同じ）。名簿・成績など他のシートは開かない
var RC_GRADEBOOK_SHEET_ = 'テスト一覧';
var RC_GRADEBOOK_COLUMNS_ = ['受付ページを使う', '実施中', 'スプレッドシートのID'];

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
  rcFormNote_ = '';
  var formUrl = rcPrefilledFormUrl_(cls, name);
  return { number: plan.number, text: String(material.本文), formUrl: formUrl, formNote: formUrl ? '' : rcFormNote_ };
}

var rcFormNote_ = '';
var rcOpened_ = null;

/** 1回の呼び出しの中では、開いたスプレッドシート（案内先のテスト）を使い回す。 */
function rcSpreadsheet_() {
  if (rcOpened_) return rcOpened_;
  var id = chooseReceptionTest(rcGradebookTests_());
  try {
    rcOpened_ = SpreadsheetApp.openById(id);
  } catch (e) {
    throw new Error('受付ページの準備ができていません（テストのスプレッドシートを開けません）。先生に連絡してください');
  }
  return rcOpened_;
}

/**
 * 集計表のテスト一覧から、受付ページを使う・実施中・スプレッドシートのIDの3列だけを読む。
 * 学生が開くたびに集計表を開かないよう、60秒ほど覚えておく（印を付け替えても1分ほどで切り替わる）。
 */
function rcGradebookTests_() {
  var cache = CacheService.getScriptCache();
  var key = 'gradebookTests';
  var cached = cache.get(key);
  if (cached) return JSON.parse(cached);

  var notReady = '受付ページの準備ができていません（集計表を開けません）。先生に連絡してください';
  if (typeof GRADEBOOK_ID === 'undefined' || !/^[A-Za-z0-9_-]{20,}$/.test(String(GRADEBOOK_ID))) throw new Error(notReady);
  var sheet;
  try {
    sheet = SpreadsheetApp.openById(GRADEBOOK_ID).getSheetByName(RC_GRADEBOOK_SHEET_);
  } catch (e) {
    throw new Error(notReady);
  }
  if (!sheet) throw new Error('受付ページの準備ができていません（集計表にテスト一覧のシートがありません）。先生に連絡してください');
  var lastRow = sheet.getLastRow();
  var headers = lastRow < 1 ? [] : sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(rcText_);
  var columns = RC_GRADEBOOK_COLUMNS_.map(function (h) {
    var col = headers.indexOf(h) + 1;
    if (col < 1) throw new Error('受付ページの準備ができていません（テスト一覧に「' + h + '」の列がありません）。先生に連絡してください');
    return lastRow < 2 ? [] : sheet.getRange(2, col, lastRow - 1, 1).getValues().map(function (r) { return r[0]; });
  });
  var tests = (columns[0] || []).map(function (_, i) {
    var row = {};
    RC_GRADEBOOK_COLUMNS_.forEach(function (h, c) { row[h] = columns[c][i]; });
    return row;
  });
  cache.put(key, JSON.stringify(tests), RC_TESTS_CACHE_SECONDS_);
  return tests;
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
  if (!control) { rcFormNote_ = 'Control シートがありません'; return ''; }
  var m = String(control.getRange(RC_CONTROL_EDIT_URL_).getValue()).match(/\/forms\/d\/([^/]+)/);
  if (!m) { rcFormNote_ = 'Control の編集URLからフォームを特定できません'; return ''; }
  var formId = m[1];
  var itemOf = {};
  rcReadTable_('FormMapping').forEach(function (r) {
    if (r.form_id === formId) itemOf[r.question_id] = Number(r.form_item_id);
  });
  if (!itemOf.__NAME__) { rcFormNote_ = 'FormMapping に氏名欄の項目番号がありません'; return ''; }
  var placeholder = 'RCNAMEPLACEHOLDER';
  var cache = CacheService.getScriptCache();
  var key = ['prefill', formId, itemOf.__NAME__, itemOf.__CLASS__ || 0,
    Utilities.base64EncodeWebSafe(Utilities.newBlob(cls).getBytes())].join(':');
  var template = cache.get(key);
  if (!template) {
    try {
      template = rcBuildTemplate_(formId, itemOf, cls, placeholder);
    } catch (e) {
      // 名簿にあってフォームに無いクラスなど。番号と資料は渡し、入口だけ出さない。理由は画面に出す
      rcFormNote_ = String(e && e.message || e);
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
