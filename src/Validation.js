/**
 * Questions・Rubrics・Settings の内容を検証し、教師向けの日本語メッセージを全件返す。
 * Apps Script の API には依存しない。
 */

var VALIDATION_QUESTION_TYPES_ = ['SHORT_TEXT', 'PARAGRAPH', 'MULTIPLE_CHOICE', 'CHECKBOX', 'DROPDOWN'];
var VALIDATION_GRADING_MODES_ = ['AUTO', 'LLM', 'MANUAL'];
var VALIDATION_AUTO_RULES_ = ['NATIVE', 'EXACT', 'ANY_OF', 'CONTAINS', 'NUMBER'];
var VALIDATION_CHOICE_TYPES_ = ['MULTIPLE_CHOICE', 'CHECKBOX', 'DROPDOWN'];
var VALIDATION_PROVIDERS_ = ['OPENAI', 'ANTHROPIC', 'GEMINI'];

function validationSplit_(value) {
  var list = (typeof splitList === 'function') ? splitList : require('./Utils.js').splitList;
  return list(value);
}

function vIsBlank_(value) {
  return value === undefined || value === null || String(value).trim() === '';
}

function vIsTrue_(value) {
  return value === true || String(value).trim().toUpperCase() === 'TRUE';
}

function vIsNumeric_(value) {
  return !vIsBlank_(value) && isFinite(Number(value));
}

function vIsNonNegInt_(value) {
  return vIsNumeric_(value) && Number(value) >= 0 && Number(value) % 1 === 0;
}

/**
 * @param {{questions: Object[], rubrics: Object[], settings: Object}} config
 *   各行は見出し名をキーにしたオブジェクト。settings は key -> value。
 * @return {string[]} エラーメッセージ。空配列なら問題なし。
 */
function validateConfiguration(config) {
  var errors = [];
  var questions = (config.questions || []).filter(function (row) { return vIsTrue_(row.enabled); });
  var rubrics = config.rubrics || [];
  var settings = config.settings || {};

  if (questions.length === 0) {
    errors.push('ERROR: 有効な問題がありません。Questionsシートで enabled を TRUE にした問題を入力してください。');
  }

  var seen = {};
  var hasLlm = false;
  questions.forEach(function (row, index) {
    var label = vIsBlank_(row.question_id) ? ('Questionsの' + (index + 1) + '番目の有効な問題') : String(row.question_id);
    var type = String(row.question_type || '').trim();
    var mode = String(row.grading_mode || '').trim();
    var rule = String(row.auto_rule || '').trim();

    if (vIsBlank_(row.question_id)) {
      errors.push('ERROR: ' + label + ' question_idが未設定です。');
    } else if (seen[row.question_id]) {
      errors.push('ERROR: ' + label + ' question_idが重複しています。');
    }
    seen[row.question_id] = true;

    if (vIsBlank_(row.question_text)) errors.push('ERROR: ' + label + ' question_textが未設定です。');
    if (VALIDATION_QUESTION_TYPES_.indexOf(type) < 0) {
      errors.push('ERROR: ' + label + ' question_typeが不正です（' + VALIDATION_QUESTION_TYPES_.join('/') + ' から選んでください）。');
    }
    if (VALIDATION_GRADING_MODES_.indexOf(mode) < 0) {
      errors.push('ERROR: ' + label + ' grading_modeが不正です（AUTO/LLM/MANUAL から選んでください）。');
    }
    if (!vIsNonNegInt_(row.points)) {
      errors.push('ERROR: ' + label + ' pointsは0以上の整数で入力してください。');
    }

    var isChoice = VALIDATION_CHOICE_TYPES_.indexOf(type) >= 0;
    var options = validationSplit_(row.options);
    if (isChoice && options.length === 0) {
      errors.push('ERROR: ' + label + ' ' + type + 'なのにoptionsがありません。');
    }

    if (mode === 'AUTO') {
      if (VALIDATION_AUTO_RULES_.indexOf(rule) < 0) {
        errors.push('ERROR: ' + label + ' AUTOなのにauto_ruleが未設定または不正です。');
      }
      if (vIsBlank_(row.correct_answer)) {
        errors.push('ERROR: ' + label + ' AUTOなのにcorrect_answerが未設定です。');
      } else {
        if (rule === 'NATIVE' && !isChoice) {
          errors.push('ERROR: ' + label + ' NATIVEは選択式（MULTIPLE_CHOICE/CHECKBOX/DROPDOWN）の問題でだけ使えます。');
        }
        if (isChoice && options.length > 0) {
          var answers = type === 'CHECKBOX' ? validationSplit_(row.correct_answer) : [String(row.correct_answer).trim()];
          answers.forEach(function (a) {
            if (options.indexOf(a) < 0) {
              errors.push('ERROR: ' + label + ' correct_answer「' + a + '」がoptionsにありません。');
            }
          });
        }
        if (rule === 'NUMBER') {
          if (!vIsNumeric_(row.correct_answer)) {
            errors.push('ERROR: ' + label + ' NUMBERなのにcorrect_answerが数値ではありません。');
          }
          if (!vIsBlank_(row.tolerance) && !(vIsNumeric_(row.tolerance) && Number(row.tolerance) >= 0)) {
            errors.push('ERROR: ' + label + ' toleranceは0以上の数値で入力してください。');
          }
        }
      }
    }

    if (mode === 'LLM') {
      hasLlm = true;
      if (vIsBlank_(row.rubric_id)) {
        errors.push('ERROR: ' + label + ' rubric_idが未設定です。');
      } else {
        var versions = vRubricLatest_(rubrics, row.rubric_id);
        if (!versions) {
          errors.push('ERROR: ' + label + ' のルーブリック ' + row.rubric_id + ' がRubricsシートに見つかりません。');
        } else if (vIsNonNegInt_(row.points) && versions.total !== Number(row.points)) {
          errors.push('ERROR: ' + row.rubric_id + ' rubric点合計' + versions.total + '点 != Questions.points ' + Number(row.points) + '点（' + label + '）');
        }
      }
    }
  });

  vValidateSettings_(settings, hasLlm, errors);
  return errors;
}

