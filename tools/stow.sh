#!/bin/bash
# stow — keep repo-nonessential files (plans, notes, agent artifacts) in the
# sibling grok-shell-stow repo so this tree stays source-only.
#
#   tools/stow.sh init            create/clone hexuria/grok-shell-stow into .stow/
#   tools/stow.sh add <path>…     move files/dirs into .stow/ (paths preserved), commit, push
#   tools/stow.sh status          show what's stowed and whether it's pushed
#
# The .stow/ checkout is gitignored here — it is that repo's whole worktree.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
STOW="$ROOT/.stow"
GH_REPO="hexuria/grok-shell-stow"
# hexuria.github.com is the SSH alias that picks the hexuria key — plain
# github.com would authenticate as the wrong account.
SSH_URL="git@hexuria.github.com:${GH_REPO}.git"

cmd="${1:-}"; shift || true

case "$cmd" in
init)
  if [ -d "$STOW/.git" ]; then
    echo "stow already initialised at $STOW"
    exit 0
  fi
  if ! gh repo view "$GH_REPO" >/dev/null 2>&1; then
    gh repo create "$GH_REPO" --public --description "Stowed notes, plans and agent artifacts for grok-shell"
  fi
  git clone "$SSH_URL" "$STOW" 2>/dev/null || { mkdir -p "$STOW"; git -C "$STOW" init; git -C "$STOW" remote add origin "$SSH_URL"; }
  git -C "$STOW" rev-parse --verify main >/dev/null 2>&1 || {
    (cd "$STOW" && git commit --allow-empty -m "init" >/dev/null && git push -u origin HEAD:main)
  }
  echo "stow ready at $STOW -> $GH_REPO"
  ;;

add)
  [ -d "$STOW/.git" ] || { echo "run tools/stow.sh init first"; exit 1; }
  [ $# -gt 0 ] || { echo "usage: tools/stow.sh add <path>…"; exit 1; }
  moved=0
  for p in "$@"; do
    rel="${p#"$ROOT"/}"; rel="${rel#./}"
    src="$ROOT/$rel"; dst="$STOW/$rel"
    [ -e "$src" ] || { echo "skip $rel (missing)"; continue; }
    mkdir -p "$(dirname "$dst")"
    # Untrack first, then move — `git mv` into the ignored .stow/ would stage a
    # rename whose target lands back in this repo on commit.
    git -C "$ROOT" ls-files --error-unmatch "$rel" >/dev/null 2>&1 \
      && git -C "$ROOT" rm -q -r --cached "$rel"
    mv "$src" "$dst"
    echo "stowed $rel"; moved=$((moved+1))
  done
  [ "$moved" -gt 0 ] || exit 0
  git -C "$STOW" add -A
  git -C "$STOW" commit -m "stow: $(echo "$@" | tr ' ' ', ')" >/dev/null
  git -C "$STOW" push
  ;;

status)
  [ -d "$STOW" ] || { echo "no stow yet — tools/stow.sh init"; exit 0; }
  git -C "$STOW" status -sb
  find "$STOW" -type f -not -path "*/.git/*" | sed "s|$STOW/|  |"
  ;;

*)
  sed -n '2,10p' "$0"; exit 1 ;;
esac
