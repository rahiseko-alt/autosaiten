const test = require('node:test');
const assert = require('node:assert/strict');
const { createGasContext } = require('./helpers/gasFakes.js');

function fillAuthoring(env, rows) {
  const sheet = env.ss.getSheetByName('試験作成');
  rows.forEach((row, i) => row.forEach((v, c) => sheet.put(11 + i, c + 1, v)));
}

const A = (text, kind, points, correct, alt, options, viewpoint) =>
  [true, text, kind, points, correct || '', alt || '', options || '', viewpoint || '', true, ''];

function prepare(over, rows) {
  const env = createGasContext(over);
  env.ctx.setupSystem();
  fillAuthoring(env, rows || [
    A('日本の首都は？', '短答', 5, '東京', '東京都'),
    A('4PのPriceを選べ', '選択', 5, 'Price', '', 'Product||Price||Place')
  ]);
  return env;
}

function control(env, key) {
  const cells = { STATUS: 'B4', MESSAGE: 'B5', FORM_URL: 'B6', FORM_VERSION: 'B8', TOTAL_POINTS: 'B11' };
  return env.ss.getSheetByName('Control').getRange(cells[key]).getValue();
}

function pressOk(env) {
  const range = env.ss.getSheetByName('試験作成').getRange('B2');
  range.setValue(true);
  env.ctx.handleControlEdit({ range });
  return range;
}

test('初期セットアップで8シートができ、何度実行してもトリガーが2本のまま', () => {
  const env = createGasContext();
  env.ctx.setupSystem();
  env.ctx.setupSystem();
  const names = env.ss.getSheets().map((s) => s.name);
  ['Control', 'Questions', 'Rubrics', 'Settings', 'Results', 'Queue', 'FormMapping', 'Logs'].forEach((n) => assert.ok(names.includes(n), n));
  assert.ok(!names.includes('Sheet1'));
  assert.equal(env.triggers.length, 2);
});

test('必ず埋める列の見出しは黄色、条件つきの列は薄い橙でメモ付き', () => {
  const env = createGasContext();
  env.ctx.setupSystem();
  const q = env.ss.getSheetByName('Questions');
  ['A1', 'B1', 'D1', 'E1', 'F1', 'G1', 'H1'].forEach((a1) => assert.equal(q.backgrounds[a1], '#ffff00', a1));
  ['I1', 'J1', 'M1', 'N1'].forEach((a1) => { assert.equal(q.backgrounds[a1], '#fce5cd', a1); assert.ok(q.notes[a1], a1); });
  const r = env.ss.getSheetByName('Rubrics');
  ['A1', 'B1', 'C1', 'D1', 'E1'].forEach((a1) => assert.equal(r.backgrounds[a1], '#ffff00', a1));
});

test('未記入の必須欄を黄色にする条件つき書式は、何度セットアップしても増えない', () => {
  const env = createGasContext();
  env.ctx.setupSystem();
  env.ctx.setupSystem();
  assert.equal(env.ss.getSheetByName('Questions').getConditionalFormatRules().length, 5);
  assert.equal(env.ss.getSheetByName('Rubrics').getConditionalFormatRules().length, 1);
});

test('不備があれば ERROR になり、全件が MESSAGE に出て、チェックは戻る', () => {
  const env = createGasContext();
  env.ctx.setupSystem();
  const range = pressOk(env);
  assert.equal(control(env, 'STATUS'), 'ERROR');
  assert.ok(String(control(env, 'MESSAGE')).includes('有効な問題がありません'));
  assert.equal(range.getValue(), false);
});

test('「これでOK」でフォームができ、READY になり、対応表と集計が入る', () => {
  const env = prepare();
  pressOk(env);
  assert.equal(control(env, 'STATUS'), 'READY', control(env, 'MESSAGE'));
  assert.ok(String(control(env, 'FORM_URL')).startsWith('https://forms.example/'));
  assert.equal(control(env, 'FORM_VERSION'), 1);
  assert.equal(control(env, 'TOTAL_POINTS'), 10);
  assert.equal(env.ss.getSheetByName('FormMapping').getLastRow(), 3);
  assert.equal(Object.keys(env.forms).length, 1);
});

