/**
 * 待ち行列の判断（何を登録し、何を処理し、結果をどうするか）。Apps Script の API には依存しない。
 */

var QUEUE_MAX_RETRIES = 5;
var QUEUE_BACKOFF_MINUTES = [1, 5, 15, 60, 120];

function qpTime_(value) {
  return new Date(value).getTime();
}

/** まだ待ち行列に無い回答だけを返す。同じ response_id は1件だけ。 */
function planNewJobs(responses, existingJobs) {
  var known = {};
  existingJobs.forEach(function (j) { known[j.response_id] = true; });
  var out = [];
  responses.forEach(function (r) {
    if (known[r.response_id]) return;
    known[r.response_id] = true;
    out.push(r);
  });
  return out;
}

/** PENDING と、時刻が来た RETRY を、古い順に limit 件。 */
function pickRunnable(jobs, now, limit) {
  return jobs
    .filter(function (j) {
      return j.status === 'PENDING' || (j.status === 'RETRY' && qpTime_(j.next_run_at) <= now.getTime());
    })
    .sort(function (a, b) { return qpTime_(a.created_at) - qpTime_(b.created_at); })
    .slice(0, limit);
}

/** 更新から staleMinutes 分以上たった PROCESSING。実行が途中で止まったもの。 */
function findStaleJobs(jobs, now, staleMinutes) {
  return jobs.filter(function (j) {
    return j.status === 'PROCESSING' && now.getTime() - qpTime_(j.updated_at) >= staleMinutes * 60000;
  });
}

/**
 * 1回の処理の結果から、次の状態を決める。
 * @param {{retry_count: number}} job
 * @param {{type: 'FINALIZED'|'REVIEW'|'ERROR', message?: string}} outcome
 */
function afterAttempt(job, outcome, now) {
  if (outcome.type === 'FINALIZED') return { status: 'COMPLETED', retry_count: job.retry_count || 0, last_error: '' };
  if (outcome.type === 'REVIEW') return { status: 'REVIEW_REQUIRED', retry_count: job.retry_count || 0, last_error: '' };
  var count = (job.retry_count || 0) + 1;
  if (count >= QUEUE_MAX_RETRIES) return { status: 'FAILED', retry_count: count, last_error: outcome.message || '' };
  var wait = QUEUE_BACKOFF_MINUTES[Math.min(count - 1, QUEUE_BACKOFF_MINUTES.length - 1)];
  return {
    status: 'RETRY', retry_count: count, last_error: outcome.message || '',
    next_run_at: new Date(now.getTime() + wait * 60000)
  };
}

function shouldStop(startMs, nowMs, budgetMs) {
  return nowMs - startMs >= budgetMs;
}

if (typeof module !== 'undefined') {
  module.exports = {
    planNewJobs: planNewJobs, pickRunnable: pickRunnable, findStaleJobs: findStaleJobs,
    afterAttempt: afterAttempt, shouldStop: shouldStop
  };
}
