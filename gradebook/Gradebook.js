/**
 * 集計表の判断（学生の照合、取り込みの計画、要確認の一覧、成績の一覧、名簿の別名、新しいテストの用意、保管）。Apps Script の API には依存しない（ADR 0010）。
 * 取り込み記録は「テストのID＋回答の番号」を一意キーにし、先生の判断（この学生にする・この回答を使う）を取り込み直しでも残す。
 */

var GB_SHEETS = {
  名簿: ['氏名', 'クラス', 'アカウント', '別のアカウント', '別の綴り', '学生番号'],
  テスト一覧: ['テスト名', '科目', '実施日', 'スプレッドシートのURL', '受付ページを使う', '実施中', '最後の取り込み日時',
    '保管の状態', 'スプレッドシートのID'],
  要確認: ['テスト', '回答の番号', '回答の氏名', '回答のアカウント', '送信時刻', '合計点', '理由', 'おすすめの学生',
    'この学生にする', 'この回答を使う', 'テストのID'],
  取り込み記録: ['テストのID', '回答の番号', '回答の氏名', '回答のアカウント', '回答のクラス', '送信時刻', '合計点', '状態',
    '学生番号', '理由', 'おすすめの学生', 'この学生にする', 'この回答を使う', '取り込み日時'],
  集計表の設定: ['項目', '値', '説明']
};

/** テスト側の名簿シートの見出し（src/Config.js の ROSTER_HEADERS と同じ）。 */
var GB_TEST_ROSTER_HEADERS = ['クラス', 'No.', '氏名', '呼び名'];

var GB_SETTINGS = [
  ['ひな型のID', '', '新しいテストを作るときにコピーするひな型のスプレッドシートの ID'],
  ['新しいテストのフォルダのID', '', '新しいテストのスプレッドシートを置くフォルダの ID'],
  ['保管用のフォルダのID', '', '保管したテストを移すフォルダの ID']
];

var GB_GRADES_NOTICE = '自動で作り直します。書き込みは消えます';
/** テスト一覧の保管の状態（空は、まだ保管していない）。 */
var GB_ARCHIVE = { 停止待ち: '停止待ち', 保管済み: '保管済み' };
/** テスト側の定期処理がまだ進める仕事（src/QueuePlan.js の hasOpenJobs と同じ）。 */
var GB_OPEN_JOB_STATUSES = ['PENDING', 'RETRY', 'PROCESSING'];
var GB_MARKS = { 未確定: '（未確定）', 要確認: '（要確認）', 選択待ち: '（選択待ち）' };

function gbText_(v) {
  return v === undefined || v === null ? '' : String(v).trim();
}

function gbTrue_(v) {
  return v === true || gbText_(v).toUpperCase() === 'TRUE';
}

function gbKey_(testId, responseId) {
  return gbText_(testId) + '\n' + gbText_(responseId);
}

function gbEmail_(v) {
  return gbText_(v).toLowerCase();
}

/** 氏名の比べ方: NFKC・大文字小文字をそろえ、前後の空白を外し、続いた空白を1つにする。 */
function gbName_(v) {
  return gbText_(v).normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim();
}

function gbAliases_(v) {
  return gbText_(v).split('||').map(function (s) { return s.trim(); }).filter(function (s) { return s !== ''; });
}

function gbStudentsBy_(roster, keysOf, wanted) {
  if (wanted === '') return [];
  return roster.filter(function (s) {
    return gbText_(s.学生番号) !== '' && keysOf(s).indexOf(wanted) >= 0;
  }).map(function (s) { return gbText_(s.学生番号); });
}

/**
 * 回答を名簿の学生に照合する。アカウントは大文字小文字を区別しない完全一致（本名のアカウント・別のアカウント）、
 * 氏名はそろえてから比べる（本名・別の綴り）。両方が同じ学生に当たれば自動、アカウントが無ければ氏名だけで自動。
 * @param {{email: string, name: string}} response
 * @param {Object[]} roster 名簿の行（学生番号が振られたもの）
 * @return {{studentId: string, reason: string, suggestion: string}} reason は ''・'食い違い'・'名簿に無い'
 */
