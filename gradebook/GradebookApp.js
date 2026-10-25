/**
 * 集計表（スプレッドシートに結び付いた Apps Script）。判断は Gradebook.js に任せ、ここはシートの読み書きだけをする。
 *
 * 採点の仕組み（src/）・受付ページ（reception/）とは別のプロジェクト。採点の仕組みの関数は呼ばず、
 * 各テストのスプレッドシートは ID で開いて Queue と Results を読むだけにする（ADR 0010）。
 * 新しいテストは、ひな型をドライブでコピーし、名簿シートだけを書き込む。
 * 保管では、テストのフォームの受付を閉じ、テストの Settings に ARCHIVED の行を足し（列は変えない）、ファイルを移す。
 * 集計表の設定は先生がひな型・フォルダの ID を入れるので隠さない。
 */

var GB_SHEET_ORDER_ = ['名簿', 'テスト一覧', '成績', '要確認', '取り込み記録', '集計表の設定'];
var GB_HIDDEN_ = ['取り込み記録'];
var GB_CHECKBOX_ROWS_ = 500;

function onOpen() {
  SpreadsheetApp.getUi().createMenu('集計表')
    .addItem('初期セットアップ', 'setupGradebook')
    .addItem('新しいテストを作る', 'createNewTest')
    .addItem('取り込む', 'importTests')
    .addItem('保管する', 'archiveTest')
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
 * ひな型をコピーして新しいテストを作る。テスト名・科目・実施日を順に聞き、ひな型が空であることを確かめてから、
 * 新しいテストのフォルダへコピーし、名簿を写して、テスト一覧に1行足す。採点の仕組みの初期セットアップは先生が押す。
 */
function createNewTest() {
  var ui = SpreadsheetApp.getUi();
  var test = {};
  var asks = [['テスト名', '例: 第3回 小テスト'], ['科目', '例: リテラシー・マーケティング・AI演習'], ['実施日', '例: 2026/11/6']];
  for (var i = 0; i < asks.length; i++) {
    var answer = ui.prompt('新しいテストを作る（' + (i + 1) + '/' + asks.length + '）', asks[i][0] + 'を入れてください。' + asks[i][1],
      ui.ButtonSet.OK_CANCEL);
    if (answer.getSelectedButton() !== ui.Button.OK) return;
    test[asks[i][0]] = answer.getResponseText().trim();
    if (test[asks[i][0]] === '') {
      ui.alert(asks[i][0] + 'が空です。もう一度「新しいテストを作る」を押してください');
      return;
    }
  }
  test.実施日 = gbDate_(test.実施日);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(test.実施日)) {
    ui.alert('実施日を日付として読めません。2026/11/6 のように入れてください');
    return;
  }

  var message;
  gbWithLock_(function () {
    gbEnsureSheets_();
    var settings = {};
    gbReadTable_('集計表の設定').rows.forEach(function (r) { settings[gbText_(r.項目)] = gbText_(r.値); });
    var templateId = spreadsheetIdFromUrl(settings['ひな型のID']);
    var folderId = folderIdFromUrl(settings['新しいテストのフォルダのID']);
    if (templateId === '' || folderId === '') {
      message = '集計表の設定シートに、ひな型のIDと新しいテストのフォルダのID（URL でもよい）を入れてください';
      return;
    }
    var template = SpreadsheetApp.openById(templateId);
    var problems = templateProblems({
      results: gbReadTable_('Results', template).rows, queue: gbReadTable_('Queue', template).rows,
      formMapping: gbReadTable_('FormMapping', template).rows, settings: gbReadTable_('Settings', template).rows
    });
    if (problems.length > 0) {
      message = 'ひな型が空ではないので、コピーを止めました（前のテストの記録を引き継ぐため）。\n' + problems.join('\n');
      return;
    }

    var file = DriveApp.getFileById(templateId).makeCopy(newTestName(test), DriveApp.getFolderById(folderId));
    var copy = SpreadsheetApp.openById(file.getId());
    gbWriteTestRoster_(copy, rosterForTest(gbAssignStudentIds_()));

    var list = gbReadTable_('テスト一覧');
    var row = { テスト名: test.テスト名, 科目: test.科目, 実施日: test.実施日, スプレッドシートのURL: copy.getUrl(),
      受付ページを使う: false, 実施中: false, スプレッドシートのID: copy.getId() };
    list.sheet.appendRow(list.headers.map(function (h) { return row[h] === undefined ? '' : row[h]; }));
    message = '新しいテスト「' + newTestName(test) + '」を作りました。\n' +
      '新しいスプレッドシートを開き、メニュー AI Grader の初期セットアップを押してください。\n' + copy.getUrl();
  });
  ui.alert(message);
}

