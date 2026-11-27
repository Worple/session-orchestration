# Phase 1 spikes, 2026-11-27

Claude Code 2.1.331 inside WSL Ubuntu 24.04. A throwaway plugin (`~/spikes/turnstep`, not committed) has one `turn.step` hook. Before each main-loop request it reads `/tmp/spike-model` and `/tmp/spike-effort`, passes `next({ ...e, model, effort })`, and logs what it saw, what it sent, and `$.session.id()`.

S2 and S3 ran in `claude -p` (print) mode, which needs no workspace-trust prompt. The `--bg` confirmation of both is folded into Task 9's live check, together with S5. Upstream's `--compact` already depends on `--bg --resume` keeping the id (`resume_with` checks `backgrounded · ID8`).

## Decisions

```
LIVE=on
RESUME_KEEPS=yes
DEFAULT_MODE_WORD=default
```

## S2: a `turn.step` rewrite of model and effort

The command, with the model file flipped to `haiku` 30 s in:

```
claude -p --plugin-dir ~/spikes/turnstep --model opus --effort high --allowedTools "Bash(sleep:*)" --output-format json \
  'Run the Bash command `sleep 20` three times, one call at a time. Before each call, say its number.'
```

- **Model: applies from the next request, mid-turn.** Steps 2 and 3, after the flip, went out as `haiku`. Their transcript rows have `message.model` and `requestedModel` set to `claude-haiku-5-5`. Steps 0 and 1 stayed `claude-opus-5-5`.
- **Effort: applies from the next step that carries input,** meaning the next turn, not mid-turn.
  - Flipping effort to `low` 30 s into the run: the hook sent `low` on steps 2 and 3, but the transcript kept `effort: "high"`. This matches `claude-code.d.ts` (TurnStepInput.effort): "a level on tool results alone is not sent if another is in force".
  - With the effort file present from the start, step 0 (which carries the prompt) went out `low`. Every row records `effort: "low"`, which stays for the later tool steps ("one on a step with input stays for later tool steps").
- **The transcript records what was sent:** `requestedModel` and `effort` reflect the rewrite. So upstream's `last_model` reads the live values back.
- **Session id:** `$.session.id()` returns the full session UUID. It equals the transcript's file name, which is the id `session-status` uses. The override file can therefore be keyed by it.

## S3: resume with flags

```
claude -p --resume <id of an opus/high session> --model sonnet --effort low --permission-mode acceptEdits --output-format json \
  'How many times did you run sleep earlier in this conversation? Answer with one number.'
```

- **The same session id came back,** and the conversation was kept: it answered `3`, which was correct.
- **The new row has the new values:** `requestedModel: claude-sonnet-5-5` and `effort: "low"`. The new user row has `permissionMode: "acceptEdits"`; earlier rows had `default`.

## Permission-mode word

- `claude --help` lists `acceptEdits, auto, bypassPermissions, manual, dontAsk, plan`.
- `--permission-mode default` is still accepted, though unlisted. `manual` is accepted too, and `bogus` is refused with the list of choices.
- Upstream's `bg_cmd` passes `default`, so we keep it.
- Risk: `default` could be dropped from a later CLI. `mode_ok` accepts both words, so switching is a one-line change.

## What this changes in the plan

- **Task 6, live tier:** the message must say that effort lands at the next turn. A lead that needs effort applied right away, mid-turn, uses `--how resume` once the agent is idle.
- **Task 9:** the hook applies both fields as planned. The engine decides when a rewritten effort takes effect.