function matchStudent(response, roster) {
  var email = gbEmail_(response.email);
  var name = gbName_(response.name);
  var byEmail = gbStudentsBy_(roster, function (s) {
    return [s.アカウント].concat(gbAliases_(s.別のアカウント)).map(gbEmail_).filter(function (e) { return e !== ''; });
  }, email);
  var byName = gbStudentsBy_(roster, function (s) {
    return [s.氏名].concat(gbAliases_(s.別の綴り)).map(gbName_).filter(function (n) { return n !== ''; });
  }, name);
  var both = email === '' ? byName : byEmail.filter(function (id) { return byName.indexOf(id) >= 0; });
  if (both.length === 1) return { studentId: both[0], reason: '', suggestion: '' };
  var hint = byEmail[0] || byName[0] || '';
  return { studentId: '', reason: hint ? '食い違い' : '名簿に無い', suggestion: hint };
}

/** Results の行を回答ごとにまとめる（最初に出た順）。最終点は __LATE__ の行も含めて足す。 */
function gbResponses_(results) {
  var order = [];
  var byId = {};
  results.forEach(function (r) {
    var id = gbText_(r.response_id);
    if (id === '') return;
    if (!byId[id]) {
      byId[id] = { id: id, email: gbText_(r.respondent_email), name: gbText_(r.respondent_name),
        cls: gbText_(r.respondent_class), submittedAt: r.submitted_at, total: 0 };
      order.push(byId[id]);
    }
    var score = Number(r.final_score);
    if (gbText_(r.final_score) !== '' && !isNaN(score)) byId[id].total += score;
  });
  return order;
}

/**
 * 1つのテストの取り込みを計画する。既存の取り込み記録の先生の判断を残したまま、同じキーの行を作り直し、新しい回答は末尾に足す。
 * Queue で COMPLETED の回答だけを確定とみなす。照合を先に済ませ、同じ学生の確定した回答が2件以上あり、
 * 「この回答を使う」がちょうど1件に付いていなければ、それらを「2回送信」にする。
 * @param {{testId: string, queue: Object[], results: Object[], roster: Object[], records: Object[], now: Date}} input
 * @return {Object[]} すべてのテストの取り込み記録
 */
function planImport(input) {
  var testId = gbText_(input.testId);
  var completed = {};
  input.queue.forEach(function (j) { if (gbText_(j.status) === 'COMPLETED') completed[gbText_(j.response_id)] = true; });
  var known = {};
  input.roster.forEach(function (s) { if (gbText_(s.学生番号) !== '') known[gbText_(s.学生番号)] = true; });

  var records = input.records.slice();
  var indexOf = {};
  records.forEach(function (r, i) { indexOf[gbKey_(r.テストのID, r.回答の番号)] = i; });

  var mine = gbResponses_(input.results).map(function (resp) {
    var key = gbKey_(testId, resp.id);
    var old = indexOf[key] === undefined ? {} : records[indexOf[key]];
    var chosen = gbText_(old.この学生にする);
    var match = known[chosen] ? { studentId: chosen, reason: '', suggestion: '' }
      : matchStudent({ email: resp.email, name: resp.name }, input.roster);
    var isDone = !!completed[resp.id];
    var rec = {
      テストのID: testId, 回答の番号: resp.id, 回答の氏名: resp.name, 回答のアカウント: resp.email, 回答のクラス: resp.cls,
      送信時刻: resp.submittedAt, 合計点: isDone ? resp.total : '', 状態: isDone ? '確定' : '未確定',
      学生番号: match.studentId, 理由: match.reason, おすすめの学生: match.suggestion,
      この学生にする: chosen, この回答を使う: gbTrue_(old.この回答を使う), 取り込み日時: input.now
    };
    if (indexOf[key] === undefined) {
      indexOf[key] = records.length;
      records.push(rec);
    } else {
      records[indexOf[key]] = rec;
    }
    return rec;
  });

  var byStudent = {};
  mine.forEach(function (r) {
    if (r.状態 !== '確定' || r.学生番号 === '') return;
    (byStudent[r.学生番号] = byStudent[r.学生番号] || []).push(r);
  });
  Object.keys(byStudent).forEach(function (id) {
    var group = byStudent[id];
    var used = group.filter(function (r) { return r.この回答を使う; }).length;
    if (group.length < 2 || used === 1) return;
    group.forEach(function (r) { r.理由 = '2回送信'; r.おすすめの学生 = id; });
  });
  return records;
}