/** テストの名簿シートの見出しの下を消して、集計表の名簿で書き直す。見出しが無ければ置く。 */
function gbWriteTestRoster_(ss, rows) {
  var sheet = ss.getSheetByName('名簿') || ss.insertSheet('名簿');
  var width = GB_TEST_ROSTER_HEADERS.length;
  if (sheet.getLastRow() === 0) sheet.getRange(1, 1, 1, width).setValues([GB_TEST_ROSTER_HEADERS]);
  var headers = sheet.getRange(1, 1, 1, width).getValues()[0].map(gbText_);
  if (headers.join('\n') !== GB_TEST_ROSTER_HEADERS.join('\n')) {
    throw new Error('新しいテストの名簿シートの見出しが「' + GB_TEST_ROSTER_HEADERS.join('・') + '」ではありません');
  }
  if (sheet.getLastRow() > 1) sheet.getRange(2, 1, sheet.getLastRow() - 1, sheet.getLastColumn()).clearContent();
  if (rows.length > 0) sheet.getRange(2, 1, rows.length, width).setValues(rows);
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
      // 保管済みのテストは後から変わらないので開き直さず、取り込み記録をそのまま使う（成績の一覧には残る）
      if (gbText_(t.保管の状態) === GB_ARCHIVE.保管済み) return;
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
    gbAddAliases_(records);
    gbWriteRows_('要確認', reviewRows(records, tests, roster));
    gbCheckboxes_('要確認', 'この回答を使う');
    gbStudentDropdown_(roster);
    gbWriteGrades_(buildGradeTable(records, roster, tests));
  });
  var message = count + '件のテストを取り込みました。';
  if (failures.length > 0) message += '\n取り込めなかったテスト:\n' + failures.join('\n');
  SpreadsheetApp.getUi().alert(message);
}

/**
 * テスト一覧で選んだ行のテストを保管する（2段階。何をするかは archiveStep が決める）。
 * 1回目は全版のフォームの受付を閉じて停止待ちにする。2回目は保管できるかを確かめ、よければ Settings に ARCHIVED を書き、
 * テスト側がトリガーを外していれば、スプレッドシートと全版のフォームを保管用のフォルダへ移して保管済みにする。
 * 2回目以降も毎回、その時点の全版のフォームの受付を閉じ直す。取り込みでは保管の段階を進めない。
 */
function archiveTest() {
  var message;
  gbWithLock_(function () {
    gbEnsureSheets_();
    var ss = gbSpreadsheet_();
    var testTable = gbReadTable_('テスト一覧');
    var sheet = ss.getActiveSheet();
    var index = sheet.getName() === 'テスト一覧' ? testTable.rowNumbers.indexOf(sheet.getActiveRange().getRow()) : -1;
    if (index < 0) {
      message = 'テスト一覧シートで、保管するテストの行を選んでから「保管する」を押してください';
      return;
    }
    var t = testTable.rows[index];
    var name = gbText_(t.テスト名) || (testTable.rowNumbers[index] + '行目');
    var id = gbText_(t.スプレッドシートのID) || spreadsheetIdFromUrl(t.スプレッドシートのURL);
    if (id === '') {
      message = name + ': スプレッドシートのURLから ID を読めません';
      return;
    }
    if (gbText_(t.保管の状態) === GB_ARCHIVE.保管済み) {
      message = name + ': ' + archiveStep({ status: t.保管の状態, blockers: [], settings: [] }).message;
      return;
    }
    if (gbText_(t.スプレッドシートのID) === '') gbSetCell_(testTable, index, 'スプレッドシートのID', id);

    var source = SpreadsheetApp.openById(id);
    var formMapping = gbReadTable_('FormMapping', source).rows;
    var formIds = archiveFormIds(formMapping);
    var queue = gbReadTable_('Queue', source).rows;
    var settingsTable = gbReadTable_('Settings', source);
    // どの段でも、その時点の全版のフォームの受付を閉じ直す（停止待ちの間に「これでOK」で新しい版ができても閉じる）
    var status = gbText_(t.保管の状態);
    var closed = status === '' || status === GB_ARCHIVE.停止待ち ? gbCloseForms_(formIds) : { failed: [], responseCount: 0 };
    var step = archiveStep({
      status: t.保管の状態, settings: settingsTable.rows, queue: queue, formMapping: formMapping,
      blockers: status === GB_ARCHIVE.停止待ち ? archiveBlockers({
        testId: id, queue: queue, results: gbReadTable_('Results', source).rows,
        records: gbReadTable_('取り込み記録').rows, formResponseCount: closed.responseCount
      }) : []
    });
    var moveFailed = [];
    var report = function () {
      var r = archiveFormReport({ step: step, closeFailed: closed.failed, moveFailed: moveFailed });
      message = name + ': ' + r.message;
      return r;
    };

    if (step.action === 'close') {
      gbSetCell_(testTable, index, '保管の状態', GB_ARCHIVE.停止待ち);
      report();
      return;
    }
    if (step.action !== 'wait' && step.action !== 'move') {
      report();
      return;
    }
    // 受付を閉じられないフォームが残るうちは、保管の印を書かない（印があると、テスト側が新しい回答を取り込まなくなる）
    if (closed.failed.length > 0) {
      report();
      return;
    }
    var folderId = '';
    if (step.action === 'move') {
      gbReadTable_('集計表の設定').rows.forEach(function (r) {
        if (gbText_(r.項目) === '保管用のフォルダのID') folderId = folderIdFromUrl(r.値);
      });
      if (folderId === '') {
        message = name + ': 集計表の設定シートに、保管用のフォルダのID（URL でもよい）を入れてから、もう一度「保管する」を押してください';
        return;
      }
    }
    gbMarkArchived_(settingsTable);
    if (step.action === 'wait') {
      report();
      return;
    }
    var folder = DriveApp.getFolderById(folderId);
    [id].concat(formIds).forEach(function (fileId) {
      try {
        DriveApp.getFileById(fileId).moveTo(folder);
      } catch (e) {
        moveFailed.push(fileId);
      }
    });
    if (!report().archived) return;
    gbSetCell_(testTable, index, '保管の状態', GB_ARCHIVE.保管済み);
    gbSetCell_(testTable, index, '実施中', false);
  });
  SpreadsheetApp.getUi().alert(message);
}

