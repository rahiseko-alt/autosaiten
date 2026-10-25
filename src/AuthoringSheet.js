/**
 * 試験作成シート（先生が触る唯一のシート）と、結果シートの用意と同期（ADR 0007）。
 * 変換の判断は Authoring.js にある。
 */

function setupAuthoringSheet_(ss) {
  var sheet = ss.getSheetByName(SHEET_NAMES.AUTHORING);
  var isNew = !sheet;
  if (isNew) sheet = ss.insertSheet(SHEET_NAMES.AUTHORING, 0);

  if (isNew) {
    sheet.getRange(1, 1, AUTHORING_LABELS.length, 2).setValues(AUTHORING_LABELS);
    var settings = readSettings();
    sheet.getRange(AUTHORING_CELLS.FORM_TITLE).setValue(settings.FORM_TITLE || '');
    sheet.getRange(AUTHORING_CELLS.FORM_DESCRIPTION).setValue(settings.FORM_DESCRIPTION || '');
    var imported = fromQuestionRows(readTable(SHEET_NAMES.QUESTIONS), readTable(SHEET_NAMES.RUBRICS));
    if (imported.length > 0) writeAuthoringRows_(sheet, imported);
    sheet.getRange(AUTHORING_LATE.CAP_ROW, AUTHORING_LATE.VALUE_COL).setValue(settings[LATE_CAP_KEY] === undefined ? '' : settings[LATE_CAP_KEY]);
  }
  setupLateTable_(sheet);
  sheet.getRange('A1').setFontWeight('bold').setFontSize(14);
  sheet.getRange(AUTHORING_CELLS.OK).setDataValidation(SpreadsheetApp.newDataValidation().requireCheckbox().build());
  sheet.getRange('B3:B6').setBackground('#eeeeee');
  sheet.getRange('B7:B8').setBackground('#fff2cc');

  var h = AUTHORING_HEADER_ROW;
  sheet.getRange(h, 1, 1, AUTHORING_HEADERS.length).setValues([AUTHORING_HEADERS])
    .setFontWeight('bold').setBackground('#d9eaff');
  ['A', 'B', 'C', 'D'].forEach(function (c) { sheet.getRange(c + h).setBackground('#ffff00'); });
  var notes = {
    C: '短答・数値・記述・選択・複数選択・プルダウン・説明 から選ぶ（説明は答えのない欄）',
    E: '記述は模範解答（空欄可）。複数選択は || 区切り',
    F: '短答で、ほかに正解とする答え（|| 区切り）。数値は許容差',
    G: '選択・複数選択・プルダウンのとき必須（|| 区切り）',
    H: '記述のとき、何が書けていれば何点かを書く',
    J: '自動で付きます。書き換えないでください'
  };
  Object.keys(notes).forEach(function (c) { sheet.getRange(c + h).setNote(notes[c]); });
  sheet.getRange('J' + h + ':J1000').setBackground('#eeeeee');
  // 「001」のような番号が数値に変わらないよう、文字列の書式にする
  sheet.getRange('J' + (h + 1) + ':J1000').setNumberFormat('@');
  sheet.setFrozenRows(h);

  var first = h + 1;
  var rule = function (a1, builder) { sheet.getRange(a1).setDataValidation(builder.build()); };
  rule('A' + first + ':A1000', SpreadsheetApp.newDataValidation().requireCheckbox());
  rule('I' + first + ':I1000', SpreadsheetApp.newDataValidation().requireCheckbox());
  rule('C' + first + ':C1000', SpreadsheetApp.newDataValidation()
    .requireValueInList(['短答', '数値', '記述', '選択', '複数選択', 'プルダウン', '説明'], true));
  // 長い文は折り返さずに切る。行の高さは一定にする（クリックすれば全文が見える）
  sheet.getRange('A1:J1000').setWrapStrategy(SpreadsheetApp.WrapStrategy.CLIP).setVerticalAlignment('middle');
  sheet.setRowHeightsForced(2, 999, 21);
  [[1, 50], [2, 360], [3, 90], [4, 50], [5, 160], [6, 140], [7, 160], [8, 240], [9, 50], [10, 70]]
    .forEach(function (w) { sheet.setColumnWidth(w[0], w[1]); });

  setupAuthoringHighlights_(sheet, first);
  return sheet;
}

