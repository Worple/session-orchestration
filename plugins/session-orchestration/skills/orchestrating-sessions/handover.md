# Handing over the coordinator

The coordinator's rules for replacing itself. Read this at the context-watch hook's mark, at a `Weekly limit:` line,
before a restart, and as a successor (your first prompt says `You succeed "NAME"`). The status command here is
`session-status`; each step prints the next. Flags in detail: [status-reference.md](status-reference.md#commands-in-detail).

## The old coordinator

Overwrite `<replies>/coordinator-handover.md` with the state that's in no file: live sessions worth knowing and what
each waits on, and why the restart. Pane asks and their answers carry over by themselves: your successor's `--start`
lists the answers to relay ([approvals.md](approvals.md#the-relay-block)). An approval the user gave you in chat or
the question box that a session will still need: ask it again on the pane first. No rules and no files to read: the next
coordinator's Start reads those, and each restated rule is re-sent on its every wake. Then start your successor:

1. `session-status --successor` (`--account DIR` for the weekly-limit move): it opens a tab running an interactive
   `claude --model M --effort E -n NAME-next 'Act as a coordinator. You succeed …'`, on the model and effort you run on
   (else config `plan.models.coordinator` for the account it starts under: `fable/medium` where `fable.accounts` lists it). It refuses while your handover note is missing or older than your start: write it (again, if your Write failed), then run it again. Nothing opened: hand the user the command it prints
   (`hand_command`, key `coordinator`). In Claude Code Desktop it prints a `start_session` call instead, so the
   successor is an app session in the sidebar: make it, and leave your pin and your archiving to it (archiving
   yourself takes it with you). Then arm `--await ready` (Bash, background) and end your turn. From here act
   on no message: forward each, text on stdin, with `session-status --inbox-add --from '<name> (<id8>)'`, run by its
   full path with a quoted heredoc (`<<'EOF'`), so the approval hook reads the text as text even when it quotes a merge.
2. When `--await ready` wakes you, call `name_session` with what `session-status --prev-name --title` prints
   (`NAME-prev-K`; it titles your tab too, and in Desktop its result names the sidebar title's call), arm `--await renamed` (background) and end your turn: the rename lands
   then.
3. When `--await renamed` wakes you, stop your watcher (TaskStop), forward what came meanwhile, run
   `session-status --successor --done` and end. Your terminal closes once you are idle.

## The successor

Your name is `NAME-next`. In Desktop your first prompt says to run `session-status --successor --started NAME` first:
it records your id, so you count as `NAME-next` even when the app named you otherwise. Run Start as usual (`open_pane` keeps your name while the old one holds `NAME`), then:

1. Arm `--await name`. It wakes you when `NAME` is free: call `name_session` with `NAME`.
2. Arm `--await done`. It closes the old coordinator's tab (only its split, when the tab has others) once that one is
   idle and done forwarding; when it runs in the background, the tab it was moved out of (or a `claude attach` to it).
   Tell the user what was left open, if anything. In Desktop it closes nothing and says how to finish the old one:
   detach from it, take its pin, archive it.

- Any `--await` also wakes you on an unread coordinator inbox entry (exit 3, first line `NOT DONE`): the step isn't
  done. Act on each entry, mark it read (`session-status --inbox --read N`), and arm the same `--await` again.
- The note's blockers (a login out, a session stuck, a PR failing) are claims from when it was written: check each
  against `--start`'s output (a login: whether its source's notices line still starts `(failed)`; a session: its
  row) before you tell the user, and drop the ones that cleared.
- A live session other than the one you succeed holds `NAME` (`open_pane` says so): stop and ask the user.
- An `--await` that times out: check the other coordinator (`--activity`), then re-arm or finish by hand.
