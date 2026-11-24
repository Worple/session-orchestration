# Multi-agent hub: design

Status: approved 2026-11-24. Implementation plans: `docs/superpowers/plans/`.

## Context

You want one system that coordinates many Claude Code agents doing code work: tickets, then pull requests, then review, then merge. Some agents run in parallel on one machine. Some belong to other people and run on their machines. Lead agents run the process and post questions for humans to answer whenever they get to them. The system can change any agent's model, permission mode and effort.

The starting point is your friend's MIT-licensed plugin, `vargroozzz/session-orchestration`. It already covers the single-machine part well:
- a coordinator session starts `claude --bg` workers and tracks them by reading their logs;
- async questions appear as buttons in a terminal panel;
- merges wait behind a verified approval.

What it lacks:
1. Changing model or effort without losing context. Today it stops the agent and starts a fresh one, and it never touches permission mode.
2. A web page for answering questions.
3. Task and result exchange with other people's agents.
4. A central, group-steered lead.
5. Native Windows support. It's bash for macOS/Linux, so it runs on Windows only through WSL.

**Decisions you made**
- **Work type:** code in git repos.
- **Platform:** your machine runs everything inside **WSL Ubuntu 24.04**.
- **Two levels:** one **central project lead** on an **always-on Linux server**, steered by a group of people through a **self-hosted web dashboard** (GitHub login, works on a phone). Plus **department leads** on each person's machine, under that person's own Claude account. Accounts are mixed.
- **Department leads:** each runs your friend's coordinator with local parallel workers and talks to its own human through **both** the terminal panel and a **private claude.ai page**.
- **Group questions:** the central lead aims each one at a person, a department or "anyone". The first allowed answer wins, and everyone sees who answered.
- **Hub:** our own server, a web app plus SQLite. Departments connect out over HTTPS with a per-department token.

## Architecture

```
Always-on Linux server
  central lead (Claude Code coordinator, user "lead")  --local API-->  hub (Node 22 + SQLite, user "hub")
  hub <--HTTPS (Cloudflare Tunnel)-- group dashboard (GitHub login; phone-first)
  hub <--HTTPS, per-dept bearer token, outbound polling-- department leads

Each person's machine (WSL / macOS / Linux)
  department lead (upstream coordinator) -> parallel `claude --bg` workers (one per ticket -> PR)
  human <-> terminal panel  +  private claude.ai page (answers signed by a paired phone)
```

## Key design decisions

**Changing model, mode and effort.** New command: `session-status --set NAME|ID [--model M] [--effort E] [--mode P] [--why T] [--by pane|hub:LOGIN]`. It has three tiers:
1. **Live (model and effort):** the agent's hooks module adds an `on('turn.step')` hook that rewrites `model` and `effort` on every request. This is confirmed in the engine types at `plugin-authoring/types/claude-code.d.ts:18842`: "A hook rewrites `model` or `effort` going down… a rewrite lasts one step". The hook reads `~/.cache/session-status/settings/<sid>.json`, so the change applies on the next request, mid-turn. Optionally, `/model` also runs at turn end through the existing queued-command runner (`register.tsx:1897-1925`).
2. **Resume (permission mode, or as a fallback):** `claude stop ID`, then `claude --bg --resume ID --model … --effort … --permission-mode …`. The conversation is kept.
3. **Fresh:** the existing `--handover` path, used when context is too big (about 200K tokens).

**Who decides**
- Leads decide by rule: the upstream task kinds plus `escalate_rung` (`lib.sh` ~L427), and a new `deescalate_rung` for cheap phases such as waiting on CI.
- Humans can override from the terminal panel, the phone page or the dashboard.
- The central lead or the group can only *request* a change to a department's agent. The department applies it if `policy.*` in that person's config allows it, and otherwise asks its own human.
- `bypassPermissions` is never accepted from a remote request.
- Every change is logged with old, new, who, why and tier.

