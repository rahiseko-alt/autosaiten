/**
 * シート名・見出し・初期設定。Spreadsheet schema（列の増減）はここだけで定義する。
 * 変更するときは docs/DESIGN_SPEC.md と合わせること。
 */

var SHEET_NAMES = {
  AUTHORING: '試験作成', RESULTS_VIEW: '結果',
  CONTROL: 'Control', QUESTIONS: 'Questions', RUBRICS: 'Rubrics', SETTINGS: 'Settings',
  RESULTS: 'Results', QUEUE: 'Queue', FORM_MAPPING: 'FormMapping', LOGS: 'Logs',
  ROSTER: '名簿', MATERIALS: '資料', ASSIGNMENTS: '割り当て'
};

/** 受付ページ（別の Apps Script プロジェクト、reception/）が読み書きするシートの見出し。 */
var ROSTER_HEADERS = ['クラス', 'No.', '氏名', '呼び名'];
var MATERIAL_HEADERS = ['資料番号', '本文', '家賃', '貯金額', '必要額', '不足額', '必要日数', '開始期限'];
var ASSIGNMENT_HEADERS = ['クラス', '氏名', '資料番号', '受付日時'];

var INTERNAL_SHEETS = [SHEET_NAMES.QUEUE, SHEET_NAMES.FORM_MAPPING, SHEET_NAMES.LOGS];

/** 先生には見せない裏方のシート（ADR 0007）。 */
var BACKEND_SHEETS = [SHEET_NAMES.CONTROL, SHEET_NAMES.QUESTIONS, SHEET_NAMES.RUBRICS, SHEET_NAMES.SETTINGS,
  SHEET_NAMES.RESULTS, SHEET_NAMES.QUEUE, SHEET_NAMES.FORM_MAPPING, SHEET_NAMES.LOGS];

/** 試験作成シートの上部のセル。表は AUTHORING_HEADER_ROW 行目が見出し。 */
var AUTHORING_CELLS = {
  OK: 'B2', STATUS: 'B3', MESSAGE: 'B4', FORM_URL: 'B5', TOTAL_POINTS: 'B6',
  FORM_TITLE: 'B7', FORM_DESCRIPTION: 'B8'
};
var AUTHORING_LABELS = [
  ['試験作成', ''], ['これでOK', false], ['状態', '待機中'],
  ['メッセージ', '下の表に問題を書いてから、「これでOK」にチェックしてください'],
  ['フォームURL（学生に配る）', ''], ['合計点', ''], ['フォームのタイトル', ''], ['フォームの説明', '']
];
var AUTHORING_HEADER_ROW = 10;
/**
 * 試験作成シートの上部の E・F 列。授業外の上限点と、クラスごとの授業の終わる日時の表（ADR 0013）。
 * 「これでOK」のとき Settings の LATE_CAP と CLASS_END_<クラス> の行へ写す。定義の指紋には入れない。
 */
var AUTHORING_LATE = { LABEL_COL: 5, VALUE_COL: 6, CAP_ROW: 1, CLASS_HEADER_ROW: 3, CLASS_FIRST_ROW: 4, CLASS_LAST_ROW: 9 };
var LATE_CAP_KEY = 'LATE_CAP';
var CLASS_END_KEY_PREFIX = 'CLASS_END_';
/**
 * 保管の印（集計表の「保管する」が Settings に行を足す）と、テスト側がトリガーを外した印（日時）。
 * どちらも行を足すだけで、Settings の列は変えない。
 */
var ARCHIVED_KEY = 'ARCHIVED';
var TRIGGERS_REMOVED_KEY = 'TRIGGERS_REMOVED';
var ARCHIVED_MESSAGE = 'このテストは保管済みです。フォームの作成・更新はできません';
var AUTHORING_STATUS_LABELS = { IDLE: '待機中', VALIDATING: '確認中', BUILDING: 'フォーム作成中', READY: '準備完了', ERROR: 'エラー' };

var SHEET_HEADERS = {
  Questions: ['enabled', 'question_id', 'section', 'question_text', 'question_type', 'required', 'points',
    'grading_mode', 'auto_rule', 'correct_answer', 'alternatives', 'tolerance', 'options', 'rubric_id',
    'feedback_correct', 'feedback_incorrect', 'notes'],
  Rubrics: ['rubric_id', 'rubric_version', 'criterion_id', 'criterion', 'max_points', 'description', 'required', 'notes'],
  Settings: ['key', 'value', '説明'],
  Results: ['response_id', 'form_version', 'submitted_at', 'respondent_email', 'question_id', 'question_text_snapshot',
    'answer', 'grading_mode', 'auto_score', 'llm_score', 'manual_score', 'final_score', 'max_score', 'status',
    'confidence', 'grading_reason', 'provider', 'model', 'prompt_version', 'rubric_id', 'rubric_version', 'graded_at',
    'respondent_name', 'respondent_class'],
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
  ['COLLECT_EMAIL', true, '回答者のアカウント（メールアドレス）を集める。Classroom へ返すときの照合に使う'],
  ['FORM_TITLE', 'AIビジネス専門学校 テスト', 'タイトル'],
  ['FORM_DESCRIPTION', '', '説明'],
  ['PROMPT_VERSION', 1, '採点プロンプト版'],
  ['LIMIT_ONE_RESPONSE', true, '1人1回の回答に制限する（学生は Google ログインが必要）']
];

/** フォーム先頭の氏名欄。FormMapping ではこの番号で記録し、採点の対象にはしない。 */
var NAME_QUESTION_ID = '__NAME__';
var NAME_ITEM_TITLE = '氏名（Name）';
/** 氏名欄の次のクラス欄。氏名欄と同じく採点の対象にしない。 */
var CLASS_QUESTION_ID = '__CLASS__';
/**
 * 問題の項目のあとの、最後の採点結果の欄。合計点と講評の受け皿で、採点の対象にしない（ADR 0013）。
 * 回答の無い項目には点を書き込めないので必須にする。
 */
var RESULT_QUESTION_ID = '__RESULT__';
var RESULT_ITEM_TITLE = '採点結果（「確認しました」を選んでください）';
var RESULT_ITEM_CHOICE = '確認しました';
var RESULT_ITEM_HELP = '返却のとき、ここに合計点と講評が表示されます';

var QUESTION_TYPES = ['SHORT_TEXT', 'PARAGRAPH', 'MULTIPLE_CHOICE', 'CHECKBOX', 'DROPDOWN', 'INFO'];
var GRADING_MODES = ['AUTO', 'LLM', 'MANUAL', 'NONE'];
var AUTO_RULES = ['NATIVE', 'EXACT', 'ANY_OF', 'CONTAINS', 'NUMBER'];
var LLM_PROVIDERS = ['OPENAI', 'ANTHROPIC', 'GEMINI'];
