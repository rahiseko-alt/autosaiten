/**
 * 試験作成シート（先生が触る表）と、裏方の Questions の行との変換（ADR 0007）。
 * Apps Script の API には依存しない。
 */

var AUTHORING_HEADERS = ['掲載', '問題文', '種類', '配点', '正答', '別解', '選択肢', '採点の観点', '必須', '問題番号'];

var AUTHORING_KINDS = {
  短答: { question_type: 'SHORT_TEXT', grading_mode: 'AUTO', auto_rule: 'ANY_OF' },
  数値: { question_type: 'SHORT_TEXT', grading_mode: 'AUTO', auto_rule: 'NUMBER' },
  記述: { question_type: 'PARAGRAPH', grading_mode: 'MANUAL', auto_rule: '' },
  選択: { question_type: 'MULTIPLE_CHOICE', grading_mode: 'AUTO', auto_rule: 'NATIVE' },
  複数選択: { question_type: 'CHECKBOX', grading_mode: 'AUTO', auto_rule: 'NATIVE' },
  プルダウン: { question_type: 'DROPDOWN', grading_mode: 'AUTO', auto_rule: 'NATIVE' }
};

function auBlank_(v) {
  return v === undefined || v === null || String(v).trim() === '';
}

function auTrue_(v) {
  return v === true || String(v).trim().toUpperCase() === 'TRUE';
}

/** 問題文・種類・配点・正答のどれかが書かれていれば、使われている行とみなす。 */
function auInUse_(r) {
  return ['問題文', '種類', '配点', '正答', '別解', '選択肢', '採点の観点'].some(function (k) { return !auBlank_(r[k]); });
}

function auNumber_(id) {
  var m = String(id || '').match(/^Q(\d+)$/);
  return m ? Number(m[1]) : 0;
}

/**
 * 行ごとの問題番号を決める。既にある番号は保ち、空または重複は新しい番号を振る。
 * @param {Object[]} rows 試験作成の行
 * @param {string[]} knownIds 過去に使った番号（再利用しないため）
 * @return {string[]} 行ごとの番号（空行は ''）
 */
function assignQuestionIds(rows, knownIds) {
  var max = 0;
  (knownIds || []).concat(rows.map(function (r) { return r.問題番号; })).forEach(function (id) {
    max = Math.max(max, auNumber_(id));
  });
  var seen = {};
  return rows.map(function (r) {
    if (!auInUse_(r)) return '';
    var id = String(r.問題番号 || '').trim();
    if (id === '' || seen[id] || auNumber_(id) === 0) {
      max += 1;
      id = 'Q' + ('00' + max).slice(-3);
    }
    seen[id] = true;
    return id;
  });
}

/**
 * 試験作成の行を、裏方の Questions の行に変換する。
 * @param {Object[]} rows 問題番号が付いた試験作成の行
 * @param {number} [firstRowNumber] 1行目がシートの何行目か（エラー表示用）
 * @return {{rows: Object[], errors: string[]}}
 */
function toQuestionRows(rows, firstRowNumber) {
  var errors = [];
  var out = [];
  rows.forEach(function (r, i) {
    if (!auInUse_(r)) return;
    var kind = AUTHORING_KINDS[String(r.種類 || '').trim()];
    var label = '試験作成の' + ((firstRowNumber || 1) + i) + '行目（' + r.問題番号 + '）';
    if (!kind) {
      if (auTrue_(r.掲載)) errors.push('ERROR: ' + label + ' 種類を ' + Object.keys(AUTHORING_KINDS).join('・') + ' から選んでください。');
      kind = { question_type: '', grading_mode: '', auto_rule: '' };
    }
    var isNumber = kind.auto_rule === 'NUMBER';
    out.push({
      enabled: auTrue_(r.掲載),
      question_id: r.問題番号,
      section: '',
      question_text: r.問題文,
      question_type: kind.question_type,
      required: auTrue_(r.必須),
      points: r.配点,
      grading_mode: kind.grading_mode,
      auto_rule: kind.auto_rule,
      correct_answer: r.正答,
      alternatives: isNumber ? '' : r.別解,
      tolerance: isNumber ? r.別解 : '',
      options: r.選択肢,
      rubric_id: '',
      feedback_correct: '',
      feedback_incorrect: '',
      notes: r.採点の観点
    });
  });
  return { rows: out, errors: errors };
}

/** 裏方の Questions（と Rubrics）から試験作成の行を作る。初めて試験作成シートを作るときの引っ越し用。 */
function fromQuestionRows(questions, rubrics) {
  var kindOf = function (q) {
    var names = Object.keys(AUTHORING_KINDS);
    for (var i = 0; i < names.length; i++) {
      var k = AUTHORING_KINDS[names[i]];
      if (k.question_type !== q.question_type) continue;
      if (q.question_type === 'SHORT_TEXT' && (k.auto_rule === 'NUMBER') !== (q.auto_rule === 'NUMBER')) continue;
      return names[i];
    }
    return '';
  };
  return questions.filter(function (q) { return !auBlank_(q.question_id) || !auBlank_(q.question_text); }).map(function (q) {
    var kind = kindOf(q);
    var viewpoint = q.notes || '';
    if (!auBlank_(q.rubric_id)) {
      var rows = (rubrics || []).filter(function (r) { return String(r.rubric_id) === String(q.rubric_id); });
      var latest = Math.max.apply(null, rows.map(function (r) { return Number(r.rubric_version); }).concat([0]));
      viewpoint = rows.filter(function (r) { return Number(r.rubric_version) === latest; }).map(function (r) {
        return r.criterion + '（' + r.max_points + '点）: ' + r.description;
      }).join('\n');
    }
    return {
      掲載: auTrue_(q.enabled), 問題文: q.question_text, 種類: kind, 配点: q.points,
      正答: q.correct_answer || '', 別解: kind === '数値' ? (q.tolerance || '') : (q.alternatives || ''),
      選択肢: q.options || '', 採点の観点: viewpoint, 必須: auTrue_(q.required), 問題番号: q.question_id
    };
  });
}

/** 検証メッセージの裏方の列名を、試験作成シートの列名に置き換える。 */
function toTeacherMessage(message) {
  var names = [
    ['question_text', '問題文'], ['question_type', '種類'], ['grading_mode', '種類'], ['auto_rule', '種類'],
    ['correct_answer', '正答'], ['alternatives', '別解'], ['tolerance', '別解（許容差）'], ['options', '選択肢'],
    ['points', '配点'], ['rubric_id', '採点の観点'], ['question_id', '問題番号'], ['enabled', '掲載']
  ];
  var out = String(message);
  names.forEach(function (n) { out = out.split(n[0]).join(n[1]); });
  return out.replace('Questionsシート', '試験作成シート').replace('Questions.points', '配点');
}

if (typeof module !== 'undefined') {
  module.exports = {
    AUTHORING_HEADERS: AUTHORING_HEADERS, toTeacherMessage: toTeacherMessage, assignQuestionIds: assignQuestionIds,
    toQuestionRows: toQuestionRows, fromQuestionRows: fromQuestionRows
  };
}
