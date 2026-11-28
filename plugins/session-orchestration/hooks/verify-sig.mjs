// Checks a phone's signature on an approval answer. The phone signs with a non-extractable ECDSA P-256 key (WebCrypto:
// SHA-256, 64-byte IEEE P1363 r||s, base64url without padding) over the payload's UTF-8 bytes.
//
// CLI: stdin is {"jwk":{kty,crv,x,y},"payload":"<string>","sig":"<base64url>"}.
//   exit 0 valid; 1 bad signature; 2 malformed input; 3 anything unexpected (could not verify).
//   Prints nothing on 0 and one reason line on stderr otherwise.
// Module: verifySig(jwk, payload, sig) resolves true/false, and throws MalformedInput for malformed input.
import { pathToFileURL } from 'node:url';

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

  const { subtle } = globalThis.crypto;
  let key;
  try {
    key = await subtle.importKey('jwk', { kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y },
      { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
  } catch (e) {
    bad(`jwk cannot be imported: ${e.message}`);
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

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    if (await main()) process.exit(0);
    console.error('bad signature');
    process.exit(1);
  } catch (e) {
    if (e instanceof MalformedInput) { console.error(`malformed input: ${e.message}`); process.exit(2); }
    console.error(`could not verify: ${String(e?.message ?? e).split('\n')[0]}`);
    process.exit(3);
  }
}
