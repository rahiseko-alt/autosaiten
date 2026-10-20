/**
 * 1つの回答を採点して Results の行にする。Apps Script の API には依存しない。
 * AUTO・LLM・MANUAL の振り分け、確定判定、再採点時の結果の統合をここで行う。
 */

function rgFn_(name, file) {
  return (typeof globalThis[name] === 'function') ? globalThis[name] : require(file)[name];
}

function rgIsBlank_(v) {
  return v === undefined || v === null || String(v).trim() === '';
}

function rgText_(answer) {
  if (answer === undefined || answer === null) return '';
  return Array.isArray(answer) ? answer.join('||') : String(answer);
}

/** 同じ rubric_id の最大の rubric_version の基準を返す。無ければ null。 */
function latestRubricCriteria(rubrics, rubricId) {
  var rows = rubrics.filter(function (r) { return String(r.rubric_id).trim() === String(rubricId).trim(); });
  if (rows.length === 0) return null;
  var latest = Math.max.apply(null, rows.map(function (r) { return Number(r.rubric_version); }));
  return {
    version: latest,
    criteria: rows.filter(function (r) { return Number(r.rubric_version) === latest; })
  };
}

function rgBaseRow_(response, q, settings, now) {
  return {
    response_id: response.response_id, form_version: response.form_version, submitted_at: response.submitted_at,
    respondent_email: (settings.COLLECT_EMAIL === true || String(settings.COLLECT_EMAIL).toUpperCase() === 'TRUE') ? (response.respondent_email || '') : '',
    question_id: q.question_id, question_text_snapshot: q.question_text,
    answer: rgText_(response.answers[q.question_id]), grading_mode: q.grading_mode,
    auto_score: '', llm_score: '', manual_score: '', final_score: '', max_score: Number(q.points) || 0,
    status: '', confidence: '', grading_reason: '', provider: '', model: '', prompt_version: '',
    rubric_id: '', rubric_version: '', graded_at: now
  };
}

function rgFinish_(row) {
  var resolve = rgFn_('resolveFinalScore', './Scoring.js');
  var r = resolve(row);
  row.final_score = r.final_score === null ? '' : r.final_score;
  return row;
}

/**
 * @param {{response: Object, questions: Object[], rubrics: Object[], settings: Object,
 *   provider: {gradeBatch: function}, now: Date, deps?: Object}} input
 * @return {{rows: Object[], finalized: boolean}}
 */
function gradeResponse(input) {
  var gradeAuto_ = rgFn_('gradeAuto', './AutoGrader.js');
  var gradeLlmBatch_ = rgFn_('gradeLlmBatch', './LLMGrader.js');
  var isFinalized = rgFn_('isResponseFinalized', './Scoring.js');
  var settings = input.settings;
  var questions = input.questions.filter(function (q) {
    return q.enabled === true || String(q.enabled).trim().toUpperCase() === 'TRUE';
  });

  var rows = questions.map(function (q) {
    var row = rgBaseRow_(input.response, q, settings, input.now);
    var answer = input.response.answers[q.question_id];
    var unanswered = rgIsBlank_(Array.isArray(answer) ? answer.join('') : answer);
    if (unanswered) {
      row.status = 'UNANSWERED';
      row.grading_reason = '未回答';
    } else if (q.grading_mode === 'AUTO') {
      var g = gradeAuto_(q, answer);
      row.auto_score = g.score;
      row.status = g.status;
    } else if (q.grading_mode === 'MANUAL') {
      row.status = 'MANUAL_PENDING';
    }
    return row;
  });

  var llmItems = [];
  var llmRows = {};
  questions.forEach(function (q, i) {
    var row = rows[i];
    if (q.grading_mode !== 'LLM' || row.status === 'UNANSWERED') return;
    row.provider = settings.LLM_PROVIDER;
    row.model = settings.LLM_MODEL;
    row.prompt_version = settings.PROMPT_VERSION;
    var rubric = rgIsBlank_(q.rubric_id) ? null : latestRubricCriteria(input.rubrics, q.rubric_id);
    if (!rubric) {
      row.status = 'REVIEW_REQUIRED';
      row.grading_reason = 'ルーブリックが見つかりません';
      return;
    }
    row.rubric_id = q.rubric_id;
    row.rubric_version = rubric.version;
    llmRows[q.question_id] = row;
    llmItems.push({
      question_id: q.question_id, question_text: q.question_text, max_points: Number(q.points),
      rubric_id: q.rubric_id, rubric_version: rubric.version, criteria: rubric.criteria,
      answer: rgText_(input.response.answers[q.question_id])
    });
  });

  if (llmItems.length > 0) {
    gradeLlmBatch_(input.provider, llmItems, settings, input.deps).forEach(function (res) {
      var row = llmRows[res.question_id];
      row.status = res.status;
      row.llm_score = res.llm_score === null ? '' : res.llm_score;
      row.confidence = res.confidence === null ? '' : res.confidence;
      row.grading_reason = res.reason;
    });
  }

  rows.forEach(rgFinish_);
  return { rows: rows, finalized: isFinalized(rows) };
}

/**
 * 再採点の結果を既存の行と統合する。教師が入れた manual_score は守る。
 * @return {{row: Object, existed: boolean}[]}
 */
function mergeResults(existing, fresh) {
  var byKey = {};
  existing.forEach(function (r) { byKey[r.response_id + '\u0000' + r.question_id] = r; });
  return fresh.map(function (row) {
    var old = byKey[row.response_id + '\u0000' + row.question_id];
    if (old && !rgIsBlank_(old.manual_score)) {
      row.manual_score = old.manual_score;
      rgFinish_(row);
    }
    return { row: row, existed: !!old };
  });
}

if (typeof module !== 'undefined') {
  module.exports = { gradeResponse: gradeResponse, mergeResults: mergeResults, latestRubricCriteria: latestRubricCriteria };
}