/** 同じ rubric_id の最大の rubric_version の基準点を合計する。無ければ null。 */
function vRubricLatest_(rubrics, rubricId) {
  var rows = rubrics.filter(function (r) { return String(r.rubric_id).trim() === String(rubricId).trim(); });
  if (rows.length === 0) return null;
  var latest = Math.max.apply(null, rows.map(function (r) { return Number(r.rubric_version); }));
  var total = 0;
  rows.forEach(function (r) {
    if (Number(r.rubric_version) === latest) total += Number(r.max_points) || 0;
  });
  return { version: latest, total: total };
}

function vValidateSettings_(settings, hasLlm, errors) {
  if (VALIDATION_PROVIDERS_.indexOf(String(settings.LLM_PROVIDER || '').trim()) < 0) {
    errors.push('ERROR: Settings LLM_PROVIDERが不正です（OPENAI/ANTHROPIC/GEMINI から選んでください）。');
  }
  if (hasLlm && vIsBlank_(settings.LLM_MODEL)) {
    errors.push('ERROR: Settings LLM_MODELが未設定です（LLMで採点する問題があります）。');
  }
  var threshold = settings.LLM_CONFIDENCE_THRESHOLD;
  if (!vIsNumeric_(threshold) || Number(threshold) < 0 || Number(threshold) > 1) {
    errors.push('ERROR: Settings LLM_CONFIDENCE_THRESHOLDは0〜1の数値で入力してください。');
  }
  ['LLM_BATCH_SIZE', 'WORKER_BATCH_SIZE'].forEach(function (key) {
    if (!vIsNonNegInt_(settings[key]) || Number(settings[key]) < 1) {
      errors.push('ERROR: Settings ' + key + 'は1以上の整数で入力してください。');
    }
  });
  if (!vIsNonNegInt_(settings.LLM_MAX_RETRIES)) {
    errors.push('ERROR: Settings LLM_MAX_RETRIESは0以上の整数で入力してください。');
  }
}

if (typeof module !== 'undefined') {
  module.exports = { validateConfiguration: validateConfiguration, vRubricLatest_: vRubricLatest_ };
}
