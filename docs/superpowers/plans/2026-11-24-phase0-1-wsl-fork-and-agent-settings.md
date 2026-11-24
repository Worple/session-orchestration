# Phases 0–1: WSL fork and live agent settings — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Get a fork of `session-orchestration` passing its tests inside WSL. Then add `session-status --set`, so a lead or the human can change a running agent's model, effort and permission mode without losing its conversation.

**Architecture:**
- Phase 0 forks the upstream plugin into WSL and adds a toolchain check.
- Phase 1 runs spikes first, then:
  - pure policy helpers in `lib.sh`;
  - a sibling script `set.sh`, sourced by `session-status --set`. It writes a per-session override file (live tier), resumes the agent under its own id with new flags (resume tier), or hands over to a fresh session (fresh tier);
  - a `turn.step` hook in `register.tsx` that applies the override file to every model request;
  - a guard rule so only the human uses `--by pane` or `bypassPermissions`;
  - pane card actions.

**Tech Stack:** bash with jq and python3 (in the guard), a TypeScript hooks module (the `claude-code` API, Claude Code ≥ 2.1.330), and upstream's test styles: bash `*.test.sh` with a fake `claude` on PATH, and `claude plugin test`.

**Spec:** `docs/superpowers/specs/2026-11-24-multi-agent-hub-design.md` (Phases 0 and 1)

## Global Constraints

- **Location:** everything runs inside WSL `Ubuntu-24.04`. The fork lives at `~/src/session-orchestration`, on the Linux filesystem, never under `/mnt/`.
- **Toolchain:** Node 22.x; Linux-native Claude Code ≥ 2.1.330; `jq git gh perl openssl python3 curl tmux`.
- **Names:** the plugin stays `session-orchestration`. The marketplace becomes `session-orchestration-hub`. Remote `upstream` points to `github.com/vargroozzz/session-orchestration`.
- **Keeping upstream merges easy:** keep edits to upstream files small. New behaviour goes in new files.
- **Paths below:** all relative to `plugins/session-orchestration/` unless they start with `.github/`, `scripts/` or `docs/`.
- **Effort levels:** `low medium high xhigh max`.
- **Permission modes:** `acceptEdits auto bypassPermissions manual dontAsk plan` (Claude Code 2.1.331), plus upstream's `default`.
- **`bypassPermissions` and `plan`:** only ever set with `--by pane`.
- **Override file:** `${XDG_CACHE_HOME:-$HOME/.cache}/session-status/settings/<session-id>.json`, containing `{"model"?: string, "effort"?: string, "by": string, "why": string, "at": <epoch s>}`. Written via a temp file and `mv`.
- **Change log:** `$(proj_dir)/settings.jsonl`, one object per change: `{"at","id","name","by","why","tier":"live|resume|fresh","old":{"model","effort"},"new":{"model","effort","mode"}}`.
- **`--set` exit codes:**

  | Code | Meaning |
  |---|---|
  | 0 | done |
  | 1 | listing, stop or resume failed |
  | 2 | usage error, no such session, or invalid value |
  | 3 | busy, waiting, locked, or interactive and needs resume |
  | 4 | over `SESSION_STATUS_MAX_RESUME` (200000) tokens for a resume |
  | 5 | outside policy; last line is `needs your approval: set "NAME" (ID8) to <changes>` |
- **Scrubbing:** repo text must pass `./scrub-check.sh`: no personal names, emails or `/Users/` paths.
- **Branches:** `setup/wsl` for Phase 0 and `feat/agent-settings` for Phase 1. Each is merged to the fork's `main` by a PR.

## Calls this plan makes beyond the spec

- **The PATH check is a new `scripts/wsl-doctor.sh`,** not an addition to upstream's `--init --check`. This keeps upstream edits small.
- **Spikes S1 (`/model` via `$.command.run`) and S4 (`setMode` without restart) are dropped.** `turn.step` covers live model and effort, and mode changes use the resume tier.
- **The pane gets Up and Down a rung only.** Mode changes come from the lead within policy, or from the human typing `! session-status --set … --by pane`.
- **`policy.remote` and `--by hub:LOGIN` wait for Phase 4,** when hub requests exist.

## Review Focus

1. **Mode change while the agent is mid-turn or waiting on a prompt.** Refused with exit 3, and nothing is stopped (Task 6).
2. **Stale override file.** One left behind after a resume or handover that passed flags would quietly bring back old values. Both paths delete it (Tasks 6 and 8).
3. **Corrupt or hostile override file.** The agent's requests pass through unchanged and the bad fields are dropped (Task 9).
4. **`--mode` on an interactive session.** Refused with exit 3. A live model or effort change is still allowed (Task 6).
5. **A coordinator or worker typing `--by pane`, a variable in place of `--by`, or `bash -c "…--set…"`.** Denied by the guard (Task 7).

---

## Phase 0: environment and fork

### Task 1: WSL toolchain

**Files:** none (machine setup).

