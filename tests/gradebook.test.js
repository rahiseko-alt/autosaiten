const test = require('node:test');
const assert = require('node:assert/strict');
const {
  matchStudent, planImport, applyReviewDecisions, reviewRows, buildGradeTable, assignStudentIds, spreadsheetIdFromUrl,
  planAliasAdditions, rosterForTest, templateProblems, newTestName
} = require('../gradebook/Gradebook.js');

const roster = [
  { 学生番号: 'S001', 氏名: '山田 太郎', クラス: '国際', アカウント: 'taro@example.com', 別のアカウント: 'taro.y@gmail.com', 別の綴り: 'Yamada Taro||山田太朗' },
  { 学生番号: 'S002', 氏名: '佐藤 花子', クラス: '総合', アカウント: 'hanako@example.com', 別のアカウント: '', 別の綴り: '' },
  { 学生番号: 'S003', 氏名: 'Kim Minji', クラス: '国際', アカウント: '', 別のアカウント: '', 別の綴り: '' }
];

// --- 照合 ---

test('アカウントと氏名が同じ学生に当たれば、自動でその学生に結びつける', () => {
  assert.deepEqual(matchStudent({ email: 'taro@example.com', name: '山田 太郎' }, roster), { studentId: 'S001', reason: '', suggestion: '' });
});

test('アカウントは大文字小文字を区別せず、別のアカウントでも当たる', () => {
  assert.equal(matchStudent({ email: 'TARO.Y@gmail.com', name: '山田 太郎' }, roster).studentId, 'S001');
});

test('氏名は全角・大文字小文字・前後と連続の空白の違いをそろえ、別の綴りでも当たる', () => {
  assert.equal(matchStudent({ email: 'taro@example.com', name: '  ｙａｍａｄａ　　taro ' }, roster).studentId, 'S001');
  assert.equal(matchStudent({ email: 'taro@example.com', name: '山田太朗' }, roster).studentId, 'S001');
});

test('氏名の途中の空白の有無は、同じとみなさない', () => {
  assert.equal(matchStudent({ email: '', name: '山田太郎' }, roster).studentId, '');
});

test('回答にアカウントが無ければ、氏名だけで結びつける', () => {
  assert.deepEqual(matchStudent({ email: '', name: 'kim minji' }, roster), { studentId: 'S003', reason: '', suggestion: '' });
});

test('アカウントだけ当たり氏名が違えば、食い違いとしてアカウントの学生をすすめる', () => {
  assert.deepEqual(matchStudent({ email: 'taro@example.com', name: '佐藤 花子' }, roster), { studentId: '', reason: '食い違い', suggestion: 'S001' });
});

test('氏名だけ当たりアカウントが名簿に無ければ、食い違いとして氏名の学生をすすめる', () => {
  assert.deepEqual(matchStudent({ email: 'other@example.com', name: '佐藤 花子' }, roster), { studentId: '', reason: '食い違い', suggestion: 'S002' });
});

test('どちらも名簿に無ければ、名簿に無いとしておすすめは出さない', () => {
  assert.deepEqual(matchStudent({ email: 'x@example.com', name: '鈴木' }, roster), { studentId: '', reason: '名簿に無い', suggestion: '' });
  assert.deepEqual(matchStudent({ email: '', name: '鈴木' }, roster), { studentId: '', reason: '名簿に無い', suggestion: '' });
});

// --- 取り込みの計画 ---

const row = (rid, qid, score, who) => Object.assign({
  response_id: rid, question_id: qid, final_score: score, submitted_at: '2026-10-23T10:00:00+09:00'
}, who);
const taro = { respondent_email: 'taro@example.com', respondent_name: '山田 太郎', respondent_class: '国際' };
const hanako = { respondent_email: 'hanako@example.com', respondent_name: '佐藤 花子', respondent_class: '総合' };
const stranger = { respondent_email: 'x@example.com', respondent_name: '鈴木', respondent_class: '国際' };
const done = (...ids) => ids.map((id) => ({ response_id: id, status: 'COMPLETED' }));
const NOW = new Date('2026-10-25T12:00:00+09:00');

function importOnce(records, queue, results) {
  return planImport({ testId: 'T1', queue, results, roster, records, now: NOW });
}

