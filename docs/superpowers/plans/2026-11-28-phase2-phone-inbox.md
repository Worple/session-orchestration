# Phase 2: phone inbox — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Answer the coordinator's approval asks from your phone. A private claude.ai page shows the open asks. A tap signs the answer with a key that lives only on your paired phone. The coordinator's hooks module checks the signature and submits the answer exactly as a pane click does, so the existing approval gate needs no change.

**Architecture:**
- **The page** (`phone-inbox/inbox.html`) keeps a non-extractable ECDSA P-256 key in the browser's IndexedDB. It reads the mirrored asks from its database and writes signed answer rows back.
- **The hooks module** (new `hooks/phone.tsx`, wired into `register.tsx`) talks to the page database itself through `$.tool.call('ArtifactData')`. Plugin tool calls are auto-allowed, and no model turn is involved.
  - It mirrors the asks whenever they change.
  - Every 60 s it sweeps for pairing requests and answers.
  - It verifies each signature with Node (`hooks/verify-sig.mjs`).
  - It claims the ask and submits `answerText(...)` through a `claimAndSubmit` helper factored out of the pane click.
- **Pairing:** the fingerprint shown on the phone is approved by a button in the coordinator pane.

**Tech Stack:** TypeScript hooks module (the `claude-code` API, Claude Code ≥ 2.1.330), a plain HTML/JS artifact page (the `db` and `user` capabilities), Node 22 WebCrypto, and bash tests.

**Spec:** `docs/superpowers/specs/2026-11-24-multi-agent-hub-design.md` (Phase 2, and the "Trust and safety" section)

## Global Constraints