**Where it runs:** from the Windows session, through `wsl -d Ubuntu-24.04 …`. From Task 3 on, work in a Claude Code session started inside WSL in `~/src/session-orchestration`.

- [ ] **Step 1: Start the distro.**
  Run: `wsl -d Ubuntu-24.04 -- echo ok`. Expected: `ok`.
- [ ] **Step 2: Install system packages as root.**
  Run: `wsl -d Ubuntu-24.04 -u root -- bash -lc 'apt-get update && apt-get install -y jq git gh perl openssl python3 curl tmux ca-certificates'`. Expected: exit 0.
- [ ] **Step 3: Install Node 22 as root** (NodeSource).
  Run: `wsl -d Ubuntu-24.04 -u root -- bash -lc 'curl -fsSL https://deb.nodesource.com/setup_22.x | bash - && apt-get install -y nodejs'`. Expected: `node --version` prints `v22.`….
- [ ] **Step 4: Install Claude Code as the normal user.**
  Run: `wsl -d Ubuntu-24.04 -- bash -lc 'curl -fsSL https://claude.ai/install.sh | bash'`. Expected: `~/.local/bin/claude --version` is ≥ `2.1.330`.
- [ ] **Step 5 (human): sign in.** In a WSL terminal, run `claude` and finish signing in, then run `gh auth login`.
- [ ] **Step 6: Verify which binaries win.**
  Run: `wsl -d Ubuntu-24.04 -- bash -lc 'for c in claude jq node python3 gh git perl curl tmux; do command -v $c; done'`.
  Expected: every path is under `/usr` or `/home`, never `/mnt/c`. If any is under `/mnt/c`, put `~/.local/bin` first in PATH in `~/.profile`, and install the missing Linux package.

### Task 2: Fork, clone, baseline, docs

**Files:**
- Create in the fork: `docs/superpowers/specs/2026-11-24-multi-agent-hub-design.md` and `docs/superpowers/plans/2026-11-24-phase0-1-wsl-fork-and-agent-settings.md`, copied from the Windows working folder `docs/superpowers/`.
- Create: `docs/superpowers/notes/2026-11-24-wsl-baseline.md`.

- [ ] **Step 1: Fork and clone.** This creates a repo under the user's GitHub account; the approved plan covers that.
  Run: `mkdir -p ~/src && cd ~/src && gh repo fork vargroozzz/session-orchestration --clone`.
  Expected: `git -C ~/src/session-orchestration remote -v` lists `origin` (the fork) and `upstream` (vargroozzz).
- [ ] **Step 2: Create the branch.** Run `git switch -c setup/wsl`.
- [ ] **Step 3 (human): give the scrub pattern.** Ask the user for one case-insensitive ERE of their personal markers, such as their name and handles. Write it to `~/.config/scrub-deny`. Never invent it.
- [ ] **Step 4: Run the baseline.**
  Run: `for t in $(git ls-files '*.test.sh'); do printf '%s: ' "$t"; bash "$t" 2>&1 | tail -1; done; ./scrub-check.sh; claude plugin validate .; claude plugin test plugins/session-orchestration`.
  Expected: each test prints `ok…`, scrub prints `ok`, validate passes, and plugin test passes.
- [ ] **Step 5: Record the baseline.** Write each failing test to `docs/superpowers/notes/2026-11-24-wsl-baseline.md` with its last lines.
  - Fix a failure only if it's WSL-specific and blocks a file Phase 1 touches: `session-status.test.sh` sections `config shared accounts handover`, `coordinator-guard.test.sh`, or `hooks/*.test.ts`.
  - Leave everything else recorded and unfixed.
- [ ] **Step 6: Copy the docs in and commit.**
  Copy the spec and plan in, then run `git add docs && git commit -m "docs: hub design, phase 0-1 plan, WSL baseline"`.

### Task 3: Fork identity and `wsl-doctor`

**Files:**
- Modify: `.claude-plugin/marketplace.json`: `name` → `session-orchestration-hub`, `owner.name` → the user's GitHub login.
- Modify: `.github/workflows/release.yml`: add `if: github.repository == 'vargroozzz/session-orchestration'` to the `release` job, so the fork never writes release commits.
- Create: `scripts/wsl-doctor.sh` and `scripts/wsl-doctor.test.sh`. CI's `git ls-files '*.test.sh'` picks the test up.

**Interfaces:**
- Produces: `scripts/wsl-doctor.sh`.
  - Prints one line per check, either `ok NAME PATH [VERSION]` or `FAIL NAME: REASON`.
  - Exits 0 only when every check is ok.
  - Env `WSL_DOCTOR_WINDOWS_PREFIX` (default `/mnt/`) sets the path prefix that counts as Windows.

