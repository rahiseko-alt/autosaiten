const test = require('node:test');
const assert = require('node:assert/strict');
const { resolveFinalScore, isResponseFinalized, decideLlmStatus } = require('../src/Scoring.js');

test('AUTO は auto_score が確定点', () => {
  assert.deepEqual(resolveFinalScore({ grading_mode: 'AUTO', status: 'AUTO_GRADED', auto_score: 4 }), { final_score: 4, confirmed: true });
});

test('LLM_GRADED は llm_score が確定点', () => {
  assert.deepEqual(resolveFinalScore({ grading_mode: 'LLM', status: 'LLM_GRADED', llm_score: 8 }), { final_score: 8, confirmed: true });
});

test('REVIEW_REQUIRED は仮点を持つが確定しない', () => {
  assert.deepEqual(resolveFinalScore({ grading_mode: 'LLM', status: 'REVIEW_REQUIRED', llm_score: 8 }), { final_score: 8, confirmed: false });
  assert.deepEqual(resolveFinalScore({ grading_mode: 'LLM', status: 'REVIEW_REQUIRED' }), { final_score: null, confirmed: false });
});

test('MANUAL は manual_score が入るまで未確定', () => {
  assert.deepEqual(resolveFinalScore({ grading_mode: 'MANUAL', status: 'MANUAL_PENDING' }), { final_score: null, confirmed: false });
  assert.deepEqual(resolveFinalScore({ grading_mode: 'MANUAL', status: 'MANUAL_PENDING', manual_score: 7 }), { final_score: 7, confirmed: true });
});

test('manual_score があれば常にそれが最終点（要確認の確定にも使う）', () => {
  assert.deepEqual(resolveFinalScore({ grading_mode: 'LLM', status: 'REVIEW_REQUIRED', llm_score: 8, manual_score: 6 }), { final_score: 6, confirmed: true });
  assert.deepEqual(resolveFinalScore({ grading_mode: 'LLM', status: 'REVIEW_REQUIRED', llm_score: 8, manual_score: 0 }), { final_score: 0, confirmed: true });
});

test('未回答は0点で確定', () => {
  assert.deepEqual(resolveFinalScore({ grading_mode: 'LLM', status: 'UNANSWERED' }), { final_score: 0, confirmed: true });
});

test('全問が確定したときだけ回答が確定する', () => {
  const ok = { grading_mode: 'AUTO', status: 'AUTO_GRADED', auto_score: 1 };
  const pending = { grading_mode: 'MANUAL', status: 'MANUAL_PENDING' };
  assert.equal(isResponseFinalized([ok, ok]), true);
  assert.equal(isResponseFinalized([ok, pending]), false);
  assert.equal(isResponseFinalized([]), false);
});

test('信頼度が閾値以上なら LLM_GRADED、未満なら REVIEW_REQUIRED', () => {
  assert.equal(decideLlmStatus(0.8, 0.8), 'LLM_GRADED');
  assert.equal(decideLlmStatus(0.79, 0.8), 'REVIEW_REQUIRED');
  assert.equal(decideLlmStatus(undefined, 0.8), 'REVIEW_REQUIRED');
});