/** 書き始めた行で、まだ埋めていない必須の欄を黄色にする。 */
function setupAuthoringHighlights_(sheet, first) {
  var inUse = 'COUNTA($B' + first + ':$H' + first + ')>0';
  var choice = 'OR($C' + first + '="選択",$C' + first + '="複数選択",$C' + first + '="プルダウン")';
  var rule = function (a1s, formula) {
    return SpreadsheetApp.newConditionalFormatRule().whenFormulaSatisfied(formula).setBackground('#ffff00')
      .setRanges(a1s.map(function (a1) { return sheet.getRange(a1); })).build();
  };
  sheet.setConditionalFormatRules([
    rule(['A' + first + ':A1000'], '=AND(' + inUse + ',$A' + first + '<>TRUE)'),
    rule(['B' + first + ':D1000'], '=AND(' + inUse + ',LEN(B' + first + ')=0)'),
    rule(['E' + first + ':E1000'], '=AND(' + inUse + ',$C' + first + '<>"記述",LEN(E' + first + ')=0)'),
    rule(['G' + first + ':G1000'], '=AND(' + choice + ',LEN(G' + first + ')=0)'),
    rule(['H' + first + ':H1000'], '=AND($C' + first + '="記述",LEN(H' + first + ')=0)')
  ]);
}

/** 授業外の上限点と、クラスごとの授業の終わる日時の表（E・F 列）。見出しを書き、クラスを名簿から並べる。 */
function setupLateTable_(sheet) {
  var L = AUTHORING_LATE;
  sheet.getRange(L.CAP_ROW, L.LABEL_COL).setValue('授業外の上限点')
    .setNote('授業の終わる日時より後に送信された回答の、合計点の上限。空欄なら抑えません');
  sheet.getRange(L.CLASS_HEADER_ROW, L.LABEL_COL, 1, 2).setValues([['クラス', '授業の終わる日時']]).setFontWeight('bold');
  sheet.getRange(L.CAP_ROW, L.VALUE_COL).setBackground('#fff2cc');
  var rows = L.CLASS_LAST_ROW - L.CLASS_FIRST_ROW + 1;
  sheet.getRange(L.CLASS_FIRST_ROW, L.VALUE_COL, rows, 1).setBackground('#fff2cc').setNumberFormat('yyyy/MM/dd HH:mm');
  sheet.getRange(L.CLASS_FIRST_ROW, L.LABEL_COL, rows, 1).setBackground('#eeeeee');
  arrangeLateClasses_(sheet);
}

/**
 * クラスの列を名簿のクラスに並べ直す。先生が入れた日時はクラスについたまま動かし、
 * 名簿から消えたクラスも日時が入っていれば後ろに残す（消さない）。表に無い日時は Settings から戻す。
 * @return {{cls: string, end: *}[]} 並べ直した表
 */
function arrangeLateClasses_(sheet) {
  var L = AUTHORING_LATE;
  var count = L.CLASS_LAST_ROW - L.CLASS_FIRST_ROW + 1;
  var current = sheet.getRange(L.CLASS_FIRST_ROW, L.LABEL_COL, count, 2).getValues();
  var settings = readSettings();
  var endOf = {};
  var order = rosterClasses_();
  current.forEach(function (r) {
    var cls = String(r[0]).trim();
    if (cls === '') return;
    endOf[cls] = r[1];
    if (order.indexOf(cls) < 0 && String(r[1]).trim() !== '') order.push(cls);
  });
  var table = order.map(function (cls) {
    var end = endOf[cls] !== undefined ? endOf[cls] : settings[CLASS_END_KEY_PREFIX + cls];
    return { cls: cls, end: end === undefined || end === null ? '' : end };
  });
  if (table.length > count) {
    writeLog('WARN', 'LATE_CLASSES_TRUNCATED', '', 'クラスが多すぎるため、授業の終わる日時の表に入りきりません', { classes: order });
    table = table.slice(0, count);
  }
  var values = table.map(function (t) { return [t.cls, t.end]; });
  while (values.length < count) values.push(['', '']);
  sheet.getRange(L.CLASS_FIRST_ROW, L.LABEL_COL, count, 2).setValues(values);
  return table;
}

