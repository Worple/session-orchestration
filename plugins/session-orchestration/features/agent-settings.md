# Feature: agent settings (`--set`)

> **Start**: nothing to do.
> **Read when**: a running session should change its model, effort or permission mode; a `needs your approval: set …`
> line; the user asks what a lead may change by itself, or how to give a session `bypassPermissions`.

`session-status --set` changes a session's model, effort or permission mode and keeps its conversation. A handover
alone would start a new session that has to read its task back in, so use `--set` for these changes.

```
session-status --set ID [--model M] [--effort E] [--mode P] [--up|--down] [--how auto|live|resume|fresh]
                        [--why TEXT] [--by lead|pane] [-- 'NEXT']
```

ID is the session's id or its first 8 or more characters, in any account. Every change starts from what the session
runs on now: the override file's values (below), else its transcript's last reply. `--up` and `--down` move the model
and effort one rung together. Up is the rung `--handover --escalate` takes. Down takes the first of these that
applies: `max` to `xhigh` on the same model, `fable` to `opus` at the same effort, one effort step down, then at `low`
`opus` to `sonnet` and `sonnet` to `haiku`. `--why` is the reason, given to the session and kept in the log.

## Tiers

`--how auto`, the default, picks `resume` when `--mode` is given and `live` otherwise.

- **live** writes the override file. The plugin's `turn.step` hook in the session reads it before each request. A
  new model applies from the next request, even mid-turn. A new effort applies from the next turn, meaning the next
  step that carries input: Claude Code doesn't switch effort on a step of tool results alone. The session can be
  busy, waiting on a prompt, interactive or not running. A mode can't change live. It prints each change with its
  timing, for example `"NAME" (ID8): model sonnet from its next request, effort low from its next turn (live)`, or
  `"NAME" (ID8): model sonnet, effort low when it next runs (live)` for a session that isn't running.
- **resume** stops the session while it is idle and resumes it under its own id. A background session resumed with
  flags would start a copy under a new id, so the change goes into the options the session was started with:
  `respawnFlags` in Claude Code's `jobs/ID8/state.json`, in its account's config folder (`~/.claude` by default).
  While the session is stopped, its `--model` and `--effort` entries are replaced with what it runs on, the change
  applied, and its `--permission-mode` entry is replaced when the mode changes; every other entry stays as it was.
  It is then resumed without flags, with a prompt naming who changed what and why and telling it to carry on, or to
  end its turn without a message if it had finished. If that resume fails, the job state is put back as it was. The
  override file is removed once it has resumed, so old values can't come back. It takes the same lock as
  `--compact`, so the two never stop and resume one session at once. It prints `"NAME" (ID8): CHANGES, resumed
  under its own id (resume)`. It is refused with nothing stopped when the session is mid-turn, waiting on a prompt,
  interactive or locked (exit 3), holds more than `SESSION_STATUS_MAX_RESUME` (200000) tokens of context (exit 4),
  which a resume would read in again, or has no job state to change (exit 1).
  **Risk:** `jobs/ID8/state.json` is an undocumented Claude Code file. If an update changes it, a resume fails closed:
  exit 1 with nothing stopped, pointing to `--how fresh`.
- **fresh** hands the task to a new session on the new values: `--handover` with `--model`, `--effort`, `--mode` and
  `--by`, and NEXT as the new session's brief. Use it for a session too big to resume.

## Who may change what

`--by lead`, the default, stands for any session running the command, the coordinator included. A lead may set only
what the person's policy allows. `--by pane` stands for the user, who may set any valid value.

The policy is three person keys, in `.claude/coordination.local.json` or
`~/.config/session-orchestration/config.json`. The repo file can't set them.

| Key | Value | Unset |
|---|---|---|
| `policy.models` | a JSON list of model names: a lead may set a model equal to one or starting with one | any model |
| `policy.max_effort` | `low`, `medium`, `high`, `xhigh` or `max`: the highest effort a lead may set | `max` |
| `policy.modes` | a JSON list of the modes a lead may set, never `bypassPermissions` or `plan` | `default`, `manual`, `acceptEdits`, `auto`, `dontAsk` |

A value that isn't valid counts as unset, and each `--set` prints a `warning: config policy.… is not valid` line for
it. Only what changes is checked: a `--down` that keeps the model doesn't need that model in `policy.models`.

Outside the policy, `--set` changes nothing and exits 5. Its last line is `needs your approval: set "NAME" (ID8) to
CHANGES`: queue that as an ask. A yes means the user runs the change with `--by pane` (below) or widens the policy:
a session can't pass `--by pane`.

**`bypassPermissions` and `plan` are only ever set by the user.** The user types the command in their own Claude Code
terminal, where the `!` prefix runs it as a shell command:

```
! session-status --set ID --mode bypassPermissions --by pane
```

The coordinator guard hook refuses a session's Bash command that passes `--by pane`, `--mode plan` or
`bypassPermissions` to `--set`, or runs `--set` through `bash -c` or `eval`.

## Exit codes

| Code | Meaning |
|---|---|
| 0 | done |
| 1 | the session listing, the stop or the resume failed (a failed resume says whether the session was stopped), or a resume found no job state to change |
| 2 | usage error, no such session, or a value the CLI wouldn't take |
| 3 | busy, waiting on a prompt, locked, or interactive when the change needs a resume |
| 4 | too big to resume: use `--how fresh` |
| 5 | outside the policy |

## Files

- **The override file** is `~/.cache/session-status/settings/ID.json` (under `$XDG_CACHE_HOME` when that is set):
  `{"model"?, "effort"?, "by", "why", "at"}`, written to a temporary file and moved into place. A live change merges
  into it; a successful resume removes it.
- **The job state** is Claude Code's own `jobs/ID8/state.json` (ID8: the id's first 8 characters). A resume checks
  that its `sessionId` is the session's and that `respawnFlags` is a list before it stops anything, and rewrites it
  through a temporary file and a move.
- **The log** is `settings.jsonl` in the project's state folder,
  `~/.local/state/session-orchestration/projects/<project>/`. It gets one line per change made:
  `{"at", "id", "name", "by", "why", "tier", "old": {"model", "effort"}, "new": {"model", "effort", "mode"}}`.
