const test = require('node:test');
const assert = require('node:assert/strict');
const { splitList } = require('../src/Utils.js');

test('splitList は || で区切り、前後の空白と空要素を除く', () => {
  assert.deepEqual(splitList('東京都|| とうきょう ||'), ['東京都', 'とうきょう']);
});

test('splitList は空や未指定で空配列を返す', () => {
  assert.deepEqual(splitList(''), []);
  assert.deepEqual(splitList(undefined), []);
});