- **Location and base:** inside WSL, in `~/src/session-orchestration`. Work on branch `feat/phone-inbox`, cut from `feat/agent-settings` (PR #2), which touches the same files. Paths are relative to `plugins/session-orchestration/` unless they start with `docs/`.
- **Keep upstream merges easy:** new behaviour goes in new files (`hooks/phone.tsx`, `hooks/verify-sig.mjs`, `skills/orchestrating-sessions/phone-inbox/…`). `register.tsx` gets only the `claimAndSubmit` refactor and wiring lines.
- **The gate stays unchanged:** `verify-approval.sh`, `approvals.jq` and `approved-action.sh` are not edited. A phone answer submits the exact text `answerText(a, option)`: `Approval pane answer for KEY: OPTION. Asked: QUESTION`.
- **Crypto:**
  - ECDSA P-256 with SHA-256.
  - The signature is the 64-byte IEEE P1363 form (r‖s), as WebCrypto produces it, encoded base64url without padding.
  - The device id `fp` is the RFC 7638 JWK thumbprint: SHA-256 over `{"crv":"P-256","kty":"EC","x":"…","y":"…"}` (exactly these members, in this order, no spaces), base64url. A JWK carrying `d` is refused.
  - The human code is the first 16 hex digits of that digest, uppercase, grouped as `XXXX-XXXX-XXXX-XXXX`.
- **Payload:** the exact UTF-8 string the phone signs: `{"v":1,"root":R,"askId":I,"key":K,"question":Q,"option":O,"at":MS,"device":FP}`.
  - Built with `JSON.stringify` of an object with the keys in that order. `at` is the phone's epoch milliseconds.
  - The bytes are signed and verified as stored, so no canonical form is needed.
  - `root` is the same 16-hex id as the project's asks store (`hex16(projectRoot)`).
- **Page database** (default rules, so only the owner writes). Each document has one writer:

  | Path | Created by | Fields | Updated by the module |
  |---|---|---|---|
  | `coordinators/<root>` | module | `{v:1, project, asks: PhoneAsk[], activity, updatedAt}` | — |
  | `devices/<fp>` | page | `{jwk:{kty,crv,x,y}, label, createdAt}` | `{state:"paired"\|"rejected", stateAt}` |
  | `answers/<uuid>` | page | `{root, payload, sig, device, createdAt}` | `{result:"queued"\|"delivered"\|"refused", reason?, resultAt}` |

  `PhoneAsk` is `{id, key, question, options, at, details?, target?}`.
- **Limits:**
  - mirror: at most 50 asks (oldest first), `details` cut at 4000 characters and `activity` at 4000, each cut ending in `…`;
  - payload at most 8 KiB;
  - device label at most 40 characters after `clean` and `oneLine`;
  - `PHONE_MAX_AGE_MS = 3_600_000`, `PHONE_SKEW_MS = 300_000`, `PAIR_MAX_AGE_MS = 600_000`;
  - the sweep runs every `60_000` ms, and answer rows whose result is older than `86_400_000` ms are deleted.
- **Store** (`$.store`, per account): `phone.url` (string), `phone.devices` (`Record<fp, {jwk, label, code, pairedAt}>`), `phone.rejected` (`string[]`), `phone.used` (`Record<sha256hex(payload), at>`, pruned past max age plus skew), and `phone.page` (Task 9).
- **Refusal reasons** (exact strings, shown on the phone): `malformed answer`, `unpaired device`, `bad signature`, `expired`, `clock ahead`, `already used`, `withdrawn or changed`, `not an option`, `already answered`, `not delivered: <why>`, and `page changed` (Task 9).
- **New state atoms must be declared** in `types/index.d.ts` `PluginState`, and every check below includes `claude plugin validate plugins/session-orchestration/`. That validation step is what failed PR #2's CI.
- **Portability:** shell tests run on macOS CI too. Use `wc -l | tr -d ' '`, no GNU-only flags, and do hashing in node.
- **Engine types for reference:** `plugin-authoring/types/claude-code.d.ts`, from the skills bundled with Claude Code 2.1.330 (the controller passes its local path to each implementer):
  - `$.store` at about L4115;
  - `$.prompt.submit` at about L3561 and L12129;
  - `$.tool.call` at about L3663;
  - the ArtifactData and Artifact inputs at about L22503-22611 and their results from about L23427.

  Page capability types: the bundled `artifact-capabilities/0.2.99/{db,user}.d.ts`.

## Calls this plan makes beyond the spec

1. **Wake-up is a 60 s module sweep, not a comment.**
   - The module reads the answer rows itself, so a tap costs no model turn, and nothing depends on comment-watch arming.
   - The page declares `db` and `user`, not `comments`.
   - Cost: up to a minute before an answer reaches the coordinator. A busy coordinator would make it wait for the turn's end anyway.
2. **The module mirrors and reads the database itself** (`$.tool.call` of ArtifactData; plugin calls are auto-allowed).
   - The model's only parts are publishing the page once, calling `phone_setup`, and optionally `phone_answers` to sweep at once.
3. **Signatures are verified by Node** (`verify-sig.mjs` via `runBash`), because the module's `crypto.subtle` is typed for `digest` only. Node 22 is already a required tool.
   - P-256 rather than Ed25519, because it has wider mobile WebCrypto support.
4. **`$.store` is a plain file under the Claude config folder, not model-proof.** The spec assumed it was.
   - The signature stops what upstream admits it can't stop: a session writing a fake decision row with ArtifactData.
   - It does not stop a session that deliberately edits the plugin's store file. That is the same limit upstream's transcript-based gate has, and it is documented.
5. **The phone offers the listed options only.** Answers in your own words stay in the terminal's question dialog.
6. **Same prompt text as a pane click,** so the gate is untouched. Where an answer came from goes to the usage log (`Phone answer`) and to the page.
7. **A page-integrity check (Task 9) only if Spike P2 shows the artifact can be read back byte-exact.** Otherwise it becomes a documented residual risk: a session that republishes the page with other code could sign with your phone's key while the page is open.
8. **No repo config key.** The page URL and the devices live in the plugin's store, per account.
9. **Spike S7 is settled by the engine types, not run.** `$.prompt.submit` queues until the session is idle, and resolves when that turn starts. So the pane click awaits it, and a tool handler or sweep never does. Tasks 4 and 7 pin this with tests.

## Review Focus

1. **A long-busy coordinator.** `phone_answers` called mid-turn returns at once; awaiting `$.prompt.submit` inside a tool handler would deadlock, because submit waits for idle. The row reads `queued` until the turn starts, then `delivered` (Task 7).
2. **Two taps on one ask** (a double tap, or Yes then No). Exactly one prompt. The second row is refused with `already answered` or `withdrawn or changed` (Task 7).
3. **Verifier unavailable** (node missing, crash, timeout). Rows stay untouched and unconsumed, and the pane shows the error. A later sweep delivers them once node works (Task 7).
4. **Another project's answer rows.** Left untouched for that project's coordinator, neither refused nor consumed (Task 7).
5. **A huge mirror** (60 asks with 20 KB details each). The document stays within the limits above (Task 5).

---

### Task 1: Spikes — phone key storage and module access to the page database

**Files:** `docs/superpowers/notes/2026-11-28-phase2-spikes.md` (new). Throwaway material goes in `~/spikes/phone/`, not committed.

- [ ] **Step 1 (S6, phone).** Publish a spike page (capabilities `{db:{}, user:{}}`) with three buttons:
  - **Generate:** a P-256 key pair, the private key non-extractable, kept in IndexedDB `phone-inbox`/`keys`/`device`. It shows the code.
  - **Check:** reads the key back and shows its code.
  - **Sign:** writes `spike/<uuid>` `{payload, sig, jwk}`.

  Human steps: open the page on the phone (the claude.ai app, then the phone's browser), Generate, close the app fully, reopen, Check. Then the controller republishes the page with a one-word change and the human taps Check again.
  Record: `IDB_KEEPS=yes|no` and `KEEPS_ACROSS_REPUBLISH=yes|no`.
- [ ] **Step 2 (signature format).** Read the `spike/*` row with ArtifactData and verify it in node with `crypto.webcrypto.subtle.verify({name:'ECDSA',hash:'SHA-256'}, …)`. Record `NODE_VERIFIES_BROWSER_SIG=yes|no`.
- [ ] **Step 3 (P2, module).** Make a throwaway plugin `~/spikes/phone/mod` whose tool `spike_db` runs `$.tool.call` with:
  - ArtifactData `get` and `query` on `spike`;
  - `set` on a new doc, then `update` with `if_version`;
  - Artifact `read` of the spike URL.

  It returns the raw results. Run it in `~/src/scratch` with `claude -p --plugin-dir ~/spikes/phone/mod 'Call spike_db with url <URL> and print its result.'`.
  Record:
  - `MODULE_DB=yes|no`;
  - the result shapes (where `version` sits);
  - `READBACK_EXACT=yes|no` (whether the read-back page equals the published file byte for byte);
  - the `$.store` file path.
- [ ] **Step 4: Write the notes,** with a decisions block and what each changes. These rules bind later tasks:
  - `MODULE_DB=no`: **stop and ask the user.** The fallback is the spec's original flow, where the model carries rows to `phone_answers`, and it needs a revised plan.
  - `IDB_KEEPS=no`: Task 8 keeps the key in memory and asks to pair on each visit.
  - `KEEPS_ACROSS_REPUBLISH=no`: the docs say a page update means pairing again.
  - `READBACK_EXACT=no`: Task 9 becomes a docs-only residual-risk note.
  - `NODE_VERIFIES_BROWSER_SIG=no`: stop. The signature format needs fixing before Task 2.
- [ ] **Step 5: Commit** (`docs: phase 2 spike notes`).

### Task 2: `verify-sig.mjs` and the crypto test

**Files:** create `hooks/verify-sig.mjs` and `skills/orchestrating-sessions/phone-inbox/phone-inbox.test.sh`.

**Interfaces:**
- Produces the CLI `node hooks/verify-sig.mjs`:
  - stdin is `{"jwk":{kty,crv,x,y},"payload":"<string>","sig":"<base64url>"}`;
  - exit 0 means valid;
  - exit 1 means a bad signature;
  - exit 2 means malformed input: bad JSON, a JWK that isn't an EC P-256 public key or that carries `d`, a signature that isn't 64 bytes, or a payload over 8 KiB.

  It prints nothing on 0 and one reason line on stderr otherwise. It also exports `verifySig(jwk, payload, sig): Promise<boolean>`.

- [ ] **Step 1: Write the failing test** `phone-inbox.test.sh`. It drives node to generate a P-256 key pair and sign with `crypto.webcrypto` (P1363, base64url), then pipes cases into the CLI:
  - a valid signature → 0;
  - one changed byte in the payload → 1;
  - a different key's JWK → 1;
  - a JWK with `d` → 2;
  - a 63-byte signature → 2;
  - non-JSON stdin → 2;
  - a 9 KiB payload → 2.

  The script prints `ok` or the first failure.
- [ ] **Step 2: Run it.** `bash plugins/session-orchestration/skills/orchestrating-sessions/phone-inbox/phone-inbox.test.sh`. Expected: FAIL (no CLI yet).
- [ ] **Step 3: Implement `verify-sig.mjs`** with `globalThis.crypto.subtle.importKey('jwk', {kty,crv,x,y}, {name:'ECDSA',namedCurve:'P-256'}, false, ['verify'])` and `verify`.
- [ ] **Step 4: Run it.** Expected: `ok`.
- [ ] **Step 5: Commit** (`feat: verify-sig.mjs checks a phone's P-256 signature`).

### Task 3: Pure phone helpers

**Files:** create `hooks/phone.tsx` (pure exports only in this task); test in `hooks/phone.test.ts`.

**Interfaces (produced, all exported from `hooks/phone.tsx`):**
```ts
type Jwk = { kty: 'EC'; crv: 'P-256'; x: string; y: string }
type Payload = { v: 1; root: string; askId: string; key: string; question: string; option: string; at: number; device: string }
type AnswerRow = { id: string; version: number; root: string; payload: string; sig: string; device: string; result?: string }
type Device = { jwk: Jwk; label: string; code: string; pairedAt: number }
type PhoneAsk = { id: string; key: string; question: string; options: string[]; at: number; details?: string; target?: string }
sha256hex(text: string): Promise<string>                               // crypto.subtle.digest of the UTF-8 bytes
thumbprint(jwk: Jwk): Promise<{ fp: string; code: string }>          // RFC 7638, crypto.subtle.digest
publicJwk(v: unknown): Jwk | null                                      // refuses `d`, other curves, bad base64url
parseAnswerRow(id: string, version: number, v: unknown): AnswerRow | null
parsePayload(text: string): Payload | null
judgePayload(p: Payload, row: AnswerRow, ctx: { root: string; now: number; hash: string; used: Record<string, number>; asks: Ask[] }):
  { ok: true; ask: Ask } | { ok: false; reason: string }
mirrorDoc(project: string, asks: Ask[], activity: string, now: number): { v: 1; project: string; asks: PhoneAsk[]; activity: string; updatedAt: number }
```
`judgePayload` checks, in this order:
1. `p.device === row.device` and `p.root === row.root === ctx.root`, else `malformed answer`;
2. `now - p.at > PHONE_MAX_AGE_MS` → `expired`, and `p.at - now > PHONE_SKEW_MS` → `clock ahead`;
3. `ctx.hash` in `used` → `already used`;
4. an ask with the same `id`, `key` and exact `question` exists, else `withdrawn or changed`. If it exists but has `sending` set → `already answered`;
5. `option` is one of its `options`, else `not an option`.

- [ ] **Step 1: Write failing tests** in `hooks/phone.test.ts`:
  - `thumbprint of a fixed JWK is the pinned fp and code` (pin the literal; Task 8's shell test pins the same one);
  - `publicJwk refuses d, P-384 and bad base64url`;
  - `parsePayload refuses a missing field, v 2 and a non-number at`;
  - `judgePayload gives each reason in order`, one case per reason above plus one `ok`;
  - `mirrorDoc keeps 50 oldest asks, cuts details and activity at 4000 with …` (60 asks with 20 KB details → `JSON.stringify(doc).length < 210_000`).
- [ ] **Step 2: Run** `claude plugin test plugins/session-orchestration`. Expected: the new tests FAIL.
- [ ] **Step 3: Implement** the exports. `mirrorDoc` drops `seen`, `sending`, `body`, `kind` and `still_applies`.
- [ ] **Step 4: Run** the plugin tests and `claude plugin validate plugins/session-orchestration/`. Expected: all pass.
- [ ] **Step 5: Commit** (`feat: phone payload, thumbprint and mirror helpers`).

### Task 4: Factor `claimAndSubmit` out of the pane click

**Files:** modify `hooks/register.tsx` (`answer`, about L2165-2195, moves to module level); test in `hooks/register.test.ts`.

**Interfaces:**
- Produces `claimAndSubmit($: EngineInterface, a: Ask, option: string, label: string): Promise<{ sent: Promise<string | undefined> } | null>`:
  - It resolves `null` when the ask is gone or already claimed.
  - Otherwise it resolves once the claim is written. `sent` resolves `undefined` when delivered (ask dropped), or the drop reason when not delivered (ask put back). It rejects after putting the ask back on a throw.
  - `logPress($, label)` and `syncStatus` run as before.
- The pane's `answer(a, option)` becomes `claimAndSubmit` plus `await sent`, with the same toasts as today.

- [ ] **Step 1: Write the failing test** `claimAndSubmit resolves before delivery; sent settles when the turn starts`. Its `on('prompt.submit')` holds a promise. Assert that `claimAndSubmit` resolves with the ask marked `sending` while submit is pending. Resolving submit then drops the ask, and `sent` gives `undefined`.
- [ ] **Step 2: Run** the plugin tests. Expected: FAIL (not exported).
- [ ] **Step 3: Refactor.** Move the body out of the render closure, unchanged in behaviour, and export it.
- [ ] **Step 4: Run** the plugin tests. Expected: the new test passes, and so do the existing click and race tests (`register.test.ts` about L175, L208, L260 and L811) without edits.
- [ ] **Step 5: Commit** (`refactor: claimAndSubmit, the pane click's claim and submit`).

### Task 5: Phone setup and the mirror

**Files:** `hooks/phone.tsx` (I/O part), `hooks/register.tsx` (wiring), `types/index.d.ts`, `hooks/phone.test.ts`, `hooks/register.test.ts` (the tools list at about L1126).

**Interfaces:**
- Produces from `phone.tsx`:
  ```ts
  type PhoneDeps = {
    root($): Promise<string | undefined>; project($): Promise<string>; activity($): Promise<string>
    asks($): Promise<Ask[]>                                            // this project's store, sending included
    claimAndSubmit: typeof claimAndSubmit                              // Task 4
    runNode($, script: string, stdin: string): Promise<{ exitCode: number; stderr: string }>
  }
  createPhone(deps: PhoneDeps): {
    setup($, url: string): Promise<string>; mirror($): Promise<void>; sweep($): Promise<string>
    pair($, fp: string): Promise<void>; reject($, fp: string): Promise<void>; unpair($, fp: string): Promise<void>
    rows($, accent: Color): RenderNode[]
  }
  ```
- The atom `phone` (key `phone`) holds `PhoneView = { url: string | null; devices: { fp: string; label: string; code: string }[]; pairing: { fp: string; label: string; code: string; at: number }[]; last: string | null; error: string | null }`. It is declared in `PluginState`.
- The tool `phone_setup` takes input `{url: string}`, matching `https://claude.ai/(code/)?artifact/…`. An empty string turns the phone inbox off.
  - It stores `phone.url`, then mirrors at once.
  - It returns `Phone inbox set: open <url> on your phone, tap Pair this phone, and approve its code in the pane.` or `Phone inbox off.`
  - It is coordinator only, like `ask_approval`.
- Wiring in `register.tsx`:
  - `const phone = createPhone({...})`;
  - the tool spec and its handler;
  - `void phone.mirror($)` after `setAsksNow` writes a changed list;
  - `$.clock.every(60_000, …)` in `open()` calling `phone.sweep`, with one sweep at a time.
- `mirror` does nothing without `phone.url`, or when the document text equals the last one written.
  - Otherwise it writes `coordinators/<root>` with ArtifactData `set`.
  - It passes `if_version` once the version is known. After a version refusal it runs `get` and retries once. A failure goes to `PhoneView.error`.

- [ ] **Step 1: Write failing tests** in `phone.test.ts`, with `mock.store` and `on('tool.call', {tool:'ArtifactData'})` recording calls:
  - `phone_setup stores the url and mirrors the asks once`;
  - `a new ask mirrors; an unchanged list writes nothing`;
  - `a version refusal re-reads and retries once`;
  - `no url: nothing is written`;
  - `phone_setup refuses a non-artifact url`;
  - `phone_setup with "" turns it off`.

  Also add `phone_setup` and `phone_answers` to the tools list test.
- [ ] **Step 2: Run** the plugin tests. Expected: FAIL.
- [ ] **Step 3: Implement** the I/O part, the wiring and the `PluginState.phone` declaration.
- [ ] **Step 4: Run** the plugin tests plus `claude plugin validate plugins/session-orchestration/`. Expected: all pass.
- [ ] **Step 5: Commit** (`feat: phone_setup, and the asks mirrored to the phone inbox`).

### Task 6: Pairing in the pane

**Files:** `hooks/phone.tsx`, `hooks/register.tsx` (one `section('Phone', …)` line in the pane), `hooks/phone.test.ts`.

**Behaviour:**
- The sweep queries `devices` (limit 50). It lists in `PhoneView.pairing` every document with:
  - no `state`;
  - `now - createdAt <= PAIR_MAX_AGE_MS`;
  - `publicJwk` valid;
  - `thumbprint(jwk).fp === doc id`;
  - the fp neither paired nor rejected.
- **The pane section `Phone`** shows `Pair phone "<label>" XXXX-XXXX-XXXX-XXXX? Pair only if your phone shows this code.` with **Pair** and **Reject** buttons (no hotkeys). Each paired device has an **Unpair** button. The section ends with a dim line: the URL, the last sweep's summary, and any error.
- **Pair** stores the device in `phone.devices`, with the fp recomputed and never taken from the doc, then updates the doc to `state: "paired"`. **Reject** adds the fp to `phone.rejected` and writes `state: "rejected"`. **Unpair** removes the device from the store.

- [ ] **Step 1: Write failing tests:**
  - `a fresh device doc shows a pairing row; Pair stores it and marks the doc paired`;
  - `Reject remembers the fp and marks it rejected; the row never returns`;
  - `a doc older than 10 minutes, a doc whose id isn't its thumbprint, or a JWK with d shows no row`;
  - `Unpair removes the device`.
- [ ] **Step 2: Run** the tests. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the plugin tests and validate. Expected: pass.
- [ ] **Step 5: Commit** (`feat: pair a phone from the coordinator pane`).

### Task 7: The answer sweep and `phone_answers`

**Files:** `hooks/phone.tsx`, `hooks/register.tsx` (tool spec and handler), `hooks/phone.test.ts`.

**Behaviour.** `sweep` queries `answers` where `root == <this root>` (limit 100) and handles each row with no `result`, in `createdAt` order:
1. `parseAnswerRow` fails → `malformed answer`.
2. The device isn't in `phone.devices` → `unpaired device`.
3. `runNode(verify-sig.mjs)` exits 1 → `bad signature`; exits 2 → `malformed answer`. **Any other outcome** (a spawn error, timeout or other code) leaves the row untouched, sets `PhoneView.error = "can't verify phone answers: <why>"`, and stops this sweep.
4. `parsePayload`, then `judgePayload` with `hash = sha256hex(payload)` → a refusal reason.
5. Write `queued` with the row's `if_version` **before** claiming. That versioned write is the lock between two coordinators of one project (a handover's overlap): a version refusal means another session took the row, so skip it.
6. Then write the hash into `phone.used`, then call `claimAndSubmit(a, option, 'Phone answer')`:
   - `null` → update the row to `already answered`;
   - otherwise **don't await `sent`**. When it settles, write `delivered`, or `not delivered: <why>`.

Every write is an ArtifactData `update` with the row's `if_version`. Rows whose result is older than a day are deleted. The return value is one line: `Phone: N delivered (KEYS), M refused (reasons)`, or `Phone: nothing new`.

The tool `phone_answers` (no input, coordinator only) runs the same sweep and returns its line, plus `Delivered answers arrive as prompts once this turn ends.`

- [ ] **Step 1: Write failing tests**, faking `runNode` through `on('process.run')` by argv:
  - `a good answer gives exactly one prompt with the pane-answer text and marks the row delivered`;
  - `bad signature`, `unpaired device`, `expired`, `clock ahead`, `withdrawn ask`, `changed question`, `not an option`: each refused with its exact reason, and no prompt;
  - `the same payload twice: the second is already used` (replay);
  - `Yes then No for one ask: one prompt, the second refused` (Review Focus 2);
  - `phone_answers returns while prompt.submit is still pending; the row goes queued, then delivered` (Review Focus 1);
  - `node failing leaves rows untouched and shows the error; the next sweep delivers` (Review Focus 3);
  - `a row for another root is not touched` (Review Focus 4);
  - `a version refusal on the queued write skips the row: no claim, no prompt`;
  - `a dropped submit marks not delivered and puts the ask back`.
- [ ] **Step 2: Run** the tests. Expected: FAIL.
- [ ] **Step 3: Implement.** `runNode` in `register.tsx` is `runBash($, ['-c', 'exec node "$0"', script], { stdin, timeoutMs: 10_000 })`.
- [ ] **Step 4: Run** the plugin tests and validate. Expected: pass, with the older tests unchanged.
- [ ] **Step 5: Commit** (`feat: phone answers verified and submitted like a pane click`).

### Task 8: The page

**Files:** create `skills/orchestrating-sessions/phone-inbox/inbox.html`; extend `phone-inbox.test.sh`.

**Behaviour:**
- **Loading.** On load it calls `claude.use('db')` and `claude.use('user')`. With no db: `Open this page signed in as its owner.`. A 10 s loading timeout shows a message and never reloads.
- **Not paired yet.** It shows a **Pair this phone** button and a label input (default `Phone`).
  - The button generates the key (IndexedDB `phone-inbox`/`keys`/`device`, private key non-extractable) and creates `devices/<fp>` with `{jwk, label, createdAt}`.
  - It then shows `XXXX-XXXX-XXXX-XXXX — approve this code in the coordinator pane` and listens to that doc: `paired` opens the inbox, and `rejected` offers Pair again with a new key.
- **The inbox.** One `onSnapshot` on `coordinators` renders each project: its asks as cards (question, key, details, target), one button per option, and its activity with "as of HH:MM".
- **A tap** disables that card's buttons. It builds `payloadFor(...)`, signs it, and creates `answers/<randomUUID>` with `{root, payload, sig, device, createdAt}`.
- **Answer status.** One `onSnapshot` on `answers` where `device == fp` (newest 20) shows each answer's state on its card: `Sent — the coordinator picks it up within a minute`, `Queued`, `Delivered`, or `Refused: <reason>`.
- **Rendering.** Every database value is set with `textContent`. There is no free-text answer.
- **Pure functions** go between `// phone-inbox:pure-start` and `// phone-inbox:pure-end`: `b64url`, `thumbprintInput(jwk)`, `codeOf(digestBytes)`, and `payloadFor(root, ask, option, fp, at)`.
- If Task 1 found `IDB_KEEPS=no`, the key is kept in memory and the page says `This phone forgets its key when the page closes: pair again each visit.`

- [ ] **Step 1: Write failing cases** in `phone-inbox.test.sh`. Extract the pure block with `sed` and evaluate it in node:
  - `payloadFor` gives the exact Global Constraints string for a fixture ask;
  - the thumbprint of the fixed JWK equals the literal Task 3 pinned;
  - a payload built by the page and signed with node verifies through `verify-sig.mjs` (the page and the module agree end to end).
- [ ] **Step 2: Run** the test. Expected: FAIL.
- [ ] **Step 3: Write the page** (one file: HTML, CSS and a module script; no external scripts).
- [ ] **Step 4: Run** the shell test, and publish the page as a scratch artifact for a smoke check on the phone (pair, see one fake mirrored ask). Expected: `ok`, and the page works on the phone.
- [ ] **Step 5: Commit** (`feat: the phone inbox page`).

### Task 9: Page integrity (only if `READBACK_EXACT=yes`, otherwise a docs note)

**Files:** `hooks/phone.tsx`, `hooks/phone.test.ts`.

**Behaviour:**
- `phone_setup` reads the page back (Artifact `read` via `$.tool.call`) and compares its sha256 with the plugin's own `skills/orchestrating-sessions/phone-inbox/inbox.html`, read with `$.fs.read`.
  - On a match it stores `phone.page`.
  - On a mismatch it refuses with `The page at <url> isn't the plugin's inbox.html: republish it from the plugin (phone-inbox.md), then call phone_setup again.`
- A sweep that has rows to handle reads the page again first. On a mismatch it marks those rows `page changed`, and the pane shows the same warning.

- [ ] **Step 1: Write failing tests:**
  - `setup refuses a page that differs from the plugin file`;
  - `a sweep after the page changed refuses its rows with page changed and submits nothing`;
  - `matching page: answers go through`.
- [ ] **Step 2: Run** the tests. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the plugin tests and validate. Expected: pass.
- [ ] **Step 5: Commit** (`feat: phone answers only through the plugin's own page`).

If `READBACK_EXACT=no`: skip Steps 1-4, put the residual risk in Task 10's feature doc, and record the ruling in the ledger.

### Task 10: Docs and the end-to-end check

**Files:** create `skills/orchestrating-sessions/phone-inbox.md` (for the coordinator) and `features/phone-inbox.md` (for people). Modify `skills/orchestrating-sessions/SKILL.md` (one bullet).

- **`phone-inbox.md`** covers:
  - Setting up when the user asks: publish `phone-inbox/inbox.html` from the plugin unchanged, with the Artifact tool and capabilities `{db:{}, user:{}}`; call `phone_setup` with the URL; give the user the URL.
  - Republishing it after a plugin update.
  - `phone_answers` when the user says they answered on the phone.
  - **Never write the page's database yourself.**
  - A phone answer arrives as an ordinary `Approval pane answer` prompt.
- **`features/phone-inbox.md`** covers: what it does; pairing; what the signature protects and what it doesn't (Calls 4 and 7); the 60 s delay; that asks need the coordinator pane open; and how to unpair or turn it off.

- [ ] **Step 1: Write both docs and the SKILL.md bullet.** Then run `bash docs-lint.test.sh`, the docs-lint script on the repo, and `./scrub-check.sh`. Expected: clean.
- [ ] **Step 2: Run the full verification** (below). Expected: everything green except the two known WSL-only baseline failures.
- [ ] **Step 3: End to end, with the human** (a coordinator in `~/src/scratch` with the branch's plugin installed):
  1. Publish the page and run `phone_setup`.
  2. Pair the phone and approve the code in the pane.
  3. The coordinator queues `ask_approval` with key `PHONE-1` (Yes/No).
  4. Tap Yes on the phone. Within about 60 s the coordinator gets `Approval pane answer for PHONE-1: Yes…`, and the page shows Delivered.
  5. `session-status --relay PHONE-1 '<action>'` prints `APPROVAL relayed from the user` and its own `verify-approval.sh` check passes.
  6. A merge through the unchanged `approved-action.sh` hook is checked only if the user offers a scratch GitHub repo with a PR. Creating one needs their OK.
- [ ] **Step 4: Forged rows.** From a WSL session, write two answer rows with ArtifactData: one with a paired device's fp and a random sig, one with an unknown device. After the next sweep: `refused: bad signature` and `refused: unpaired device`, and no prompt.
- [ ] **Step 5: Commit** (`docs: phone inbox`). Then hand off to finishing-a-development-branch.

## Verification

- `bash plugins/session-orchestration/skills/orchestrating-sessions/phone-inbox/phone-inbox.test.sh` prints `ok`.
- `claude plugin test plugins/session-orchestration` passes, with the new `hooks/phone.test.ts` and the unchanged older tests.
- `claude plugin validate plugins/session-orchestration/`, `claude plugin validate plugins/project-memory/` and `claude plugin validate .` pass.
- Every `*.test.sh` passes (`git ls-files '*.test.sh'`), except the two known WSL-local failures. Run `session-status.test.sh` once with a padded-`wc` shim on PATH, to catch macOS-only breakage before CI.
- `./scrub-check.sh` and docs-lint are clean.
- The end-to-end and forged-row checks in Task 10 pass.
- After the push, the PR's three CI jobs (`plugin`, `shell (ubuntu-latest)`, `shell (macos-latest)`) are green.

## After approval

1. Create `feat/phone-inbox` from `feat/agent-settings`.
2. Save this plan as `docs/superpowers/plans/2026-11-28-phase2-phone-inbox.md`, with a copy under the Windows working folder's `docs/superpowers/plans/`, and commit it.
3. Run it with subagent-driven development, the method you chose for Phases 0 and 1. Task 1 needs you twice: opening the spike page on your phone, and closing and reopening it.
