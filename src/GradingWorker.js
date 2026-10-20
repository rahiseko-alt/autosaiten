/**
 * 定期処理（1分ごと）。新しい回答を待ち行列に入れ、順に採点する。
 * 送信イベントは使わない（ADR 0005）。同じ response_id は1件しか登録しない。
 */

var WORKER_BUDGET_MS = 240000;
var WORKER_STALE_MINUTES = 10;

function processGradingQueue() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) return;
  var start = Date.now();
  try {
    var settings = readSettings();
    ingestNewResponses_();
    recoverStaleJobs_();

    var jobs = readQueueRows_();
    var runnable = pickRunnable(jobs.map(function (j) { return j.job; }), new Date(), Number(settings.WORKER_BATCH_SIZE) || 5);
    var rowOf = {};
    jobs.forEach(function (j) { rowOf[j.job.job_id] = j.rowIndex; });

    for (var i = 0; i < runnable.length; i++) {
      if (shouldStop(start, Date.now(), WORKER_BUDGET_MS)) break;
      runJob_(runnable[i], rowOf[runnable[i].job_id], settings);
    }
  } catch (err) {
    writeLog('ERROR', 'WORKER_FAILED', '', String(err && err.message), { stack: String(err && err.stack) });
  } finally {
    lock.releaseLock();
  }
}

function readQueueRows_() {
  var sheet = SpreadsheetApp.getActive().getSheetByName(SHEET_NAMES.QUEUE);
  if (sheet.getLastRow() < 2) return [];
  var headers = SHEET_HEADERS.Queue;
  return sheet.getRange(2, 1, sheet.getLastRow() - 1, headers.length).getValues().map(function (row, i) {
    var job = {};
    headers.forEach(function (h, c) { job[h] = row[c]; });
    return { rowIndex: i + 2, job: job };
  });
}

function updateJob_(rowIndex, patch) {
  var sheet = SpreadsheetApp.getActive().getSheetByName(SHEET_NAMES.QUEUE);
  var headers = SHEET_HEADERS.Queue;
  patch.updated_at = new Date();
  Object.keys(patch).forEach(function (key) {
    sheet.getRange(rowIndex, headers.indexOf(key) + 1).setValue(patch[key]);
  });
}

/** フォームの新しい回答を待ち行列に登録する。すでにあるものは登録しない。 */
function ingestNewResponses_() {
  var props = PropertiesService.getDocumentProperties();
  var formId = props.getProperty(PROP_ACTIVE_FORM_ID);
  if (!formId) return;
  var form = openFormOrNull_(formId);
  if (!form) return;
  var version = Number(props.getProperty(PROP_FORM_VERSION)) || 1;
  var responses = form.getResponses().map(function (r) { return { response_id: r.getId() }; });
  var fresh = planNewJobs(responses, readQueueRows_().map(function (j) { return j.job; }));
  if (fresh.length === 0) return;
  var now = new Date();
  var rows = fresh.map(function (r) {
    return [Utilities.getUuid(), r.response_id, formId, version, 'PENDING', 0, '', now, now, ''];
  });
  var sheet = SpreadsheetApp.getActive().getSheetByName(SHEET_NAMES.QUEUE);
  sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, rows[0].length).setValues(rows);
  writeLog('INFO', 'RESPONSE_QUEUED', formId, fresh.length + '件の回答を登録しました');
}

/** 実行が途中で止まって PROCESSING のままの job を RETRY に戻す。 */
function recoverStaleJobs_() {
  var jobs = readQueueRows_();
  var stale = findStaleJobs(jobs.map(function (j) { return j.job; }), new Date(), WORKER_STALE_MINUTES);
  stale.forEach(function (s) {
    var found = jobs.filter(function (j) { return j.job.job_id === s.job_id; })[0];
    updateJob_(found.rowIndex, { status: 'RETRY', next_run_at: new Date(), last_error: '処理が途中で止まったため再試行します' });
  });
}

function runJob_(job, rowIndex, settings) {
  updateJob_(rowIndex, { status: 'PROCESSING' });
  writeLog('INFO', 'GRADING_STARTED', job.response_id, '採点を開始しました');
  var outcome;
  try {
    var result = gradeJob_(job, settings);
    saveResultRows(result.rows);
    if (result.finalized) {
      writeBackScores(job.form_id, job.response_id, result.rows);
      outcome = { type: 'FINALIZED' };
      writeLog('INFO', 'GRADING_COMPLETED', job.response_id, '採点が確定しました');
    } else {
      outcome = { type: 'REVIEW' };
      writeLog('INFO', 'REVIEW_REQUIRED', job.response_id, '確認または手動採点が必要です');
    }
  } catch (err) {
    outcome = { type: 'ERROR', message: String(err && err.message) };
    writeLog('ERROR', 'GRADING_FAILED', job.response_id, String(err && err.message), { stack: String(err && err.stack) });
  }
  var next = afterAttempt(job, outcome, new Date());
  updateJob_(rowIndex, {
    status: next.status, retry_count: next.retry_count, last_error: next.last_error,
    next_run_at: next.next_run_at || ''
  });
}

/** フォームの回答を読み、採点して Results の行にする（保存はしない）。 */
function gradeJob_(job, settings) {
  var form = FormApp.openById(job.form_id);
  var formResponse = form.getResponse(job.response_id);
  var questionOfItem = {};
  readTable(SHEET_NAMES.FORM_MAPPING).forEach(function (m) {
    if (Number(m.form_version) === Number(job.form_version) && m.form_id === job.form_id) {
      questionOfItem[String(m.form_item_id)] = m.question_id;
    }
  });
  var answers = {};
  formResponse.getItemResponses().forEach(function (ir) {
    var qid = questionOfItem[String(ir.getItem().getId())];
    if (qid) answers[qid] = ir.getResponse();
  });
  var mappedIds = {};
  Object.keys(questionOfItem).forEach(function (k) { mappedIds[questionOfItem[k]] = true; });
  var questions = readTable(SHEET_NAMES.QUESTIONS).filter(function (q) { return mappedIds[q.question_id]; });

  return gradeResponse({
    response: {
      response_id: job.response_id, form_version: job.form_version,
      submitted_at: formResponse.getTimestamp(), respondent_email: formResponse.getRespondentEmail(),
      answers: answers
    },
    questions: questions,
    rubrics: readTable(SHEET_NAMES.RUBRICS),
    settings: settings,
    provider: createProvider(settings),
    now: new Date()
  });
}

function menuRegradeSelected() {
  SpreadsheetApp.getActive().toast('再採点はまだ実装されていません', 'AI Grader', 5);
}
function finalizeManualGrades() {
  SpreadsheetApp.getActive().toast('Manual採点の反映はまだ実装されていません', 'AI Grader', 5);
}
function runDiagnostics() {
  SpreadsheetApp.getActive().toast('システム診断はまだ実装されていません', 'AI Grader', 5);
}
