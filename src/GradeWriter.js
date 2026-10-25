/**
 * 採点結果の書き込み。Results シートへの保存と、フォームへの書き戻し。
 */

var RESULTS_TEXT_COLUMNS = ['respondent_email', 'question_text_snapshot', 'answer', 'grading_reason', 'respondent_name'];

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

/** 授業外の上限の決まり（Settings の LATE_CAP・CLASS_END_<クラス> と名簿）。recomputeResponses に渡す。 */
function lateRules_() {
  var settings = readSettings();
  var classEnds = {};
  Object.keys(settings).forEach(function (key) {
    if (key.indexOf(CLASS_END_KEY_PREFIX) === 0) classEnds[key.slice(CLASS_END_KEY_PREFIX.length)] = settings[key];
  });
  return { cap: settings[LATE_CAP_KEY], classEnds: classEnds, roster: readTable(SHEET_NAMES.ROSTER), now: new Date() };
}

/**
 * 1回答の `__LATE__` の行を、決め直した rows に合わせて Results に書く。
 * rows にあれば更新するか足し、無ければ消す（同じ response_id + question_id は1行だけ）。
 */
function saveLateRow_(responseId, rows) {
  var sheet = SpreadsheetApp.getActive().getSheetByName(SHEET_NAMES.RESULTS);
  var headers = SHEET_HEADERS.Results;
  var old = readResultsWithRows_().filter(function (r) {
    return r.response_id === responseId && r.question_id === LATE_QUESTION_ID;
  })[0];
  var fresh = rows.filter(function (r) { return r.question_id === LATE_QUESTION_ID; })[0];
  if (fresh) {
    writeResultValues_(sheet, old ? old.__row : sheet.getLastRow() + 1, [headers.map(function (h) { return fresh[h]; })]);
  } else if (old) {
    sheet.deleteRow(old.__row);
  }
}

function writeResultValues_(sheet, startRow, valueRows) {
  var headers = SHEET_HEADERS.Results;
  RESULTS_TEXT_COLUMNS.forEach(function (name) {
    sheet.getRange(startRow, headers.indexOf(name) + 1, valueRows.length, 1).setNumberFormat('@');
  });
  sheet.getRange(startRow, 1, valueRows.length, headers.length).setValues(valueRows);
}

/**
 * 確定した回答の合計点と講評をフォームへ書き戻す。確定していない回答では呼ばない（ADR 0003）。
 * 問題の項目には書かず、氏名欄にだけ合計点と講評を書く（ADR 0013）。
 * フォームの送信イベントは使っていないので、書き戻しで新しい job は作られない（ADR 0005）。
 */
function writeBackScores(formId, responseId, rows) {
  var form = FormApp.openById(formId);
  var formResponse = form.getResponse(responseId);
  var nameItemId = null;
  readTable(SHEET_NAMES.FORM_MAPPING).forEach(function (m) {
    if (m.form_id === formId && m.question_id === NAME_QUESTION_ID) nameItemId = Number(m.form_item_id);
  });
  var itemResponse = nameItemId === null ? null : formResponse.getGradableResponseForItem(form.getItemById(nameItemId));
  if (!itemResponse) {
    // 氏名欄は必須なので通常は起きない。点を書き込む先が無いので、記録だけ残す
    writeLog('WARN', 'GRADE_NOT_SUBMITTED', responseId, '氏名欄が見つからないため、フォームへ点数を反映できませんでした');
    return;
  }
  var total = totalScore(rows);
  itemResponse.setScore(total);
  itemResponse.setFeedback(FormApp.createFeedback().setText(buildCommentary(rows)).build());
  formResponse.withItemGrade(itemResponse);
  form.submitGrades([formResponse]);
  writeLog('INFO', 'GRADE_SUBMITTED', responseId, 'フォームへ合計点と講評を反映しました', { total: total });
}