function gbTestsById_(tests) {
  var byId = {};
  tests.forEach(function (t) { var id = gbText_(t.スプレッドシートのID); if (id !== '') byId[id] = t; });
  return byId;
}

/** 要確認シートの行。理由のある取り込み記録だけを出す。 */
function reviewRows(records, tests) {
  var byId = gbTestsById_(tests);
  return records.filter(function (r) { return gbText_(r.理由) !== ''; }).map(function (r) {
    var t = byId[gbText_(r.テストのID)];
    return {
      テスト: t ? gbText_(t.テスト名) : gbText_(r.テストのID), 回答の番号: r.回答の番号, 回答の氏名: r.回答の氏名,
      回答のアカウント: r.回答のアカウント, 送信時刻: r.送信時刻, 合計点: r.合計点, 理由: r.理由,
      おすすめの学生: r.おすすめの学生, この学生にする: gbText_(r.この学生にする), この回答を使う: gbTrue_(r.この回答を使う),
      テストのID: r.テストのID
    };
  });
}

/** 要確認シートの先生の判断を、同じキーの取り込み記録へ写す（空欄も写すので、判断の取り消しもできる）。 */
function applyReviewDecisions(records, rows) {
  var decided = {};
  rows.forEach(function (r) { decided[gbKey_(r.テストのID, r.回答の番号)] = r; });
  return records.map(function (rec) {
    var d = decided[gbKey_(rec.テストのID, rec.回答の番号)];
    if (!d) return rec;
    var copy = Object.assign({}, rec);
    copy.この学生にする = gbText_(d.この学生にする);
    copy.この回答を使う = gbTrue_(d.この回答を使う);
    return copy;
  });
}

function gbPad2_(n) {
  return ('0' + n).slice(-2);
}

/** 実施日を yyyy-MM-dd にする。日付の値は日本時間で読む。読めない文字はそのまま。 */
function gbDate_(v) {
  if (v instanceof Date && !isNaN(v.getTime())) {
    var jst = new Date(v.getTime() + 9 * 3600 * 1000);
    return jst.getUTCFullYear() + '-' + gbPad2_(jst.getUTCMonth() + 1) + '-' + gbPad2_(jst.getUTCDate());
  }
  var s = gbText_(v);
  var m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/);
  return m ? m[1] + '-' + gbPad2_(Number(m[2])) + '-' + gbPad2_(Number(m[3])) : s;
}

/** 1人の学生の1つのテストのセル。点数が出せなければ、空欄の理由の印。 */
function gbGradeCell_(recs, studentId) {
  var mine = recs.filter(function (r) { return gbText_(r.学生番号) === studentId; });
  var done = mine.filter(function (r) { return r.状態 === '確定'; });
  if (done.length === 1) return done[0].合計点;
  if (done.length > 1) {
    var used = done.filter(function (r) { return gbTrue_(r.この回答を使う); });
    return used.length === 1 ? used[0].合計点 : GB_MARKS.選択待ち;
  }
  var pending = recs.some(function (r) {
    return gbText_(r.学生番号) === '' && gbText_(r.理由) !== '' && gbText_(r.おすすめの学生) === studentId;
  });
  if (pending) return GB_MARKS.要確認;
  return mine.length > 0 ? GB_MARKS.未確定 : '';
}

/**
 * 成績シートの値（先頭に注意書き、次に見出し）。学生1人1行・テスト1回1列（見出しは「科目 実施日 テスト名」）、値は合計点。
 * @return {Array[]} シートにそのまま書く2次元の値
 */
