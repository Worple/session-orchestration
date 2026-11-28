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
echo ok
