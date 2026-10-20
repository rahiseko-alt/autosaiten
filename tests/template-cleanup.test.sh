#!/bin/sh
# 片づけ役の検査。作ったとき・直したときに手で流す: sh tests/template-cleanup.test.sh
set -u
root=$(cd "$(dirname "$0")/.." && pwd)
fail=0
tmps=""
trap 'rm -rf $tmps' EXIT

# ひな型の写しを一時的な置き場所に作る。$1 = 送信先 URL（空なら送信先なし）
make_repo() {
  r=$(mktemp -d)
  mkdir -p "$r/.claude/hooks" "$r/docs/agents"
  cp "$root/.claude/hooks/template-cleanup.sh" "$r/.claude/hooks/"
  cp -R "$root/.template" "$r/.template"
  cp "$root/docs/agents/handover.md" "$root/docs/agents/handover-archive.md" "$r/docs/agents/"
  git -C "$r" init -q
  git -C "$r" config user.email t@example.com
  git -C "$r" config user.name test
  [ -n "$1" ] && git -C "$r" remote add origin "$1"
  git -C "$r" add -A && git -C "$r" commit -qm init
  echo "$r"
}
new_repo() { r=$(make_repo "$1"); tmps="$tmps $r"; }

run() { CLAUDE_PROJECT_DIR="$1" sh "$1/.claude/hooks/template-cleanup.sh"; }

check() { # $1 説明, $2 条件の終了コード
  if [ "$2" -eq 0 ]; then echo "ok   $1"; else echo "FAIL $1"; fail=1; fi
}

origin=$(cat "$root/.template/origin")

# 1. ひな型そのものでは何も消えない
new_repo "https://github.com/$origin"
run "$r" >/dev/null
[ -d "$r/.template" ] && cmp -s "$r/docs/agents/handover.md" "$root/docs/agents/handover.md"
check "ひな型そのものでは何も消えない" $?

# 2. 複製先ではひな型専用フォルダと保管庫が消え、引き継ぎメモが白紙になる
new_repo "https://github.com/someone/new-project.git"
run "$r" >/dev/null
[ ! -e "$r/.template" ] && [ ! -e "$r/docs/agents/handover-archive.md" ]
check "複製先ではひな型専用フォルダと保管庫が消える" $?
n=$(grep -c '^## ' "$r/docs/agents/handover.md")
[ "$n" -eq 1 ] && grep -q '^## .*テンプレートから作成' "$r/docs/agents/handover.md" \
  && grep -q '^# 引き継ぎメモ' "$r/docs/agents/handover.md"
check "複製先では引き継ぎメモが白紙（見出しと最初の1件だけ）になる" $?
[ -z "$(git -C "$r" status --porcelain)" ] && git -C "$r" log -1 --format=%s | grep -q 'テンプレート'
check "片づけた変更が1回記録される" $?

# 3. 2回目以降は何もしない
before=$(git -C "$r" rev-parse HEAD)
out=$(run "$r")
[ -z "$out" ] && [ "$(git -C "$r" rev-parse HEAD)" = "$before" ]
check "2回目以降は何もしない" $?

# 4. 送信先が取得できないときは何も消さず、その旨を一言出す
new_repo ""
out=$(run "$r")
[ -d "$r/.template" ] && cmp -s "$r/docs/agents/handover.md" "$root/docs/agents/handover.md" \
  && [ -n "$out" ]
check "送信先が取れないときは何も消さず一言出す" $?

# 5. Windows の改行（CRLF）で取り出されても、ひな型そのものでは何も消えない
new_repo "https://github.com/$origin"
for f in "$r/.template/origin" "$r/docs/agents/handover.md"; do sed -i 's/$/\r/' "$f"; done
run "$r" >/dev/null
[ -d "$r/.template" ] && [ -e "$r/docs/agents/handover-archive.md" ]
check "CRLF でも、ひな型そのものでは何も消えない" $?

# 6. CRLF の複製先でも、引き継ぎメモが白紙になる
new_repo "https://github.com/someone/new-project"
sed -i 's/$/\r/' "$r/docs/agents/handover.md"
run "$r" >/dev/null
[ "$(grep -c '^## ' "$r/docs/agents/handover.md")" -eq 1 ]
check "CRLF の複製先でも引き継ぎメモが白紙になる" $?

# 7. ひな型の名前の記録が無いときは、判定できないので何も消さない
new_repo "https://github.com/someone/new-project"
rm "$r/.template/origin"
run "$r" >/dev/null
[ -d "$r/.template" ]
check "ひな型の名前の記録が無ければ何も消さない" $?

exit $fail
