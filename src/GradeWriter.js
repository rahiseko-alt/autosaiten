/**
 * 採点結果の書き込み。Results シートへの保存と、フォームへの書き戻し。
 */

var RESULTS_TEXT_COLUMNS = ['respondent_email', 'question_text_snapshot', 'answer', 'grading_reason'];

/** 既存の Results 行を、行番号つきで返す。 */
function readResultsWithRows_() {
  var sheet = SpreadsheetApp.getActive().getSheetByName(SHEET_NAMES.RESULTS);
  if (sheet.getLastRow() < 2) return [];
  var headers = SHEET_HEADERS.Results;
  var values = sheet.getRange(2, 1, sheet.getLastRow() - 1, headers.length).getValues();
  return values.map(function (row, i) {
    var obj = { __row: i + 2 };
    headers.forEach(function (h, c) { obj[h] = row[c]; });
    return obj;
  });
}

/**
 * 採点結果の行を保存する。同じ response_id + question_id は更新し、無ければ追加する。
 * 回答は常に文字列として書く（数式として評価させない）。
 */
function saveResultRows(freshRows) {
  var sheet = SpreadsheetApp.getActive().getSheetByName(SHEET_NAMES.RESULTS);
  var headers = SHEET_HEADERS.Results;
  if (freshRows.length === 0) return [];
  var existing = readResultsWithRows_().filter(function (r) { return r.response_id === freshRows[0].response_id; });
  var merged = mergeResults(existing, freshRows);
  var rowOf = {};
  existing.forEach(function (r) { rowOf[r.question_id] = r.__row; });

  var append = [];
  merged.forEach(function (m) {
    var values = headers.map(function (h) { return m.row[h]; });
    if (m.existed) {
      writeResultValues_(sheet, rowOf[m.row.question_id], [values]);
    } else {
      append.push(values);
    }
  });
  if (append.length > 0) writeResultValues_(sheet, sheet.getLastRow() + 1, append);
  return merged.map(function (m) { return m.row; });
}

function writeResultValues_(sheet, startRow, valueRows) {
  var headers = SHEET_HEADERS.Results;
  RESULTS_TEXT_COLUMNS.forEach(function (name) {
    sheet.getRange(startRow, headers.indexOf(name) + 1, valueRows.length, 1).setNumberFormat('@');
  });
  sheet.getRange(startRow, 1, valueRows.length, headers.length).setValues(valueRows);
}

/**
 * 確定した回答の点数をフォームへ書き戻す。確定していない回答では呼ばない（ADR 0003）。
 * フォームの送信イベントは使っていないので、書き戻しで新しい job は作られない（ADR 0005）。
 */
function writeBackScores(formId, responseId, rows) {
  var form = FormApp.openById(formId);
  var formResponse = form.getResponse(responseId);
  var itemOfQuestion = {};
  readTable(SHEET_NAMES.FORM_MAPPING).forEach(function (m) {
    if (m.form_id === formId) itemOfQuestion[m.question_id] = Number(m.form_item_id);
  });

  var graded = 0;
  scoresToWriteBack(rows).forEach(function (s) {
    var itemId = itemOfQuestion[s.question_id];
    if (itemId === undefined) return;
    var itemResponse = formResponse.getGradableResponseForItem(form.getItemById(itemId));
    if (!itemResponse) return; // 未回答の項目には点を付けられない
    itemResponse.setScore(s.score);
    formResponse.withItemGrade(itemResponse);
    graded += 1;
  });
  if (graded > 0) form.submitGrades([formResponse]);
  writeLog('INFO', 'GRADE_SUBMITTED', responseId, 'フォームへ点数を反映しました', { items: graded });
}

/**
 * 教師が入れた manual_score を反映する。確定した回答はフォームへ書き戻し、Queue を COMPLETED にする。
 * 回答ごとに処理し、1件の失敗や入力ミスで残りを止めない。
 */
function finalizeManualGrades() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) {
    SpreadsheetApp.getActive().toast('別の処理が実行中です。しばらくしてからもう一度お試しください', 'AI Grader', 6);
    return;
  }
  var done = 0;
  var problems = [];
  try {
    var sheet = SpreadsheetApp.getActive().getSheetByName(SHEET_NAMES.RESULTS);
    var headers = SHEET_HEADERS.Results;
    var existing = readResultsWithRows_();
    var recomputed = recomputeResponses(existing);
    var rowIndexOf = {};
    existing.forEach(function (r) { rowIndexOf[r.response_id + '\u0000' + r.question_id] = r.__row; });
    var queue = readQueueRows_();

    Object.keys(recomputed).forEach(function (responseId) {
      var item = recomputed[responseId];
      try {
        item.errors.forEach(function (e) { problems.push(responseId + ': ' + e); });
        var before = existing.filter(function (r) { return r.response_id === responseId; });
        var changed = item.rows.some(function (r, i) {
          return String(r.final_score) !== String(before[i].final_score) || r.status !== before[i].status;
        });
        var job = queue.filter(function (q) { return q.job.response_id === responseId; })[0];
        var needsWriteBack = item.finalized && job && job.job.status !== 'COMPLETED';
        if (!changed && !needsWriteBack) return;

        item.rows.forEach(function (r) {
          var rowIndex = rowIndexOf[r.response_id + '\u0000' + r.question_id];
          sheet.getRange(rowIndex, headers.indexOf('final_score') + 1).setValue(r.final_score);
          sheet.getRange(rowIndex, headers.indexOf('status') + 1).setValue(r.status);
        });
        if (item.finalized && job) {
          writeBackScores(job.job.form_id, responseId, item.rows);
          updateJob_(job.rowIndex, { status: 'COMPLETED' });
          done += 1;
        }
      } catch (err) {
        problems.push(responseId + ': ' + String(err && err.message));
        writeLog('ERROR', 'FINALIZE_FAILED', responseId, String(err && err.message));
      }
    });
  } finally {
    lock.releaseLock();
  }
  if (problems.length > 0) {
    setControl('MESSAGE', 'Manual採点の反映で次の問題がありました:\n' + problems.join('\n'));
    writeLog('WARN', 'FINALIZE_PROBLEMS', '', problems.length + '件の問題がありました');
  }
  SpreadsheetApp.getActive().toast(done + '件の回答を確定し、フォームへ反映しました' + (problems.length ? '（問題あり。Control を確認してください）' : ''), 'AI Grader', 8);
}
