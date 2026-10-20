# Google Forms AI Grader

教師がスプレッドシートだけを操作して、Googleフォーム試験の生成から採点までを行う仕組みです。
仕様は `docs/DESIGN_SPEC.md`（変更は `docs/DESIGN_ADDENDUM.md`）、用語は `CONTEXT.md` にあります。

- テスト: `npm test`（純粋ロジックの単体テスト。Google の環境は不要）
- 配備と動作確認は下の「導入と動作確認」を参照

## 導入と動作確認（導入担当者向け）

実際の Google 環境での確認は、まだ誰も行っていません。下の各項目は **【未確認】** です。確認できたら印を外してください。

1. 空のスプレッドシートを作り、「拡張機能 > Apps Script」を開いて、プロジェクトの設定からスクリプトIDを控える
2. このリポジトリで `npm install -g @google/clasp`、`clasp login`、`cp .clasp.json.example .clasp.json`（スクリプトIDを書く）、`clasp push`
3. スプレッドシートを開き直し、メニュー「AI Grader > 初期セットアップ」を実行して権限を許可する
4. Questions に問題を入力し、Control の「これでOK」にチェックする

確認項目:

- 【未確認】初期セットアップで8シート（Control・Questions・Rubrics・Settings・Results・Queue・FormMapping・Logs）ができる
- 【未確認】何度実行しても、トリガーが2本（編集時・1分ごと）のまま増えない
- 【未確認】Questions に不備があるとき、Control の MESSAGE に全件が日本語で出て STATUS が ERROR になる
- 【未確認】不備が無いとき、Control の集計（問題数・合計点・AUTO/LLM/MANUAL）が出る
- 【未確認】「これでOK」で Google フォーム（クイズ）ができ、Control に FORM_URL・EDIT_URL・FORM_VERSION が出る
- 【未確認】5種類の問題タイプ・必須・配点・選択式の正答・フィードバックがフォームに反映される（フィードバックは問題タイプによっては付かない可能性がある）
- 【未確認】何も変えずにもう一度「これでOK」を押しても、新しいフォームや版ができない
- 【未確認】回答が1件ある状態で問題を変えて「これでOK」を押すと、新しい版ができ、旧フォームの受付が止まる
- 【未確認】FormMapping に question_id とフォーム項目IDの対応が入る
- 【未確認】学生が送信すると、1分以内に Queue に job が1件できる（同じ回答で増えない）
- 【未確認】選択式・ANY_OF など AUTO の問題が採点され、Results に「回答×問題」で1行ずつ入る
- 【未確認】回答に `=1+1` のような文字を入れても、Results では文字のまま表示される
- 【未確認】MANUAL の問題が残る回答は、Queue が REVIEW_REQUIRED のままになる
- 【未確認】「Queueを今すぐ処理」を連続で押しても二重に採点されない
- 【未確認】全問が確定した回答だけ、フォームの採点結果に点数が反映される（MANUAL・要確認が残る回答は反映されない）
- 【未確認】Results の manual_score に点を入れて「Manual採点を反映」を実行すると、その回答が確定してフォームへ反映される
- 【未確認】反映によって Queue に新しい job が増えない
- 【未確認】Results の行を選んで「選択回答を再採点」を実行すると、行が更新され（増えない）、入力済みの manual_score は残る
- 注意: 回答が残っている旧版の採点が終わるまでは、Questions の配点・正答を大きく変えないでください（採点は現在の Questions を使います）
- 【未確認】回答先のスプレッドシートに「フォームの回答 N」シートが増える（版ごとに増える）


### LLM 採点の準備（導入担当者向け）

1. Anthropic で**この仕組み専用の API キー**を作り、提供元の画面で月額の上限を設ける
2. Apps Script の「プロジェクトの設定 > スクリプト プロパティ」に `ANTHROPIC_API_KEY` として登録する（シートやリポジトリには書かない）
3. Settings シートの `LLM_MODEL` に使うモデル名を入れる
4. Apps Script エディタで `diagnoseAnthropic` を選んで実行し、「接続に成功しました」と出ることを確かめる

- 【未確認】`diagnoseAnthropic` が成功する
- 【未確認】LLM の問題が採点され、Results に提供元・モデル・版・理由・信頼度が入る
- 【未確認】通信が失敗した問題は REVIEW_REQUIRED になり、0点にならない
- 注意: `appsscript.json` の `urlFetchWhitelist` で、通信先を `https://api.anthropic.com/` だけに限っています。他社の提供元を足すときは、ここに追加が必要です

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
