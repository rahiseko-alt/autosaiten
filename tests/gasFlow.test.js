const test = require('node:test');
const assert = require('node:assert/strict');
const { createGasContext } = require('./helpers/gasFakes.js');

function llmResponse() {
  const body = JSON.stringify({ content: [{ type: 'tool_use', name: 'submit_grades', input: { results: [
    { question_id: 'Q003', score: 9, max_score: 10, confidence: 0.9, reason: 'よい', criteria: [{ criterion_id: 'C01', score: 9 }] }
  ] } }] });
  return { getResponseCode: () => 200, getContentText: () => body };
}

function fillSheet(env, name, rows) {
  const sheet = env.ss.getSheetByName(name);
  rows.forEach((row, i) => row.forEach((v, c) => sheet.put(i + 2, c + 1, v)));
}

function prepare(over) {
  const env = createGasContext(Object.assign({ scriptProperties: { ANTHROPIC_API_KEY: 'sk-test' }, fetch: () => llmResponse() }, over));
  env.ctx.setupSystem();
  const q = (id, text, type, points, mode, rule, correct, alt, opts, rubric) =>
    [true, id, '基礎', text, type, true, points, mode, rule, correct, alt, '', opts, rubric, '', '', ''];
  fillSheet(env, 'Questions', [
    q('Q001', '日本の首都は？', 'SHORT_TEXT', 5, 'AUTO', 'ANY_OF', '東京', '東京都', '', ''),
    q('Q002', '4PのPriceを選べ', 'MULTIPLE_CHOICE', 5, 'AUTO', 'NATIVE', 'Price', '', 'Product||Price||Place', ''),
    q('Q003', '理由を説明せよ', 'PARAGRAPH', 10, 'LLM', '', '', '', '', 'R001')
  ]);
  fillSheet(env, 'Rubrics', [['R001', 1, 'C01', '理由', 10, '説明できている', true, '']]);
  const settings = env.ss.getSheetByName('Settings');
  for (let r = 2; r <= 12; r++) if (settings.cell(r, 1) === 'LLM_MODEL') settings.put(r, 2, 'test-model');
  return env;
}

function control(env, key) {
  const cells = { STATUS: 'B4', MESSAGE: 'B5', FORM_URL: 'B6', FORM_VERSION: 'B8', TOTAL_POINTS: 'B11' };
  return env.ss.getSheetByName('Control').getRange(cells[key]).getValue();
}

function pressOk(env) {
  const range = env.ss.getSheetByName('Control').getRange('B2');
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
  assert.equal(control(env, 'TOTAL_POINTS'), 20);
  const mapping = env.ss.getSheetByName('FormMapping');
  assert.equal(mapping.getLastRow(), 4); // 見出し + 3問（セクション見出しは対象外）
  assert.equal(Object.keys(env.forms).length, 1);
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
  env.ss.getSheetByName('Questions').put(2, 4, '日本の首都はどこですか？');
  pressOk(env);
  assert.equal(control(env, 'STATUS'), 'READY', control(env, 'MESSAGE'));
  assert.equal(control(env, 'FORM_VERSION'), 2);
  assert.equal(Object.keys(env.forms).length, 2);
  assert.equal(env.forms.form1.accepting, false);
});

test('回答が無いフォームは、同じフォームのまま同期される', () => {
  const env = prepare();
  pressOk(env);
  env.ss.getSheetByName('Questions').put(2, 4, '首都は？');
  pressOk(env);
  assert.equal(Object.keys(env.forms).length, 1);
  assert.equal(control(env, 'FORM_VERSION'), 1);
  assert.equal(env.ss.getSheetByName('FormMapping').getLastRow(), 4);
});

