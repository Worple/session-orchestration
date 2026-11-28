#!/usr/bin/env bash
# Self-check for hooks/verify-sig.mjs: node generates a P-256 key pair and signs with WebCrypto the way the phone does
# (P1363 r||s, base64url, over the payload's UTF-8 bytes); each case is piped into the CLI and its exit code compared.
# Run: bash phone-inbox.test.sh  (prints "ok" or the first failure).
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)
cli=$here/../../../hooks/verify-sig.mjs
tmp=$(mktemp -d); trap 'rm -rf "$tmp"' EXIT

# Writes one JSON case file per scenario into $1.
cat > "$tmp/gen.mjs" <<'EOF'
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
const dir = process.argv[2];
const { subtle } = globalThis.crypto;
const b64u = (buf) => Buffer.from(buf).toString('base64url');
const gen = () => subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
const pub = async (k) => { const { kty, crv, x, y } = await subtle.exportKey('jwk', k.publicKey); return { kty, crv, x, y }; };
const sign = async (k, s) => b64u(await subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, k.privateKey, new TextEncoder().encode(s)));
const put = (name, v) => writeFileSync(join(dir, name), typeof v === 'string' ? v : JSON.stringify(v));

const a = await gen(), b = await gen();
const jwk = await pub(a);
const payload = '{"id":"f1","status":"approved","final":"Use ?? here — ñ ✓"}';
const sig = await sign(a, payload);
put('valid', { jwk, payload, sig });
put('tampered', { jwk, payload: payload.replace('f1', 'f2'), sig });
put('otherkey', { jwk: await pub(b), payload, sig });
put('withd', { jwk: { ...(await subtle.exportKey('jwk', a.privateKey)) }, payload, sig });
put('short', { jwk, payload, sig: b64u(Buffer.from(sig, 'base64url').subarray(0, 63)) });
put('notjson', 'this is not json');
const big = 'x'.repeat(9 * 1024);
put('big', { jwk, payload: big, sig: await sign(a, big) });
const edge = 'y'.repeat(8192);
put('edge', { jwk, payload: edge, sig: await sign(a, edge) });
put('badchars', { jwk, payload, sig: sig.slice(0, -2) + '!!' });
put('nosig', { jwk, payload });
put('sigtype', { jwk, payload, sig: 5 });
put('payloadtype', { jwk, payload: 5, sig });
put('wrongcrv', { jwk: { ...jwk, crv: 'P-384' }, payload, sig });
put('wrongkty', { jwk: { ...jwk, kty: 'RSA' }, payload, sig });
put('badpoint', { jwk: { ...jwk, y: jwk.x.slice(0, -4) + 'AAAA' }, payload, sig });
EOF
node "$tmp/gen.mjs" "$tmp"

check() { # $1 case file, $2 wanted exit code
  local got=0
  node "$cli" < "$tmp/$1" >"$tmp/out" 2>"$tmp/err" || got=$?
  [ "$got" = "$2" ] || { echo "FAIL $1: exit $got, want $2 ($(head -c 200 "$tmp/err"))"; exit 1; }
  if [ "$2" = 0 ]; then
    [ ! -s "$tmp/out" ] && [ ! -s "$tmp/err" ] || { echo "FAIL $1: printed something on success"; exit 1; }
  else
    [ ! -s "$tmp/out" ] && [ "$(wc -l < "$tmp/err" | tr -d ' ')" = 1 ] || { echo "FAIL $1: want one stderr line and no stdout"; exit 1; }
  fi
}
check valid 0
check edge 0                    # exactly 8 KiB is allowed
check tampered 1
check otherkey 1
check withd 2
check short 2
check notjson 2
check big 2                     # validly signed, so the 2 comes from the size check
check badchars 2
check nosig 2
check sigtype 2
check payloadtype 2
check wrongcrv 2
check wrongkty 2
check badpoint 2

# The CLI must run however it is reached: a symlink, a path with "..", the way the hooks module launches it.
ln -s "$cli" "$tmp/link.mjs"
runvia() { # $1 label, $2 case file, $3 wanted exit; the rest is the command
  local label=$1 f=$2 want=$3 got=0; shift 3
  "$@" < "$tmp/$f" >"$tmp/out" 2>"$tmp/err" || got=$?
  [ "$got" = "$want" ] || { echo "FAIL $label $f: exit $got, want $want ($(head -c 200 "$tmp/err"))"; exit 1; }
}
for c in "valid 0" "notjson 2" "tampered 1"; do
  set -- $c
  runvia symlink "$1" "$2" node "$tmp/link.mjs"
  runvia dotdot "$1" "$2" node "$(dirname "$cli")/../hooks/verify-sig.mjs"
  runvia exec-form "$1" "$2" bash -c 'exec node "$0"' "$cli"
  runvia exec-symlink "$1" "$2" bash -c 'exec node "$0"' "$tmp/link.mjs"
done

# Imported, the module runs no CLI: it neither reads stdin nor exits, and verifySig resolves true for a valid triple.
cat > "$tmp/imp.mjs" <<'EOF'
import { readFileSync } from 'node:fs';
const { verifySig } = await import(process.argv[2]);
const c = JSON.parse(readFileSync(process.argv[3], 'utf8'));
if ((await verifySig(c.jwk, c.payload, c.sig)) !== true) throw new Error('verifySig did not resolve true');
console.log('imported');
EOF
got=0; out=$(node "$tmp/imp.mjs" "file://$cli" "$tmp/valid" < /dev/null 2>&1) || got=$?
[ "$got" = 0 ] && [ "$out" = imported ] || { echo "FAIL import: exit $got: $out"; exit 1; }