function readAuthoringRows_(sheet) {
  var first = AUTHORING_HEADER_ROW + 1;
  var last = sheet.getLastRow();
  if (last < first) return [];
  return sheet.getRange(first, 1, last - first + 1, AUTHORING_HEADERS.length).getValues().map(function (values) {
    var obj = {};
    AUTHORING_HEADERS.forEach(function (h, i) { obj[h] = values[i]; });
    return obj;
  });
}

function writeAuthoringRows_(sheet, rows) {
  var values = rows.map(function (r) { return AUTHORING_HEADERS.map(function (h) { return r[h]; }); });
  sheet.getRange(AUTHORING_HEADER_ROW + 1, 1, values.length, AUTHORING_HEADERS.length).setValues(values);
}

/**
 * 試験作成シートを読み、問題番号を付けて、裏方の Questions に写す行を用意する（まだ写さない）。
 * 問題番号だけは試験作成シートの右端に書き戻す。
 * @return {{questions: Object[], errors: string[], title: string, description: string}|null}
 *   試験作成シートが無ければ null
 */
function prepareAuthoring_() {
  var ss = SpreadsheetApp.getActive();
  var sheet = ss.getSheetByName(SHEET_NAMES.AUTHORING);
  if (!sheet) return null;
  var rows = readAuthoringRows_(sheet);
  var existing = readTable(SHEET_NAMES.QUESTIONS);

  var known = existing.map(function (q) { return q.question_id; })
    .concat(readTable(SHEET_NAMES.FORM_MAPPING).map(function (m) { return m.question_id; }));
  var ids = assignQuestionIds(rows, known);
  var idColumn = [];
  var changed = false;
  rows.forEach(function (r, i) {
    if (String(r.問題番号) !== ids[i]) changed = true;
    r.問題番号 = ids[i];
    idColumn.push([ids[i]]);
  });
  if (changed) sheet.getRange(AUTHORING_HEADER_ROW + 1, AUTHORING_HEADERS.length, idColumn.length, 1).setValues(idColumn);

  var converted = toQuestionRows(rows, AUTHORING_HEADER_ROW + 1);
  var errors = converted.errors.slice();
  if (converted.rows.length === 0) {
    errors.push('・試験作成シートの表に問題がありません。11行目から問題を書いてください。');
  }
  var late = readAuthoringLate_(sheet);
  return {
    questions: mergeWithExisting(converted.rows, existing),
    late: late.late,
    errors: errors.concat(late.errors),
    title: sheet.getRange(AUTHORING_CELLS.FORM_TITLE).getValue(),
    description: sheet.getRange(AUTHORING_CELLS.FORM_DESCRIPTION).getValue()
  };
}

/**
 * 試験作成シートの授業外の上限点と、クラスごとの授業の終わる日時を読む。
 * @return {{late: {cap: *, classes: {cls: string, end: *}[]}, errors: string[]}}
 */
function readAuthoringLate_(sheet) {
  var cap = sheet.getRange(AUTHORING_LATE.CAP_ROW, AUTHORING_LATE.VALUE_COL).getValue();
  var errors = [];
  if (String(cap).trim() !== '' && !(isFinite(Number(cap)) && Number(cap) >= 0)) {
    errors.push('・授業外の上限点は0以上の数で入れてください（抑えないなら空欄）。');
  }
  return { late: { cap: cap, classes: arrangeLateClasses_(sheet) }, errors: errors };
}

/** 授業外の上限を Settings に写す。フォームに出ないので、定義の指紋には入らず、フォームの作り直しも起きない。 */
function writeLateSettings_(late) {
  setSetting(LATE_CAP_KEY, late.cap);
  late.classes.forEach(function (t) { setSetting(CLASS_END_KEY_PREFIX + t.cls, t.end); });
}

/**
 * 試験作成シートの授業外の上限を、そのまま Settings に写す（「手動採点を反映」の最初に使う）。
 * 「これでOK」を押さずに上限点や終わる日時を直しても、新しい値で決め直せるようにする。
 * 呼び出し側が ScriptLock を持っていること。試験作成シートが無ければ何もしない。
 * @return {string[]} 不備の理由。あれば Settings は書き換えない
 */