**Trust and safety**
- Text from other departments, the group, or PRs is wrapped as data, the same way the upstream Links feature does it.
- Control requests are fixed fields that a script applies, not free text the model acts on.
- Tasks arriving from the central lead need the department human's Yes, unless `hub.accept: work` is set.
- Approvals never cross machines. Phone answers are signed by a paired device key; group answers are signed by the hub with Ed25519. The hooks module checks each signature before submitting the answer as a plugin-origin prompt, so the existing `approved-action.sh` and `verify-approval.sh` gate keeps working.
- `hub.*` and `policy.*` are personal-only config keys (`person_keys_drop`, `lib.sh` ~L72), so a repo file someone commits can't redirect or loosen them.
- The hub runs as its own Unix user, so agents can't write its database or read its signing key.

**Staying mergeable with your friend's upstream.** New features go in new sibling scripts, dispatched the way `pending` is. Edits to the big `session-status` script stay small. Generic parts, such as `--set`, could later be offered upstream as a PR.

## Phases (each one ships and tests on its own)

### Phase 0: environment and fork
- **WSL:** start Ubuntu 24.04. Install `jq git gh perl openssl python3 curl tmux`, Node 22, and Linux Claude Code via the native installer, then sign in.
- **Fork:** `gh repo fork vargroozzz/session-orchestration --clone` into `~/src/` on the Linux filesystem, not `/mnt/c`. Keep `upstream` as a remote. This creates a repo under your GitHub account.
- **PATH:** make sure the Linux `claude` and `python3` win over the Windows ones on PATH, and add this to `--init --check`. Windows PATH stays appended.
- **Fork CI:** set `SCRUB_DENY`, give the marketplace its own name, and decide whether to keep `release.yml`.
- **Acceptance:** all `*.test.sh`, `claude plugin validate .` and `claude plugin test plugins/session-orchestration` pass in WSL. Install the fork's plugin and run one coordinator with two workers on a test repo.

### Phase 1: live model, mode and effort switching (spikes first)
- **Spikes S1 to S4** (table below) settle which tier applies to each setting.
- **`session-status`:** add `--set` to the flag case (~L1999) and its guards, plus a dispatch block next to `--compact` (~L2385) that sources a new `skills/orchestrating-sessions/set.sh`.
- **Reused helpers:** `model_ok` (`lib.sh` ~L410), `find_session`/`stop_session`/`resume_with` (~L2170-2193, where `resume_with` gains an optional FLAGS argument), `mid_turn` (~L2152), `too_big` (~L2433), and `last_model` (`lib.sh` ~L454). Also make `--handover` (~L2607) read the override file and pass `--permission-mode` through.
- **`lib.sh`:** add `deescalate_rung`, `mode_ok` and `policy_allows WHO M E P`, plus new config keys `policy.{models,max_effort,modes,remote}`.
- **`hooks/register.tsx`:** add the `turn.step` override hook (main loop only, ignoring a bad file) and a "Settings" action on panel session cards.
- **Docs:** a de-escalation section in `skills/choosing-model-effort/SKILL.md`, and a new `features/agent-settings.md`.
- **Tests:** a `set` section in `session-status.test.sh`, using the fake-`claude` helper `accounts_claude` (~L72), covering:
  - the logged stop and resume calls with their flags;
  - the busy case, exit 3;
  - outside policy;
  - `bypassPermissions` from the hub refused;
  - the size limit, and the log line.

  Plus `config`/`shared` section cases for the new keys, and a new `hooks/settings.test.ts` for the `turn.step` rewrite.
- **Acceptance:** a live worker switches from opus/xhigh to sonnet/low on its next request, and the transcript shows it. A mode change keeps the session id.

### Phase 2: personal phone inbox (a private claude.ai page)
- **New files:**
  - `skills/orchestrating-sessions/phone-inbox/inbox.html` (capabilities `db`, `user`, `comments`), adapting the upstream `review-inbox/inbox.html` pattern;
  - `phone-inbox.md` and `features/phone-inbox.md`;
  - `hooks/verify-sig.mjs`.
- **Flow:**
  1. After each `ask_approval`, the coordinator mirrors the asks and a status document into the page's database with `ArtifactData`.
  2. **Pairing:** the page makes a non-extractable key in the browser, and you approve its fingerprint on the terminal panel. The public key is kept in the module's `$.store`, which the model can't write.
  3. **Answering:** a tap signs `{askId, key, question, option, at}` and leaves a comment, which wakes the coordinator.
  4. A new `phone_answers` tool checks the signature, the age, that the ask is still open and unchanged, and that the answer hasn't been used. It then claims the ask through a `claimAndSubmit` helper factored out of the panel-click code (`register.tsx` ~L844, `answerText` ~L119).
