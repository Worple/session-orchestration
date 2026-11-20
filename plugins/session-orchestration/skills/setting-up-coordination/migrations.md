# Migrations

What a project set up by an older plugin version needs done when the layout changes. One row per migration; `session-status --init --migrate` runs them in this order: m1 m2 m3 m4 m5 m6 m8 m7 m9 h1 h2 (m8 before m7, so the move sees the `pending.file` m8 brings over; m9 last). Design: the retro case `claude-plugins-auto-migrate`.

Class: **auto** = applied without asking (personal, untracked, restorable); **ask** = one pane ask `migrate-<id>` (Apply / Decline, what it changes in its details); **hand** = a pane ask `migrate-<id>` (Start a session / Not now).
"From" names the release after which a project needs it (docs say "from the release after <feature>", never a version that doesn't exist yet).

| id | From | Class | Detector (the `--check` line, prefixed `[id class]`, e.g. `[m7 auto]`; m8 prints `auto` or `ask`) | Fix |
|---|---|---|---|---|
| m1 | the release after config files and `approvals.delegate` (0.46) | ask | `delegation found in CLAUDE.md` | sets `approvals.delegate=true` in the person file |
| m2 | the release after the `features.accounts`, `features.review_inbox` and terminal opt-ins (0.47, 0.48) | ask | `second account found`, `review inbox found`, `detected <terminal>` | sets that one key (`features.review_inbox` in the repo file, the others in the person file) |
| m3 | the release after `history.dirs` (0.94) | ask | `project Stop hook commits a folder` | the folder to `history.dirs`, the hook out of `.claude/settings*.json` (the ask shows the diff) |
| m4 | the release after retro replaced rnd (0.98) | auto | `rnd-brief.md` exists | `--write`'s rename to `retro-brief.md` |
| m5 | the release after retro replaced rnd (0.98) | ask | the crontab has the rnd-weekly line | the line's path swapped to `retro-run` |
| m6 | the release after `start.mode` (0.99) | ask | a memory line naming the start mode | write `start.mode`, delete the line |
| m7 | the release after the state folder (0.102; includes 0.56 `pending.file` and the replies move) | auto; ask while sessions are live (or listing them failed); hand while the committed `CLAUDE.md` holds the path lines | `coordinator files outside P` | `--move` |
| m8 | the release after the repo file stopped setting `pending.file` and `history.dirs` (0.112) | auto (untracked repo file), ask (tracked) | `pending.file and history.dirs are ignored in the repo file` | move both keys to the person file |
| m9 | the release after the state folder move (0.102), for a project moved by a move that left the local adapter naming old paths | auto | `.claude/session-status-adapter names files already moved to P` | `--migrate` points the adapter at P |
| h1 | the release after memory became index + topic files (0.32.2) | hand | flat `memory.md` | pane ask offering a session |
| h2 | the release after messages modules (0.52) | hand | the adapter mentions msgraph while `messages` is unset | pane ask offering a session |

Answering: `--migrate` stamps nothing while an ask or hand id is open. `--apply=ID [--dry-run]` runs one ask id's fix
(a hand id has none: a session does it), `--decline=ID` adds an ask or hand id to `P/setup.json`'s `declined`, which
`--migrate` then skips (`--check` still names it; `--apply=ID` still applies it). m7 isn't declined but put off: it asks
again while other sessions run and moves unasked once none does.

Changes that needed no migration (cosmetic, a feature offer, no reliable detector, or old rows still read): `--init` itself (0.42), the github adapter (0.43), generic coordinator rules in the plugin (0.44), the Replies line wording (0.64), `features.retro` (0.103), adapter `brief` and `standup-template` (0.113), the CLAUDE.md task line's `--advisor` hint (the release after plan.advisor: the old line still works, the playbook has the rule), `coordinator.purpose` (from the release after coordinator discovery: a feature offer, asked at `--start` while unset).

## Adding a migration

A change to what setup writes, or to where a project's files live, ships its migration in the same PR:

1. A detector: a `--check` line in `session-init` that starts `[<id> <class>] `, and its fix.
2. `LAYOUT` +1 in `lib.sh`.
3. A row here, with the id the code uses.
4. A fixture in `orchestrating-sessions/session-status.test.sh`, marked by a line `# migration fixture: <id>` (an ask-only or hand id may wait, through `no_fixture_yet` in `migrations.test.sh`): build the previous layout, run `--migrate`, assert the layout is current, run it again and assert nothing changed.

`migrations.test.sh` fails on an id in the code with no row here, or with no fixture marker. Two branches that both add one conflict on the `LAYOUT=` line; the second renumbers on rebase.
