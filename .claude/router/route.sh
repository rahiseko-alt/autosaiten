#!/bin/sh
# 振り分け役。役割名を受け取り、役割表から使える担当を上から選んで仕事をさせる。
#   使い方: echo "依頼文" | sh .claude/router/route.sh <役割名>
#   出力:   見出し行（assignee: など）、"---"、担当の答え
#   モード判定: sh .claude/router/route.sh --check （利用枠を使わずに他社の道具を確かめる）
set -u

here=$(cd "$(dirname "$0")" && pwd)
table="${ROLE_TABLE:-$here/roles.txt}"
role="${1:-}"

# 他社の道具が使えるかを、利用枠を使わずに確かめる
if [ "$role" = "--check" ]; then
  mode=solo
  for tool in codex gemini; do
    if ! command -v "$tool" >/dev/null 2>&1; then state=not-installed
    elif [ "$tool" = codex ]; then
      codex login status </dev/null >/dev/null 2>&1 && state=available || state=not-logged-in
    elif [ -f "$HOME/.gemini/oauth_creds.json" ] || [ -n "${GEMINI_API_KEY:-}" ]; then
      state=available
    else state=not-logged-in
    fi
    echo "$tool: $state"
    [ "$state" = available ] && mode=auto
  done
  echo "mode: $mode"
  exit 0
fi

# Windows の改行（CR）は取り除いてから読む
candidates=$(tr -d '\r' < "$table" | awk -v r="$role" '!/^[[:space:]]*(#|$)/ && $1 == r { $1 = ""; print; exit }')
if [ -z "$candidates" ]; then
  echo "役割「$role」は役割表（$table）にありません。役割表の1列目の名前を指定してください。" >&2
  exit 2
fi

prompt=$(cat)
out=$(mktemp); err=$(mktemp)
trap 'rm -f "$out" "$err"' EXIT

# 担当1人に仕事をさせる。答えは $out、エラー出力は $err に残す
run_one() { # $1 道具, $2 モデル
  case "$1" in
    # 実装役は検査も流すので、どの道具も確認なしで作業させる（利用者が関わるのは人の確認点だけ）
    claude) printf '%s' "$prompt" | claude -p --model "$2" --permission-mode bypassPermissions ;;
    codex)  printf '%s' "$prompt" | codex exec -m "$2" --skip-git-repo-check -s workspace-write - ;;
    # 依頼文は標準入力で渡す（長い依頼文がコマンドの長さの上限に当たらないように）
    gemini) printf '%s' "$prompt" | gemini -m "$2" -p "標準入力の依頼に従ってください。" --approval-mode yolo --skip-trust ;;
    *)      echo "道具「$1」には対応していません（claude / codex / gemini のみ）" >&2; return 1 ;;
  esac > "$out" 2> "$err"
}

# 失敗の理由をエラー出力から見分ける。どれにも当たらなければ error（それでも次の担当へ回し、止めない）
reason() {
  if grep -Eiq 'usage limit|rate.?limit|quota|limit (reached|exceeded)|too many requests|resource.?exhausted|\b429\b' "$err"; then echo usage-limit
  elif grep -Eiq 'not logged in|log ?in required|please (log|sign) ?in|unauthori[sz]ed|unauthenticated|\b401\b|credentials? (not found|missing|expired)|authentication (required|failed)' "$err"; then echo not-logged-in
  else echo error
  fi
}

skipped=""
other_skipped=no
for c in $candidates; do
  tool=${c%%:*}; rest=${c#*:}; model=${rest%%:*}
  why=""
  if ! command -v "$tool" >/dev/null 2>&1; then
    why=not-installed
  elif ! run_one "$tool" "$model"; then
    why=$(reason)
  fi
  if [ -n "$why" ]; then
    skipped="${skipped}skipped: $c ($why)
"
    [ "$tool" = claude ] || other_skipped=yes
    continue
  fi
  # 他社の担当を飛ばして Claude に落ちたら単独モード
  solo=no
  [ "$tool" = claude ] && [ "$other_skipped" = yes ] && solo=yes
  echo "assignee: $c"
  echo "solo: $solo"
  printf '%s' "$skipped"
  echo "---"
  cat "$out"
  exit 0
done

echo "役割「$role」の担当が全員使えませんでした。" >&2
printf '%s' "$skipped" >&2
exit 1
