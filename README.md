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