test('確定した回答は、__LATE__ の行も含めて最終点を足して合計点にし、学生に結びつける', () => {
  const results = [row('r1', 'Q001', 5, taro), row('r1', 'Q002', 3, taro), row('r1', '__LATE__', -2, taro)];
  const out = importOnce([], done('r1'), results);
  assert.equal(out.length, 1);
  assert.equal(out[0].テストのID, 'T1');
  assert.equal(out[0].回答の番号, 'r1');
  assert.equal(out[0].合計点, 6);
  assert.equal(out[0].状態, '確定');
  assert.equal(out[0].学生番号, 'S001');
  assert.equal(out[0].理由, '');
  assert.equal(out[0].回答の氏名, '山田 太郎');
  assert.equal(out[0].回答のアカウント, 'taro@example.com');
  assert.equal(out[0].回答のクラス, '国際');
});

test('Queue で COMPLETED でない回答は未確定にし、合計点を入れない', () => {
  const out = importOnce([], [{ response_id: 'r1', status: 'PENDING' }], [row('r1', 'Q001', 5, taro)]);
  assert.equal(out[0].状態, '未確定');
  assert.equal(out[0].合計点, '');
  assert.equal(out[0].学生番号, 'S001');
});

test('何度取り込んでも、同じ回答は1行のまま', () => {
  const results = [row('r1', 'Q001', 5, taro), row('r2', 'Q001', 4, hanako)];
  const once = importOnce([], done('r1', 'r2'), results);
  const twice = importOnce(once, done('r1', 'r2'), results);
  assert.deepEqual(twice, once);
});

test('ほかのテストの取り込み記録には手を付けない', () => {
  const other = { テストのID: 'T0', 回答の番号: 'r1', 学生番号: 'S002', 状態: '確定', 合計点: 9, 理由: '' };
  const out = importOnce([other], done('r1'), [row('r1', 'Q001', 5, taro)]);
  assert.equal(out.length, 2);
  assert.deepEqual(out[0], other);
});

test('照合できない回答は、理由とおすすめを記録する', () => {
  const out = importOnce([], done('r1'), [row('r1', 'Q001', 5, stranger)]);
  assert.equal(out[0].学生番号, '');
  assert.equal(out[0].理由, '名簿に無い');
});

test('先生が学生番号を指定した回答は、取り込み直してもその学生に結びつける', () => {
  const first = importOnce([], done('r1'), [row('r1', 'Q001', 5, stranger)]);
  first[0].この学生にする = 'S002';
  const out = importOnce(first, done('r1'), [row('r1', 'Q001', 5, stranger)]);
  assert.equal(out[0].学生番号, 'S002');
  assert.equal(out[0].理由, '');
  assert.equal(out[0].この学生にする, 'S002');
});

test('同じ学生の確定した回答が2件あれば、どちらも2回送信の要確認にする', () => {
  const results = [row('r1', 'Q001', 5, taro), row('r2', 'Q001', 7, taro)];
  const out = importOnce([], done('r1', 'r2'), results);
  assert.deepEqual(out.map((r) => [r.学生番号, r.理由, r.おすすめの学生]), [['S001', '2回送信', 'S001'], ['S001', '2回送信', 'S001']]);
});

test('2回送信は、先生が指定した学生番号での重なりも数える', () => {
  const first = importOnce([], done('r1', 'r2'), [row('r1', 'Q001', 5, taro), row('r2', 'Q001', 7, stranger)]);
  first[1].この学生にする = 'S001';
  const out = importOnce(first, done('r1', 'r2'), [row('r1', 'Q001', 5, taro), row('r2', 'Q001', 7, stranger)]);
  assert.deepEqual(out.map((r) => r.理由), ['2回送信', '2回送信']);
});

test('「この回答を使う」が1件に付けば、2回送信は解決し、取り込み直しても残る', () => {
  const results = [row('r1', 'Q001', 5, taro), row('r2', 'Q001', 7, taro)];
  const first = importOnce([], done('r1', 'r2'), results);
  first[1].この回答を使う = true;
  const out = importOnce(first, done('r1', 'r2'), results);
  assert.deepEqual(out.map((r) => r.理由), ['', '']);
  assert.equal(out[1].この回答を使う, true);
});

test('未確定の回答は2回送信に数えない', () => {
  const results = [row('r1', 'Q001', 5, taro), row('r2', 'Q001', 7, taro)];
  const out = importOnce([], done('r1'), results);
  assert.deepEqual(out.map((r) => r.理由), ['', '']);
});

// --- 要確認の一覧と先生の判断 ---

const tests = [
  { テスト名: '第1回', 科目: 'リテラシー', 実施日: new Date('2026-10-23T00:00:00+09:00'), スプレッドシートのID: 'T1' },
  { テスト名: '第2回', 科目: 'AI演習', 実施日: '2026/10/30', スプレッドシートのID: 'T2' }
];