- [ ] **Step 1: Write the failing test** `scripts/wsl-doctor.test.sh`, in upstream's style (`set -euo pipefail`, a temp dir, prints `ok`). Stubs go in `$tmp/bin`:
  - `node` prints `v22.11.0`; `claude` prints `2.1.331 (Claude Code)`;
  - `jq python3 gh git perl curl tmux` each just exit 0.

  Run the doctor with `PATH=$tmp/bin:/usr/bin:/bin WSL_DOCTOR_WINDOWS_PREFIX=$tmp/mnt/` from a temp git repo. Cases:
  1. All present: exit 0, and 9 `ok ` lines.
  2. `node` prints `v20.1.0`: exit 1, and a line `FAIL node: v20.1.0 is older than 22`.
  3. `claude` prints `2.1.300 (Claude Code)`: exit 1, with `FAIL claude: 2.1.300 is older than 2.1.330`.
  4. A second `claude` stub placed first in PATH at `$tmp/mnt/c/bin/claude`: exit 1, with `FAIL claude: resolves to Windows ($tmp/mnt/c/bin/claude)`.
  5. Without the `jq` stub (PATH limited to `$tmp/bin`): `FAIL jq: not found`.
  6. Run from a repo under `$tmp/mnt/src`: `FAIL repo: under $tmp/mnt/ (use the Linux filesystem)`.
- [ ] **Step 2: Run it and see it fail.**
  Run: `bash scripts/wsl-doctor.test.sh`. Expected: fails, because no `scripts/wsl-doctor.sh` exists yet.
- [ ] **Step 3: Implement `scripts/wsl-doctor.sh`.**
  - Find each tool with `command -v`.
  - Compare versions with `sort -V`; the minimums are node 22 and claude 2.1.330.
  - Take the repo root from `git rev-parse --show-toplevel`.
- [ ] **Step 4: Run the tests.**
  Run: `bash scripts/wsl-doctor.test.sh && bash scripts/wsl-doctor.sh && ./scrub-check.sh`. Expected: `ok`, every check `ok`, then `ok`.
- [ ] **Step 4b: Give the fork's CI the scrub pattern.** Without it, CI's `scrub-check.sh` fails on the fork's own PRs.
  Run: `gh secret set SCRUB_DENY --repo "$(gh api user -q .login)/session-orchestration" < ~/.config/scrub-deny`. Expected: `✓ Set Actions secret SCRUB_DENY`.
- [ ] **Step 5: Install and smoke-test the fork's plugin.**
  - Run `claude plugin marketplace add ~/src/session-orchestration && claude plugin install session-orchestration@session-orchestration-hub`.
  - In a scratch repo (`~/src/scratch`, `git init`), the human starts `claude`, types `Act as a coordinator`, and asks it to start two `claude --bg` workers on trivial tasks.
  - Expected: `claude agents` lists both workers, and the coordinator's board shows them.
- [ ] **Step 6: Commit and open the PR.**
  Run `git add -A && git commit -m "chore: fork identity, wsl-doctor"`, then `git push -u origin setup/wsl && gh pr create --fill`. Merge after review.

---

## Phase 1: live model, effort and mode (branch `feat/agent-settings`)

### Task 4: Spikes S2, S3, S5

**Files:**
- Create: `docs/superpowers/notes/2026-11-24-phase1-spikes.md`.
- Create: a throwaway plugin at `~/spikes/turnstep/`, outside the repo and never committed.

**Interfaces:** produces the decisions Tasks 6, 8 and 9 read:
- `LIVE`: `on` or `off`;
- `RESUME_KEEPS`: `yes` or `no`;
- `DEFAULT_MODE_WORD`: `default` or `manual`.

- [ ] **Step 1: S5, the hooks module loads in WSL.**
  In a WSL terminal, the human runs `claude` in `~/src/scratch` and types `/coordinator`.
  Expected: the coordinator pane opens. Record pass or fail.
- [ ] **Step 2: S2, a `turn.step` rewrite works in a `--bg` session.**
  - Write `~/spikes/turnstep/` (`.claude-plugin/plugin.json` plus `hooks/hooks.json` naming the module `register.tsx`). Its single hook: `on('turn.step', async function* ($, e, next) { … })`. When `/tmp/spike-model` exists, it calls `next({ ...e, model: <its trimmed text> })`; otherwise `next(e)`.
  - Run `claude --plugin-dir ~/spikes/turnstep --bg --model opus -n spike-b 'Run Bash "sleep 20" three times, saying a number before each'`.
  - After the first number, run `echo haiku > /tmp/spike-model`.
  - Expected: in the session's transcript, assistant rows after the change have `message.model` matching `haiku`. Also record what `requestedModel` and `effort` show.
  - Repeat with an effort rewrite (`effort: 'low'`) and record the `effort` field.
  - Set `LIVE=on` only if the model rewrite shows.
- [ ] **Step 3: S3, resume with flags keeps the id and the new settings.**
  - Run `claude stop <spike-b id>`, then `claude --bg --resume <id> --model sonnet --effort low --permission-mode acceptEdits 'Which model are you?'`.
  - Expected: output contains `backgrounded · <same first 8 of id>`, and new assistant rows show sonnet and effort `low`.
  - Set `RESUME_KEEPS=yes` if so.
  - Then try `--permission-mode default`. Set `DEFAULT_MODE_WORD=default` if it's accepted, else `manual`.