function syncLateSettingsFromAuthoring_() {
  var sheet = SpreadsheetApp.getActive().getSheetByName(SHEET_NAMES.AUTHORING);
  if (!sheet) return [];
  var read = readAuthoringLate_(sheet);
  if (read.errors.length === 0) writeLateSettings_(read.late);
  return read.errors;
}

/**
 * 用意した行を Questions に、タイトル・説明・授業外の上限を Settings に写す。
 * 採点処理が Questions を読む最中に書き換えないよう、同じ鍵（ScriptLock）を取る。
 * 消してから書くのではなく、1回の書き込みで置き換える。
 */
function commitAuthoring_(prepared) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) throw new Error('採点処理が実行中です。少し待ってから、もう一度「これでOK」を押してください');
  try {
    var q = SpreadsheetApp.getActive().getSheetByName(SHEET_NAMES.QUESTIONS);
    var headers = SHEET_HEADERS.Questions;
    var values = prepared.questions.map(function (r) {
      return headers.map(function (h) { return r[h] === undefined || r[h] === null ? '' : r[h]; });
    });
    var oldRows = Math.max(0, q.getLastRow() - 1);
    while (values.length < oldRows) values.push(headers.map(function () { return ''; }));
    if (values.length > 0) q.getRange(2, 1, values.length, headers.length).setValues(values);
    if (String(prepared.title).trim() !== '') setSetting('FORM_TITLE', prepared.title);
    setSetting('FORM_DESCRIPTION', prepared.description);
    writeLateSettings_(prepared.late);
  } finally {
    lock.releaseLock();
  }
}

/** 先生が見る結果シート。裏方の Results から必要な列だけを数式で引く。 */
function setupResultsView_(ss) {
  var sheet = ss.getSheetByName(SHEET_NAMES.RESULTS_VIEW) || ss.insertSheet(SHEET_NAMES.RESULTS_VIEW, 1);
  sheet.getRange(1, 1, 1, 9).setValues([['送信日時', '回答者', '問題番号', '問題文', '回答', '点数', '満点', '状態', '採点の理由']])
    .setFontWeight('bold').setBackground('#d9eaff');
  var status = '{"AUTO_GRADED","自動採点済み";"LLM_GRADED","AI採点済み";"REVIEW_REQUIRED","要確認";' +
    '"MANUAL_PENDING","採点待ち（記述）";"MANUAL_GRADED","手動採点済み";"UNANSWERED","未回答";"NO_POINTS","加点なし"}';
  sheet.getRange('A2').setFormula('=IFNA(FILTER({Results!C2:C,ARRAYFORMULA(IF(Results!W2:W<>"",Results!W2:W,Results!D2:D)),Results!E2:E,Results!F2:F,Results!G2:G,' +
    'Results!L2:L,Results!M2:M,ARRAYFORMULA(IFNA(VLOOKUP(Results!N2:N,' + status + ',2,FALSE),Results!N2:N)),Results!P2:P},' +
    'Results!A2:A<>""),"")');
  sheet.getRange('A1:I1000').setWrapStrategy(SpreadsheetApp.WrapStrategy.CLIP).setVerticalAlignment('middle');
  sheet.setRowHeightsForced(1, 1000, 21);
  sheet.setFrozenRows(1);
  [[1, 140], [2, 160], [3, 70], [4, 240], [5, 320], [6, 50], [7, 50], [8, 120], [9, 360]]
    .forEach(function (w) { sheet.setColumnWidth(w[0], w[1]); });
  return sheet;
}

function hideBackendSheets_(ss) {
  // 見えているシートが無くなると隠せないので、先生のシートは必ず表示する
  [SHEET_NAMES.AUTHORING, SHEET_NAMES.RESULTS_VIEW].forEach(function (name) {
    var sheet = ss.getSheetByName(name);
    if (sheet && sheet.isSheetHidden()) sheet.showSheet();
  });
  BACKEND_SHEETS.forEach(function (name) {
    var sheet = ss.getSheetByName(name);
    if (sheet && !sheet.isSheetHidden()) sheet.hideSheet();
  });
}
