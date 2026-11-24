---
name: choosing-model-effort
description: Size work into a plan.models kind and get its model and effort. Use before starting or proposing a task session (claude --bg), before picking a subagent's model in a coordinated project, and in a retro comparing cost per kind.
---

# Choosing a model and effort

Each kind maps to a model and effort through config `plan.models.<kind>` (defaults: `scan` haiku/low, `mechanical`
and `release` sonnet/medium, `build` opus/medium, `design`, `review` and `retro` opus/xhigh, `research` opus/high, `coordinator` opus/medium). Size the work into a kind, then take that kind's values.
`coordinator` is what a coordinator's start and its successor run on (a successor or handed-over session keeps what
its predecessor ran on, fable too, when the transcript says).

**Fable** only runs under an account config `fable.accounts` lists (the person sets it: nothing tells reliably which
accounts have fable). There `design`, `review`, `coordinator` and `retro` default to `fable` at the same effort, any kind may be
set to `fable/<effort>`, and an escalation goes on from opus/max to fable/max. Under any other account a `fable` value
falls back to the kind's default, so fable never starts there. Nor does it while the account's weekly Fable limit
is reached (lib.sh `fable_out`: the "You've hit your Fable limit" row a session got, until its reset): every start
takes what it would without fable, then fable again once the limit resets. No Fable percent is readable, so this
only shows once a session on that account hit the limit. Never pick `fable` yourself beyond that unless the user
names it.

**An advisor** is a trial, off by default: config `plan.advisor.<kind>`
(`fable`, `opus` or `sonnet`; unset means off) gives that kind's task starts an advisor model the session consults.
`session-status --kind` prints it as ` --advisor A` after `--effort E`: paste the whole line. It pairs only at or above
the main model: an opus session takes fable or opus, sonnet and haiku take any, a fable session takes none. A fable
advisor also needs the account in `fable.accounts` (and its Fable limit not hit). Where it doesn't pair, `--kind`
leaves it off and says why on stderr. A successor or handed-over session keeps its predecessor's advisor where it
still pairs. Don't set it yourself unless the user asks.

## Size the work

Size by what the hardest step needs, not by the task's label. A "fix" can be `mechanical` and a "doc change" can be
`design`.

| Kind | The work | E.g. |
|---|---|---|
| `scan` | Reads and reports and changes nothing | A status check, a search, a summary of a log |
| `mechanical` | Changes whose every edit is known before you start | A one-file doc fix, a rename, a scrub tweak, a config value, a fix the case already spells out |
| `build` | Code that needs judgement: a cause to find, tests to write, or several files to keep consistent | A bug whose cause isn't known, a small feature in an existing pattern |
| `design` | Choices to make before code: a new interface, a new feature, a plan to split | A new command or skill, a change in how parts fit together |
| `review` | Judging someone else's change | A PR review, a diff audit |
| `release` | Landing and releasing work that is already done | Running the release steps, checking the installed version |
| `research` | Answers a question from sources outside the project (the web, docs, other tools' code), judging what is reliable and what applies here; changes nothing (the `research` skill) | An other-tools scan, a library comparison, how another tool solves a problem |

- Between two kinds, take the one the hardest step needs. Too small costs a retry, and a retry costs more than the
  difference.
- A batch takes the kind of its largest item. When one item is far larger than the rest, split it into its own task.
- Say why in a few words where the kind is shown ("mechanical: one-file doc fix"), so the user can amend it.

## Size it within the kind

Add a size when the work sits clearly at one end of its kind, by expected context growth (plans.md's classes): `S`
≤ 22K (a one-file fix), `M` ≤ 43K, `L` ≤ 65K (several files, tests to write). `build:S` runs one effort step below
`plan.models.build`, `build:L` one above, `build:M` or a bare `build` as configured. Show it with the kind
("build:L: three files and a new test"). Past L, split the work (plans.md). A size changes the effort only; a model
change is the kind's or an escalation's (`session-status --handover --escalate`, after the same failure twice).

## Use it

- **A task start (`claude --bg`)**: `session-status --launch <session-name> --kind <kind>[:S|M|L] …` (sessions.md) runs
  `--kind` itself and logs the start once; don't run `--kind` first, which logs it twice and double-counts retro's `kinds`.
  Run `session-status --kind <kind>[:S|M|L] <session-name>` alone, as its own call, only for a start `--launch` doesn't
  cover (`<session-name>` is the `-n` value; its usage text says what a name may hold), and paste the
  `--model M --effort E` it prints onto the start line. Exit 2 means a wrong kind or name: fix it, and don't start without the flags. Exit 3: the task isn't the user's to
  start (someone else's ticket or branch): don't start, queue the ask its stderr names. It logs the start for retro,
  so run it once per task: a handover or fresh restart of the same task reuses the flags. `session-status` is in this
  plugin's `skills/orchestrating-sessions/` (`../orchestrating-sessions/session-status` from this skill's folder) and
  isn't on a task session's PATH: run it by that path.
- **A proposal line** (the coordinator's propose-first list): name the kind and the reason on each line.
- **A subagent (Agent tool)**: pass the model of the kind's `plan.models` value (`session-status --config
  plan.models.<kind>` prints it) as `model` when it is an alias the tool takes (`sonnet`, `opus`, `haiku`). A full
  model id: pass its family's alias. Set `effort` only when the user, a CLAUDE.md or a skill asks for that effort.
  Nothing is logged.
- **A retro**: the usage log's start lines (`{"k":"start","what":KIND,"model":…,"effort":…,"sess":…,"size":…,"advisor":…}`, size and advisor only when given) carry
  `sess`, the first 12 hex characters of the session name's sha256 (the hash only keeps the name out of clear text:
  someone who can guess a name can confirm it). retro's `kinds` report joins them to sessions that way and compares
  cost and outcome per kind (a sized start as `build:L`), with the escalations each start's sessions logged.