- [ ] **Step 4: Record and commit.**
  Write each spike's commands, observations and decision line in the notes file, then run `git add docs/superpowers/notes && git commit -m "docs: phase 1 spike results"`.
  - **If `LIVE=off`:** Task 6's default tier is `resume`, and Task 9 is skipped.
  - **If `RESUME_KEEPS=no`:** Task 6's resume tier keeps the override file instead of deleting it. That only helps when `LIVE=on`. If both are bad, `--set` offers only `--how fresh`.
  - **If `DEFAULT_MODE_WORD=manual`:** `set.sh` and `bg_cmd` pass `--permission-mode manual` wherever the mode is `default` (Tasks 6 and 8). `mode_ok` still accepts both words.

### Task 5: Policy helpers and config keys in `lib.sh`

**Files:**
- Modify: `lib.sh`:
  - `person_keys_drop` (~L72-74): add `.policy` to the `del(...)` list;
  - after `model_ok` (~L410-414): add `mode_ok`;
  - after `escalate_rung` (~L427-436): add `deescalate_rung`;
  - in `config()` (~L465-541): add the `policy.*` keys, their checks and defaults;
  - after `config()`: add `policy_allows`.
- Modify: `skills/choosing-model-effort/SKILL.md`: add a "Stepping down" section.
- Test: `skills/orchestrating-sessions/session-status.test.sh`: a new `if section policy; then … fi`, plus one assertion in the `config` section.

**Interfaces:**
- `mode_ok MODE`: exit 0 iff MODE is one of `default manual acceptEdits auto dontAsk plan bypassPermissions`.
- `deescalate_rung MODEL EFFORT`: prints `MODEL EFFORT` one rung down, applying the first rule that matches:
  1. `max` becomes `xhigh`, same model;
  2. any fable model becomes `opus`, same effort;
  3. `xhigh`, `high` or `medium` steps down one;
  4. at `low`, opus becomes sonnet and sonnet becomes haiku.

  A `[1m]` suffix is kept throughout. Exit 1 at `haiku low` or on an unknown effort.
