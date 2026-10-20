# Google Forms AI Grader

教師がスプレッドシートだけを操作して、Googleフォーム試験の生成から採点までを完了させる仕組み。

## Language

**教師**:
スプレッドシートを操作して試験を作り、結果を確認する人。
_Avoid_: ユーザー, 管理者

**導入担当者**:
GitHub・clasp・Apps Script・APIキーの初期設定だけを行う人。
_Avoid_: 開発者, 管理者

**問題**:
Questionsシートの1行。question_id で一意に識別される。
_Avoid_: 設問, 質問

**question_id**:
問題を結びつける固定ID。問題文を変えても変えない。
_Avoid_: 問題番号, タイトル

**採点方式**:
問題ごとの採点の担い手。AUTO・LLM・MANUAL の3つ。
_Avoid_: 採点モード

**AUTO**:
ルールだけで機械的に採点する方式（NATIVE・EXACT・ANY_OF・CONTAINS・NUMBER）。
_Avoid_: 自動

**LLM採点**:
記述式をルーブリックに沿ってLLMが採点する方式。
_Avoid_: AI採点

**MANUAL**:
教師がResultsにmanual_scoreを入力して採点する方式。

**ルーブリック**:
LLM採点の評価基準の集まり。rubric_id と rubric_version で識別する。
_Avoid_: 採点基準表

**フォーム版**:
生成されたGoogleフォームの世代（form_version）。回答済みのフォームは変更せず、新しい版を作る。
_Avoid_: バージョン

**回答**:
学生がフォームを1回送信したもの（response_id で識別）。
_Avoid_: 提出, 答案

**採点待ち行列（Queue）**:
送信された回答を採点順に待たせておく内部の列。
_Avoid_: ジョブ一覧

**確定（FINALIZED）**:
回答内の全問題の点数が確定した状態。要確認・手動採点が残る間は確定しない。

**要確認（REVIEW_REQUIRED）**:
LLM採点が低信頼度・失敗などで、教師の確認が要る状態。
_Avoid_: 保留

**信頼度（confidence）**:
LLMが返す0〜1の自己評価。閾値未満は要確認になる。