test('要確認の一覧には、理由のある取り込み記録だけを、テスト名つきで出す', () => {
  const recs = importOnce([], done('r1', 'r2'), [row('r1', 'Q001', 5, taro), row('r2', 'Q001', 7, stranger)]);
  const rows = reviewRows(recs, tests);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].テスト, '第1回');
  assert.equal(rows[0].回答の番号, 'r2');
  assert.equal(rows[0].理由, '名簿に無い');
  assert.equal(rows[0].合計点, 7);
  assert.equal(rows[0].テストのID, 'T1');
  assert.equal(rows[0].この学生にする, '');
  assert.equal(rows[0].この回答を使う, false);
});

test('要確認シートの先生の判断を、同じテスト・回答の取り込み記録へ写す', () => {
  const recs = importOnce([], done('r1'), [row('r1', 'Q001', 5, stranger)]);
  const sheet = reviewRows(recs, tests);
  sheet[0].この学生にする = ' S002 ';
  const out = applyReviewDecisions(recs, sheet);
  assert.equal(out[0].この学生にする, 'S002');
  assert.equal(out[0].この回答を使う, false);
  // 写したあとで計画を立てれば、指定した学生に結びつく
  assert.equal(importOnce(out, done('r1'), [row('r1', 'Q001', 5, stranger)])[0].学生番号, 'S002');
});

test('要確認シートに出ていない記録の判断は、そのまま残す', () => {
  const recs = [{ テストのID: 'T1', 回答の番号: 'r9', この学生にする: 'S003', この回答を使う: true }];
  assert.deepEqual(applyReviewDecisions(recs, []), recs);
});

// --- 成績の一覧 ---

test('成績の一覧は、先頭に注意書き、学生1人1行・テスト1回1列で合計点を並べる', () => {
  const recs = importOnce([], done('r1', 'r2'), [row('r1', 'Q001', 5, taro), row('r2', 'Q001', 8, hanako)]);
  const table = buildGradeTable(recs, roster, tests);
  assert.match(String(table[0][0]), /自動で作り直します。書き込みは消えます/);
  assert.deepEqual(table[1], ['学生番号', '氏名', 'クラス', 'リテラシー 2026-10-23 第1回', 'AI演習 2026-10-30 第2回']);
  assert.deepEqual(table.slice(2), [
    ['S001', '山田 太郎', '国際', 5, ''],
    ['S002', '佐藤 花子', '総合', 8, ''],
    ['S003', 'Kim Minji', '国際', '', '']
  ]);
});

test('空欄の理由を、未確定・要確認・選択待ちの印で示す', () => {
  let recs = importOnce([], [{ response_id: 'r1', status: 'PROCESSING' }], [row('r1', 'Q001', 5, taro)]);
  recs = recs.concat(planImport({
    testId: 'T2', queue: done('a', 'b', 'c'), roster, records: [], now: NOW,
    results: [row('a', 'Q001', 5, taro), row('b', 'Q001', 6, taro), row('c', 'Q001', 4, { respondent_email: 'hanako@example.com', respondent_name: '別人' })]
  }));
  const body = buildGradeTable(recs, roster, tests).slice(2);
  assert.deepEqual(body.map((r) => r.slice(3)), [['（未確定）', '（選択待ち）'], ['', '（要確認）'], ['', '']]);
});

test('2回送信で「この回答を使う」を選んだ回答の点を出す', () => {
  const results = [row('r1', 'Q001', 5, taro), row('r2', 'Q001', 7, taro)];
  const first = importOnce([], done('r1', 'r2'), results);
  first[0].この回答を使う = true;
  const recs = importOnce(first, done('r1', 'r2'), results);
  assert.equal(buildGradeTable(recs, roster, tests)[2][3], 5);
});

// --- 学生番号と URL ---

test('学生番号は空の行にだけ、過去に使った番号の次から振る', () => {
  const rows = [{ 氏名: 'A', 学生番号: 'S002' }, { 氏名: 'B', 学生番号: '' }, { 氏名: '', 学生番号: '' }, { 氏名: 'C', 学生番号: 'S002' }];
  assert.deepEqual(assignStudentIds(rows, ['S005']), ['S002', 'S006', '', 'S007']);
});

