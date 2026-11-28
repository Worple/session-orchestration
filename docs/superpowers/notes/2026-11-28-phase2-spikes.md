# Phase 2 spikes: phone key storage and module access to the page database

Task 1 of `docs/superpowers/plans/2026-11-28-phase2-phone-inbox.md`. Run on 2026-11-28 with Claude Code 2.1.330, an Android 16 phone in the claude.ai app, and Node 22 in WSL. The throwaway page and plugin are not committed.

## Decisions

| Decision | Result | What it changes |
|---|---|---|
| `MODULE_DB` | **yes**, verified in a `--bg` session; an interactive session has the same main-loop tool set and is expected to work but was not run. Task 10's end-to-end check (an interactive coordinator) verifies it. | The plan stands: the module mirrors and sweeps through `$.tool.call('ArtifactData')`. In `claude -p` there are no Artifact tools (`$.tool.call` fails with "no tool named ArtifactData"). Coordinators are interactive by design (the pane), so no coordinator runs under `-p` (controller ruling R5). The docs (Task 10) say so, and `mirror` / `sweep` put that error in `PhoneView.error` rather than throwing. |
| `IDB_KEEPS` | **yes**, from the claude.ai app on one Android 16 phone; the phone's own browser and iOS were not tested | Task 8 keeps the key in IndexedDB; no "pair again each visit" fallback. Task 10's end-to-end check on the user's phone re-confirms it. |
| `KEEPS_ACROSS_REPUBLISH` | **yes**, from the claude.ai app on one Android 16 phone; the phone's own browser and iOS were not tested | Republishing the page to the same URL (a plugin update) keeps the pairing. The docs say no re-pairing is needed. Task 10's end-to-end check on the user's phone re-confirms it. |
| `READBACK_EXACT` | **yes**, after trimming surrounding whitespace | Task 9 runs. See "Reading the page back" for where the HTML sits. |
| `NODE_VERIFIES_BROWSER_SIG` | **yes** | Task 2 proceeds with the format in Global Constraints. |

## What was run

**S6, the phone.** A page with capabilities `{db:{}, user:{}}` generated a P-256 key pair (private key non-extractable, `exportKey` refused it) and kept it in IndexedDB `phone-inbox` / `keys` / `device`. After the app was fully closed and reopened, the page found the same key and showed the same code. The page was then republished with a one-word change (a new version id at the same URL); on reopening, the same code again. This was tested only in the claude.ai Android app on one Android 16 phone; the phone's own browser and iOS were not tested.

**Signature format.** The phone signed `JSON.stringify({v:1, spike:true, page, at})` and wrote `{payload, sig, sigBytes, jwk, code, createdAt, ua}` to `spike/<auto id>`. Read back with ArtifactData and checked in Node 22 `globalThis.crypto.subtle` (same scope: the claude.ai Android app on one Android 16 phone):

- `sig` is 64 bytes (IEEE P1363, r‖s), base64url without padding, as WebCrypto's `sign` produces it.
- `verify({name:'ECDSA', hash:'SHA-256'}, key, sig, utf8(payload))` is true; the payload with one character appended is false.
- The code computed in Node equals the code the page showed.

**Thumbprint member order.** RFC 7638 orders the members lexicographically: `crv, kty, x, y`. A first Node check built `{kty, crv, x, y}` and got a different digest. Both sides must build exactly `JSON.stringify({crv, kty, x, y})`; Task 3 and Task 8 pin the same literal for this reason.

**P2, the module.** A throwaway plugin whose tool called `$.tool.call` for ArtifactData `query`, `set`, `update` with `if_version`, a deliberately stale `update`, and Artifact `read`.

- Under `claude -p` the Artifact tools do not exist (see the table).
- In a `--bg` session every call worked.

## Result shapes

`$.tool.call` resolves an object; the useful part is under `result`.

| Call | Shape |
|---|---|
| ArtifactData `set` / `update` | `result.db_write = {op, collection, doc_id, committed, version}`; `version` is a number, 1 after the first `set`. |
| ArtifactData `query` | `result.db_read = {op, collection, docs: [...]}` |
| A stale `if_version` | `{result: "Error: db write failed (version_mismatch): … now at version 2 …", text, isError: true}`. Detect it with `isError` plus `version_mismatch` in the text, not by a thrown error. |
| Artifact `read` | `result = {read: {bytes, code: 200, codeText, result: "", url, title}, artifactRead: {slug, ver}, owned}` |

## Reading the page back

The structured `read.result` field is an empty string. The page HTML is only in the call's `text` field, inside the publish skeleton within `<cowritten-artifact-html>…</cowritten-artifact-html>`. The part between `</head><body>` and `</body></html>` equals the published source file after trimming surrounding whitespace on both.

`artifactRead.ver` changes on every republish.

For Task 9:

- Compare `sha256hex(body.trim())` with `sha256hex(file.trim())`.
- If the text can't be parsed (no `cowritten-artifact-html` block or no skeleton body), treat it like a failed verifier: leave the rows untouched and put the error in `PhoneView.error`. Don't mark them `page changed`, since that would refuse answers over a read-back format change.
- `artifactRead.ver` may be stored next to `phone.page` to skip the hash when the version is unchanged. That is optional.

## `$.store`

`$.store.set` / `keys` work from a module tool. The data is a plain JSON file at `~/.claude/plugins/store/<plugin>_<install id>.json` (for the spike, `phone-spike_inline-<hash>.json`). Any process running as the user can read or edit it, which is the limit Call 4 of the plan documents.
