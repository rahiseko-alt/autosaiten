# 設計書への補足（設計の確認で決めた変更）

`docs/DESIGN_SPEC.md` と食い違う場合は、この補足を優先する。節番号は設計書のもの。

## 変更

1. **LLM提供元（§16, §59）**: `LLM_PROVIDER` の初期値は `ANTHROPIC`。Phase 5 は Anthropic、Phase 8 は OpenAI と Gemini。
2. **書き戻し（§22, §27, §57, ADR 0003）**: Results への書込後すぐには書き戻さない。回答の全問題が確定したときだけフォームへ書き戻す。Queue の `COMPLETED` は「確定して書き戻し済み」、`REVIEW_REQUIRED` は「確認待ち」を表す。
3. **最終点（§26, §31）**: `manual_score` が入っていれば常にそれを最終点とする。`finalizeManualGrades()` は MANUAL と REVIEW_REQUIRED の両方を確定する。
4. **回答の取り込み（§20, §34, §35, ADR 0005）**: フォーム送信トリガーは使わない。1分ごとの定期処理がフォームの新しい回答を拾って Queue に登録する。`submitGrades` 由来の再発火ループは起きない。response_id の一意性は維持する。
5. **ルーブリックの版（§12）**: Questions に版の列は足さない。同じ rubric_id の最大の rubric_version を使い、Results に記録する。
6. **再生成の判定（§18, §28）**: 問題定義のハッシュを Control 側に記録し、前回と同じなら「これでOK」は何もしない。
7. **時間の管理（§22, §24）**: 定期処理は開始から4分で打ち切る。更新から10分以上たった `PROCESSING` は `RETRY` に戻す。
8. **入力形式（§8, §10）**: CONTAINS のキーワードは `correct_answer` に `||` 区切り。CHECKBOX の正答も `||` 区切りで、全部合えば満点、それ以外は0点。
9. **個人情報と注入（§11, §39）**:
   - LLMへ送る前に、氏名・メール・学籍番号に当たる欄を除外する純粋関数を通す。
   - 回答は JSON の文字列フィールドで渡し、毎回ランダムな区切りを使う。区切りや指示めいた語を含む回答は REVIEW_REQUIRED にする。
   - Results に回答を書くときは必ず文字列として書く（数式として評価させない）。
   - 未回答は API を呼ばず「未回答」として 0 点で確定する（エラー時の黙った0点とは区別する）。
10. **秘密情報（§41, §42）**: `appsscript.json` の `urlFetchWhitelist` を `https://api.anthropic.com/` に限定する。ログには応答本文を丸ごと出さない。API キーは専用に発行し、提供元側で月額上限を設ける。「GASエディタ直接修正禁止」は運用ルールであり、技術的な強制ではないと README に書く。
11. **フォーム設定（§17）**: 回答後の編集は許可しない。`respondent_email` は `COLLECT_EMAIL=FALSE` のとき空欄。
12. **GAS とテストの両立（§5, §46）**: 純粋ロジックのファイルは末尾に `if (typeof module !== 'undefined') module.exports = {...}` を置く。`.clasp.json` の `rootDir` を `src` にして、`tests/` や `package.json` は GAS に送らない。

## 実環境で確認が要る項目（【未確認】）

- 成績の公開タイミング（送信直後か後か）を Apps Script から設定できるか。できなければ運用で補う。
- Apps Script の実行時間・UrlFetch の1日の上限が60人規模で足りるか。
- 回答先のスプレッドシートに版ごとに増える「フォームの回答 N」シートの扱い。
- `LLM_CONFIDENCE_THRESHOLD` 0.80 での要確認の出方（実際の答案で確かめる）。
