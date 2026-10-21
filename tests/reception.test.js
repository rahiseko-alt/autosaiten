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