test('状態・メッセージ・フォームURL・合計点は、試験作成シートにも出る', () => {
  const env = prepare();
  pressOk(env);
  const a = env.ss.getSheetByName('試験作成');
  assert.equal(a.getRange('B3').getValue(), 'READY');
  assert.ok(String(a.getRange('B5').getValue()).startsWith('https://forms.example/'));
  assert.equal(a.getRange('B6').getValue(), 10);
});

test('問題番号が自動で付き、並べ替えても行についたまま', () => {
  const env = prepare();
  pressOk(env);
  const a = env.ss.getSheetByName('試験作成');
  assert.deepEqual([a.cell(11, 10), a.cell(12, 10)], ['Q001', 'Q002']);
  // 行を入れ替える
  const r11 = a.rows[10].slice(); a.rows[10] = a.rows[11].slice(); a.rows[11] = r11;
  pressOk(env);
  assert.deepEqual([a.cell(11, 10), a.cell(12, 10)], ['Q002', 'Q001']);
  const q = env.ss.getSheetByName('Questions');
  assert.deepEqual([q.cell(2, 2), q.cell(3, 2)], ['Q002', 'Q001']);
});

test('種類が不正なら、試験作成シートに行番号つきで出る', () => {
  const env = prepare({}, [A('首都は？', 'なぞ', 5, '東京')]);
  pressOk(env);
  const a = env.ss.getSheetByName('試験作成');
  assert.equal(a.getRange('B3').getValue(), 'ERROR');
  assert.ok(String(a.getRange('B4').getValue()).includes('11行目'));
});

test('フォームのタイトルと説明は、試験作成シートの欄から反映される', () => {
  const env = prepare();
  const a = env.ss.getSheetByName('試験作成');
  a.put(7, 2, '期末テスト'); a.put(8, 2, '資料はこちら');
  pressOk(env);
  const settings = env.ctx.readSettings();
  assert.deepEqual([settings.FORM_TITLE, settings.FORM_DESCRIPTION], ['期末テスト', '資料はこちら']);
});

test('初期セットアップで試験作成と結果のシートが前に並び、裏方のシートは隠れる', () => {
  const env = createGasContext();
  env.ctx.setupSystem();
  const names = env.ss.getSheets().map((s) => s.name);
  assert.deepEqual(names.slice(0, 2), ['試験作成', '結果']);
  ['Control', 'Questions', 'Rubrics', 'Settings', 'Results', 'Queue', 'FormMapping', 'Logs']
    .forEach((n) => assert.equal(env.ss.getSheetByName(n).isSheetHidden(), true, n));
  assert.equal(env.ss.getSheetByName('試験作成').isSheetHidden(), false);
  assert.ok(String(env.ss.getSheetByName('結果').cell(2, 1)).startsWith('=IFERROR(FILTER('));
});

test('既に Questions にある問題は、初めて試験作成シートを作るときに引っ越す', () => {
  const env = createGasContext();
  const q = env.ss.insertSheet('Questions');
  [true, 'Q005', '', '説明せよ', 'PARAGRAPH', true, 20, 'MANUAL', '', '', '', '', '', '', '', '', '観点メモ']
    .forEach((v, c) => q.put(2, c + 1, v));
  env.ctx.setupSystem();
  const a = env.ss.getSheetByName('試験作成');
  assert.deepEqual([a.cell(11, 2), a.cell(11, 3), a.cell(11, 4), a.cell(11, 8), a.cell(11, 10)], ['説明せよ', '記述', 20, '観点メモ', 'Q005']);
});

test('何も変えずにもう一度押しても、フォームも版も増えない', () => {
  const env = prepare();
  pressOk(env);
  pressOk(env);
  assert.equal(Object.keys(env.forms).length, 1);
  assert.equal(control(env, 'FORM_VERSION'), 1);
});

test('回答が1件ある状態で問題を変えると、新しい版ができ、旧フォームの受付が止まる', () => {
  const env = prepare();
  pressOk(env);
  env.forms.form1.submit({ '日本の首都は？': '東京' });
  env.ss.getSheetByName('試験作成').put(11, 2, '日本の首都はどこですか？');
  pressOk(env);
  assert.equal(control(env, 'STATUS'), 'READY', control(env, 'MESSAGE'));
  assert.equal(control(env, 'FORM_VERSION'), 2);
  assert.equal(Object.keys(env.forms).length, 2);
  assert.equal(env.forms.form1.accepting, false);
});

