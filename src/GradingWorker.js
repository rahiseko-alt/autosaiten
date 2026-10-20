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

/** すべての版のフォームから、新しい回答を待ち行列に登録する。すでにあるものは登録しない。 */
function ingestNewResponses_() {
  var props = PropertiesService.getDocumentProperties();
  var forms = {};
  var activeId = props.getProperty(PROP_ACTIVE_FORM_ID);
  if (activeId) forms[activeId] = Number(props.getProperty(PROP_FORM_VERSION)) || 1;
  readTable(SHEET_NAMES.FORM_MAPPING).forEach(function (m) {
    if (m.form_id && forms[m.form_id] === undefined) forms[m.form_id] = Number(m.form_version);
  });

  Object.keys(forms).forEach(function (formId) {
    var form;
    try {
      form = FormApp.openById(formId);
    } catch (e) {
      writeLog('WARN', 'FORM_UNAVAILABLE', formId, 'フォームを開けませんでした。次の回で再試行します');
      return;
    }
    var responses = form.getResponses().map(function (r) { return { response_id: r.getId() }; });
    var fresh = planNewJobs(responses, readQueueRows_().map(function (j) { return j.job; }));
    if (fresh.length === 0) return;
    var now = new Date();
    var rows = fresh.map(function (r) {
      return [Utilities.getUuid(), r.response_id, formId, forms[formId], 'PENDING', 0, '', now, now, ''];
    });
    var sheet = SpreadsheetApp.getActive().getSheetByName(SHEET_NAMES.QUEUE);
    sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, rows[0].length).setValues(rows);
    writeLog('INFO', 'RESPONSE_QUEUED', formId, fresh.length + '件の回答を登録しました');
  });
}

/** 実行が途中で止まって PROCESSING のままの job を、再試行回数を増やして RETRY に戻す。 */
function recoverStaleJobs_() {
  var jobs = readQueueRows_();
  var stale = findStaleJobs(jobs.map(function (j) { return j.job; }), new Date(), WORKER_STALE_MINUTES);
  stale.forEach(function (s) {
    var found = jobs.filter(function (j) { return j.job.job_id === s.job_id; })[0];
    var next = afterAttempt(s, { type: 'ERROR', message: '処理が途中で止まったため再試行します' }, new Date());
    updateJob_(found.rowIndex, {
      status: next.status, retry_count: next.retry_count, last_error: next.last_error, next_run_at: next.next_run_at || ''
    });
  });
}

function runJob_(job, rowIndex, settings, force) {
  updateJob_(rowIndex, { status: 'PROCESSING' });
  writeLog('INFO', 'GRADING_STARTED', job.response_id, '採点を開始しました');
  var outcome;
  try {
    var done = null;
    if (!force) {
      // 採点と保存は済んでいて、書き戻しだけが失敗していた場合は、LLM を呼び直さない。
      var existing = readResultsWithRows_().filter(function (r) { return r.response_id === job.response_id; });
      var again = existing.length > 0 ? recomputeResponses(existing)[job.response_id] : null;
      if (again && again.finalized) done = { rows: again.rows, finalized: true };
    }
    if (!done) {
      var lastAttempt = (Number(job.retry_count) || 0) + 1 >= QUEUE_MAX_RETRIES;
      var graded = gradeJob_(job, settings, { onProviderError: lastAttempt ? 'review' : 'throw' });
      var saved = saveResultRows(graded.rows);
      var recomputed = recomputeResponses(saved)[job.response_id];
      done = { rows: recomputed.rows, finalized: recomputed.finalized };
    }
    if (done.finalized) {
      writeBackScores(job.form_id, job.response_id, done.rows);
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
function gradeJob_(job, settings, deps) {
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
    now: new Date(),
    deps: deps
  });
}

/**
 * 回答を採点し直す。過去の行は消さず更新し、教師が入れた manual_score は守る。
 */
function regradeResponse(responseId) {
  var found = readQueueRows_().filter(function (j) { return j.job.response_id === responseId; })[0];
  if (!found) throw new Error('回答 ' + responseId + ' は待ち行列にありません');
  writeLog('INFO', 'REGRADING', responseId, '再採点を開始しました');
  runJob_(found.job, found.rowIndex, readSettings(), true);
}

/** Results シートで選んだ行の回答を再採点する。 */
function menuRegradeSelected() {
  var sheet = SpreadsheetApp.getActiveSheet();
  if (sheet.getName() !== SHEET_NAMES.RESULTS) {
    SpreadsheetApp.getActive().toast('Results シートで再採点したい行を選んでから実行してください', 'AI Grader', 6);
    return;
  }
  var range = sheet.getActiveRange();
  var ids = {};
  for (var r = range.getRow(); r < range.getRow() + range.getNumRows(); r++) {
    if (r < 2) continue;
    var id = sheet.getRange(r, 1).getValue();
    if (id) ids[id] = true;
  }
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) return;
  try {
    Object.keys(ids).forEach(regradeResponse);
  } finally {
    lock.releaseLock();
  }
  SpreadsheetApp.getActive().toast(Object.keys(ids).length + '件の回答を再採点しました', 'AI Grader', 6);
}