function buildGradeTable(records, roster, tests) {
  var cols = tests.filter(function (t) { return gbText_(t.スプレッドシートのID) !== ''; });
  var byTest = {};
  records.forEach(function (r) { (byTest[gbText_(r.テストのID)] = byTest[gbText_(r.テストのID)] || []).push(r); });
  var header = ['学生番号', '氏名', 'クラス'].concat(cols.map(newTestName));
  var notice = [GB_GRADES_NOTICE].concat(header.slice(1).map(function () { return ''; }));
  var body = roster.filter(function (s) { return gbText_(s.学生番号) !== ''; }).map(function (s) {
    var id = gbText_(s.学生番号);
    return [id, gbText_(s.氏名), gbText_(s.クラス)].concat(cols.map(function (t) {
      return gbGradeCell_(byTest[gbText_(t.スプレッドシートのID)] || [], id);
    }));
  });
  return [notice, header].concat(body);
}

function gbIdNumber_(id) {
  var m = gbText_(id).match(/^S(\d+)$/);
  return m ? Number(m[1]) : 0;
}

/**
 * 名簿の行ごとの学生番号を決める。既にある番号は保ち、空または重複（行のコピー）は、過去に使った番号の次から振る。
 * @param {Object[]} rows 名簿の行
 * @param {string[]} knownIds 取り込み記録などで過去に使った番号（消した学生の番号を使い回さないため）
 * @return {string[]} 行ごとの番号（氏名が空の行は ''）
 */
function assignStudentIds(rows, knownIds) {
  var max = 0;
  (knownIds || []).concat(rows.map(function (r) { return r.学生番号; })).forEach(function (id) {
    max = Math.max(max, gbIdNumber_(id));
  });
  var seen = {};
  return rows.map(function (r) {
    if (gbText_(r.氏名) === '') return '';
    var id = gbText_(r.学生番号);
    if (id === '' || seen[id]) {
      max += 1;
      id = 'S' + (max < 1000 ? ('00' + max).slice(-3) : String(max));
    }
    seen[id] = true;
    return id;
  });
}

/**
 * 先生が「この学生にする」で結びつけた回答のアカウント・氏名のうち、その学生の登録（本名・別名）に無いものを、
 * 別のアカウント・別の綴りに足す計画。比べ方は照合と同じ。|| 区切りで後ろに足し、同じものは1回だけ足す。
 * @param {Object[]} records 取り込み記録
 * @param {Object[]} roster 名簿の行（学生番号が振られたもの）
 * @return {{学生番号: string, 別のアカウント: string, 別の綴り: string}[]} 書き換える学生だけ（名簿の順）
 */
function planAliasAdditions(records, roster) {
  var plans = {};
  roster.forEach(function (s) {
    var id = gbText_(s.学生番号);
    if (id === '') return;
    plans[id] = {
      emails: gbAliases_(s.別のアカウント), names: gbAliases_(s.別の綴り), changed: false,
      emailKeys: [s.アカウント].concat(gbAliases_(s.別のアカウント)).map(gbEmail_),
      nameKeys: [s.氏名].concat(gbAliases_(s.別の綴り)).map(gbName_)
    };
  });
  records.forEach(function (r) {
    var plan = plans[gbText_(r.この学生にする)];
    if (!plan) return;
    var email = gbText_(r.回答のアカウント);
    if (email !== '' && plan.emailKeys.indexOf(gbEmail_(email)) < 0) {
      plan.emails.push(email);
      plan.emailKeys.push(gbEmail_(email));
      plan.changed = true;
    }
    var name = gbText_(r.回答の氏名);
    if (name !== '' && plan.nameKeys.indexOf(gbName_(name)) < 0) {
      plan.names.push(name);
      plan.nameKeys.push(gbName_(name));
      plan.changed = true;
    }
  });
  return roster.filter(function (s) {
    var plan = plans[gbText_(s.学生番号)];
    return plan && plan.changed;
  }).map(function (s) {
    var plan = plans[gbText_(s.学生番号)];
    return { 学生番号: gbText_(s.学生番号), 別のアカウント: plan.emails.join('||'), 別の綴り: plan.names.join('||') };
  });
}

