// Preload for the msgraph CLI (NODE_OPTIONS="--import <this file>"): its token.json write becomes atomic.
// The CLI saves a refreshed token with a plain writeFileSync, and parallel calls each refresh, so a shorter write over
// a longer one left stray bytes after the closing } and logged the user out. A temp file + rename can't interleave.
// shortcut: patches fs.writeFileSync, the call 1.0.104 uses; drop this once the CLI writes the token atomically.
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';

const write = fs.writeFileSync;
fs.writeFileSync = function (file, data, opts) {
  if (typeof file !== 'string' || !file.endsWith('/msgraph-cli/token.json')) return write.apply(this, arguments);
  const tmp = `${file}.${process.pid}.tmp`;
  try {
    write(tmp, data, { encoding: 'utf-8', mode: 0o600 });
    fs.renameSync(tmp, file);
  } catch (e) {
    fs.rmSync(tmp, { force: true });
    throw e;
  }
};
syncBuiltinESMExports(); // the CLI's `import { writeFileSync } from 'fs'` binding sees the patch
