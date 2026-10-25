/**
 * 集計表（スプレッドシートに結び付いた Apps Script）。判断は Gradebook.js に任せ、ここはシートの読み書きだけをする。
 *
 * 採点の仕組み（src/）・受付ページ（reception/）とは別のプロジェクト。採点の仕組みの関数は呼ばず、
 * 各テストのスプレッドシートは ID で開いて Queue と Results を読むだけにする（ADR 0010）。
 */

var GB_SHEET_ORDER_ = ['名簿', 'テスト一覧', '成績', '要確認', '取り込み記録', '集計表の設定'];
var GB_HIDDEN_ = ['取り込み記録', '集計表の設定'];
var GB_CHECKBOX_ROWS_ = 500;

function onOpen() {
  SpreadsheetApp.getUi().createMenu('集計表')
    .addItem('初期セットアップ', 'setupGradebook')
    .addItem('取り込む', 'importTests')
    .addToUi();
}

/** シートを作り、見出しと学生番号を整える。既存の入力は消さない（何度押しても同じ）。 */
function setupGradebook() {
  gbWithLock_(function () {
    gbEnsureSheets_();
    gbAssignStudentIds_();
  });
  SpreadsheetApp.getUi().alert('初期セットアップが終わりました。名簿とテスト一覧を埋めてから「取り込む」を押してください');
}

/**
 * テスト一覧の各テストから、確定した回答の点数を吸い上げる。
 * 要確認シートの先生の判断を取り込み記録へ写してから計画を立て、取り込み記録・要確認・成績を書き直す。
 */
function importTests() {
  var failures = [];
  var count = 0;
  gbWithLock_(function () {
    gbEnsureSheets_();
    var roster = gbAssignStudentIds_();
    var records = applyReviewDecisions(gbReadTable_('取り込み記録').rows, gbReadTable_('要確認').rows);
    var testTable = gbReadTable_('テスト一覧');
    var tests = testTable.rows;
    tests.forEach(function (t, i) {
      var id = gbText_(t.スプレッドシートのID) || spreadsheetIdFromUrl(t.スプレッドシートのURL);
      if (id === '') {
        if (gbText_(t.テスト名) !== '' || gbText_(t.スプレッドシートのURL) !== '') {
          failures.push((gbText_(t.テスト名) || (i + 2) + '行目') + ': スプレッドシートのURLから ID を読めません');
        }
        return;
      }
      if (gbText_(t.スプレッドシートのID) === '') gbSetCell_(testTable, i, 'スプレッドシートのID', id);
      t.スプレッドシートのID = id;
      var source;
      try {
        source = SpreadsheetApp.openById(id);
      } catch (e) {
        failures.push((gbText_(t.テスト名) || id) + ': スプレッドシートを開けません');
        return;
      }
      records = planImport({
        testId: id, queue: gbReadTable_('Queue', source).rows, results: gbReadTable_('Results', source).rows,
        roster: roster, records: records, now: new Date()
      });
      gbSetCell_(testTable, i, '最後の取り込み日時', new Date());
      count += 1;
    });
    gbWriteRows_('取り込み記録', records);
    gbWriteRows_('要確認', reviewRows(records, tests));
    gbCheckboxes_('要確認', 'この回答を使う');
    gbWriteGrades_(buildGradeTable(records, roster, tests));
  });
  var message = count + '件のテストを取り込みました。';
  if (failures.length > 0) message += '\n取り込めなかったテスト:\n' + failures.join('\n');
  SpreadsheetApp.getUi().alert(message);
}

function gbWithLock_(fn) {
  var lock = LockService.getDocumentLock();
  lock.waitLock(30000);
  try {
    fn();
  } finally {
    lock.releaseLock();
  }
}

function gbSpreadsheet_() {
  return SpreadsheetApp.getActiveSpreadsheet();
}

