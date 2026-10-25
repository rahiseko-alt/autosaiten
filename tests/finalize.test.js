const test = require('node:test');
const assert = require('node:assert/strict');
const { recomputeResponses } = require('../src/Finalize.js');

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

test('不正な manual_score は無視して確定させず、理由を返す', () => {
  const rows = [row({ question_id: 'Q2', grading_mode: 'MANUAL', status: 'MANUAL_PENDING', auto_score: '', final_score: '', manual_score: 'abc', max_score: 5 }),
    row({ question_id: 'Q3', grading_mode: 'MANUAL', status: 'MANUAL_PENDING', auto_score: '', final_score: '', manual_score: 9, max_score: 5 })];
  const r = recomputeResponses(rows).r1;
  assert.equal(r.finalized, false);
  assert.equal(r.errors.length, 2);
  assert.ok(r.errors[0].includes('Q2'));
  assert.deepEqual(r.rows.map((x) => x.final_score), ['', '']);
});

const late = {
  cap: 6, classEnds: { 国際: new Date('2026-10-20T10:30:00Z') }, roster: [{ クラス: '国際', 氏名: '山田' }],
  now: new Date('2026-10-20T12:00:00Z')
};
const lateRow = (over) => row(Object.assign({ submitted_at: new Date('2026-10-20T11:00:00Z'), respondent_name: '山田', respondent_class: '国際', max_score: 10 }, over));

test('上限の決まりを渡せば、授業外の回答に __LATE__ の行を足して合計を上限点にする', () => {
  const r = recomputeResponses([lateRow({ final_score: 8, auto_score: 8 }), lateRow({ question_id: 'Q2', auto_score: 3, final_score: 3 })], late).r1;
  const capped = r.rows.filter((x) => x.question_id === '__LATE__')[0];
  assert.equal(capped.final_score, -5);
  assert.equal(r.finalized, true);
});

test('不要になった __LATE__ の行は結果から外れる（上限点を空欄に戻した）', () => {
  const rows = [lateRow({ auto_score: 8, final_score: 8 }), lateRow({ question_id: '__LATE__', grading_mode: 'AUTO', auto_score: -2, final_score: -2, max_score: 0 })];
  const r = recomputeResponses(rows, Object.assign({}, late, { cap: '' })).r1;
  assert.deepEqual(r.rows.map((x) => x.question_id), ['Q1']);
});

test('要確認の __LATE__ が残れば確定しない。0以下の manual_score を入れれば確定し、正の数は無視して理由を返す', () => {
  const unknown = Object.assign({}, late, { roster: [] });
  const base = lateRow({ auto_score: 8, final_score: 8 });
  assert.equal(recomputeResponses([base], unknown).r1.finalized, false);
  const decided = recomputeResponses([base, lateRow({ question_id: '__LATE__', grading_mode: 'MANUAL', status: 'REVIEW_REQUIRED', auto_score: '', final_score: '', manual_score: -2, max_score: 0 })], unknown).r1;
  assert.equal(decided.finalized, true);
  assert.equal(decided.rows[1].final_score, -2);
  assert.equal(decided.rows[1].status, 'MANUAL_GRADED');
  const bad = recomputeResponses([base, lateRow({ question_id: '__LATE__', grading_mode: 'MANUAL', status: 'REVIEW_REQUIRED', auto_score: '', final_score: '', manual_score: 3, max_score: 0 })], unknown).r1;
  assert.equal(bad.finalized, false);
  assert.ok(bad.errors[0].includes('__LATE__'), bad.errors[0]);
});

test('__LATE__ の manual_score が -(__LATE__ を除く合計点) より小さければ、理由を返して無視する', () => {
  const base = lateRow({ auto_score: 8, final_score: 8 });
  const bad = recomputeResponses([base, lateRow({ question_id: '__LATE__', grading_mode: 'MANUAL', status: 'REVIEW_REQUIRED', auto_score: '', final_score: '', manual_score: -9, max_score: 0 })]).r1;
  assert.equal(bad.finalized, false);
  assert.ok(bad.errors[0].includes('-8'), bad.errors[0]);
  const ok = recomputeResponses([base, lateRow({ question_id: '__LATE__', grading_mode: 'MANUAL', status: 'REVIEW_REQUIRED', auto_score: '', final_score: '', manual_score: -8, max_score: 0 })]).r1;
  assert.deepEqual([ok.finalized, ok.errors.length], [true, 0]);
});
