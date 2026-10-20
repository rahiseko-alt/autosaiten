const test = require('node:test');
const assert = require('node:assert/strict');
const { summarizeQuestions } = require('../src/Summary.js');

test('有効な問題の数と、採点方式ごとの配点を集計する', () => {
  const rows = [
    { enabled: true, points: 5, grading_mode: 'AUTO' },
    { enabled: true, points: 10, grading_mode: 'LLM' },
    { enabled: 'TRUE', points: 3, grading_mode: 'MANUAL' },
    { enabled: false, points: 100, grading_mode: 'AUTO' }
  ];
  assert.deepEqual(summarizeQuestions(rows), { total: 3, points: 18, auto: 5, llm: 10, manual: 3 });
});

test('問題が無ければすべて0', () => {
  assert.deepEqual(summarizeQuestions([]), { total: 0, points: 0, auto: 0, llm: 0, manual: 0 });
});