- **Why signing is needed:** the page database can't tell your tap apart from a session writing as you (upstream admits this in `review-inbox/verify-row.sh` ~L14).
- **Tests:** `hooks/phone.test.ts` (bad signature, replay, withdrawn ask, stale answer, unpaired device; a good answer gives exactly one prompt) and `phone-inbox.test.sh`.
- **Acceptance:** a phone Yes leads to `--relay` and then a merge that the unchanged hook allows. A row forged through `ArtifactData` is rejected.

### Phase 3: hub server MVP (new `hub/` package in the fork)
- **Stack:** Node 22 TypeScript, run by type-stripping so there's no build step. Libraries: `fastify`, `@fastify/cookie`, `better-sqlite3`, `zod`. Pages are server-rendered with escaped templates, live updates use SSE, and it installs on a phone as a PWA. `hub/bin/hubctl` manages people, departments and tokens.
- **Tables:** `people(login, role)`, `departments(id, owner, token_sha256, policy_json, last_seen, status_json)`, `dept_members`, `messages(seq, dept_id, dir, kind: task|result|ask|answer|note|control|status, ref, body ≤8KB, …)`, `tasks`, `questions(target_type: person|dept|anyone, target, options, state, answered_by, sig, …)`, `control_requests`, `agents`, `audit`, `web_sessions`.
- **First answer wins:** one `UPDATE questions … WHERE id=? AND state='open'` and a check that `changes()=1`. Each answer gets an Ed25519 signature.
- **API:**
  - humans: cookie plus CSRF;
  - central lead: `127.0.0.1` only, with a token file readable only by user `lead`;
  - departments: `GET /api/dept/inbox?after=SEQ` and `POST /api/dept/{messages,ack,control/:id/result}`;
  - `GET /api/pubkey`.

  Rate limits and size caps apply throughout.
- **Login:** GitHub OAuth with the `state` check, against an allowlist of logins mapped to roles and departments.
- **Exposure:** Cloudflare Tunnel by default, since it needs no inbound ports and can add Cloudflare Access. Caddy is the alternative if the box has a public IP.
- **Dashboard:** departments and their status, tasks, questions with who answered, controls for model, mode and effort, and the audit log.
- **Tests** (`node:test`, plus a new `hub` job in `.github/workflows/test.yml`):
  - two answers racing produce one winner;
  - department, person and anyone permissions, with a viewer refused;
  - department A can't read department B;
  - CSRF, OAuth `state` and size caps;
  - the hub's signatures verify with `verify-sig.mjs`;
  - every write creates an audit row.
- **Acceptance:** someone answers on a phone, and everyone sees "answered by @x". A control request is logged.

### Phase 4: departments joined to the hub
- **New script** `skills/orchestrating-sessions/hub`, dispatched like `pending`. Verbs:
  - `enroll URL --dept ID`: the token is read from stdin and stored at 0600, and the hub key is pinned after your panel Yes;
  - `pull`, `send --kind K`, `status`, `apply ID [--approved]`, `list`, `remove`.
- **Polling:** the watcher's `nap()` (~L1521) polls the hub the same way it polls Links today.
- **Incoming messages:** they reuse the Links cleanup (~L855-866: byte cap, control characters stripped, fields checked) and land in `coordinator-inbox.md` through `--inbox-add`, marked as data. Tasks are proposals unless `hub.accept: work` is set.
- **Control requests:** `apply` runs them through `policy_allows`, then `--set --by hub:LOGIN`. Anything outside policy becomes a panel ask.
- **Outgoing messages:** `status` is built from structured fields only and sent automatically. Every other kind needs your panel Yes, gated in `approved-action.sh` by copying the Links send gate (~L619-660). Text is scrubbed with `link_scrub` (~L724).
- **Tests:** `hub.test.sh` with a fake `curl` on PATH (the same approach as the fake `claude`), a case for the `--hub send` gate in `approved-action.test.sh`, and the `watch` section.
- **Acceptance:** the full loop works. A dashboard task reaches the department within about 2 minutes, you accept it on the panel, a worker opens a PR, and the result shows on the dashboard. A sonnet/low control applies live, and a `bypassPermissions` control is refused.