/**
 * 教師が入れた manual_score を反映する。確定した回答はフォームへ書き戻し、Queue を COMPLETED にする。
 * 授業外の上限（`__LATE__` の行）も毎回決め直す。上限点や終わる日時を直して押し直せば、合計点が直る。
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
    var recomputed = recomputeResponses(existing, lateRules_());
    var rowIndexOf = {};
    existing.forEach(function (r) { rowIndexOf[r.response_id + '\u0000' + r.question_id] = r.__row; });
    var queue = readQueueRows_();
    var lateRows = [];

    Object.keys(recomputed).forEach(function (responseId) {
      var item = recomputed[responseId];
      try {
        item.errors.forEach(function (e) { problems.push(responseId + ': ' + e); });
        // __LATE__ の行は足されたり消えたりするので、添字ではなく問題番号で新旧を比べる
        var before = {};
        existing.forEach(function (r) { if (r.response_id === responseId) before[r.question_id] = r; });
        var after = {};
        item.rows.forEach(function (r) { after[r.question_id] = true; });
        var removed = Object.keys(before).filter(function (id) { return !after[id]; });
        var changed = removed.length > 0 || item.rows.some(function (r) {
          var b = before[r.question_id];
          return !b || String(r.final_score) !== String(b.final_score) || r.status !== b.status ||
            String(r.question_text_snapshot) !== String(b.question_text_snapshot);
        });
        var job = queue.filter(function (q) { return q.job.response_id === responseId; })[0];
        var needsWriteBack = item.finalized && job && job.job.status !== 'COMPLETED';
        if (!changed && !needsWriteBack) return;

        item.rows.forEach(function (r) {
          if (r.question_id === LATE_QUESTION_ID) {
            lateRows.push({ row: r, rowIndex: before[r.question_id] ? before[r.question_id].__row : null });
            return;
          }
          var rowIndex = rowIndexOf[r.response_id + '\u0000' + r.question_id];
          sheet.getRange(rowIndex, headers.indexOf('final_score') + 1).setValue(r.final_score);
          sheet.getRange(rowIndex, headers.indexOf('status') + 1).setValue(r.status);
        });
        removed.forEach(function (id) { lateRows.push({ row: null, rowIndex: before[id].__row }); });
        if (item.finalized && job) {
          writeBackScores(job.job.form_id, responseId, item.rows);
          updateJob_(job.rowIndex, { status: 'COMPLETED' });
          done += 1;
        } else if (!item.finalized && job && job.job.status === 'COMPLETED') {
          // 上限の決め直しで要確認に戻ったら、集計表が確定とみなさないよう待ち行列も戻す
          updateJob_(job.rowIndex, { status: 'REVIEW_REQUIRED' });
        }
      } catch (err) {
        problems.push(responseId + ': ' + String(err && err.message));
        writeLog('ERROR', 'FINALIZE_FAILED', responseId, String(err && err.message));
      }
    });
    writeLateRows_(sheet, lateRows);
  } finally {
    lock.releaseLock();
  }
  if (problems.length > 0) {
    setControl('MESSAGE', '手動採点の反映で次の問題がありました:\n' + problems.join('\n'));
    writeLog('WARN', 'FINALIZE_PROBLEMS', '', problems.length + '件の問題がありました');
  }
  SpreadsheetApp.getActive().toast(done + '件の回答を確定し、フォームへ反映しました' + (problems.length ? '（問題あり。メッセージ欄を確認してください）' : ''), 'AI Grader', 8);
}

/**
 * 手動採点の反映で決め直した `__LATE__` の行をまとめて書く。行番号がずれないよう、
 * 更新と追加を先に行い、消す行は下から消す。
 * @param {{row: (Object|null), rowIndex: (number|null)}[]} lateRows row が null なら消す
 */
function writeLateRows_(sheet, lateRows) {
  var headers = SHEET_HEADERS.Results;
  lateRows.forEach(function (l) {
    if (!l.row) return;
    var values = [headers.map(function (h) { return l.row[h]; })];
    writeResultValues_(sheet, l.rowIndex || sheet.getLastRow() + 1, values);
  });
  lateRows.filter(function (l) { return !l.row; }).map(function (l) { return l.rowIndex; })
    .sort(function (a, b) { return b - a; })
    .forEach(function (rowIndex) { sheet.deleteRow(rowIndex); });
}