test('スプレッドシートの URL から ID を取り出す', () => {
  const id = '1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-';
  assert.equal(spreadsheetIdFromUrl('https://docs.google.com/spreadsheets/d/' + id + '/edit#gid=0'), id);
  assert.equal(spreadsheetIdFromUrl(id), id);
  assert.equal(spreadsheetIdFromUrl('https://example.com/'), '');
  assert.equal(spreadsheetIdFromUrl(''), '');
});

// --- 照合の結果を名簿の別名に残す ---

test('先生が指定した学生の登録に無いアカウントと綴りを、別のアカウント・別の綴りに足す', () => {
  const records = [{ 回答のアカウント: 'X@Example.com', 回答の氏名: 'Hanako Sato', この学生にする: 'S002' }];
  assert.deepEqual(planAliasAdditions(records, roster), [
    { 学生番号: 'S002', 別のアカウント: 'X@Example.com', 別の綴り: 'Hanako Sato' }
  ]);
});

test('既にある別名には、|| 区切りで後ろに足す', () => {
  const records = [{ 回答のアカウント: 'taro2@example.com', 回答の氏名: 'Taro Yamada', この学生にする: 'S001' }];
  assert.deepEqual(planAliasAdditions(records, roster), [
    { 学生番号: 'S001', 別のアカウント: 'taro.y@gmail.com||taro2@example.com', 別の綴り: 'Yamada Taro||山田太朗||Taro Yamada' }
  ]);
});

test('本名・別名に既にあるもの（大文字小文字・全角・空白の違いを含む）は足さない', () => {
  const records = [
    { 回答のアカウント: 'TARO.Y@gmail.com', 回答の氏名: 'ｙａｍａｄａ　taro', この学生にする: 'S001' },
    { 回答のアカウント: 'taro@example.com', 回答の氏名: '山田 太郎', この学生にする: 'S001' }
  ];
  assert.deepEqual(planAliasAdditions(records, roster), []);
});

test('同じ別名が何件の回答にあっても、1回だけ足す', () => {
  const records = [
    { 回答のアカウント: 'x@example.com', 回答の氏名: '', この学生にする: 'S002' },
    { 回答のアカウント: 'X@example.com', 回答の氏名: '', この学生にする: 'S002' }
  ];
  assert.deepEqual(planAliasAdditions(records, roster), [
    { 学生番号: 'S002', 別のアカウント: 'x@example.com', 別の綴り: '' }
  ]);
});

test('先生が指定していない回答・名簿に無い学生番号の回答からは足さない', () => {
  const records = [
    { 回答のアカウント: 'x@example.com', 回答の氏名: '鈴木', 学生番号: 'S002', この学生にする: '' },
    { 回答のアカウント: 'y@example.com', 回答の氏名: '田中', この学生にする: 'S999' }
  ];
  assert.deepEqual(planAliasAdditions(records, roster), []);
});

// --- 新しいテストを作る ---

test('名簿の写しは、クラス・No.（学生番号）・氏名・呼び名（空欄）の行にする', () => {
  assert.deepEqual(rosterForTest(roster.concat([{ 学生番号: '', 氏名: '', クラス: '国際' }])), [
    ['国際', 'S001', '山田 太郎', ''],
    ['総合', 'S002', '佐藤 花子', ''],
    ['国際', 'S003', 'Kim Minji', '']
  ]);
});

test('空のひな型には、止める理由が無い', () => {
  assert.deepEqual(templateProblems({ results: [], queue: [], formMapping: [], settings: [{ key: 'COLLECT_EMAIL', value: true }] }), []);
});

test('ひな型に回答・待ち行列・フォームの記録・保管の印があれば、それぞれを理由に挙げる', () => {
  const problems = templateProblems({
    results: [{ response_id: 'r1' }, { response_id: 'r1' }], queue: [{ job_id: 'j1' }],
    formMapping: [{ form_id: 'f1' }], settings: [{ key: 'ARCHIVED', value: true }]
  });
  assert.equal(problems.length, 4);
  assert.match(problems[0], /Results/);
  assert.match(problems[1], /Queue/);
  assert.match(problems[2], /FormMapping/);
  assert.match(problems[3], /ARCHIVED/);
});

test('ひな型にまだ無いシート（初期セットアップ前）は、空とみなす', () => {
  assert.deepEqual(templateProblems({}), []);
});

test('新しいテストのファイル名は「科目 実施日 テスト名」', () => {
  assert.equal(newTestName({ 科目: 'リテラシー', 実施日: '2026/11/6', テスト名: '第3回' }), 'リテラシー 2026-11-06 第3回');
});