### Phase 5: central lead on the server, and deployment
- **Deployment files** in `deploy/`:
  - `systemd/hub.service`: runs as user `hub`, hardened;
  - `systemd/claude-lead.service`: runs as user `lead`, with an interactive coordinator inside tmux;
  - `cloudflared/config.yml`;
  - `backup/hub-backup.sh` with a timer: an encrypted `sqlite3 .backup` copied off-site, plus the lead's state.
- **Central role:** new `skills/orchestrating-sessions/central.md` and `hub task|ask|control` verbs that post to the local API.
- **Answers back to the lead:** a 60s timer in `register.tsx`, modelled on `forwardOutbox` (~L1626), fetches signed hub answers, checks them against the pinned key, and submits `Hub answer for KEY by @login: OPT…`. `approvals.jq` (~L23) and `verify-approval.sh` accept this prefix only when the signature checks out.
- **Notifications:** Web Push or self-hosted ntfy, sending only a count and a link.
- **Acceptance:**
  - an "anyone" question answered on a phone ends in a merge, with the whole chain in the audit log;
  - a race between two people gives exactly one prompt;
  - the hub restores from backup, and departments catch up after an outage.

## Spikes (run before the phase that needs them)

| | What to confirm | Fallback |
|---|---|---|
| S1 | `$.command.run('/model')` works in a `--bg` session | `turn.step` only |
| S2 | The `turn.step` rewrite works in `--bg`, and the transcript shows the new model and effort | tier 2 |
| S3 | `--bg --resume ID` with new flags keeps the id and the new settings, and resume doesn't restore the old model | handover |
| S4 | A mode change without restart (`setMode` via a PermissionRequest answer) | tier 2 for mode |
| S5 | The hooks module loads on WSL/Linux and on the Claude Code versions the departments run | feature-check, then degrade |
| S6 | On iOS and Android inside claude.ai: `crypto.subtle`, IndexedDB keeping the key, posting a comment from a tap | re-pair when the key is evicted |
| S7 | `$.prompt.submit` from a timer or tool, with the session busy and idle | queue until idle |
| S8 | Signing in on a headless server (`claude setup-token` or an API key) | — |

## Risks and open decisions
- **Central lead's Claude account and billing (decide before Phase 5).** An always-on lead steered by a group probably needs API or Team billing, not a personal Pro/Max login. Whose account it uses is your group's call.
- **Prompt injection between departments, the group and PR text.** Mitigated by wrapping text as data, applying controls through a script, requiring the human's Yes for tasks, never letting approvals cross machines, and size caps.
- **The hooks-module API is still changing.** Mitigated by feature checks at runtime, falling back to tier 2, and a minimum-version check in `--init --check`.
- **Upstream merge drift.** Mitigated by keeping changes in new files and keeping edits to `session-status` small.
- **Cloudflare can see dashboard traffic decrypted.** Switch to Caddy if that's unacceptable.

## Verification (end to end)
1. **Phase 0:** the upstream suite passes in WSL, and one coordinator with two workers runs on a scratch repo.
2. **Phase 1:**
   - `session-status --set W --model sonnet --effort low` changes the next request, which you check with `--peek` and in the transcript;
   - `--set W --mode acceptEdits` keeps the session id;
   - `bash session-status.test.sh set` and `claude plugin test` pass.
3. **Phase 2:** pair the phone, approve a merge from it, and it lands. A forged `ArtifactData` row is rejected.
4. **Phase 3:**
   - `node --test hub/` passes;
   - on a phone over the tunnel, two accounts race on one question and one wins;
   - the audit log shows it.
5. **Phase 4:** a dashboard task reaches your WSL department lead, gets your panel Yes, a worker PR opens, and the result is posted back. A control applies within policy and is refused outside it.
6. **Phase 5:** with systemd services on the server, a group answer leads to a verified central approval. A backup restore works.