/** 足りないシート・見出し・設定の行だけを足す。列の並びが違うシートは書き換えない。 */
function gbEnsureSheets_() {
  var ss = gbSpreadsheet_();
  GB_SHEET_ORDER_.forEach(function (name) {
    var sheet = ss.getSheetByName(name) || ss.insertSheet(name);
    if (GB_HIDDEN_.indexOf(name) >= 0) sheet.hideSheet();
    if (sheet.getRange(1, 1).getValue() !== '') return;
    // 成績は表示専用で見出しは取り込みのたびに作るので、先頭の注意書きだけを置く
    var first = name === '成績' ? [GB_GRADES_NOTICE] : GB_SHEETS[name];
    sheet.getRange(1, 1, 1, first.length).setValues([first]).setFontWeight('bold');
    sheet.setFrozenRows(1);
  });
  gbCheckboxes_('テスト一覧', '受付ページを使う');
  gbCheckboxes_('テスト一覧', '実施中');

  var settings = ss.getSheetByName('集計表の設定');
  var have = gbReadTable_('集計表の設定').rows.map(function (r) { return gbText_(r.項目); });
  GB_SETTINGS.forEach(function (row) {
    if (have.indexOf(row[0]) < 0) settings.appendRow(row);
  });
}

/** 名簿の空の学生番号を振って書き戻し、名簿の行を返す。 */
function gbAssignStudentIds_() {
  var table = gbReadTable_('名簿');
  var known = [];
  gbReadTable_('取り込み記録').rows.forEach(function (r) { known.push(r.学生番号, r.この学生にする); });
  var ids = assignStudentIds(table.rows, known);
  table.rows.forEach(function (r, i) {
    if (ids[i] !== '' && gbText_(r.学生番号) !== ids[i]) gbSetCell_(table, i, '学生番号', ids[i]);
    r.学生番号 = ids[i];
  });
  return table.rows;
}

/** 見出しの行を読み、行をオブジェクトにする。行の位置（何行目か）も覚えておく。空の行は飛ばす。 */
function gbReadTable_(name, ss) {
  var sheet = (ss || gbSpreadsheet_()).getSheetByName(name);
  if (!sheet || sheet.getLastRow() < 1) return { sheet: sheet, headers: [], rows: [], rowNumbers: [] };
  var values = sheet.getRange(1, 1, sheet.getLastRow(), sheet.getLastColumn()).getValues();
  var headers = values[0].map(function (h) { return gbText_(h); });
  var rows = [];
  var rowNumbers = [];
  values.slice(1).forEach(function (row, i) {
    if (!row.some(function (v) { return v !== '' && v !== null; })) return;
    var obj = {};
    headers.forEach(function (h, c) { if (h !== '') obj[h] = row[c]; });
    rows.push(obj);
    rowNumbers.push(i + 2);
  });
  return { sheet: sheet, headers: headers, rows: rows, rowNumbers: rowNumbers };
}

function gbSetCell_(table, index, header, value) {
  var col = table.headers.indexOf(header);
  if (col < 0) throw new Error(table.sheet.getName() + ' シートに「' + header + '」の列がありません');
  table.sheet.getRange(table.rowNumbers[index], col + 1).setValue(value);
}

/** 見出しの下をすべて書き直す。見出しの並びはシートのものに従う。 */
function gbWriteRows_(name, rows) {
  var sheet = gbSpreadsheet_().getSheetByName(name);
  var headers = gbReadTable_(name).headers;
  if (sheet.getLastRow() > 1) sheet.getRange(2, 1, sheet.getLastRow() - 1, headers.length).clearContent();
  if (rows.length === 0) return;
  var values = rows.map(function (r) {
    return headers.map(function (h) { return r[h] === undefined || r[h] === null ? '' : r[h]; });
  });
  sheet.getRange(2, 1, values.length, headers.length).setValues(values);
}

/** 成績シートは表示専用なので、毎回すべて消して書き直す。 */
function gbWriteGrades_(values) {
  var sheet = gbSpreadsheet_().getSheetByName('成績');
  sheet.clearContents();
  var width = values[0].length;
  sheet.getRange(1, 1, values.length, width).setValues(values);
  sheet.getRange(1, 1).setFontWeight('bold');
  sheet.getRange(2, 1, 1, width).setFontWeight('bold');
  sheet.setFrozenRows(2);
}

/** 列にチェックボックスの入力規則を付ける。値は書き換えない。 */
function gbCheckboxes_(name, header) {
  var table = gbReadTable_(name);
  var col = table.headers.indexOf(header) + 1;
  if (col < 1) return;
  var rule = SpreadsheetApp.newDataValidation().requireCheckbox().build();
  table.sheet.getRange(2, col, GB_CHECKBOX_ROWS_, 1).setDataValidation(rule);
}
