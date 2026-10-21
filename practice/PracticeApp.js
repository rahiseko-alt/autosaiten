/**
 * 練習の受付ページ（ウェブアプリ）。学生はクラスと名前を選び、練習の資料と、氏名・クラスを入れた練習フォームへの入口を受け取る。
 *
 * 本番の受付（reception/）や採点の仕組み（src/）とは別の Apps Script プロジェクト。誰でも開けるウェブアプリでは
 * 末尾が _ でない関数はすべて画面から呼べるため、本番の関数はここに置かない（ADR 0009）。
 * スプレッドシートは名簿を読むだけ（コードは読み取りの呼び出ししか使わない。SpreadsheetApp.openById は読み取り専用の権限では動かないため、権限の範囲は本番の受付と同じ）。割り当て・結果・キューには何も書かない。
 * 練習フォームは setupPracticeForm を教師が1回実行して作る。作ったフォームの番号はスクリプトプロパティに保存する。
 */

var PR_CACHE_SECONDS_ = 21600;
var PR_PROP_FORM_ = 'practiceFormId';
var PR_PROP_NAME_ITEM_ = 'practiceNameItemId';
var PR_PROP_CLASS_ITEM_ = 'practiceClassItemId';

function doGet() {
  return HtmlService.createHtmlOutputFromFile('PracticePage')
    .setTitle('練習の受付')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

/** 画面が最初に呼ぶ。クラスごとの名簿を返す。 */
function getPracticeRoster() {
  return rosterByClass(prReadRoster_());
}

/** 練習の資料と、氏名・クラスを入れた練習フォームのURLを返す。資料番号は無い。 */
function claimPractice(cls, name) {
  var group = getPracticeRoster().filter(function (g) { return g.name === cls; })[0];
  if (!group || group.students.indexOf(name) < 0) throw new Error('名簿にない名前です。選び直してください');
  return { text: practiceMaterial(), formUrl: prPrefilledFormUrl_(cls, name) };
}

/**
 * 練習フォームを作る。教師がエディタから1回実行する。
 * 外から呼ばれても困らないよう、保存済みのフォームがあれば作らず、回答用のURLだけを返す（編集用のURLは返さない）。
 */
function setupPracticeForm() {
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var props = PropertiesService.getScriptProperties();
    var plan = planFormSetup({ formId: props.getProperty(PR_PROP_FORM_) });
    if (plan.action === 'reuse') {
      try {
        return FormApp.openById(plan.formId).getPublishedUrl();
      } catch (e) {
        throw new Error('保存した練習フォームが見つかりません（削除された可能性があります）。スクリプトプロパティの practiceFormId・practiceNameItemId・practiceClassItemId を消してから、もう一度実行してください');
      }
    }

    var spec = practiceFormSpec(getPracticeRoster().map(function (g) { return g.name; }));
    var built;
    try {
      built = prBuildForm_(spec);
    } catch (e) {
      throw new Error('練習フォームの作成に失敗しました。Googleドライブに「' + spec.title + '」ができていたら消してから、もう一度実行してください（' + e.message + '）');
    }
    props.setProperties(built.saved);
    return built.form.getPublishedUrl();
  } finally {
    lock.releaseLock();
  }
}

