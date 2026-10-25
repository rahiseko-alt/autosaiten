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
  assert.ok(String(control(env, 'MESSAGE')).includes('表に問題がありません'));
  assert.equal(range.getValue(), false);
});

test('「これでOK」でフォームができ、READY になり、対応表と集計が入る', () => {
  const env = prepare();
  pressOk(env);
  assert.equal(control(env, 'STATUS'), 'READY', control(env, 'MESSAGE'));
  assert.ok(String(control(env, 'FORM_URL')).startsWith('https://forms.example/'));
  assert.equal(control(env, 'FORM_VERSION'), 1);
  assert.equal(control(env, 'TOTAL_POINTS'), 10);
  assert.equal(env.ss.getSheetByName('FormMapping').getLastRow(), 4); // 見出し + 氏名欄 + 2問
  assert.equal(Object.keys(env.forms).length, 1);
});

test('初期設定のままなら、フォームは回答者のアカウント（メールアドレス）を集める', () => {
  const env = prepare();
  pressOk(env);
  assert.equal(Object.values(env.forms)[0].collectEmail, true);
});

test('状態・メッセージ・フォームURL・合計点は、試験作成シートにも出る', () => {
  const env = prepare();
  pressOk(env);
  const a = env.ss.getSheetByName('試験作成');
  assert.equal(a.getRange('B3').getValue(), '準備完了');
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
  assert.equal(a.getRange('B3').getValue(), 'エラー');
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
  assert.ok(String(env.ss.getSheetByName('結果').cell(2, 1)).startsWith('=IFNA(FILTER({Results!C2:C,ARRAYFORMULA(IF(Results!W2:W<>"",Results!W2:W,Results!D2:D)),Results!E2:E,Results!F2:F,Results!G2:G,Results!L2:L,Results!M2:M,'));
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
  assert.equal(env.ss.getSheetByName('FormMapping').getLastRow(), 4);
});

function putRoster(env, rows) {
  const sheet = env.ss.getSheetByName('名簿');
  rows.forEach((row, i) => row.forEach((v, c) => sheet.put(2 + i, c + 1, v)));
}

test('「これでOK」を押し直すと、手で消えたクラスの選択肢が名簿から戻る（回答済みでも新しい版は作らない）', () => {
  const env = prepare();
  putRoster(env, [['国際', 1, 'A', ''], ['総合', 1, 'B', '']]);
  pressOk(env);
  const form = env.forms.form1;
  const classItem = form.items.filter((i) => i.title.indexOf('クラス') === 0)[0];
  assert.equal(classItem.getChoices().map((c) => c.getValue()).join(','), '国際,総合');
  form.submit({ '日本の首都は？': '東京' });
  classItem.setChoices([classItem.createChoice('総合')]); // 誰かが手で「国際」を消した
  pressOk(env);
  assert.equal(classItem.getChoices().map((c) => c.getValue()).join(','), '国際,総合');
  assert.equal(Object.keys(env.forms).length, 1);
  assert.equal(control(env, 'FORM_VERSION'), 1);
});

test('システム診断は、フォームに届いているのに待ち行列に登録されていない回答を知らせる', () => {
  const env = prepare();
  pressOk(env);
  env.forms.form1.submit({ '日本の首都は？': '東京' });
  env.ctx.runDiagnostics();
  const before = env.ss.getSheetByName('Control').getRange('B5').getValue();
  assert.ok(before.includes('NG: フォームの回答の登録'), before);
  assert.ok(before.includes('未登録 1件'), before);
  env.ctx.processGradingQueue();
  env.ctx.runDiagnostics();
  const after = env.ss.getSheetByName('Control').getRange('B5').getValue();
  assert.ok(after.includes('OK: フォームの回答の登録'), after);
});

test('掲載を外した問題はフォームに載らない', () => {
  const env = prepare();
  env.ss.getSheetByName('試験作成').put(12, 1, false);
  pressOk(env);
  assert.equal(env.forms.form1.items.filter((i) => i.kind !== 'SECTION' && i.title !== '氏名（Name）').length, 1);
});

