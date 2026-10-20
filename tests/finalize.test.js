const test = require('node:test');
const assert = require('node:assert/strict');
const { recomputeResponses, scoresToWriteBack } = require('../src/Finalize.js');

function row(over) {
  return Object.assign({ response_id: 'r1', question_id: 'Q1', grading_mode: 'AUTO', status: 'AUTO_GRADED', auto_score: 5, llm_score: '', manual_score: '', final_score: 5 }, over);
}

test('manual_score が入った MANUAL_PENDING は確定し、状態が MANUAL_GRADED になる', () => {
  const rows = [row(), row({ question_id: 'Q2', grading_mode: 'MANUAL', status: 'MANUAL_PENDING', auto_score: '', final_score: '', manual_score: 3 })];
  const r = recomputeResponses(rows).r1;
  assert.equal(r.finalized, true);
  assert.deepEqual([r.rows[1].final_score, r.rows[1].status], [3, 'MANUAL_GRADED']);
});

test('manual_score が無い MANUAL が残れば確定しない', () => {
  const rows = [row(), row({ question_id: 'Q2', grading_mode: 'MANUAL', status: 'MANUAL_PENDING', auto_score: '', final_score: '' })];
  assert.equal(recomputeResponses(rows).r1.finalized, false);
});

test('要確認の LLM に manual_score を入れれば、その点で確定する', () => {
  const rows = [row({ question_id: 'Q3', grading_mode: 'LLM', status: 'REVIEW_REQUIRED', auto_score: '', llm_score: 8, final_score: 8, manual_score: 6 })];
  const r = recomputeResponses(rows).r1;
  assert.deepEqual([r.finalized, r.rows[0].final_score, r.rows[0].status], [true, 6, 'MANUAL_GRADED']);
});

test('回答ごとに別々に判定する', () => {
  const rows = [row(), row({ response_id: 'r2', grading_mode: 'MANUAL', status: 'MANUAL_PENDING', auto_score: '', final_score: '' })];
  const out = recomputeResponses(rows);
  assert.deepEqual([out.r1.finalized, out.r2.finalized], [true, false]);
});

test('書き戻す点数は、最終点が入っている問題だけ', () => {
  const rows = [row(), row({ question_id: 'Q2', final_score: '' }), row({ question_id: 'Q3', final_score: 0, status: 'UNANSWERED' })];
  assert.deepEqual(scoresToWriteBack(rows), [{ question_id: 'Q1', score: 5 }, { question_id: 'Q3', score: 0 }]);
});

test('不正な manual_score は無視して確定させず、理由を返す', () => {
  const rows = [row({ question_id: 'Q2', grading_mode: 'MANUAL', status: 'MANUAL_PENDING', auto_score: '', final_score: '', manual_score: 'abc', max_score: 5 }),
    row({ question_id: 'Q3', grading_mode: 'MANUAL', status: 'MANUAL_PENDING', auto_score: '', final_score: '', manual_score: 9, max_score: 5 })];
  const r = recomputeResponses(rows).r1;
  assert.equal(r.finalized, false);
  assert.equal(r.errors.length, 2);
  assert.ok(r.errors[0].includes('Q2'));
  assert.deepEqual(r.rows.map((x) => x.final_score), ['', '']);
});
