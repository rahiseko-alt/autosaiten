/**
 * シート名・見出し・初期設定。Spreadsheet schema（列の増減）はここだけで定義する。
 * 変更するときは docs/DESIGN_SPEC.md と合わせること。
 */

var SHEET_NAMES = {
  CONTROL: 'Control', QUESTIONS: 'Questions', RUBRICS: 'Rubrics', SETTINGS: 'Settings',
  RESULTS: 'Results', QUEUE: 'Queue', FORM_MAPPING: 'FormMapping', LOGS: 'Logs'
};

var INTERNAL_SHEETS = [SHEET_NAMES.QUEUE, SHEET_NAMES.FORM_MAPPING, SHEET_NAMES.LOGS];

var SHEET_HEADERS = {
  Questions: ['enabled', 'question_id', 'section', 'question_text', 'question_type', 'required', 'points',
    'grading_mode', 'auto_rule', 'correct_answer', 'alternatives', 'tolerance', 'options', 'rubric_id',
    'feedback_correct', 'feedback_incorrect', 'notes'],
  Rubrics: ['rubric_id', 'rubric_version', 'criterion_id', 'criterion', 'max_points', 'description', 'required', 'notes'],
  Settings: ['key', 'value', '説明'],
  Results: ['response_id', 'form_version', 'submitted_at', 'respondent_email', 'question_id', 'question_text_snapshot',
    'answer', 'grading_mode', 'auto_score', 'llm_score', 'manual_score', 'final_score', 'max_score', 'status',
    'confidence', 'grading_reason', 'provider', 'model', 'prompt_version', 'rubric_id', 'rubric_version', 'graded_at'],
  Queue: ['job_id', 'response_id', 'form_id', 'form_version', 'status', 'retry_count', 'next_run_at',
    'created_at', 'updated_at', 'last_error'],
  FormMapping: ['form_version', 'form_id', 'question_id', 'form_item_id', 'created_at'],
  Logs: ['timestamp', 'level', 'event', 'entity_id', 'message', 'details_json']
};

/** 必ず埋める列（見出しを黄色にする）。 */
var REQUIRED_HEADERS = {
  Questions: ['enabled', 'question_id', 'question_text', 'question_type', 'required', 'points', 'grading_mode'],
  Rubrics: ['rubric_id', 'rubric_version', 'criterion_id', 'criterion', 'max_points']
};

/** 条件つきで埋める列（見出しを薄い橙にし、条件をメモで示す）。 */
var CONDITIONAL_HEADERS = {
  Questions: {
    auto_rule: 'AUTO のとき必須',
    correct_answer: 'AUTO のとき必須（CHECKBOX は || 区切り、CONTAINS はキーワードを || 区切り）',
    options: '選択式（MULTIPLE_CHOICE・CHECKBOX・DROPDOWN）のとき必須。|| 区切り',
    rubric_id: 'LLM のとき必須（MANUAL では任意。採点の基準として使う）'
  }
};

var CONTROL_CELLS = {
  OK: 'B2', STATUS: 'B4', MESSAGE: 'B5', FORM_URL: 'B6', EDIT_URL: 'B7', FORM_VERSION: 'B8',
  LAST_BUILD: 'B9', TOTAL_QUESTIONS: 'B10', TOTAL_POINTS: 'B11', AUTO_POINTS: 'B12',
  LLM_POINTS: 'B13', MANUAL_POINTS: 'B14'
};

var CONTROL_LABELS = [
  ['試験設定', ''], ['これでOK', false], ['', ''], ['STATUS', 'IDLE'], ['MESSAGE', ''], ['FORM_URL', ''],
  ['EDIT_URL', ''], ['FORM_VERSION', ''], ['LAST_BUILD', ''], ['TOTAL_QUESTIONS', ''], ['TOTAL_POINTS', ''],
  ['AUTO_POINTS', ''], ['LLM_POINTS', ''], ['MANUAL_POINTS', '']
];

var DEFAULT_SETTINGS = [
  ['LLM_PROVIDER', 'ANTHROPIC', 'OPENAI/ANTHROPIC/GEMINI'],
  ['LLM_MODEL', '', '使用モデル'],
  ['LLM_CONFIDENCE_THRESHOLD', 0.8, '要確認閾値'],
  ['LLM_BATCH_SIZE', 10, '1回の最大問題数'],
  ['LLM_MAX_RETRIES', 2, 'API再試行'],
  ['WORKER_BATCH_SIZE', 5, '1回に処理する回答数'],
  ['AUTO_CLOSE_OLD_FORM', true, '新版作成時に旧フォームを閉じる'],
  ['COLLECT_EMAIL', false, 'Forms設定'],
  ['FORM_TITLE', 'AIビジネス専門学校 テスト', 'タイトル'],
  ['FORM_DESCRIPTION', '', '説明'],
  ['PROMPT_VERSION', 1, '採点プロンプト版']
];

var QUESTION_TYPES = ['SHORT_TEXT', 'PARAGRAPH', 'MULTIPLE_CHOICE', 'CHECKBOX', 'DROPDOWN'];
var GRADING_MODES = ['AUTO', 'LLM', 'MANUAL'];
var AUTO_RULES = ['NATIVE', 'EXACT', 'ANY_OF', 'CONTAINS', 'NUMBER'];
var LLM_PROVIDERS = ['OPENAI', 'ANTHROPIC', 'GEMINI'];
