const test = require('node:test');
const assert = require('node:assert/strict');
const { planNewJobs, pickRunnable, findStaleJobs, afterAttempt, shouldStop } = require('../src/QueuePlan.js');

const T0 = new Date('2026-10-20T10:00:00Z');
const min = (n) => new Date(T0.getTime() + n * 60000);

test('まだ待ち行列に無い回答だけを登録対象にする（二重登録しない）', () => {
  const responses = [{ response_id: 'r1' }, { response_id: 'r2' }, { response_id: 'r2' }];
  assert.deepEqual(planNewJobs(responses, [{ response_id: 'r1' }]).map(r => r.response_id), ['r2']);
  assert.deepEqual(planNewJobs(responses, [{ response_id: 'r1' }, { response_id: 'r2' }]), []);
});

test('PENDING と、時刻が来た RETRY を古い順に上限まで選ぶ', () => {
  const jobs = [
    { job_id: 'a', status: 'RETRY', next_run_at: min(10), created_at: min(0) },
    { job_id: 'b', status: 'PENDING', created_at: min(2) },
    { job_id: 'c', status: 'RETRY', next_run_at: min(-1), created_at: min(1) },
    { job_id: 'd', status: 'COMPLETED', created_at: min(0) },
    { job_id: 'e', status: 'PENDING', created_at: min(3) }
  ];
  assert.deepEqual(pickRunnable(jobs, T0, 2).map(j => j.job_id), ['c', 'b']);
});

test('10分以上 PROCESSING のままの job を見つける', () => {
  const jobs = [
    { job_id: 'a', status: 'PROCESSING', updated_at: min(-11) },
    { job_id: 'b', status: 'PROCESSING', updated_at: min(-3) },
    { job_id: 'c', status: 'PENDING', updated_at: min(-30) }
  ];
  assert.deepEqual(findStaleJobs(jobs, T0, 10).map(j => j.job_id), ['a']);
});

test('確定すれば COMPLETED、確認待ちなら REVIEW_REQUIRED', () => {
  assert.equal(afterAttempt({ retry_count: 0 }, { type: 'FINALIZED' }, T0).status, 'COMPLETED');
  assert.equal(afterAttempt({ retry_count: 0 }, { type: 'REVIEW' }, T0).status, 'REVIEW_REQUIRED');
});

test('失敗すれば間隔を空けて RETRY、上限を超えたら FAILED', () => {
  const first = afterAttempt({ retry_count: 0 }, { type: 'ERROR', message: 'boom' }, T0);
  assert.equal(first.status, 'RETRY');
  assert.equal(first.retry_count, 1);
  assert.ok(first.next_run_at.getTime() > T0.getTime());
  assert.equal(first.last_error, 'boom');
  const later = afterAttempt({ retry_count: 1 }, { type: 'ERROR', message: 'x' }, T0);
  assert.ok(later.next_run_at.getTime() > first.next_run_at.getTime());
  assert.equal(afterAttempt({ retry_count: 4 }, { type: 'ERROR', message: 'x' }, T0).status, 'FAILED');
});

test('実行時間の予算を超えたら止める', () => {
  assert.equal(shouldStop(0, 239000, 240000), false);
  assert.equal(shouldStop(0, 240000, 240000), true);
});
