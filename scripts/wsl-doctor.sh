#!/usr/bin/env bash
# Checks that this machine runs the plugin from Linux, not Windows: each tool resolves outside the Windows prefix
# (WSL_DOCTOR_WINDOWS_PREFIX, default /mnt/), node and claude meet their minimums, and the repo sits on the Linux
# filesystem. One line per check, `ok NAME PATH [VERSION]` or `FAIL NAME: REASON`; exits 0 only when all are ok.
# Plain bash with no external tools (it still runs when PATH holds nothing else), bash 3.2 included.
set -u
win=${WSL_DOCTOR_WINDOWS_PREFIX:-/mnt/}
bad=0
pass() { echo "ok $*"; }
flunk() { echo "FAIL $1: $2"; bad=1; }

# ver_ge A B: A >= B, comparing dot-separated numbers field by field (a missing field counts as 0).
ver_ge() {
  local IFS=. i x y
  local -a a b
  read -r -a a <<<"$1"; read -r -a b <<<"$2"
  for ((i = 0; i < ${#a[@]} || i < ${#b[@]}; i++)); do
    x=${a[i]:-0}; y=${b[i]:-0}
    x=${x%%[!0-9]*}; y=${y%%[!0-9]*}
    ((10#${x:-0} > 10#${y:-0})) && return 0
    ((10#${x:-0} < 10#${y:-0})) && return 1
  done
  return 0
}

# check NAME [MIN]: found, not under the Windows prefix, and (with MIN) its --version at least MIN.
check() {
  local p v shown
  p=$(command -v "$1") || { flunk "$1" "not found"; return; }
  case $p in "$win"*) flunk "$1" "resolves to Windows ($p)"; return ;; esac
  [ -z "${2:-}" ] && { pass "$1" "$p"; return; }
  shown=$("$p" --version 2>/dev/null); shown=${shown%%[[:space:]]*}
  v=${shown#v}
  [ -n "$v" ] || { flunk "$1" "no version from $p --version"; return; }
  if ver_ge "$v" "$2"; then pass "$1" "$p" "$shown"; else flunk "$1" "$shown is older than $2"; fi
}

check node 22
check claude 2.1.330
for t in jq python3 gh git perl curl tmux openssl; do check "$t"; done

repo=$(git rev-parse --show-toplevel 2>/dev/null) || repo=
[ -n "$repo" ] || repo=$PWD
case $repo/ in
  "$win"*) flunk repo "under $win (use the Linux filesystem)" ;;
  *) pass repo "$repo" ;;
esac
exit "$bad"