/** フォームを作って項目を足す。作ったフォームと、保存する値（フォームIDと氏名欄・クラス欄の項目番号）を返す。 */
function prBuildForm_(spec) {
  var form = FormApp.create(spec.title);
  form.setDescription(spec.description);
  form.setIsQuiz(spec.isQuiz);
  form.setCollectEmail(spec.collectEmail);
  form.setAllowResponseEdits(spec.allowResponseEdits);
  form.setLimitOneResponsePerUser(spec.limitOneResponse);
  form.setAcceptingResponses(true);

  var nameItem = form.addTextItem().setTitle(spec.nameItem.title).setRequired(spec.nameItem.required);
  var classItem = form.addMultipleChoiceItem().setTitle(spec.classItem.title).setRequired(spec.classItem.required);
  classItem.setChoices(spec.classItem.choices.map(function (c) { return classItem.createChoice(c); }));
  spec.items.forEach(function (it) {
    var item;
    if (it.kind === 'INFO') item = form.addSectionHeaderItem();
    else if (it.kind === 'PARAGRAPH') item = form.addParagraphTextItem().setRequired(it.required);
    else item = form.addTextItem().setRequired(it.required);
    item.setTitle(it.title);
    if (it.help_text) item.setHelpText(it.help_text);
  });

  var saved = {};
  saved[PR_PROP_FORM_] = form.getId();
  saved[PR_PROP_NAME_ITEM_] = String(nameItem.getId());
  saved[PR_PROP_CLASS_ITEM_] = String(classItem.getId());
  return { form: form, saved: saved };
}

var prOpened_ = null;

function prSpreadsheet_() {
  if (prOpened_) return prOpened_;
  var notReady = '練習の受付ページの準備ができていません（スプレッドシートを開けません）。先生に連絡してください';
  if (typeof SPREADSHEET_ID === 'undefined' || !/^[A-Za-z0-9_-]{20,}$/.test(String(SPREADSHEET_ID))) throw new Error(notReady);
  try {
    prOpened_ = SpreadsheetApp.openById(SPREADSHEET_ID);
  } catch (e) {
    throw new Error(notReady + ' [' + e.message + ']');
  }
  return prOpened_;
}

function prReadRoster_() {
  var sheet = prSpreadsheet_().getSheetByName('名簿');
  if (!sheet || sheet.getLastRow() < 2) return [];
  var values = sheet.getRange(1, 1, sheet.getLastRow(), sheet.getLastColumn()).getValues();
  var headers = values[0];
  return values.slice(1).map(function (row) {
    var obj = {};
    headers.forEach(function (h, i) { obj[h] = row[i]; });
    return obj;
  });
}

/**
 * 氏名・クラスを入れた練習フォームのURL。フォームを開くのは重いので、クラスごとに「氏名だけ差し替えればよいURL」を覚えておく。
 * 覚える鍵にフォームIDと項目の番号を含める（フォームを作り直したときに古い入口が残らないように）。
 * フォームが未作成なら空。保存したフォームが消えていれば、教師に分かるエラーにする。
 */
function prPrefilledFormUrl_(cls, name) {
  var props = PropertiesService.getScriptProperties();
  var formId = props.getProperty(PR_PROP_FORM_);
  var nameItemId = props.getProperty(PR_PROP_NAME_ITEM_);
  var classItemId = props.getProperty(PR_PROP_CLASS_ITEM_);
  if (!formId || !nameItemId || !classItemId) return '';
  var placeholder = 'PRNAMEPLACEHOLDER';
  var cache = CacheService.getScriptCache();
  var key = ['prefill', formId, nameItemId, classItemId,
    Utilities.base64EncodeWebSafe(Utilities.newBlob(cls).getBytes())].join(':');
  var template = cache.get(key);
  if (!template) {
    var form;
    try {
      form = FormApp.openById(formId);
    } catch (e) {
      throw new Error('練習フォームが見つかりません（削除された可能性があります）。先生に連絡してください');
    }
    try {
      template = form.createResponse()
        .withItemResponse(form.getItemById(Number(nameItemId)).asTextItem().createResponse(placeholder))
        .withItemResponse(form.getItemById(Number(classItemId)).asMultipleChoiceItem().createResponse(cls))
        .toPrefilledUrl();
    } catch (e) {
      // 名簿にあってフォームの選択肢に無いクラスなど。資料は渡し、入口だけ出さない
      return '';
    }
    cache.put(key, template, PR_CACHE_SECONDS_);
  }
  return template.split(placeholder).join(encodeURIComponent(name));
}
