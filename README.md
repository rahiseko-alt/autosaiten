# Google Forms AI Grader

教師がスプレッドシートだけを操作して、Googleフォーム試験の生成から採点までを行う仕組みです。
仕様は `docs/DESIGN_SPEC.md`（変更は `docs/DESIGN_ADDENDUM.md` を優先）、用語は `CONTEXT.md`、決定の理由は `docs/adr/` にあります。

- テスト: `npm test`（Google の環境は不要。依存パッケージなし）。純粋ロジックの単体テストに加え、`tests/gasFlow.test.js` が偽の Google（メモリ上のシート・フォーム）で、セットアップから採点・書き戻しまでを通しで動かします。これは実環境の代わりにはなりません
- 実際の Google 環境での確認は、2026-10-20 に一部だけ行いました（セットアップ、フォーム生成、AUTO 採点、MANUAL の確定と書き戻し）。LLM による採点は、API キーが無いため未確認です。下の **【未確認】** の項目を、導入担当者が確認してください

## 教師の使い方（導入後）

1. Questions シートに問題を入力する（採点方式は AUTO / LLM / MANUAL から選ぶ）
2. LLM で採点する問題は、Rubrics シートに採点基準を入力する（基準の点数合計が配点と一致すること）
3. Control の「これでOK」にチェックする。不備があれば MESSAGE に全件が日本語で出る
4. 配る前に、フォームの設定で成績の公開を「後で」にする（送信直後に公開すると、未採点の記述式が 0 点に見えるため）。READY になったら FORM_URL を学生に配る
5. 採点は自動で進む（約1分ごと）。Results で結果を見る。`REVIEW_REQUIRED` は教師の確認待ち
6. 確認が要る問題や MANUAL の問題は、Results の `manual_score` に点を入れ、メニュー「AI Grader > Manual採点を反映」を実行する

困ったときは、メニュー「AI Grader > システム診断」で状態を Control の MESSAGE に表示できます。

## 導入手順（導入担当者向け）

1. 空のスプレッドシートを作り、「拡張機能 > Apps Script」を開いて、プロジェクトの設定からスクリプトIDを控える
2. このリポジトリで `npm install -g @google/clasp`、`clasp login`、`cp .clasp.json.example .clasp.json`（スクリプトIDを書く）、`clasp push`
3. スプレッドシートを開き直し、メニュー「AI Grader > 初期セットアップ」を実行して権限を許可する
4. LLM 採点を使うなら、次の「LLM 採点の準備」をする

Apps Script エディタでコードを直接直さないでください（正本は GitHub です。これは運用上の約束で、技術的に強制されてはいません）。

### LLM 採点の準備

1. Anthropic で**この仕組み専用の API キー**を作り、提供元の画面で月額の上限を設ける
2. Apps Script の「プロジェクトの設定 > スクリプト プロパティ」に `ANTHROPIC_API_KEY` として登録する（シートやリポジトリには書かない）
3. Settings シートの `LLM_MODEL` に使うモデル名を入れる
4. Apps Script エディタで `diagnoseAnthropic` を選んで実行し、「接続に成功しました」と出ることを確かめる

注意:

- シートの編集者は Apps Script も開けるため、キーを読める可能性があります。シートの編集権限は必要な教員だけに限ってください
- `appsscript.json` の `urlFetchWhitelist` で、通信先を `https://api.anthropic.com/` だけに限っています。他社の提供元を足すときは、ここへの追加が必要です

## 確認項目（すべて【未確認】）

確認できたら印を外してください。

初期セットアップと「これでOK」:

- 【確認済み 2026-10-20】初期セットアップで8シートができ、何度実行してもトリガーが2本（編集時・1分ごと）のまま増えない
- 【確認済み 2026-10-20】Questions に不備があるとき、Control の MESSAGE に全件が日本語で出て STATUS が ERROR になる
- 【確認済み 2026-10-20】不備が無いとき、Control の集計（問題数・合計点・AUTO/LLM/MANUAL）が出る

フォーム生成:

- 【確認済み 2026-10-20】「これでOK」で Google フォーム（クイズ）ができ、Control に FORM_URL・EDIT_URL・FORM_VERSION が出る
- 【未確認】5種類の問題タイプ・必須・配点・選択式の正答がフォームに反映される。フィードバックは問題タイプによっては付かない可能性がある
- 【未確認】何も変えずにもう一度「これでOK」を押しても、新しいフォームや版ができない
- 【未確認】回答が1件ある状態で問題を変えて「これでOK」を押すと、新しい版ができ、旧フォームの受付が止まる
- 【確認済み 2026-10-20】FormMapping に question_id とフォーム項目IDの対応が入る
- 【未確認】成績の公開タイミング（送信直後か後か）を Apps Script から設定できるか。できなければ運用で補う
- 【未確認】回答先に「フォームの回答 N」シートが版ごとに増える（扱いを決める）

採点:

- 【確認済み 2026-10-20】学生が送信すると、1分以内に Queue に job が1件できる（同じ回答で増えない）
- 【確認済み 2026-10-20】AUTO の問題が採点され、Results に「回答×問題」で1行ずつ入る
- 【未確認】回答に `=1+1` のような文字を入れても、Results では文字のまま表示される
- 【確認済み 2026-10-20】MANUAL の問題が残る回答は、Queue が REVIEW_REQUIRED のままになる
- 【未確認】「Queueを今すぐ処理」を連続で押しても二重に採点されない
- 【未確認】`diagnoseAnthropic` が成功する
- 【未確認】LLM の問題が採点され、Results に提供元・モデル・版・理由・信頼度が入る
- 【確認済み 2026-10-20】通信が失敗した問題は REVIEW_REQUIRED になり、0点にならない（キー未設定の失敗で、再試行になり0点にならないことを確認。最終的な要確認への切り替えは未確認）
- 【未確認】60人規模の同時送信で、実行時間やUrlFetchの1日の上限に収まる
- 【未確認】信頼度の閾値 0.80 で、要確認がどの程度出るか（実際の答案で確かめる）

フォームへの書き戻しと確定:

- 【確認済み 2026-10-20】全問が確定した回答だけ、フォームの採点結果に点数が反映される（MANUAL・要確認が残る回答は反映されない）（フォームの回答一覧で、記述式を手動採点した回答の合計が 13/20 になることを確認。Q001 のような短答の点は、書き戻しでしか付かない）
- 【確認済み 2026-10-20】`manual_score` に点を入れて「Manual採点を反映」を実行すると、その回答が確定してフォームへ反映される
- 【確認済み 2026-10-20】反映によって Queue に新しい job が増えない
- 【未確認】Results の行を選んで「選択回答を再採点」を実行すると、行が更新され（増えない）、入力済みの `manual_score` は残る

運用:

- 【未確認】システム診断が Control に結果を出す
- 【未確認】Logs に API キーや認可ヘッダが出ていない

## 既知の制約

- 回答が残っている旧版の採点が終わるまでは、Questions の配点・正答を大きく変えないでください（採点は現在の Questions を使います）
- 回答後の編集は許可していません（フォームの設定）
- 部分点は v1 にありません（チェックボックスは全部合えば満点、それ以外は0点）
- LLM 提供元は Anthropic のみ実装済みです（OpenAI・Gemini は未実装。選ぶと設定の確認でエラーになります）
- LLM の点数は整数のみです
- correct_answer やルーブリックを変えても、フォームの版は上がりません。回答が残っている間は変更しないでください
- 1分ごとのトリガーは試験時間外も動きます。実行時間の1日の上限に注意してください【未確認】

---

# Matt2

Claude Code で開発を進めるための**テンプレート**です。ここから複製して、新しいプロジェクトを始めます。
製品のコードは入っていません。入っているのは「進め方の仕組み」だけです。

## 複製したら最初にすること

会話を開いて、そのまま話しかけてください。何も打たなくても、AI が
「前回の続き・いまの状態・最初の一手」を報告します。

そのうえで、次の1つだけ打てば始まります。

```
/grill-with-docs
```

AI が質問を重ねて、作りたいものの曖昧な部分を潰します。答えるだけで構いません。
決まった用語は `CONTEXT.md` に、重要な判断の理由は `docs/adr/` に書き残されるので、
次の会話にも引き継がれます。

