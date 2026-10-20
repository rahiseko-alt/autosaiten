#!/bin/sh
# 振り分け役の検査。作ったとき・直したときに手で流す: sh tests/route.test.sh
# 本物の道具は使わない。偽物の道具を PATH の先頭に置いて演じさせる。
set -u
root=$(cd "$(dirname "$0")/.." && pwd)
fail=0
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

check() { # $1 説明, $2 条件の終了コード
  if [ "$2" -eq 0 ]; then echo "ok   $1"; else echo "FAIL $1"; fail=1; fi
}

# 偽物の道具。$1 = 道具名, $2 = 振る舞い（ok / login / quota）
fake() {
  mkdir -p "$work/bin"
  cat > "$work/bin/$1" <<FAKE
#!/bin/sh
case "$2" in
  ok)    echo "$1 が実行されました: \$*"; cat >/dev/null ;;
  login) echo "Not logged in. Please run /login" >&2; exit 1 ;;
  quota) echo "Error: usage limit reached. Try again later." >&2; exit 1 ;;
esac
FAKE
  chmod +x "$work/bin/$1"
}

route() { # $1 役割表, $2 役割名, 標準入力 = 依頼文
  PATH="$work/bin:/usr/bin:/bin" ROLE_TABLE="$1" sh "$root/.claude/router/route.sh" "$2"
}

table() { printf '%s\n' "$@" > "$work/roles.txt"; echo "$work/roles.txt"; }

# 1. 役割名と依頼文を渡すと、役割表の Claude 担当で実行され、担当と結果が返る
fake claude ok
t=$(table "design  claude:claude-opus-5-5")
out=$(echo "設計して" | route "$t" design)
echo "$out" | grep -q '^assignee: claude:claude-opus-5-5$' \
  && echo "$out" | grep -q 'claude が実行されました'
check "役割表の Claude 担当で実行され、担当と結果が返る" $?

# 2. 役割表のモデル名を書き換えるだけで、呼ばれるモデルが変わる
t=$(table "design  claude:claude-sonnet-5-5")
out=$(echo "設計して" | route "$t" design)
echo "$out" | grep -q -- '--model claude-sonnet-5-5'
check "役割表の書き換えだけで呼ばれるモデルが変わる" $?

# 3. 存在しない役割名は、分かりやすい失敗になる
out=$(echo "x" | route "$t" no-such-role 2>&1); code=$?
[ "$code" -ne 0 ] && echo "$out" | grep -q 'no-such-role' && echo "$out" | grep -q '役割表'
check "存在しない役割名は分かりやすい失敗になる" $?

# 4. 同梱の役割表は、全役割の最後の候補が Claude（単独モードでも全役割が埋まる）
bad=$(awk '!/^[[:space:]]*(#|$)/ && $NF !~ /^claude:/ { print $1 }' "$root/.claude/router/roles.txt")
n=$(awk '!/^[[:space:]]*(#|$)/' "$root/.claude/router/roles.txt" | wc -l)
[ -z "$bad" ] && [ "$n" -ge 10 ]
check "同梱の役割表は全役割の最後が Claude" $?

# 5. 先頭の担当（他社）が使えれば、それが選ばれ、役割表のモデル名が渡る
fake codex ok
t=$(table "review  codex:gpt-6.1-sol  claude:claude-opus-5-5")
out=$(echo "確認して" | route "$t" review)
echo "$out" | grep -q '^assignee: codex:gpt-6.1-sol$' && echo "$out" | grep -q 'gpt-6.1-sol' \
  && echo "$out" | grep -q '^solo: no$'
check "先頭の担当が使えればそれが選ばれ、モデル名が渡る" $?

# 6. 未導入・未ログイン・使用上限のそれぞれで次の候補へ回り、理由が記録される
rm -f "$work/bin/codex"; fake gemini login; fake claude ok
t=$(table "light  codex:gpt-6.1-sol  gemini:gemini-3.8-flash  claude:claude-sonnet-5-5")
out=$(echo "直して" | route "$t" light)
echo "$out" | grep -q '^skipped: codex:gpt-6.1-sol (not-installed)$' \
  && echo "$out" | grep -q '^skipped: gemini:gemini-3.8-flash (not-logged-in)$'
check "未導入・未ログインなら次へ回り、理由が記録される" $?
fake codex quota
out=$(echo "直して" | route "$t" light)
echo "$out" | grep -q '^skipped: codex:gpt-6.1-sol (usage-limit)$'
check "使用上限なら次へ回り、理由が記録される" $?

# 7. 他社が全滅すると Claude で実行され、単独モードと返る
out=$(echo "直して" | route "$t" light)
echo "$out" | grep -q '^assignee: claude:claude-sonnet-5-5$' && echo "$out" | grep -q '^solo: yes$'
check "他社が全滅すると Claude で実行され、単独モードと返る" $?

# 8. 誰も使えなければ、理由つきの分かりやすい失敗になる
fake claude quota
out=$(echo "直して" | route "$t" light 2>&1); code=$?
[ "$code" -ne 0 ] && echo "$out" | grep -q 'claude:claude-sonnet-5-5 (usage-limit)'
check "誰も使えなければ理由つきで失敗する" $?

# 9. 作業の始めのモード判定（利用枠を使わない）: 他社が1つでも使えれば自動モード
check_mode() { PATH="$work/bin:/usr/bin:/bin" HOME="$work/home" sh "$root/.claude/router/route.sh" --check; }
mkdir -p "$work/home"
fake codex ok; rm -f "$work/bin/gemini"
out=$(check_mode)
echo "$out" | grep -q '^codex: available$' && echo "$out" | grep -q '^gemini: not-installed$' \
  && echo "$out" | grep -q '^mode: auto$'
check "他社が1つでも使えれば自動モード" $?
fake codex login; fake gemini ok
out=$(check_mode)
echo "$out" | grep -q '^codex: not-logged-in$' && echo "$out" | grep -q '^gemini: not-logged-in$' \
  && echo "$out" | grep -q '^mode: solo$'
check "他社が全部使えなければ単独モード" $?
mkdir -p "$work/home/.gemini"; : > "$work/home/.gemini/oauth_creds.json"
out=$(check_mode)
echo "$out" | grep -q '^gemini: available$' && echo "$out" | grep -q '^mode: auto$'
check "Gemini はログイン済みの記録があれば使える扱い" $?

# 10. Windows の改行（CRLF）の役割表でも、モデル名に余計な文字が混ざらない
fake claude ok
printf 'design  claude:claude-opus-5-5\r\n' > "$work/crlf.txt"
out=$(echo "設計して" | route "$work/crlf.txt" design)
echo "$out" | grep -q '^assignee: claude:claude-opus-5-5$' && ! echo "$out" | grep -q "$(printf '\r')"
check "CRLF の役割表でもモデル名が正しく渡る" $?

exit $fail