test('送信から採点・確定・フォームへの書き戻しまで通る', () => {
  const env = prepare();
  pressOk(env);
  env.forms.form1.submit({ '日本の首都は？': '東京都', '4PのPriceを選べ': 'Price', '理由を説明せよ': '顧客ごとに違うから' });
  env.ctx.processGradingQueue();

  const results = env.ss.getSheetByName('Results');
  assert.equal(results.getLastRow(), 4);
  const byQ = {};
  for (let r = 2; r <= 4; r++) byQ[results.cell(r, 5)] = { final: results.cell(r, 12), status: results.cell(r, 14) };
  assert.deepEqual(byQ.Q001, { final: 5, status: 'AUTO_GRADED' });
  assert.deepEqual(byQ.Q002, { final: 5, status: 'AUTO_GRADED' });
  assert.deepEqual(byQ.Q003, { final: 9, status: 'LLM_GRADED' });

  const queue = env.ss.getSheetByName('Queue');
  assert.equal(queue.getLastRow(), 2);
  assert.equal(queue.cell(2, 5), 'COMPLETED');

  assert.equal(env.forms.form1.submitted.length, 1);
  const grades = env.forms.form1.submitted[0][0].grades.map((g) => g.score).sort();
  assert.deepEqual(grades, [5, 5, 9]);
});

test('もう一度処理しても、Queue・Results・書き戻しが増えない', () => {
  const env = prepare();
  pressOk(env);
  env.forms.form1.submit({ '日本の首都は？': '東京', '4PのPriceを選べ': 'Price', '理由を説明せよ': '回答' });
  env.ctx.processGradingQueue();
  env.ctx.processGradingQueue();
  assert.equal(env.ss.getSheetByName('Queue').getLastRow(), 2);
  assert.equal(env.ss.getSheetByName('Results').getLastRow(), 4);
  assert.equal(env.forms.form1.submitted.length, 1);
});

test('MANUAL が残る回答は書き戻されず、manual_score を入れて反映すると確定する', () => {
  const env = prepare();
  const questions = env.ss.getSheetByName('Questions');
  questions.put(4, 8, 'MANUAL'); questions.put(4, 14, '');
  pressOk(env);
  assert.equal(control(env, 'STATUS'), 'READY', control(env, 'MESSAGE'));
  env.forms.form1.submit({ '日本の首都は？': '東京', '4PのPriceを選べ': 'Price', '理由を説明せよ': '回答' });
  env.ctx.processGradingQueue();
  assert.equal(env.forms.form1.submitted.length, 0);
  assert.equal(env.ss.getSheetByName('Queue').cell(2, 5), 'REVIEW_REQUIRED');

  const results = env.ss.getSheetByName('Results');
  for (let r = 2; r <= 4; r++) if (results.cell(r, 5) === 'Q003') results.put(r, 11, 7);
  env.ctx.finalizeManualGrades();
  assert.equal(env.forms.form1.submitted.length, 1);
  assert.equal(env.ss.getSheetByName('Queue').cell(2, 5), 'COMPLETED');
});

test('LLM の通信が失敗した回答は再試行になり、0点にならない', () => {
  const env = prepare({ fetch: () => ({ getResponseCode: () => 503, getContentText: () => '' }) });
  pressOk(env);
  env.forms.form1.submit({ '日本の首都は？': '東京', '4PのPriceを選べ': 'Price', '理由を説明せよ': '回答' });
  env.ctx.processGradingQueue();
  const queue = env.ss.getSheetByName('Queue');
  assert.equal(queue.cell(2, 5), 'RETRY');
  assert.equal(queue.cell(2, 6), 1);
  assert.equal(env.ss.getSheetByName('Results').getLastRow(), 1); // 結果はまだ書かれない
  assert.equal(env.forms.form1.submitted.length, 0);
});

test('= で始まる回答も、加工されずに Results へ渡される（文字の書式の指定は実環境で確認）', () => {
  const env = prepare();
  pressOk(env);
  env.forms.form1.submit({ '日本の首都は？': '=1+1', '4PのPriceを選べ': 'Price', '理由を説明せよ': '回答' });
  env.ctx.processGradingQueue();
  const results = env.ss.getSheetByName('Results');
  const answers = [2, 3, 4].map((r) => results.cell(r, 7));
  assert.ok(answers.includes('=1+1'));
});