test('送信から採点・確定・フォームへの書き戻しまで通る', () => {
  const env = prepare();
  pressOk(env);
  env.forms.form1.submit({ '氏名（Name）': '山田', '日本の首都は？': '東京都', '4PのPriceを選べ': 'Price' });
  env.ctx.processGradingQueue();

  const results = env.ss.getSheetByName('Results');
  assert.equal(results.getLastRow(), 3);
  const byQ = {};
  for (let r = 2; r <= 3; r++) byQ[results.cell(r, 5)] = { final: results.cell(r, 12), status: results.cell(r, 14) };
  assert.deepEqual(byQ.Q001, { final: 5, status: 'AUTO_GRADED' });
  assert.deepEqual(byQ.Q002, { final: 5, status: 'AUTO_GRADED' });
  assert.equal(env.ss.getSheetByName('Queue').cell(2, 5), 'COMPLETED');
  assert.equal(env.forms.form1.submitted.length, 1);
  assert.deepEqual(env.forms.form1.submitted[0][0].grades.map((g) => g.score), [10]);
});

test('もう一度処理しても、Queue・Results・書き戻しが増えない', () => {
  const env = prepare();
  pressOk(env);
  env.forms.form1.submit({ '氏名（Name）': '山田', '日本の首都は？': '東京', '4PのPriceを選べ': 'Price' });
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
  env.forms.form1.submit({ '氏名（Name）': '山田', '日本の首都は？': '東京', '理由を説明せよ': '回答' });
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

test('表が空のまま押しても、裏方の Questions は消えない', () => {
  const env = prepare();
  pressOk(env);
  const a = env.ss.getSheetByName('試験作成');
  for (let r = 11; r <= 12; r++) for (let c = 1; c <= 10; c++) a.put(r, c, '');
  pressOk(env);
  assert.equal(control(env, 'STATUS'), 'ERROR');
  assert.equal(env.ss.getSheetByName('Questions').cell(2, 2), 'Q001');
});

test('不備があるときは、裏方の Questions を書き換えない', () => {
  const env = prepare();
  pressOk(env);
  const a = env.ss.getSheetByName('試験作成');
  a.put(11, 5, '大阪'); a.put(12, 4, -1);
  pressOk(env);
  assert.equal(control(env, 'STATUS'), 'ERROR');
  assert.equal(env.ss.getSheetByName('Questions').cell(2, 10), '東京');
});

test('設定検証のメニューは、裏方の Questions を書き換えない', () => {
  const env = prepare();
  pressOk(env);
  env.ss.getSheetByName('試験作成').put(11, 5, '大阪');
  env.ctx.menuValidate();
  assert.equal(env.ss.getSheetByName('Questions').cell(2, 10), '東京');
});

test('行を消した問題も、その版の答案では採点される', () => {
  const env = prepare();
  pressOk(env);
  env.forms.form1.submit({ '日本の首都は？': '東京', '4PのPriceを選べ': 'Price' });
  const a = env.ss.getSheetByName('試験作成');
  a.rows.splice(11, 1); // Q002 の行を消す
  pressOk(env);
  env.ctx.processGradingQueue();
  const results = env.ss.getSheetByName('Results');
  const ids = [2, 3].map((r) => results.cell(r, 5)).sort();
  assert.deepEqual(ids, ['Q001', 'Q002']);
  const q = env.ss.getSheetByName('Questions');
  assert.ok([2, 3].some((r) => q.cell(r, 2) === 'Q002' && q.cell(r, 1) === false));
});

test('試験作成と結果を手で隠していても、セットアップをやり直せる', () => {
  const env = createGasContext();
  env.ctx.setupSystem();
  env.ss.getSheetByName('試験作成').hideSheet();
  env.ss.getSheetByName('結果').hideSheet();
  env.ctx.setupSystem();
  assert.equal(env.ss.getSheetByName('試験作成').isSheetHidden(), false);
});

test('フォームの先頭に必須の氏名欄が入り、1人1回に制限される', () => {
  const env = prepare();
  pressOk(env);
  const form = env.forms.form1;
  assert.equal(form.items[0].title, '氏名（Name）');
  assert.equal(form.limitOne, true);
});

test('氏名は結果の回答者に入り、採点の対象にはならない', () => {
  const env = prepare();
  pressOk(env);
  env.forms.form1.submit({ '氏名（Name）': 'Nguyen Van A', '日本の首都は？': '東京', '4PのPriceを選べ': 'Price' });
  env.ctx.processGradingQueue();
  const results = env.ss.getSheetByName('Results');
  assert.equal(results.getLastRow(), 3); // 氏名は行にならない
  assert.equal(results.cell(2, 23), 'Nguyen Van A');
  assert.equal(env.forms.form1.submitted[0][0].grades.length, 1);
});

test('別の言語の短答は要確認になり、Claude が意味で確かめるまで書き戻さない', () => {
  const env = prepare();
  pressOk(env);
  env.forms.form1.submit({ '氏名（Name）': 'Kim', '日本の首都は？': 'Tokyo', '4PのPriceを選べ': 'Price' });
  env.ctx.processGradingQueue();
  assert.equal(env.forms.form1.submitted.length, 0);
  assert.equal(env.ss.getSheetByName('Queue').cell(2, 5), 'REVIEW_REQUIRED');
  const results = env.ss.getSheetByName('Results');
  let row = 0;
  for (let r = 2; r <= 3; r++) if (results.cell(r, 5) === 'Q001') row = r;
  assert.equal(results.cell(row, 14), 'REVIEW_REQUIRED');
  assert.ok(String(results.cell(row, 16)).includes('別の言語'));
  results.put(row, 11, 5); // Claude が「Tokyo」は正答と同じと判断
  env.ctx.finalizeManualGrades();
  assert.equal(env.forms.form1.submitted.length, 1);
  assert.deepEqual(env.forms.form1.submitted[0][0].grades.map((g) => g.score), [10]);
});

test('新しい版を作る途中で Google が止まっても、旧フォームは受付を続ける', () => {
  const env = prepare();
  pressOk(env);
  env.forms.form1.submit({ '日本の首都は？': '東京' });
  env.ss.getSheetByName('試験作成').put(11, 2, '日本の首都はどこですか？');
  const create = env.ctx.FormApp.create;
  env.ctx.FormApp.create = () => { throw new Error('サービスがタイムアウトしました: フォーム'); };
  pressOk(env);
  assert.equal(control(env, 'STATUS'), 'ERROR');
  assert.equal(env.forms.form1.accepting, true);
  env.ctx.FormApp.create = create;
  pressOk(env);
  assert.equal(control(env, 'STATUS'), 'READY', control(env, 'MESSAGE'));
  assert.equal(env.forms.form1.accepting, false);
  assert.equal(control(env, 'FORM_VERSION'), 2);
});

test('説明の欄と配点0の記述があってもフォームができ、説明の欄は対応表に載らない', () => {
  const env = prepare({}, [
    A('以下のファイルをファクトチェックしてください。', '記述', 8, '', '', '', '観点'),
    [true, 'ただし書き', '説明', '', '', '', '', '', false, ''],
    A('タグの名前を決めてください。', '記述', 0, '', '', '', '加点なし')
  ]);
  pressOk(env);
  assert.equal(control(env, 'STATUS'), 'READY');
  const ids = env.ss.getSheetByName('FormMapping').rows.slice(1).map((r) => r[2]);
  assert.deepEqual(ids, ['__NAME__', 'Q001', 'Q003']);
});

test('問題の項目には配点も選択肢の正解も付かず、氏名欄に満点の配点が付く', () => {
  const env = prepare();
  pressOk(env);
  const items = env.forms.form1.items;
  const name = items.filter((i) => i.title === '氏名（Name）')[0];
  assert.equal(name.points, 10);
  items.filter((i) => i !== name).forEach((i) => assert.equal(i.points, 0, i.title));
  const choice = items.filter((i) => i.title === '4PのPriceを選べ')[0];
  assert.deepEqual([...choice.getChoices().map((c) => c.correct)], [false, false, false]);
});

test('書き戻しでは、氏名欄にだけ合計点と講評が入り、問題の項目には書かない', () => {
  const env = prepare();
  pressOk(env);
  env.forms.form1.submit({ '氏名（Name）': '山田', '日本の首都は？': '大阪', '4PのPriceを選べ': 'Price' });
  env.ctx.processGradingQueue();
  const grades = env.forms.form1.submitted[0][0].grades;
  assert.equal(grades.length, 1);
  assert.equal(grades[0].item.title, '氏名（Name）');
  assert.equal(grades[0].score, 5);
  assert.ok(grades[0].feedback.includes('日本の首都は？'), grades[0].feedback);
  assert.ok(grades[0].feedback.includes('4PのPriceを選べ'), grades[0].feedback);
});

test('「回答の概要を表示する」は、フォームの作成と同期のたびにオフになる', () => {
  const env = prepare();
  pressOk(env);
  const form = env.forms.form1;
  assert.equal(form.publishingSummary, false);
  form.publishingSummary = true; // 誰かがフォームで手でオンにした
  env.ss.getSheetByName('試験作成').put(11, 2, '首都は？');
  pressOk(env);
  assert.equal(form.publishingSummary, false);
  form.publishingSummary = true;
  pressOk(env); // 何も変えずに押し直しても戻る
  assert.equal(form.publishingSummary, false);
});

test('新しいフォーム・新しい版を作ったときだけ、成績の公開を手動にする案内が出る', () => {
  const guide = 'フォームの設定で、成績の公開を『後で手動で公開』にしてください';
  const env = prepare();
  pressOk(env);
  assert.ok(String(control(env, 'MESSAGE')).includes(guide), control(env, 'MESSAGE'));
  assert.ok(String(env.ss.getSheetByName('試験作成').getRange('B4').getValue()).includes(guide));
  env.ss.getSheetByName('試験作成').put(11, 2, '首都は？');
  pressOk(env); // 回答が無いので同じフォームのまま同期
  assert.ok(!String(control(env, 'MESSAGE')).includes(guide), control(env, 'MESSAGE'));
  env.forms.form1.submit({ '氏名（Name）': '山田', '首都は？': '東京' });
  env.ss.getSheetByName('試験作成').put(11, 2, '日本の首都は？');
  pressOk(env); // 回答があるので新しい版
  assert.equal(control(env, 'FORM_VERSION'), 2);
  assert.ok(String(control(env, 'MESSAGE')).includes(guide), control(env, 'MESSAGE'));
});

// 偽の回答の送信日時は 2026-10-20T10:00:00Z。授業の終わる日時をその前にすれば授業外になる
const ENDED = new Date('2026-10-20T09:30:00Z');
const LATER = new Date('2026-10-20T10:30:00Z');

function results(env) {
  const sheet = env.ss.getSheetByName('Results');
  const headers = sheet.rows[0];
  return sheet.rows.slice(1).filter((r) => r.some((v) => v !== '')).map((r) => {
    const o = {};
    headers.forEach((h, i) => { o[h] = r[i] === undefined ? '' : r[i]; });
    return o;
  });
}

/** n 回目の書き戻しで氏名欄に書いた点（偽のフォームは前回の点も持つので、最後のものを見る）。 */
function writtenScore(env, n) {
  return env.forms.form1.submitted[n][0].grades.slice(-1)[0].score;
}

function lateOf(env) {
  return results(env).filter((r) => r.question_id === '__LATE__');
}

/** 名簿に2クラス、上限点と終わる日時を入れて「これでOK」を押し、授業外の提出を1件採点する。 */
function lateSetup(opts) {
  const o = Object.assign({ cap: 6, end: ENDED, name: '山田', cls: '国際', capital: '東京' }, opts);
  const env = prepare();
  putRoster(env, [['国際', 1, '山田', ''], ['総合', 2, 'Kim', '']]);
  pressOk(env);
  const a = env.ss.getSheetByName('試験作成');
  a.put(1, 6, o.cap);
  a.put(4, 6, o.end);
  a.put(5, 6, LATER);
  pressOk(env);
  env.forms.form1.submit({ '氏名（Name）': o.name, 'クラス（Class）': o.cls, '日本の首都は？': o.capital, '4PのPriceを選べ': 'Price' });
  env.ctx.processGradingQueue();
  return env;
}

test('試験作成シートに授業外の上限点とクラスごとの終わる日時の表ができ、クラスは名簿から並ぶ', () => {
  const env = prepare();
  const a = env.ss.getSheetByName('試験作成');
  assert.equal(a.cell(1, 5), '授業外の上限点');
  putRoster(env, [['国際', 1, '山田', ''], ['総合', 2, 'Kim', '']]);
  pressOk(env);
  assert.deepEqual([a.cell(3, 5), a.cell(3, 6)], ['クラス', '授業の終わる日時']);
  assert.deepEqual([a.cell(4, 5), a.cell(5, 5)], ['国際', '総合']);
});

test('「これでOK」で上限点と終わる日時が Settings に写り、フォームの版は変わらない', () => {
  const env = prepare();
  putRoster(env, [['国際', 1, '山田', ''], ['総合', 2, 'Kim', '']]);
  pressOk(env);
  const a = env.ss.getSheetByName('試験作成');
  a.put(1, 6, 6); a.put(4, 6, ENDED);
  pressOk(env);
  const s = env.ctx.readSettings();
  assert.equal(s.LATE_CAP, 6);
  assert.equal(s['CLASS_END_国際'], ENDED);
  assert.equal(s['CLASS_END_総合'], '');
  assert.equal(Object.keys(env.forms).length, 1);
  assert.equal(control(env, 'FORM_VERSION'), 1);
});

test('名簿を並べ直しても、先生が入れた終わる日時はクラスについたまま消えない', () => {
  const env = prepare();
  putRoster(env, [['国際', 1, '山田', ''], ['総合', 2, 'Kim', '']]);
  pressOk(env);
  const a = env.ss.getSheetByName('試験作成');
  a.put(4, 6, ENDED); a.put(5, 6, LATER);
  const roster = env.ss.getSheetByName('名簿');
  roster.rows = [roster.rows[0]];
  putRoster(env, [['総合', 2, 'Kim', '']]);
  pressOk(env);
  assert.deepEqual([a.cell(4, 5), a.cell(4, 6), a.cell(5, 5), a.cell(5, 6)], ['総合', LATER, '国際', ENDED]);
});

test('授業外の提出は __LATE__ の行で合計が上限点になり、書き戻しと講評に反映される', () => {
  const env = lateSetup();
  const late = lateOf(env);
  assert.equal(late.length, 1);
  assert.equal(late[0].final_score, -4);
  assert.equal(env.ss.getSheetByName('Queue').cell(2, 5), 'COMPLETED');
  const grade = env.forms.form1.submitted[0][0].grades[0];
  assert.equal(grade.score, 6);
  assert.ok(grade.feedback.includes('授業時間外の提出のため、合計点は上限の6点までです'), grade.feedback);
});

test('授業内の提出には __LATE__ の行ができない', () => {
  const env = lateSetup({ end: LATER });
  assert.equal(lateOf(env).length, 0);
  assert.equal(env.forms.form1.submitted[0][0].grades[0].score, 10);
});

test('上限点を上げて「手動採点を反映」を押すと、行が直り、合計点を書き戻し直す', () => {
  const env = lateSetup();
  env.ss.getSheetByName('試験作成').put(1, 6, 8);
  pressOk(env);
  env.ctx.finalizeManualGrades();
  assert.equal(lateOf(env)[0].final_score, -2);
  assert.equal(env.forms.form1.submitted.length, 2);
  assert.equal(writtenScore(env, 1), 8);
});

test('上限点を空欄に戻して「手動採点を反映」を押すと、__LATE__ の行が消え、満点で書き戻し直す', () => {
  const env = lateSetup();
  env.ss.getSheetByName('試験作成').put(1, 6, '');
  pressOk(env);
  env.ctx.finalizeManualGrades();
  assert.equal(lateOf(env).length, 0);
  assert.equal(results(env).length, 2);
  assert.equal(writtenScore(env, 1), 10);
});

test('「これでOK」を押さずに上限点を変えても、「手動採点を反映」で新しい上限点が使われ、フォームは作り直さない', () => {
  const env = lateSetup();
  env.ss.getSheetByName('試験作成').put(1, 6, 8);
  env.ctx.finalizeManualGrades();
  assert.equal(env.ctx.readSettings().LATE_CAP, 8);
  assert.equal(lateOf(env)[0].final_score, -2);
  assert.equal(writtenScore(env, 1), 8);
  assert.equal(Object.keys(env.forms).length, 1);
});

test('試験作成シートの上限点が不正なら、「手動採点を反映」は「これでOK」と同じ理由を出して止まる', () => {
  const env = lateSetup();
  env.ss.getSheetByName('試験作成').put(1, 6, 'abc');
  env.ctx.finalizeManualGrades();
  assert.ok(String(control(env, 'MESSAGE')).includes('授業外の上限点は0以上の数で入れてください'), control(env, 'MESSAGE'));
  assert.equal(env.ctx.readSettings().LATE_CAP, 6);
  assert.equal(env.forms.form1.submitted.length, 1);
});

test('決め直しで確定済みの回答が要確認に戻ったら、待ち行列を戻し、フォームの点が古いままだと記録する', () => {
  const env = lateSetup({ end: LATER });
  assert.equal(env.ss.getSheetByName('Queue').cell(2, 5), 'COMPLETED');
  env.ss.getSheetByName('試験作成').put(4, 6, ''); // 終わる日時を消すと、授業内か授業外か決められない
  env.ctx.finalizeManualGrades();
  assert.equal(lateOf(env)[0].status, 'REVIEW_REQUIRED');
  assert.equal(env.ss.getSheetByName('Queue').cell(2, 5), 'REVIEW_REQUIRED');
  const warn = env.ss.getSheetByName('Logs').rows.filter((r) => r[1] === 'WARN' && String(r[4]).includes('この回答のフォームの点数は、確定し直すまで古いままです'));
  assert.equal(warn.length, 1);
});

test('問題の項目には、正解・不正解のフィードバックを付けない（Questions に書いてあっても）', () => {
  const env = prepare();
  pressOk(env);
  const q = env.ss.getSheetByName('Questions');
  const headers = q.rows[0];
  q.put(2, headers.indexOf('feedback_correct') + 1, 'よし');
  q.put(2, headers.indexOf('feedback_incorrect') + 1, 'ざんねん');
  env.ss.getSheetByName('試験作成').put(11, 2, '日本の首都はどこ？');
  pressOk(env);
  env.forms.form1.items.forEach((i) => {
    assert.equal(i.feedbackForCorrect, undefined, i.title);
    assert.equal(i.feedbackForIncorrect, undefined, i.title);
  });
  assert.deepEqual(env.ss.getSheetByName('Questions').rows[0], headers);
});

test('manual_score の入った __LATE__ の行は、上限点を変えても先生の判断として残る', () => {
  const env = lateSetup();
  const sheet = env.ss.getSheetByName('Results');
  const r = sheet.rows.findIndex((row) => row[4] === '__LATE__') + 1;
  sheet.put(r, 11, 0); // 先生が「抑えない」と決めた
  env.ss.getSheetByName('試験作成').put(1, 6, 8);
  pressOk(env);
  env.ctx.finalizeManualGrades();
  const late = lateOf(env);
  assert.deepEqual([late.length, late[0].manual_score, late[0].final_score, late[0].status], [1, 0, 0, 'MANUAL_GRADED']);
  assert.equal(writtenScore(env, 1), 10);
});

test('名簿に無い氏名の授業外の提出は要確認になり、manual_score で決めるまで書き戻さない', () => {
  const env = lateSetup({ name: '佐藤' });
  const late = lateOf(env);
  assert.deepEqual([late.length, late[0].status, late[0].final_score], [1, 'REVIEW_REQUIRED', '']);
  assert.equal(env.ss.getSheetByName('Queue').cell(2, 5), 'REVIEW_REQUIRED');
  assert.equal(env.forms.form1.submitted.length, 0);
  const sheet = env.ss.getSheetByName('Results');
  sheet.put(sheet.rows.findIndex((row) => row[4] === '__LATE__') + 1, 11, -4);
  env.ctx.finalizeManualGrades();
  assert.equal(env.ss.getSheetByName('Queue').cell(2, 5), 'COMPLETED');
  assert.equal(env.forms.form1.submitted[0][0].grades[0].score, 6);
});

test('選んだクラスと名簿のクラスが違う授業外の提出は要確認になる', () => {
  const env = lateSetup({ cls: '総合' });
  assert.equal(lateOf(env)[0].status, 'REVIEW_REQUIRED');
  assert.equal(env.forms.form1.submitted.length, 0);
});

test('記述の採点を反映するときも上限を当てはめ、問題番号で新旧を比べる', () => {
  const env = prepare({}, [
    A('日本の首都は？', '短答', 5, '東京'),
    A('理由を説明せよ', '記述', 10, '模範解答', '', '', '観点')
  ]);
  putRoster(env, [['国際', 1, '山田', '']]);
  pressOk(env);
  const a = env.ss.getSheetByName('試験作成');
  a.put(1, 6, 6); a.put(4, 6, ENDED);
  pressOk(env);
  env.forms.form1.submit({ '氏名（Name）': '山田', 'クラス（Class）': '国際', '日本の首都は？': '東京', '理由を説明せよ': '回答' });
  env.ctx.processGradingQueue();
  assert.equal(lateOf(env).length, 0); // まだ合計が上限を超えない
  const sheet = env.ss.getSheetByName('Results');
  sheet.put(sheet.rows.findIndex((row) => row[4] === 'Q002') + 1, 11, 7);
  env.ctx.finalizeManualGrades();
  assert.equal(lateOf(env)[0].final_score, -6);
  assert.equal(env.forms.form1.submitted[0][0].grades[0].score, 6);
});

test('確定済みの回答も、終わる日時を空欄にして反映し直すと要確認に戻り、待ち行列も確定でなくなる', () => {
  const env = lateSetup();
  env.ss.getSheetByName('試験作成').put(4, 6, '');
  pressOk(env);
  env.ctx.finalizeManualGrades();
  assert.equal(lateOf(env)[0].status, 'REVIEW_REQUIRED');
  assert.equal(env.ss.getSheetByName('Queue').cell(2, 5), 'REVIEW_REQUIRED');
});

test('授業外の上限点が数でなければ、「これでOK」でエラーになる', () => {
  const env = prepare();
  env.ss.getSheetByName('試験作成').put(1, 6, '六');
  pressOk(env);
  assert.equal(control(env, 'STATUS'), 'ERROR');
  assert.ok(String(control(env, 'MESSAGE')).includes('授業外の上限点'), control(env, 'MESSAGE'));
});

/** 集計表の「保管する」が書く保管の印（Settings に行を足す）。 */
function markArchived(env) {
  env.ss.getSheetByName('Settings').appendRow(['ARCHIVED', true, '']);
}

test('保管の印があり待ち行列に未完了の仕事が無ければ、トリガーを外して TRIGGERS_REMOVED を書き、新しい回答は取り込まない', () => {
  const env = prepare();
  pressOk(env);
  env.forms.form1.submit({ '氏名（Name）': '山田', '日本の首都は？': '東京', '4PのPriceを選べ': 'Price' });
  env.ctx.processGradingQueue();
  assert.equal(env.triggers.length, 2);
  markArchived(env);
  env.forms.form1.submit({ '氏名（Name）': '佐藤', '日本の首都は？': '東京', '4PのPriceを選べ': 'Price' });
  env.ctx.processGradingQueue();
  assert.equal(env.triggers.length, 0);
  assert.equal(Object.prototype.toString.call(env.ctx.readSettings().TRIGGERS_REMOVED), '[object Date]');
  assert.equal(env.ss.getSheetByName('Queue').getLastRow(), 2); // 2件目は取り込まない
  assert.deepEqual(env.ss.getSheetByName('Settings').rows[0], ['key', 'value', '説明']);
});

test('保管の印があっても、待ち行列に未完了の仕事が残っていれば処理を続け、終わってからトリガーを外す', () => {
  const env = prepare();
  pressOk(env);
  env.ctx.setSetting('WORKER_BATCH_SIZE', 1);
  env.forms.form1.submit({ '氏名（Name）': '山田', '日本の首都は？': '東京', '4PのPriceを選べ': 'Price' });
  env.forms.form1.submit({ '氏名（Name）': '佐藤', '日本の首都は？': '東京', '4PのPriceを選べ': 'Price' });
  env.ctx.processGradingQueue();
  const queue = env.ss.getSheetByName('Queue');
  assert.deepEqual([queue.cell(2, 5), queue.cell(3, 5)], ['COMPLETED', 'PENDING']);
  markArchived(env);
  env.ctx.processGradingQueue();
  assert.equal(queue.cell(3, 5), 'COMPLETED');
  assert.equal(env.triggers.length, 2);
  assert.equal(env.ctx.readSettings().TRIGGERS_REMOVED, undefined);
  env.ctx.processGradingQueue();
  assert.equal(env.triggers.length, 0);
});

test('保管済みのテストでは「これでOK」は何もせず、保管済みと知らせる', () => {
  const env = prepare();
  pressOk(env);
  markArchived(env);
  env.ss.getSheetByName('試験作成').put(11, 2, '首都は？');
  const range = pressOk(env);
  assert.ok(String(control(env, 'MESSAGE')).includes('このテストは保管済みです'), control(env, 'MESSAGE'));
  assert.ok(String(env.ss.getSheetByName('試験作成').getRange('B4').getValue()).includes('このテストは保管済みです'));
  assert.equal(env.ss.getSheetByName('Questions').cell(2, 4), '日本の首都は？');
  assert.equal(env.forms.form1.items.some((i) => i.title === '首都は？'), false);
  assert.equal(range.getValue(), false);
});

test('初期セットアップで、この表の FormMapping に無いフォームの記録（コピー元のもの）を消す', () => {
  const env = createGasContext();
  Object.assign(env.props.document, { ACTIVE_FORM_ID: 'formOfOrigin', FORM_VERSION: '3', DEFINITION_HASH: 'abc' });
  env.ctx.setupSystem();
  assert.deepEqual(env.props.document, {});
  pressOk(prepareRows(env));
  assert.equal(Object.keys(env.forms).length, 1);
  assert.equal(control(env, 'FORM_VERSION'), 1);
});

test('初期セットアップをやり直しても、このテストのフォームの記録は残る', () => {
  const env = prepare();
  pressOk(env);
  const before = Object.assign({}, env.props.document);
  env.ctx.setupSystem();
  assert.deepEqual(env.props.document, before);
  assert.equal(before.ACTIVE_FORM_ID, 'form1');
});

function prepareRows(env) {
  fillAuthoring(env, [A('日本の首都は？', '短答', 5, '東京', '東京都')]);
  return env;
}
