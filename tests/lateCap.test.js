const test = require('node:test');
const assert = require('node:assert/strict');
const { planLateRow, validLateManualScore } = require('../src/LateCap.js');

const END = new Date('2026-10-20T10:30:00Z');
const AFTER = new Date('2026-10-20T11:00:00Z');
const BEFORE = new Date('2026-10-20T10:00:00Z');
const roster = [{ クラス: '国際', 氏名: '山田 太郎' }, { クラス: '総合', 氏名: 'Kim' }];

function row(over) {
  return Object.assign({
    response_id: 'r1', form_version: 1, submitted_at: AFTER, respondent_email: 'a@example.com',
    question_id: 'Q001', question_text_snapshot: '問1', final_score: 6, max_score: 10, status: 'AUTO_GRADED',
    manual_score: '', respondent_name: '山田 太郎', respondent_class: '国際'
  }, over);
}

function plan(over) {
  return planLateRow(Object.assign({
    rows: [row(), row({ question_id: 'Q002', final_score: 4 })],
    cap: 6, classEnds: { 国際: END, 総合: END }, roster: roster, now: AFTER
  }, over));
}

test('上限点が空欄なら、行を作らない', () => {
  assert.equal(plan({ cap: '' }), null);
  assert.equal(plan({ cap: null }), null);
});

test('授業内の提出なら、合計が上限を超えても行を作らない', () => {
  assert.equal(plan({ rows: [row({ submitted_at: BEFORE, final_score: 10 })] }), null);
  assert.equal(plan({ rows: [row({ submitted_at: END, final_score: 10 })] }), null);
});

test('授業外の提出で合計が上限以下なら、行を作らない', () => {
  assert.equal(plan({ rows: [row({ final_score: 6 })] }), null);
});

test('授業外の提出で合計が上限を超えれば、上限点−合計点の行を確定扱いで作る', () => {
  const late = plan();
  assert.equal(late.question_id, '__LATE__');
  assert.equal(late.final_score, -4);
  assert.equal(late.status, 'AUTO_GRADED');
  assert.equal(late.max_score, 0);
  assert.equal(late.question_text_snapshot, '授業時間外の提出（上限6点）');
  assert.deepEqual([late.response_id, late.form_version, late.respondent_name, late.respondent_class], ['r1', 1, '山田 太郎', '国際']);
});

test('既存の __LATE__ 行の点は合計に含めない', () => {
  const late = plan({ rows: [row(), row({ question_id: 'Q002', final_score: 4 }), row({ question_id: '__LATE__', final_score: -2, status: 'AUTO_GRADED', max_score: 0 })] });
  assert.equal(late.final_score, -4);
});

test('名簿の氏名は、全角半角と前後の空白の違いをそろえて引く', () => {
  const late = plan({ rows: [row({ respondent_name: ' 山田　太郎 ', final_score: 10 })] });
  assert.equal(late.status, 'AUTO_GRADED');
  assert.equal(late.final_score, -4);
});

test('名簿の氏名は、集計表と同じく大文字小文字と連続する空白の違いもそろえて引く', () => {
  const names = roster.concat([{ クラス: '国際', 氏名: 'Taro  Yamada' }]);
  const late = plan({ rows: [row({ respondent_name: ' taro YAMADA ', final_score: 10 })], roster: names });
  assert.equal(late.status, 'AUTO_GRADED');
  const kim = plan({ rows: [row({ respondent_name: 'ｋｉｍ', respondent_class: '総合', final_score: 10 })] });
  assert.equal(kim.status, 'AUTO_GRADED');
});

test('名簿に氏名が無ければ、点を空にした要確認の行を作る', () => {
  const late = plan({ rows: [row({ respondent_name: '佐藤', final_score: 10 })] });
  assert.equal(late.status, 'REVIEW_REQUIRED');
  assert.equal(late.final_score, '');
  assert.equal(late.grading_mode, 'MANUAL');
  assert.ok(late.grading_reason.includes('名簿'), late.grading_reason);
});

test('選んだクラスと名簿のクラスが違えば、要確認（遅いクラスを選んで上限を逃れられない）', () => {
  const late = plan({ rows: [row({ respondent_class: '総合', final_score: 10 })], classEnds: { 国際: END, 総合: new Date('2026-10-20T12:00:00Z') } });
  assert.equal(late.status, 'REVIEW_REQUIRED');
  assert.ok(late.grading_reason.includes('総合') && late.grading_reason.includes('国際'), late.grading_reason);
});

test('名簿のクラスの授業の終わる日時が空欄なら、要確認', () => {
  const late = plan({ rows: [row({ final_score: 10 })], classEnds: { 国際: '', 総合: END } });
  assert.equal(late.status, 'REVIEW_REQUIRED');
});

test('同じ氏名が名簿の別々のクラスにあれば、決められないので要確認', () => {
  const late = plan({ rows: [row({ final_score: 10 })], roster: roster.concat([{ クラス: '総合', 氏名: '山田 太郎' }]) });
  assert.equal(late.status, 'REVIEW_REQUIRED');
});

test('manual_score の入った既存の __LATE__ 行は、先生の判断としてそのまま残す', () => {
  const kept = row({ question_id: '__LATE__', manual_score: 0, final_score: 0, status: 'MANUAL_GRADED', max_score: 0 });
  const late = plan({ rows: [row({ final_score: 10 }), kept], cap: '' });
  assert.equal(late.manual_score, 0);
  assert.equal(late.final_score, 0);
  assert.equal(late.status, 'MANUAL_GRADED');
});

test('manual_score の無い既存の __LATE__ 行は、作り直す（上限点を上げれば点が変わる）', () => {
  const old = row({ question_id: '__LATE__', final_score: -4, status: 'AUTO_GRADED', max_score: 0 });
  const late = plan({ rows: [row(), row({ question_id: 'Q002', final_score: 4 }), old], cap: 8 });
  assert.equal(late.final_score, -2);
  assert.equal(late.question_text_snapshot, '授業時間外の提出（上限8点）');
});

test('__LATE__ の manual_score は、-(__LATE__ を除く合計点) 以上 0 以下の数だけを有効とする', () => {
  assert.equal(validLateManualScore(0, 10), true);
  assert.equal(validLateManualScore(-3, 10), true);
  assert.equal(validLateManualScore(-10, 10), true);
  assert.equal(validLateManualScore(-11, 10), false);
  assert.equal(validLateManualScore(2, 10), false);
  assert.equal(validLateManualScore('abc', 10), false);
  assert.equal(validLateManualScore('', 10), false);
});