相談が済んだら、次を打てば残りは任せられます。

```
/conduct
```

計画書づくりから実装・確認・修正までを、役割表（`.claude/router/roles.txt`）に従って
Claude・GPT（Codex）・Gemini に振り分けて進めます。あなたが関わるのは、途中確認と最終確認で
GO / NG を返すときだけです。3社の道具を使うには、先に一度だけ
[Windows での初回準備](docs/setup-windows.md) を済ませてください（済ませていなくても、Claude だけで進みます）。

複製した直後の最初の会話では、ひな型自身の作業日誌が自動で片づき、引き継ぎメモが白紙になります。

その後、この `README.md` の冒頭をプロジェクトの説明に書き換えてください。

## 覚えるのはこの3つだけ

| 打つもの | 何が起きるか |
| --- | --- |
| `s` | 前回の続き・いまの状態・最初の一手を報告します（開始時は自動でも出ます） |
| `f` | 環境を破棄しても大丈夫な状態まで片づけ、終了して良いかを報告します |
| `/next-step` | いまどこにいて、次に何を打てばいいかを1つだけ提示します |

コマンドを覚える必要はありません。「〇〇を作りたい」と伝えるだけでも、実装前に自動で案内が入ります。

## 入っているもの

- `.claude/skills/` に [mattpocock/skills](https://github.com/mattpocock/skills) を 12 個インストール
  （`npx skills add mattpocock/skills`、`skills-lock.json` でバージョン固定）
  - ユーザー起動（このうち案内で使うもの）: `grill-with-docs` / `to-spec` / `to-tickets` / `implement` / `improve-codebase-architecture` / `setup-matt-pocock-skills`
  - モデル起動: `grilling` / `domain-modeling` / `codebase-design` / `tdd` / `code-review`
- `.claude/skills/s/`, `.claude/skills/f/`, `.claude/skills/next-step/`: この置き場所独自の案内役と儀式
- `.claude/skills/conduct/`: 指揮の案内役。相談の後の全段階を、役割表に従って3社の道具に振り分けて進める
- `.claude/router/`: 振り分け役（`route.sh`）と役割表（`roles.txt`）。モデルの乗り換えは役割表の書き換えだけで行う
- `.claude/hooks/template-cleanup.sh`: 片づけ役。複製先の最初の会話で、ひな型の作業日誌を片づける
- `.template/`: ひな型自身の記録（用語集・決めた理由など）。複製先では自動で消える
- `tests/`: 振り分け役と片づけ役の検査。直したときに `sh tests/route.test.sh` と `sh tests/template-cleanup.test.sh` を流す
- `docs/setup-windows.md`: Windows での初回準備の手引き
- `.claude/settings.json`: 会話開始時に `docs/agents/flow-map.md` を読み込む仕組み
- `docs/agents/flow-map.md`: 進め方と、説明の書き方のルール
- `docs/agents/handover.md`: 会話をまたぐ引き継ぎメモ。区切りごとに自動で追記されます
- `AGENTS.md`: 開発フローの全体像
- `docs/agents/issue-tracker.md`: 作業指示書の置き場所は GitHub Issues
- `docs/agents/domain.md`: 用語集は `CONTEXT.md`、判断の記録は `docs/adr/`

## フロー全体

- 新規開発・機能追加: `/grill-with-docs` → `/conduct`（あとは途中確認と最終確認で GO / NG を返すだけ）
- 手で1段ずつ進める場合: `/grill-with-docs` → 必要に応じて `/to-spec` → `/to-tickets` → `/implement`
- 設計改善: `/improve-codebase-architecture` → 候補を選択 → `/grill-with-docs` または `/codebase-design` → 以下同じ

`/implement` は `/tdd` で RED → GREEN を繰り返し、最後に `/code-review` を実行します。
詳細は [AGENTS.md](./AGENTS.md) の「Development flow」を参照してください。

## スキルの更新

```bash
npx skills update
```

スキル本体は本家のまま使う方針のため、ローカルで書き換えないでください。