/**
 * フォームの受付を閉じ（何度やっても同じ）、全版の回答数を数える。開けない・閉じられないフォームは、残りを止めずに ID を覚える。
 * @return {{failed: string[], responseCount: number}}
 */
function gbCloseForms_(formIds) {
  var failed = [];
  var responseCount = 0;
  formIds.forEach(function (formId) {
    try {
      var form = FormApp.openById(formId);
      form.setAcceptingResponses(false);
      responseCount += form.getResponses().length;
    } catch (e) {
      failed.push(formId);
    }
  });
  return { failed: failed, responseCount: responseCount };
}

/** テストの Settings の ARCHIVED を TRUE にする。行が無ければ足す（列は変えない）。 */
function gbMarkArchived_(settingsTable) {
  if (!settingsTable.sheet) throw new Error('テストのスプレッドシートに Settings シートがありません');
  var index = settingsTable.rows.map(function (r) { return gbText_(r.key); }).indexOf('ARCHIVED');
  if (index < 0) {
    var row = { key: 'ARCHIVED', value: true, 説明: '集計表の「保管する」が書いた保管の印' };
    settingsTable.sheet.appendRow(settingsTable.headers.map(function (h) { return row[h] === undefined ? '' : row[h]; }));
  } else if (!gbTrue_(settingsTable.rows[index].value)) {
    gbSetCell_(settingsTable, index, 'value', true);
  }
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
    // 前の版で隠した集計表の設定も、先生が開けるよう出す
    else if (sheet.isSheetHidden()) sheet.showSheet();
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

/** 先生が「この学生にする」で結びつけた回答のアカウント・氏名を、名簿の別のアカウント・別の綴りに足す。 */
function gbAddAliases_(records) {
  var table = gbReadTable_('名簿');
  var additions = {};
  planAliasAdditions(records, table.rows).forEach(function (a) { additions[a.学生番号] = a; });
  table.rows.forEach(function (r, i) {
    var a = additions[gbText_(r.学生番号)];
    if (!a) return;
    if (gbText_(r.別のアカウント) !== a.別のアカウント) gbSetCell_(table, i, '別のアカウント', a.別のアカウント);
    if (gbText_(r.別の綴り) !== a.別の綴り) gbSetCell_(table, i, '別の綴り', a.別の綴り);
  });
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

/** 要確認の「この学生にする」に、名簿の学生番号の一覧のプルダウンを付ける。名簿が空なら規則を外す。 */
function gbStudentDropdown_(roster) {
  var table = gbReadTable_('要確認');
  var col = table.headers.indexOf('この学生にする') + 1;
  if (col < 1) return;
  var ids = roster.map(function (s) { return gbText_(s.学生番号); }).filter(function (id) { return id !== ''; });
  var range = table.sheet.getRange(2, col, GB_CHECKBOX_ROWS_, 1);
  if (ids.length === 0) {
    range.setDataValidation(null);
    return;
  }
  range.setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(ids, true).setAllowInvalid(false).build());
}
