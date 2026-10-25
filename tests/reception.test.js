const test = require('node:test');
const assert = require('node:assert/strict');
const { planAssignment, rosterByClass } = require('../reception/Reception.js');

const a = (cls, name, no) => ({ クラス: cls, 氏名: name, 資料番号: no });

test('初めての人には、開いた順に次の資料番号を振る', () => {
  assert.deepEqual(planAssignment([], '国際', 'A', 60), { number: 1, isNew: true });
  assert.deepEqual(planAssignment([a('国際', 'A', 1)], '総合', 'B', 60), { number: 2, isNew: true });
});

test('同じクラス・氏名で開き直したら、同じ番号のまま', () => {
  const list = [a('国際', 'A', 1), a('総合', 'B', 2)];
  assert.deepEqual(planAssignment(list, '総合', 'B', 60), { number: 2, isNew: false });
});

test('クラスが違えば、同じ氏名でも別の人', () => {
  assert.deepEqual(planAssignment([a('国際', 'A', 1)], '総合', 'A', 60), { number: 2, isNew: true });
});

test('割り当ての行が途中で消えても、直前の番号の次を振る（番号が重ならない）', () => {
  assert.deepEqual(planAssignment([a('国際', 'A', 1), a('国際', 'C', 3)], '国際', 'D', 60), { number: 4, isNew: true });
});

test('割り当てシートを並べ替えても、いちばん新しく受け付けた番号の次を振る', () => {
  const list = [
    Object.assign(a('総合', 'B', 2), { 受付日時: new Date('2026-10-23T10:01:00+09:00') }),
    Object.assign(a('国際', 'A', 1), { 受付日時: new Date('2026-10-23T10:00:00+09:00') })
  ];
  assert.deepEqual(planAssignment(list, '国際', 'C', 60), { number: 3, isNew: true });
});

test('用意した資料の数を超えたら1番に戻る', () => {
  const list = [a('国際', 'A', 1), a('国際', 'B', 2), a('国際', 'C', 3)];
  assert.deepEqual(planAssignment(list, '国際', 'D', 3), { number: 1, isNew: true });
});

test('資料が1つも無ければ、番号を振れないと知らせる', () => {
  assert.throws(() => planAssignment([], '国際', 'A', 0), /資料/);
});

test('名簿をクラスごとに、名簿の順のまま分ける', () => {
  const rows = [
    { クラス: '国際', 氏名: 'A' }, { クラス: '総合', 氏名: 'C' }, { クラス: '国際', 氏名: 'B' }, { クラス: '', 氏名: 'X' }, { クラス: '総合', 氏名: '' }
  ];
  assert.deepEqual(rosterByClass(rows), [{ name: '国際', students: ['A', 'B'] }, { name: '総合', students: ['C'] }]);
});

const { chooseReceptionTest } = require('../reception/Reception.js');

const t = (useReception, active, id) => ({ 受付ページを使う: useReception, 実施中: active, スプレッドシートのID: id });
const NOT_READY = /受付の準備ができていません。先生に連絡してください/;

test('「受付ページを使う」と「実施中」の両方に印の付いた行がちょうど1つなら、そのテストへ案内する', () => {
  const rows = [t(false, false, 'old-test-id'), t(true, true, 'now-test-id'), t(true, false, 'next-test-id')];
  assert.equal(chooseReceptionTest(rows), 'now-test-id');
});

test('チェックの値は、true でも文字の TRUE でも印とみなす', () => {
  assert.equal(chooseReceptionTest([t('TRUE', true, 'a-id'), t(false, 'TRUE', 'b-id')]), 'a-id');
  assert.equal(chooseReceptionTest([t(true, 'TRUE', ' c-id ')]), 'c-id');
});

test('両方に印の付いた行が1つも無ければ、準備ができていないと知らせる', () => {
  assert.throws(() => chooseReceptionTest([]), NOT_READY);
  assert.throws(() => chooseReceptionTest([t(false, false, 'a-id')]), NOT_READY);
});

test('両方に印の付いた行が2つ以上あれば、どちらにも案内しない', () => {
  assert.throws(() => chooseReceptionTest([t(true, true, 'a-id'), t(true, true, 'b-id')]), NOT_READY);
});

test('印が片方だけの行は案内先にしない', () => {
  assert.throws(() => chooseReceptionTest([t(true, false, 'a-id'), t(false, true, 'b-id')]), NOT_READY);
  assert.equal(chooseReceptionTest([t(true, false, 'a-id'), t(false, true, 'b-id'), t(true, true, 'c-id')]), 'c-id');
});

test('案内先の行のスプレッドシートのIDが空なら、準備ができていないと知らせる', () => {
  assert.throws(() => chooseReceptionTest([t(true, true, '')]), NOT_READY);
  assert.throws(() => chooseReceptionTest([t(true, true, undefined)]), NOT_READY);
});