# No crypto.subtle is an unexpected failure: exit 3, one stderr line (never 1 or 2).
echo "Object.defineProperty(globalThis, 'crypto', { value: {}, configurable: true });" > "$tmp/nosubtle.mjs"
got=0; node --import "$tmp/nosubtle.mjs" "$cli" < "$tmp/valid" >"$tmp/out" 2>"$tmp/err" || got=$?
[ "$got" = 3 ] && [ ! -s "$tmp/out" ] && [ "$(wc -l < "$tmp/err" | tr -d ' ')" = 1 ] || { echo "FAIL no subtle: exit $got, want 3 ($(head -c 200 "$tmp/err"))"; exit 1; }

# --- The page (inbox.html): its pure block must agree with the module end to end. ---
page=$here/inbox.html
[ -f "$page" ] || { echo "FAIL page: inbox.html is missing"; exit 1; }
[ "$(head -c 7 "$page")" = "<title>" ] || { echo "FAIL page: must be a fragment starting with <title>"; exit 1; }
if grep -qiE '<!doctype|<html|<head|<body' "$page"; then echo "FAIL page: no document skeleton allowed"; exit 1; fi
if grep -qE '<script[^>]*src=' "$page"; then echo "FAIL page: no external scripts"; exit 1; fi
grep -q 'devTimer = setTimeout' "$page" || { echo "FAIL page: the device-doc read has no loading timer"; exit 1; }
grep -q 'clearTimeout(devTimer)' "$page" || { echo "FAIL page: the device-doc timer is never cleared"; exit 1; }
grep -q 'metadata.fromCache) return' "$page" || { echo "FAIL page: a cached device snapshot must not be acted on"; exit 1; }
sed -n '/phone-inbox:pure-start/,/phone-inbox:pure-end/p' "$page" > "$tmp/pure.js"
[ -s "$tmp/pure.js" ] || { echo "FAIL page: pure block not found"; exit 1; }

cat > "$tmp/page.mjs" <<'EOF'
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
const [pureFile, cli] = process.argv.slice(2);
const fns = new Function(readFileSync(pureFile, 'utf8') + '\nreturn { b64url, thumbprintInput, codeOf, payloadFor };')();
const eq = (a, b, what) => { if (a !== b) { console.log(`FAIL ${what}: got ${a} want ${b}`); process.exit(1); } };

// Thumbprint fixture, pinned in Task 3 too.
const jwk = { kty: 'EC', crv: 'P-256', x: 'CxijAnQFbFv29yvXuSU527dJRP1-fkjFNuFGLj9mbdw', y: 'cMplI_UDWlXdeRMubUmOKJj7yQ_QgWVvNdP0kYrE58Y' };
eq(fns.thumbprintInput(jwk), '{"crv":"P-256","kty":"EC","x":"' + jwk.x + '","y":"' + jwk.y + '"}', 'thumbprintInput');
const digest = createHash('sha256').update(fns.thumbprintInput(jwk)).digest();
eq(digest.toString('base64url'), 'h3lQ9rYMb8Y4b1jtz1xMXr8nWCFztltYAKjaYNRNJs0', 'fixture fp');
eq(fns.b64url(digest), 'h3lQ9rYMb8Y4b1jtz1xMXr8nWCFztltYAKjaYNRNJs0', 'b64url');
eq(fns.b64url(new Uint8Array([251, 255, 254])), '-__-', 'b64url alphabet');
eq(fns.b64url(new Uint8Array([1])), 'AQ', 'b64url no padding');
eq(fns.codeOf(digest), '8779-50F6-B60C-6FC6', 'fixture code');

// payloadFor: the exact string, keys in order.
const ask = { id: 'a1', key: 'k-7', question: 'Use "?" — ñ ✓', options: ['Yes', 'No'], at: 1 };
const want = '{"v":1,"root":"0123456789abcdef","askId":"a1","key":"k-7","question":"Use \\"?\\" — ñ ✓","option":"Yes","at":1700000000000,"device":"h3lQ9rYMb8Y4b1jtz1xMXr8nWCFztltYAKjaYNRNJs0"}';
const payload = fns.payloadFor('0123456789abcdef', ask, 'Yes', 'h3lQ9rYMb8Y4b1jtz1xMXr8nWCFztltYAKjaYNRNJs0', 1700000000000);
eq(payload, want, 'payloadFor');

// End to end: sign the page's payload with WebCrypto and verify through the module's CLI.
const { subtle } = globalThis.crypto;
const kp = await subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
const ex = await subtle.exportKey('jwk', kp.publicKey);
const pub = { kty: ex.kty, crv: ex.crv, x: ex.x, y: ex.y };
const sig = fns.b64url(await subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, kp.privateKey, new TextEncoder().encode(payload)));
const run = (p) => spawnSync('node', [cli], { input: JSON.stringify({ jwk: pub, payload: p, sig }), encoding: 'utf8' });
const good = run(payload);
eq(good.status, 0, 'verify-sig exit for the page payload (' + good.stderr.trim() + ')');
eq(run(payload.replace('"Yes"', '"No"')).status, 1, 'verify-sig exit for a changed payload');
console.log('page ok');
EOF
got=0; out=$(node "$tmp/page.mjs" "$tmp/pure.js" "$cli" 2>&1) || got=$?
[ "$got" = 0 ] && [ "$out" = "page ok" ] || { echo "FAIL page: exit $got: $out"; exit 1; }
echo ok