test('回答が無いフォームは、同じフォームのまま同期される', () => {
  const env = prepare();
  pressOk(env);
  env.ss.getSheetByName('試験作成').put(11, 2, '首都は？');
  pressOk(env);
  assert.equal(Object.keys(env.forms).length, 1);
  assert.equal(control(env, 'FORM_VERSION'), 1);
  assert.equal(env.ss.getSheetByName('FormMapping').getLastRow(), 3);
});

test('掲載を外した問題はフォームに載らない', () => {
  const env = prepare();
  env.ss.getSheetByName('試験作成').put(12, 1, false);
  pressOk(env);
  assert.equal(env.forms.form1.items.filter((i) => i.kind !== 'SECTION').length, 1);
});

test('送信から採点・確定・フォームへの書き戻しまで通る', () => {
  const env = prepare();
  pressOk(env);
  env.forms.form1.submit({ '日本の首都は？': '東京都', '4PのPriceを選べ': 'Price' });
  env.ctx.processGradingQueue();

  const results = env.ss.getSheetByName('Results');
  assert.equal(results.getLastRow(), 3);
  const byQ = {};
  for (let r = 2; r <= 3; r++) byQ[results.cell(r, 5)] = { final: results.cell(r, 12), status: results.cell(r, 14) };
  assert.deepEqual(byQ.Q001, { final: 5, status: 'AUTO_GRADED' });
  assert.deepEqual(byQ.Q002, { final: 5, status: 'AUTO_GRADED' });
  assert.equal(env.ss.getSheetByName('Queue').cell(2, 5), 'COMPLETED');
  assert.equal(env.forms.form1.submitted.length, 1);
  assert.deepEqual(env.forms.form1.submitted[0][0].grades.map((g) => g.score), [5, 5]);
});

test('もう一度処理しても、Queue・Results・書き戻しが増えない', () => {
  const env = prepare();
  pressOk(env);
  env.forms.form1.submit({ '日本の首都は？': '東京', '4PのPriceを選べ': 'Price' });
  env.ctx.processGradingQueue();
  env.ctx.processGradingQueue();
  assert.equal(env.ss.getSheetByName('Queue').getLastRow(), 2);
  assert.equal(env.ss.getSheetByName('Results').getLastRow(), 3);
  assert.equal(env.forms.form1.submitted.length, 1);
});

test('記述は書き戻されず、manual_score を入れて反映すると確定する', () => {
  const env = prepare({}, [
    A('日本の首都は？', '短答', 5, '東京'),
    A('理由を説明せよ', '記述', 10, '模範解答', '', '', '理由が書けていれば10点')
  ]);
  pressOk(env);
  assert.equal(control(env, 'STATUS'), 'READY', control(env, 'MESSAGE'));
  env.forms.form1.submit({ '日本の首都は？': '東京', '理由を説明せよ': '回答' });
  env.ctx.processGradingQueue();
  assert.equal(env.forms.form1.submitted.length, 0);
  assert.equal(env.ss.getSheetByName('Queue').cell(2, 5), 'REVIEW_REQUIRED');

  const results = env.ss.getSheetByName('Results');
  for (let r = 2; r <= 3; r++) if (results.cell(r, 5) === 'Q002') results.put(r, 11, 7);
  env.ctx.finalizeManualGrades();
  assert.equal(env.forms.form1.submitted.length, 1);
  assert.equal(env.ss.getSheetByName('Queue').cell(2, 5), 'COMPLETED');
});

test('= で始まる回答も、加工されずに Results へ渡される（文字の書式の指定は実環境で確認）', () => {
  const env = prepare();
  pressOk(env);
  env.forms.form1.submit({ '日本の首都は？': '=1+1', '4PのPriceを選べ': 'Price' });
  env.ctx.processGradingQueue();
  const results = env.ss.getSheetByName('Results');
  assert.ok([2, 3].map((r) => results.cell(r, 7)).includes('=1+1'));
});
