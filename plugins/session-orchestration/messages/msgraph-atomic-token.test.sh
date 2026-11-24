#!/usr/bin/env bash
# Self-check for msgraph-atomic-token.mjs: under the preload, 12 processes writing token.json of different lengths at
# the same moment (as parallel msgraph calls each saving a refreshed token) leave a file that parses, in every round,
# and no temp file. Run: bash msgraph-atomic-token.test.sh  (prints "ok" or what failed).
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)
tmp=$(mktemp -d); trap 'rm -rf "$tmp"' EXIT
dir=$tmp/.config/msgraph-cli; mkdir -p "$dir"; f=$dir/token.json
# The CLI's own form: a named ESM import of writeFileSync, then one write of the whole token.
cat > "$tmp/writer.mjs" <<'EOF'
import { writeFileSync } from 'fs';
const [file, n, start] = process.argv.slice(2);
while (Date.now() < Number(start)) {}
writeFileSync(file, JSON.stringify({ refresh_token: 'r'.repeat(4000 + Number(n) * 7), n: Number(n) }, null, 2), 'utf-8');
EOF
export NODE_OPTIONS="--import \"$here/msgraph-atomic-token.mjs\""
echo '{}' > "$f"; before=$(ls -i "$f" | awk '{print $1}')
node "$tmp/writer.mjs" "$f" 1 0
[ "$(ls -i "$f" | awk '{print $1}')" != "$before" ] || { echo "the preload didn't engage: token.json was written in place"; exit 1; }
for r in $(seq 10); do
  start=$(( $(node -p 'Date.now()') + 300 ))
  for i in $(seq 12); do node "$tmp/writer.mjs" "$f" "$i" "$start" & done
  wait
  node -e 'JSON.parse(require("fs").readFileSync(process.argv[1], "utf-8"))' "$f" 2>/dev/null ||
    { echo "round $r: token.json doesn't parse: …$(tail -c 40 "$f")"; exit 1; }
done
[ "$(ls "$dir")" = token.json ] || { echo "temp files left: $(ls "$dir")"; exit 1; }
# Another file keeps the plain write.
node "$tmp/writer.mjs" "$tmp/other.json" 1 0 && [ -s "$tmp/other.json" ] && [ "$(ls "$tmp" | grep -c tmp)" = 0 ]
echo ok