/** 集計表の名簿を、テストの名簿シート（クラス・No.・氏名・呼び名）に写す行にする。No. は学生番号、呼び名は空欄。 */
function rosterForTest(roster) {
  return roster.filter(function (s) {
    return gbText_(s.学生番号) !== '' && gbText_(s.氏名) !== '';
  }).map(function (s) {
    return [gbText_(s.クラス), gbText_(s.学生番号), gbText_(s.氏名), ''];
  });
}

/**
 * ひな型が空か（前のテストの記録を引き継がないか）を確かめ、コピーを止める理由の一覧を返す。空なら []。
 * まだ無いシート（初期セットアップ前のひな型）は空とみなす。
 * @param {{results: Object[], queue: Object[], formMapping: Object[], settings: Object[]}} template 各シートの見出し以外の行
 * @return {string[]}
 */
function templateProblems(template) {
  var problems = [];
  var count = function (rows) { return (rows || []).length; };
  if (count(template.results) > 0) problems.push('Results に回答の行が' + count(template.results) + '行あります');
  if (count(template.queue) > 0) problems.push('Queue に待ち行列の行が' + count(template.queue) + '行あります');
  if (count(template.formMapping) > 0) problems.push('FormMapping にフォームの記録が' + count(template.formMapping) + '行あります');
  var archived = (template.settings || []).some(function (r) { return gbText_(r.key) === 'ARCHIVED'; });
  if (archived) problems.push('Settings に保管の印（ARCHIVED）があります');
  return problems;
}

/** FormMapping にある全版のフォームの ID（重複を除き、最初に出た順）。保管のときに受付を閉じ、保管用のフォルダへ移す。 */
function archiveFormIds(formMapping) {
  var ids = [];
  (formMapping || []).forEach(function (r) {
    var id = gbText_(r.form_id);
    if (id !== '' && ids.indexOf(id) < 0) ids.push(id);
  });
  return ids;
}

/**
 * テストを保管できるかを確かめ、止める理由の一覧を返す（次の操作も添える）。止める理由が無ければ []。
 * Results の合計点は取り込みと同じく __LATE__ の行も含めて足し、取り込み記録の合計点と比べる。
 * @param {{testId: string, queue: Object[], results: Object[], records: Object[]}} input records はすべてのテストの取り込み記録
 * @return {string[]}
 */
function archiveBlockers(input) {
  var testId = gbText_(input.testId);
  var undecided = {};
  var completed = {};
  var open = 0;
  input.queue.forEach(function (j) {
    var id = gbText_(j.response_id);
    var status = gbText_(j.status);
    if (status === 'COMPLETED') completed[id] = true;
    else if (id !== '') undecided[id] = true;
    if (GB_OPEN_JOB_STATUSES.indexOf(status) >= 0) open += 1;
  });
  var mine = {};
  var unresolved = 0;
  input.records.forEach(function (r) {
    if (gbText_(r.テストのID) !== testId) return;
    mine[gbText_(r.回答の番号)] = r;
    if (gbText_(r.理由) !== '') unresolved += 1;
  });
  var notImported = gbResponses_(input.results).filter(function (resp) {
    if (!completed[resp.id]) return false;
    var rec = mine[resp.id];
    if (!rec || gbText_(rec.合計点) === '') return true;
    return isNaN(Number(rec.合計点)) || Math.abs(Number(rec.合計点) - resp.total) > 1e-9;
  }).length;

  var blockers = [];
  var undecidedCount = Object.keys(undecided).length;
  if (undecidedCount > 0) {
    blockers.push('採点が確定していない回答が' + undecidedCount + '件あります。テストのスプレッドシートで採点を確定してから（「手動採点を反映」など）、もう一度「保管する」を押してください');
  }
  if (notImported > 0) {
    blockers.push('集計表に取り込まれていない確定済みの回答が' + notImported + '件あります。「取り込む」を押してから、もう一度「保管する」を押してください');
  }
  if (unresolved > 0) {
    blockers.push('未解決の要確認が' + unresolved + '件あります。要確認シートで判断を書き、「取り込む」を押してから、もう一度「保管する」を押してください');
  }
  if (open > 0) {
    blockers.push('待ち行列に採点を待つ回答が' + open + '件あります。1分ほどしてから、もう一度「保管する」を押してください');
  }
  return blockers;
}

