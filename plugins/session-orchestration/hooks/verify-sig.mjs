// Checks a phone's signature on an approval answer. The phone signs with a non-extractable ECDSA P-256 key (WebCrypto:
// SHA-256, 64-byte IEEE P1363 r||s, base64url without padding) over the payload's UTF-8 bytes.
//
// CLI: stdin is {"jwk":{kty,crv,x,y},"payload":"<string>","sig":"<base64url>"}.
//   exit 0 valid; 1 bad signature; 2 malformed input; 3 anything unexpected (could not verify).
//   Prints exactly `valid` on stdout on 0 (a caller takes exit 0 without it for a verifier that did not run), and one
//   reason line on stderr otherwise: `bad signature` on 1, `malformed input: <why>` on 2.
// Module: verifySig(jwk, payload, sig) resolves true/false, and throws MalformedInput for malformed input.
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const MAX_PAYLOAD_BYTES = 8192;

export class MalformedInput extends Error {
  constructor(message) { super(message); this.name = 'MalformedInput'; }
}

const bad = (message) => { throw new MalformedInput(message); };

export async function verifySig(jwk, payload, sig) {
  if (typeof jwk !== 'object' || jwk === null || Array.isArray(jwk)) bad('jwk is not an object');
  if ('d' in jwk) bad('jwk carries a private part (d)');
  if (jwk.kty !== 'EC' || jwk.crv !== 'P-256') bad('jwk is not an EC P-256 key');
  if (typeof jwk.x !== 'string' || typeof jwk.y !== 'string') bad('jwk is missing x or y');
  if (typeof payload !== 'string') bad('payload is not a string');
  if (typeof sig !== 'string') bad('sig is not a string');
  const data = new TextEncoder().encode(payload);
  if (data.length > MAX_PAYLOAD_BYTES) bad('payload is over 8 KiB');
  if (!/^[A-Za-z0-9_-]*$/.test(sig)) bad('sig is not base64url');
  const sigBytes = Buffer.from(sig, 'base64url');
  if (sigBytes.length !== 64) bad('sig is not 64 bytes');

  const subtle = globalThis.crypto?.subtle;
  if (!subtle) throw new Error('crypto.subtle is not available');
  let key;
  try {
    key = await subtle.importKey('jwk', { kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y },
      { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
  } catch (e) {
    if (e?.name === 'DataError' || e?.name === 'SyntaxError') bad(`jwk cannot be imported: ${e.message}`);
    throw e;
  }
  return subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, key, sigBytes, data);
}

async function main() {
  const chunks = [];
  for await (const c of process.stdin) chunks.push(c);
  let input;
  try { input = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { bad('stdin is not JSON'); }
  if (typeof input !== 'object' || input === null || Array.isArray(input)) bad('stdin is not a JSON object');
  return verifySig(input.jwk, input.payload, input.sig);
}

// Entry point only: compare real paths, since import.meta.url is realpath-resolved and argv[1] may be a symlink or contain "..".
// If argv[1] is missing or unresolvable, the module is being imported: run nothing.
const isEntry = (() => {
  try { return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url)); } catch { return false; }
})();

if (isEntry) {
  try {
    if (await main()) {
      console.log('valid');
      process.exit(0);
    }
    console.error('bad signature');
    process.exit(1);
  } catch (e) {
    if (e instanceof MalformedInput) { console.error(`malformed input: ${e.message}`); process.exit(2); }
    console.error(`could not verify: ${String(e?.message ?? e).split('\n')[0]}`);
    process.exit(3);
  }
}