- `config policy.models`: a JSON array of strings, each passing `model_ok`. Prints one per line. Default: empty, meaning any model.
- `config policy.max_effort`: an effort. Default `max`.
- `config policy.modes`: a JSON array, each passing `mode_ok` and not `bypassPermissions` or `plan`. Prints one per line. Default: `default manual acceptEdits auto dontAsk`, one per line.
- `policy_allows BY MODEL EFFORT MODE`: an empty argument means unchanged.
  - Exit 0 means allowed. Exit 1 means refused, with one reason line on stdout. Exit 2 means an unknown `BY`.
  - `BY=pane` allows any valid values.
  - `BY=lead`: the model must equal, or start with, an entry in `policy.models` (when that list isn't empty); the effort must be at most `policy.max_effort` in the order low…max; the mode must be in `policy.modes`.

- [ ] **Step 1: Write the failing `policy` section.** Use a helper that sources lib.sh in the fixture: `L() { (cd "$root" && HOME=$tmp XDG_STATE_HOME=$tmp/state XDG_CONFIG_HOME=$tmp/.config; . "$here/../../lib.sh"; "$@"); }`. Assertions:
  ```bash
  [ "$(L deescalate_rung opus max)" = "opus xhigh" ] && [ "$(L deescalate_rung fable xhigh)" = "opus xhigh" ] &&
  [ "$(L deescalate_rung opus high)" = "opus medium" ] && [ "$(L deescalate_rung 'opus[1m]' low)" = "sonnet[1m] low" ] &&
  [ "$(L deescalate_rung sonnet low)" = "haiku low" ] && ! L deescalate_rung haiku low && ! L deescalate_rung opus extreme ||
    { echo "deescalate_rung"; exit 1; }
  L mode_ok acceptEdits && L mode_ok default && ! L mode_ok yolo || { echo mode_ok; exit 1; }
  L policy_allows lead sonnet low acceptEdits && ! L policy_allows lead '' '' bypassPermissions &&
    ! L policy_allows lead '' '' plan && L policy_allows pane opus max bypassPermissions || { echo "policy defaults"; exit 1; }
  rc=0; L policy_allows nobody '' low '' >/dev/null || rc=$?; [ $rc = 2 ] || { echo "unknown BY"; exit 1; }
  echo '{"policy":{"models":["sonnet","haiku"],"max_effort":"high","modes":["manual"]}}' > "$root/.claude/coordination.local.json"
  ! L policy_allows lead opus low '' && L policy_allows lead 'sonnet[1m]' high manual &&
    [ "$(L policy_allows lead sonnet xhigh '')" = "effort xhigh is over policy.max_effort high" ] || { echo "policy narrowed"; exit 1; }
  echo '{"policy":{"modes":["bypassPermissions"]}}' > "$root/.claude/coordination.local.json"
  [ "$(L config policy.modes 2>&1 | head -1)" = 'warning: config policy.modes=["bypassPermissions"] is not valid: using the default' ] ||
    { echo "bad modes fallback"; exit 1; }
  ```
  In the `config` section, after the `approvals.delegate` repo-file check, assert that a committed file can't set policy: `echo '{"policy":{"max_effort":"low"}}' > "$a/.claude/coordination/coordination.json"`, then `[ "$(cfg "$a" policy.max_effort)" = max ]`. Restore the file afterwards.
- [ ] **Step 2: Run them and see them fail.**
  Run: `bash skills/orchestrating-sessions/session-status.test.sh policy config`. Expected: FAIL in `policy` (deescalate_rung not found) and in `config` (`unknown config key: policy.max_effort`).
- [ ] **Step 3: Implement** the four lib.sh changes above. The checks follow the existing `fable.accounts` array pattern and the `plan.models.*` check. Add the new keys to the "unknown config key" list.
- [ ] **Step 4: Add "Stepping down" to `choosing-model-effort/SKILL.md`.** Its rules:
  - Use `session-status --set ID --down --why '…'` once a session's remaining work is a lower kind: review passed and only release steps remain, or it's only waiting on CI.
  - Never go below the kind the remaining work needs.
  - Go up with `--up` when the same failure repeats, in place of `--handover --escalate`, unless context is too big.
- [ ] **Step 5: Run the tests.**
  Run: `bash skills/orchestrating-sessions/session-status.test.sh policy config shared`. Expected: `ok: policy config shared`.
- [ ] **Step 6: Commit.** Run `git commit -am "feat: policy helpers, mode_ok, deescalate_rung"`.

### Task 6: `session-status --set`

**Files:**
- Create: `skills/orchestrating-sessions/set.sh`. It's sourced, not executed, so it can use `find_session read_row stop_session resume_with mid_turn transcript_of activity_fields TMP SELF`.
- Modify `skills/orchestrating-sessions/session-status`:
  - **~L1998-2000:** add `SET=` to the variable list and `--set) SET=1; shift ;;` to the case.
  - **~L2002 and ~L2083:** add `$SET` to both guard strings.
  - **Just before `if [ -n "$COMPACT" ]` (~L2385):** add `if [ -n "$SET" ]; then . "$(dirname "$SELF")/set.sh"; exit $?; fi`.
  - **`resume_with` (~L2188-2193):** add an optional 6th argument FLAGS, a pre-quoted string inserted right after the id: `$1 --bg --resume "$0" $FLAGS "$1"…`. Existing callers are unchanged.
- Create: `features/agent-settings.md`. It covers the three tiers, `--by`, policy keys, exit codes, the log, and how the human sets `bypassPermissions` (`! session-status --set ID --mode bypassPermissions --by pane` typed in their own terminal).
- Modify: `skills/orchestrating-sessions/SKILL.md`. One bullet where it covers model and effort: "Change a running session's model, effort or mode with `--set` (features/agent-settings.md); never by handover alone."
- Test: `session-status.test.sh`, a new `if section set; then … fi`.

**Interfaces:**
- **Consumes:** `mode_ok`, `deescalate_rung`, `escalate_rung`, `policy_allows`, `model_ok` and `last_model` (Task 5 and lib.sh), and the Task 4 decisions.
- **Produces:**
  - **CLI:** `session-status --set ID [--model M] [--effort E] [--mode P] [--up|--down] [--how auto|live|resume|fresh] [--why TEXT] [--by lead|pane] [-- 'NEXT']`. ID needs 8+ characters. `--by` defaults to `lead`, and `--how` to `auto`.
  - **Tier for `auto`:** `resume` when `--mode` is given; otherwise `live` (or `resume` when `LIVE=off`).
  - **Output:** the override file and the log line, in the Global Constraints formats.
  - **What it prints:**
    - live tier: `"NAME" (ID8): CHANGES from its next request (live)`;
    - live tier, session not running: `"NAME" (ID8): CHANGES when it next runs (live)`;
    - resume tier: `"NAME" (ID8): CHANGES, resumed under its own id (resume)`.
  - **Resume prompt text:** `Settings changed by BY: CHANGES (WHY). Carry on with your task; if it was finished, end your turn without a message.`, where CHANGES is a comma-separated list like `model sonnet, effort low, mode acceptEdits`.

- [ ] **Step 1: Write the failing `set` section.**
  - **Setup:** call `accounts_claude`, and use `rid=22222222-2222-3333-4444-555555555555`. Its transcript has a first prompt plus one assistant row `{"type":"assistant","requestedModel":"opus","effort":"max","message":{"model":"claude-opus-5-5","content":[{"type":"text","text":"hi"}]}}`.
  - **Helper:** `O() { cat "$tmp/.cache/session-status/settings/$rid.json"; }`.
  - **Log helper:** `LOG() { tail -1 "$(pof "$root")/settings.jsonl"; }`.

  Cases, each followed by `calls` to reset the call log:
  1. **live:** `setacct cfg "$(sess "$rid" rev idle 1)"`. Then `run --set "$rid" --model sonnet --effort low --why cheap` exits 0, with output ending `(live)`.
     - `O | jq -r '"\(.model) \(.effort) \(.by) \(.why)"'` is `sonnet low lead cheap`.
     - `LOG | jq -r '"\(.tier) \(.old.model) \(.new.model)"'` is `live opus sonnet`.
     - `calls | grep -c 'stop\|--bg'` is 0.
  2. **live merge:** `run --set "$rid" --effort high`. Then `O | jq -r '.model+" "+.effort'` is `sonnet high`.
  3. **up and down:** `run --set "$rid" --up` gives `sonnet xhigh` in O. Then `rm` the override file and run `run --set "$rid" --down`, which gives `opus xhigh`, because the transcript says opus/max.
  4. **resume for a mode:** run `run --set "$rid" --mode acceptEdits --why trust`. Expected:
     - `calls | grep -v ' agents '` begins with `cfg stop 22222222` and then `cfg --bg --resume $rid --model opus --effort xhigh --permission-mode acceptEdits Settings changed by lead: mode acceptEdits (trust).`;
     - the override file is gone;
     - `LOG | jq -r .tier` is `resume`.
  5. **busy or waiting:** for st in busy and waiting, `setacct cfg "$(sess "$rid" rev $st 1)"`. Then `--set "$rid" --mode auto` exits 3 with no `stop` or `--bg` in calls.
  6. **interactive:** with `sess "$rid" rev idle 1 interactive`, `--mode auto` exits 3 and says `interactive`. `--model sonnet` exits 0 (live).
  7. **policy:** write `{"policy":{"modes":["manual"]}}` to `$root/.claude/coordination.local.json`. Then `--set "$rid" --mode auto` exits 5, and its last line is `needs your approval: set "rev" (22222222) to mode auto`. `--mode bypassPermissions` (by lead) also exits 5. With `--by pane --mode bypassPermissions`, the resume call carries `--permission-mode bypassPermissions`.
  8. **too big:** give a session the 620k-token usage row from the `accounts` section. `--set ID --mode auto` exits 4, and its output names `--how fresh`.
  9. **usage:** `--set "$rid" --effort extreme` exits 2. `--set "$rid"` with no change exits 2 and prints a `usage:` line. `--set 1234` exits 2.
  10. **lock:** with `mkdir -p "$tmp/.cache/session-status/compact-$rid"`, `--mode auto` exits 3 and says `being compacted`.
- [ ] **Step 2: Run it and see it fail.**
  Run: `bash skills/orchestrating-sessions/session-status.test.sh set`. Expected: FAIL, because the flag is unknown and the board prints instead.
- [ ] **Step 3: Implement `set.sh` and the `session-status` edits.**
  - **Current values:** take model and effort from the override file, else from `last_model "$(transcript_of "$id")"`.
  - **Resume tier:**
    - Reuse `--compact`'s lock dir `~/.cache/session-status/compact-$id`, with the same 10-minute expiry, so the two can't race.
    - Pass the current model and effort as flags together with the change, so a resume can't bring back old values.
    - Delete the override file after a successful resume. Keep it instead when `RESUME_KEEPS=no`.
  - **Fresh tier:** run `bash "$SELF" --handover "$id" --model M --effort E [--mode P] -- "$NEXT"`. Log only if it exits 0.
- [ ] **Step 4: Run the tests.**
  Run: `bash skills/orchestrating-sessions/session-status.test.sh set accounts handover`. Expected: `ok: set accounts handover`. `accounts` and `handover` show `resume_with` callers still work.
- [ ] **Step 5: Commit.** Run `git add -A && git commit -m "feat: session-status --set (live, resume, fresh tiers)"`.

### Task 7: The guard keeps `--by pane` and `bypassPermissions` with the human

**Files:**
- Modify: `hooks/coordinator-guard.sh`.
  - Move `deny()` (~L56-61) to just after `input=$(cat)` (L27). It doesn't depend on anything defined later: it reads `$cwd`, which stays unset that early, and that's fine.
  - Add the rule right after it, so it runs for every session kind before the kind lookup exits.
- Test: `hooks/coordinator-guard.test.sh`.

**Interfaces:**
- Produces a deny, with the reason `Only the user sets --by pane, plan or bypassPermissions: they type it in their own terminal (! session-status --set …). Run --set without them, or queue an ask.`, for a Bash command whose text matches either:
  - **(A) a wrapped `--set`:** `(eval|sh -c|bash -c|zsh -c)[^;&|]*--set`, always; or
  - **(B) a direct `--set` with a reserved value:** `session-status[^;&|]*--set` together with any of `--by[= ]+['"]?(pane|hub)`, `--by[= ]+['"]?[$\`(]`, `bypassPermissions`, `--mode[= ]+['"]?plan`.

- [ ] **Step 1: Write the failing cases** in `coordinator-guard.test.sh`, using its `g SID TOOL INPUT` and `check` helpers:
  ```bash
  check "$(g c1 Bash '{"command":"bash x/session-status --set 22222222 --by pane --mode auto"}')" deny 'set --by pane (coordinator)'
  check "$(g w1 Bash '{"command":"session-status --set 22222222 --by=pane"}')" deny 'set --by pane (worker)'
  check "$(g nokind Bash '{"command":"session-status --set 22222222 --mode bypassPermissions"}')" deny 'set bypass (any session)'
  check "$(g c1 Bash '{"command":"session-status --set 22222222 --by \"$B\""}')" deny 'set --by variable'
  check "$(g c1 Bash '{"command":"bash -c \"session-status --set 22222222 --model haiku\""}')" deny 'set through bash -c'
  check "$(g c1 Bash '{"command":"session-status --set 22222222 --mode plan"}')" deny 'set plan mode'
  check "$(g c1 Bash '{"command":"session-status --set 22222222 --model sonnet --why \"by pane later\""}')" allow 'set by lead'
  check "$(g w1 Bash '{"command":"echo --by pane"}')" allow 'no --set'
  ```
- [ ] **Step 2: Run it and see it fail.**
  Run: `bash hooks/coordinator-guard.test.sh`. Expected: `FAIL set --by pane (coordinator): got allow, want deny`.
- [ ] **Step 3: Implement** the move and the rule. Match with bash `[[ =~ ]]` against the `"command"` string pulled out with `jq -r '.tool_input.command // empty'`, and only when `tool_name` is `Bash`.
- [ ] **Step 4: Run the tests.**
  Run: `bash hooks/coordinator-guard.test.sh`. Expected: `ok`.
- [ ] **Step 5: Commit.** Run `git commit -am "feat: guard keeps --by pane and bypass with the user"`.

### Task 8: `--handover` respects settings and takes `--mode`

**Files:**
- Modify `skills/orchestrating-sessions/session-status`:
  - **`bg_cmd` (~L427-429):** an optional second argument MODE. When given, it prints `PREFIX --bg --permission-mode MODE`. Otherwise it behaves as today.
  - **`--handover` parsing (~L2544):** accept `--mode P`, checked with `mode_ok`; a bad value exits 2.
  - **Model and effort precedence:** explicit flag, then the override file of the old id, then the plan row, then `last_model`. Read the override file just before the plan-row lookup (~L2601).
  - **Start (~L2652):** pass MODE to `bg_cmd`.
  - **After success:** `rm -f` the old id's override file.
  - **Usage line:** add `[--mode P]`.
- Test: `session-status.test.sh` `handover` section.

**Interfaces:**
- Consumes: the Task 6 override-file format and `mode_ok`.
- Produces: `--handover ID [--model M] [--effort E] [--mode P] [--escalate] -- 'NEXT'`.

- [ ] **Step 1: Write the failing cases** in `handover`.
  - With an override file `{"model":"sonnet","effort":"low","by":"lead","why":"x","at":1}` for the old id and no flags, the logged `--bg` call contains `--model sonnet --effort low`. Afterwards the override file is gone.
  - With `--mode acceptEdits` and `$tmp/cfg/settings.json` set to `{"permissions":{"defaultMode":"plan"}}`, the `--bg` call contains `--permission-mode` exactly once, as `--permission-mode acceptEdits`.
  - `--mode yolo` exits 2.
- [ ] **Step 2: Run it and see it fail.**
  Run: `bash skills/orchestrating-sessions/session-status.test.sh handover`. Expected: FAIL.
- [ ] **Step 3: Implement** the edits above.
- [ ] **Step 4: Run the tests.**
  Run: `bash skills/orchestrating-sessions/session-status.test.sh handover set plan launch`. Expected: `ok: handover set plan launch`.
- [ ] **Step 5: Commit.** Run `git commit -am "feat: handover takes --mode and the live settings"`.

### Task 9: The `turn.step` hook applies the override (skip if `LIVE=off`)

**Files:**
- Modify: `hooks/register.tsx`.
  - Add an exported `parseOverride` near `weeklyLine` (~L1266).
  - Add the hook inside `register` (~L1702-), next to `turn.complete`.
- Create: `hooks/settings.test.ts`.

**Interfaces:**
- Consumes: the override file path and format (Global Constraints) and the existing `stampDir($)`.
- Produces:
  - `export function parseOverride(text: string): { model?: string; effort?: 'low'|'medium'|'high'|'xhigh'|'max' } | undefined`.
    - It drops a model that doesn't match `/^[a-z][a-z0-9.-]*(\[1m\])?$/` and an effort that isn't one of the levels.
    - It returns `undefined` for invalid JSON or when nothing valid is left.
  - `on('turn.step', async function* ($, e, next) {…})`. It applies only when `e.agentId === undefined`. It reads `${await stampDir($)}/settings/${await $.session.id()}.json` with `$.fs.read`; check `claude-code.d.ts` for the exact signature. A failed read means no override. Then it runs `return yield* next({ ...e, ...valid fields })`.

- [ ] **Step 1: Write the failing tests** in `hooks/settings.test.ts`, styled like `usage.test.ts` and `forward.test.ts` (import `'./register'` and `{ parseOverride }`).
  - **Unit checks:**
    - `parseOverride('{"model":"sonnet","effort":"low"}')` equals `{ model: 'sonnet', effort: 'low' }`;
    - `parseOverride('{"model":"rm -rf /","effort":"low"}')` equals `{ effort: 'low' }`;
    - `parseOverride('{"effort":"extreme"}')` and `parseOverride('{')` are both `undefined`.
  - **Hook test:**
    - Setup: `mock.env(on, { HOME: '/h' })`, `on('session.id', async () => ({ value: 's1' }))`, and an `fs.read` mock that serves only `/h/.cache/session-status/settings/s1.json`.
    - Engine stand-in: a bottom `on('turn.step', async function* (_, e) { seen.push([e.model, e.effort]); return { turnId: e.turnId, index: e.index, answer: '', toolUses: [] } })`.
    - Drive it: `const s = $.turn.step({ turnId: 't', index: 0, model: 'opus', effort: 'max', messageCount: 1 }); for await (const _ of s) {}`.
    - Expect `seen` to equal `[['sonnet', 'low']]`.
    - Further cases, each expecting `['opus', 'max']` unchanged: the same step with `agentId: 'a1'`; no file (the read throws); a malformed file.
    - A file with only `{"effort":"low"}` expects `['opus', 'low']`.
- [ ] **Step 2: Run it and see it fail.**
  Run: `claude plugin test plugins/session-orchestration`. Expected: FAIL in `settings.test.ts` (`parseOverride` not exported).
- [ ] **Step 3: Implement** `parseOverride` and the hook.
- [ ] **Step 4: Run the tests.**
  Run: `claude plugin test plugins/session-orchestration && claude plugin validate .`. Expected: pass, and every other hooks test still passes.
- [ ] **Step 5: Live check.**
  - Start a real worker: `claude --bg --model opus --effort xhigh -n set-check 'Run Bash "sleep 30" twice, saying a number before each'`.
  - Run `session-status --set <id> --model sonnet --effort low` between the numbers.
  - Expected: `session-status --peek <id>` and the transcript show sonnet on the rows after the change. Then `session-status --set <id> --mode acceptEdits` and `claude agents` shows the same id.
- [ ] **Step 6: Commit.** Run `git add -A && git commit -m "feat: turn.step applies live model/effort overrides"`.

### Task 10: Pane card actions Up and Down a rung

**Files:**
- Modify: `hooks/register.tsx`:
  - a new atom `setting` (pattern: `compacting`, L40);
  - `async function runSet($, id, name, args: string[])`, modelled on `runCompact` (~L1535-1550);
  - next to `compactAct` (~L2098-2105), a `rungActs(a)` that returns `act('+', 'Up a rung', …)` and `act('-', 'Down a rung', …)` for any session with activity;
  - `+` and `-` added to the keys `parseActions` keeps for the pane (the same check that reserves Compact's `z`).
- Test: `hooks/settings.test.ts`.

**Interfaces:**
- Consumes: the Task 6 CLI.
- Produces: pressing `+` runs `session-status --set <id> --up --by pane`, and pressing `-` runs the same with `--down`. Each toasts the command's first stdout line, or `Settings "NAME": <reason or exit N>`.

- [ ] **Step 1: Write the failing test.** Copy `compact.test.ts`'s second test setup (its `STATUS` fixture, `process.run` mock, `ui.toast` capture and card press).
  - Expect a press of `+` on an idle background card to record `runs` containing `['--set', '<id>', '--up', '--by', 'pane']` and toast the mocked stdout.
  - Add a `parseActions('[{"label":"X","hotkey":"+","command":"x"}]').errors[0]` check that matches `/pane's own/`.
- [ ] **Step 2: Run it and see it fail.**
  Run: `claude plugin test plugins/session-orchestration`. Expected: FAIL.
- [ ] **Step 3: Implement** the edits above.
- [ ] **Step 4: Run the full suite.**
  Run: `claude plugin test plugins/session-orchestration && bash skills/orchestrating-sessions/session-status.test.sh && bash hooks/coordinator-guard.test.sh && ./scrub-check.sh`. Expected: all pass.
- [ ] **Step 5: Commit and open the PR.**
  Run `git commit -am "feat: pane Up/Down a rung"`, then `git push -u origin feat/agent-settings && gh pr create --fill`.