/**
 * 「保管する」を押したときにすることを、テスト一覧の保管の状態から決める（2段階）。
 * 空 → close（全版のフォームの受付を閉じ、停止待ちにする）。
 * 停止待ち → 止める理由があれば blocked。無ければ、テストの Settings に TRIGGERS_REMOVED（テスト側がトリガーを外した印）が
 * あれば move（ファイルを保管用のフォルダへ移し、保管済みにする）、まだなら wait。wait と move では ARCHIVED を TRUE にする。
 * 保管済み → done。それ以外の値 → unknown（何もしない）。
 * @param {{status: string, blockers: string[], settings: Object[]}} input settings はテストの Settings の行（key・value）
 * @return {{action: string, message: string}}
 */
function archiveStep(input) {
  var status = gbText_(input.status);
  if (status === '') {
    return { action: 'close', message: 'フォームを閉じました。最後の回答の採点が終わるのを待ってから、もう一度『保管する』を押してください' };
  }
  if (status === GB_ARCHIVE.保管済み) return { action: 'done', message: '保管済みです' };
  if (status !== GB_ARCHIVE.停止待ち) {
    return { action: 'unknown', message: '保管の状態「' + status + '」を読めません。空・停止待ち・保管済みのどれかにしてください' };
  }
  if (input.blockers.length > 0) {
    return { action: 'blocked', message: 'まだ保管できません。\n' + input.blockers.join('\n') };
  }
  var removed = (input.settings || []).some(function (r) { return gbText_(r.key) === 'TRIGGERS_REMOVED'; });
  if (!removed) {
    return { action: 'wait', message: 'まだ止まっていません。1分ほどしてからもう一度『保管する』を押してください' };
  }
  return { action: 'move', message: '保管しました。スプレッドシートと全版のフォームを保管用のフォルダへ移しました' };
}

/** 新しいテストのスプレッドシートの名前（「科目 実施日 テスト名」。成績の列の見出しと同じ形）。 */
function newTestName(test) {
  return [gbText_(test.科目), gbDate_(test.実施日), gbText_(test.テスト名)].filter(function (s) { return s !== ''; }).join(' ');
}

/** スプレッドシートの URL（または ID そのもの）から ID を取り出す。取り出せなければ ''。 */
function spreadsheetIdFromUrl(v) {
  var s = gbText_(v);
  var m = s.match(/\/spreadsheets\/d\/([A-Za-z0-9_-]+)/);
  if (m) return m[1];
  return /^[A-Za-z0-9_-]{20,}$/.test(s) ? s : '';
}

if (typeof module !== 'undefined') {
  module.exports = {
    GB_SHEETS: GB_SHEETS, GB_SETTINGS: GB_SETTINGS, GB_GRADES_NOTICE: GB_GRADES_NOTICE, GB_TEST_ROSTER_HEADERS: GB_TEST_ROSTER_HEADERS,
    matchStudent: matchStudent, planImport: planImport, reviewRows: reviewRows, applyReviewDecisions: applyReviewDecisions,
    buildGradeTable: buildGradeTable, assignStudentIds: assignStudentIds, spreadsheetIdFromUrl: spreadsheetIdFromUrl,
    planAliasAdditions: planAliasAdditions, rosterForTest: rosterForTest, templateProblems: templateProblems,
    newTestName: newTestName, GB_ARCHIVE: GB_ARCHIVE, archiveFormIds: archiveFormIds, archiveBlockers: archiveBlockers,
    archiveStep: archiveStep
  };
}
