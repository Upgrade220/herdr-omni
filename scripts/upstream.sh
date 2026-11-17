#!/usr/bin/env bash
# Take mods from other people's repos and keep pulling their updates.
#
#   scripts/upstream.sh add  <name> <repo-url> [path-in-repo] [branch]
#   scripts/upstream.sh sync <name>
#   scripts/upstream.sh sync --all
#   scripts/upstream.sh list
#
# `add` copies one folder of an upstream repo (default: a folder named <name>)
# into ./<name>/ with its git history, using git subtree, and records it in
# upstreams.tsv. `sync` merges the upstream's new commits into your edited
# copy; conflicts are resolved like any merge. Needs a clean working tree.
set -euo pipefail

cd "$(git rev-parse --show-toplevel)"
TSV=upstreams.tsv

die() { echo "error: $*" >&2; exit 1; }

remote_name() { echo "up-$1"; }

clean_tree() {
  git diff --quiet && git diff --cached --quiet || die "commit or stash your changes first"
}

# Split <path> out of <remote>/<branch> into a branch holding only that folder.
split_branch() {
  local name=$1 url=$2 path=$3 branch=$4 remote
  remote=$(remote_name "$name")
  git remote get-url "$remote" >/dev/null 2>&1 || git remote add "$remote" "$url"
  git fetch --quiet --no-tags "$remote" "$branch"
  local sha
  if [ "$path" = "." ]; then
    sha=$(git rev-parse "$remote/$branch")
  else
    sha=$(git subtree split --quiet --prefix="$path" "$remote/$branch") \
      || die "could not split '$path' from $url ($branch)"
  fi
  git branch -f "split/$name" "$sha" >/dev/null
}

lookup() { awk -F'\t' -v n="$1" 'NR>1 && $1==n {print; found=1} END {exit !found}' "$TSV"; }

cmd_add() {
  local name=${1:?name} url=${2:?repo-url} path=${3:-$1} branch=${4:-main}
  clean_tree
  [ -e "$name" ] && die "./$name already exists"
  lookup "$name" >/dev/null && die "$name is already in $TSV"
  split_branch "$name" "$url" "$path" "$branch"
  git subtree add --prefix="$name" "split/$name" \
    -m "Add $name from $url ($path@$branch)"
  printf '%s\t%s\t%s\t%s\n' "$name" "$url" "$path" "$branch" >> "$TSV"
  git add "$TSV" && git commit --quiet -m "Track $name upstream"
  echo "added ./$name - remember to keep its LICENSE and credit it in README.md"
}

cmd_sync_one() {
  local name url path branch
  IFS=$'\t' read -r name url path branch < <(lookup "$1") || die "$1 is not in $TSV"
  split_branch "$name" "$url" "$path" "$branch"
  echo "syncing $name from $url ($path@$branch)"
  git subtree merge --prefix="$name" "split/$name" \
    -m "Sync $name from $url ($path@$branch)"
}

cmd_sync() {
  clean_tree
  if [ "${1:-}" = "--all" ]; then
    awk -F'\t' 'NR>1 {print $1}' "$TSV" | while read -r n; do cmd_sync_one "$n"; done
  else
    cmd_sync_one "${1:?name or --all}"
  fi
}

case "${1:-}" in
  add)  shift; cmd_add "$@" ;;
  sync) shift; cmd_sync "$@" ;;
  list) column -t -s $'\t' "$TSV" ;;
  *)    sed -n '2,12p' "$0" | sed 's/^# \{0,1\}//'; exit 1 ;;
esac
