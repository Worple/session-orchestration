#!/usr/bin/env bash
# wsl-doctor.sh with stub tools: all present; node and claude too old; claude resolving under the Windows prefix;
# a missing tool; a repo under the Windows prefix. Prints "ok" or the first failure.
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)
tmp=$(mktemp -d); trap 'rm -rf "$tmp"' EXIT
mkdir -p "$tmp/bin" "$tmp/mnt/c/bin" "$tmp/mnt/src" "$tmp/repo"
stub() { printf '#!/bin/sh\n%s\n' "$2" > "$1"; chmod +x "$1"; }
stub "$tmp/bin/node" 'echo v22.11.0'
stub "$tmp/bin/claude" "echo '2.1.331 (Claude Code)'"
for c in jq python3 gh git perl curl tmux openssl; do stub "$tmp/bin/$c" 'exit 0'; done
fail() { echo "wsl-doctor.test: $1"; printf '%s\n' "$out"; exit 1; }
# doc DIR [PATH]: run the doctor from DIR; sets $out and $rc.
doc() {
  rc=0
  out=$(cd "$1" && PATH=${2:-$tmp/bin:/usr/bin:/bin} WSL_DOCTOR_WINDOWS_PREFIX=$tmp/mnt/ "$BASH" "$here/wsl-doctor.sh" 2>&1) || rc=$?
}

doc "$tmp/repo"
[ "$rc" = 0 ] && [ "$(grep -c '^ok ' <<<"$out")" = 11 ] || fail "all present: rc=$rc"
grep -qx "ok node $tmp/bin/node v22.11.0" <<<"$out" || fail "node line"

stub "$tmp/bin/node" 'echo v20.1.0'
doc "$tmp/repo"
[ "$rc" = 1 ] && grep -qx 'FAIL node: v20.1.0 is older than 22' <<<"$out" || fail "old node"
stub "$tmp/bin/node" 'echo v22.11.0'

stub "$tmp/bin/claude" "echo '2.1.300 (Claude Code)'"
doc "$tmp/repo"
[ "$rc" = 1 ] && grep -qx 'FAIL claude: 2.1.300 is older than 2.1.330' <<<"$out" || fail "old claude"
stub "$tmp/bin/claude" "echo '2.1.331 (Claude Code)'"

stub "$tmp/mnt/c/bin/claude" "echo '2.1.331 (Claude Code)'"
doc "$tmp/repo" "$tmp/mnt/c/bin:$tmp/bin:/usr/bin:/bin"
[ "$rc" = 1 ] && grep -qxF "FAIL claude: resolves to Windows ($tmp/mnt/c/bin/claude)" <<<"$out" || fail "windows claude"

rm "$tmp/bin/jq"
doc "$tmp/repo" "$tmp/bin"
[ "$rc" = 1 ] && grep -qx 'FAIL jq: not found' <<<"$out" || fail "missing jq"
stub "$tmp/bin/jq" 'exit 0'

doc "$tmp/mnt/src"
[ "$rc" = 1 ] && grep -qxF "FAIL repo: under $tmp/mnt/ (use the Linux filesystem)" <<<"$out" || fail "repo under /mnt"

echo ok
