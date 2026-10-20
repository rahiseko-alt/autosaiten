#!/bin/sh
# 片づけ役。会話開始時に session-start.sh から呼ばれる。
# 「ひな型そのもの」なら何もしない。「ひな型から複製した新しい案件」なら、写ってきた
# ひな型専用の記録（.template/・引き継ぎメモの中身・保管庫）を片づけ、白紙から始める。
# 判定は .template/origin に書いたひな型の名前と、送信先（origin）の名前の比較。
# 判定できないとき（名前の記録が無い・送信先が無い）は、何も消さない。
set -u

dir="${CLAUDE_PROJECT_DIR:-.}"
tpl="$dir/.template"
[ -d "$tpl" ] || exit 0

# URL から「持ち主/名前」だけを取り出し、小文字にそろえる。Windows の改行（CR）も取り除く
repo_name() {
  printf '%s\n' "$1" | tr -d '\r' | sed -e 's#/*$##' -e 's#\.git$##' \
    | awk -F'[/:]' 'NF >= 2 { print tolower($(NF-1) "/" $NF) }'
}

skip() {
  echo "$1 ひな型か複製先かを判定できないため、ひな型の作業日誌は片づけていません。"
  exit 0
}

[ -s "$tpl/origin" ] || skip "ひな型の名前の記録（.template/origin）がありません。"
template=$(repo_name "$(cat "$tpl/origin")")
[ -n "$template" ] || skip "ひな型の名前の記録（.template/origin）が読めません。"

url=$(git -C "$dir" remote get-url origin 2>/dev/null) || url=""
[ -n "$url" ] || skip "送信先が確認できません。"
current=$(repo_name "$url")

[ "$current" = "$template" ] && exit 0

f="$dir/docs/agents/handover.md"
seed="$tpl/handover-seed.md"
if [ -f "$f" ] && [ -f "$seed" ]; then
  # 見出しと書式説明（最初の --- まで）を残し、その下を最初の1件（日付入り）に差し替える
  tmp="$f.tmp"
  { tr -d '\r' < "$f" | awk '{ print } /^---$/ { exit }'
    echo
    sed "s/{DATE}/$(date +%Y-%m-%d)/" "$seed"
  } > "$tmp" && mv "$tmp" "$f"
fi
rm -rf "$tpl" "$dir/docs/agents/handover-archive.md"

# 片づけた分だけを記録する（ほかの未保存の変更は巻き込まない）
git -C "$dir" add -A -- .template docs/agents/handover.md docs/agents/handover-archive.md >/dev/null 2>&1
if ! git -C "$dir" commit -q -m "テンプレートから作成: ひな型の作業日誌を片づけた" \
     -- .template docs/agents/handover.md docs/agents/handover-archive.md >/dev/null 2>&1; then
  echo "ひな型から作った新しい案件として、ひな型の作業日誌を片づけ、引き継ぎメモを白紙にしました。ただし記録に失敗したので、この変更を記録して送ってください。"
  exit 0
fi
if git -C "$dir" push -q origin HEAD >/dev/null 2>&1; then
  echo "ひな型から作った新しい案件として、ひな型の作業日誌を片づけ、引き継ぎメモを白紙にしました（記録・送信済み）。"
else
  echo "ひな型から作った新しい案件として、ひな型の作業日誌を片づけ、引き継ぎメモを白紙にしました（記録済み・送信できなかったので、次に送るときに一緒に送ってください）。"
fi
