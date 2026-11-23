#!/usr/bin/env bash
# PreToolUse in a coordinator session (context-watch.sh's cached kind; none cached yet: its first prompt starts a line
# with `Act as a coordinator`): three of SKILL.md's Rules as checks.
# - Bash starting with `cd`: refused (the Bash tool keeps it, and `claude --bg` then starts outside the project).
#   Only the prefix: a `cd` later in a chain isn't parsed out of the shell text.
# - Claude Code Desktop's start_session (a sidebar session): refused, in a subagent too, unless it is the call
#   `--successor` prints (title NAME-next, its prompt running `--successor --started NAME`). A task goes to
#   `claude --bg`: a sidebar session is in no listing the status reads. Config start.sidebar true (a person key,
#   default false) lets every start_session through: the user chose sidebar tasks over the status's view of them.
#   An edit of .claude/coordination.local.json naming "sidebar" is refused: only the user turns it on.
# - Edit/Write/MultiEdit/NotebookEdit of a file inside the project root: allowed only in .claude/ (not its settings*.json
#   or hooks/), the replies folder, the handoff file (pending.file), the project memory CLAUDE.md names (the file and its memory/ folder)
#   and the root's CLAUDE.local.md while git doesn't track it (a worktree session can't reach it); never in
#   a task's worktree (.worktrees/, .claude/worktrees/). The path is resolved first (`..`, symlinks).
#   Outside the root (scratch, ~/.claude) is not the rule's business.
# - In a task, chunk or review session that answers to a coordinator (keyed, or messaged): start_session and
#   hand_off_to_session refused (worker.md: a task session starts no session), but a start_session that only shows the
#   user a card (initiation own_initiative or offer, no proposal_id). start.sidebar doesn't change this.
#   shortcut: only a cached kind is tested, so a session's first call isn't; upgrade if one starts sessions that early
# Any other session pays one bash start and a file test (and, until context-watch caches its kind, lib.sh and a
# first-prompt read).
input=$(cat)
# a subagent: its cd and edits aren't the coordinator's, but a sidebar session it starts is just as unseen
[[ $input =~ \"agent_id\":\ *\"[^\"]+\" ]] && ! [[ $input =~ \"tool_name\":\ *\"mcp__ccd_session__(start_session|hand_off_to_session)\" ]] && exit 0
[[ $input =~ \"session_id\":\ *\"([A-Za-z0-9_-]+)\" ]] || exit 0
k=${XDG_CACHE_HOME:-$HOME/.cache}/session-status/handoff-${BASH_REMATCH[1]}.kind
kind=
if [ -f "$k" ]; then read -r kind _ < "$k"
# not cached yet (a first prompt or a resume classifies in a detached job): context-watch.sh's coordinator test inline
elif [[ $input =~ \"transcript_path\":\ *\"([^\"]+)\" ]] && [ -f "${BASH_REMATCH[1]}" ]; then
  tp=${BASH_REMATCH[1]}
  # in its order: a chunk or a `Coordinate KEY` start isn't one, whatever later lines say
  ( . "${0%/*}/../lib.sh" && f=$(first_prompt "$tp" 50) && { [ -n "$f" ] || [ -z "$(sed -n '51{p;q;}' "$tp")" ] || f=$(first_prompt "$tp"); } &&
    ! chunk_of "$f" >/dev/null && ! grep -m 1 . <<<"$f" | grep -qE '^[[:space:]]*Coordinate ' && grep -q '^Act as a coordinator' <<<"$f" ) 2>/dev/null && kind=coordinator
fi
# A task, chunk or review session starts no session (worker.md), under start.sidebar too: only its start calls go on
task=
case $kind in coordinator) ;;
  task|chunk|review) task=1; [[ $input =~ \"tool_name\":\ *\"mcp__ccd_session__(start_session|hand_off_to_session)\" ]] || exit 0 ;;
  *) exit 0 ;;
esac

# deny REASON NAME: the decision, and NAME as a telemetry=full block line (lib.sh usage).
deny() {
  jq -nc --arg r "$1" '{hookSpecificOutput: {hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: $r}}'
  ( l=$(cd "${0%/*}/.." 2>/dev/null && pwd)/lib.sh; cd "${cwd:-.}" 2>/dev/null; . "$l" && usage "coordinator-guard-$2" block "" "hooks/coordinator-guard.sh:${BASH_LINENO[0]}" ) >/dev/null 2>&1
  exit 0
}
{ read -r tool; read -r cwd; read -r path; } < <(jq -r '.tool_name // "", .cwd // "", (.tool_input.file_path // .tool_input.notebook_path // "")' <<<"$input")
if [ -n "$task" ]; then
  # one that answers to a coordinator: keyed, or messaged (context-watch.sh's test for the reply card)
  read -r _ key _ < "$k"; [ "$key" != - ] || [ -e "${k%.kind}.card" ] || [ -e "${k%.kind}.msg" ] || exit 0
  # a card the user starts themselves: Desktop starts nothing for these two without a proposal_id (hand_off_to_session
  # always starts one; spawn_task only shows a chip, so it isn't matched)
  [ "$tool" = mcp__ccd_session__start_session ] &&
    jq -e '.tool_input | (.initiation == "own_initiative" or .initiation == "offer") and (.proposal_id // "" | tostring | test("^\\s*$"))' <<<"$input" >/dev/null && exit 0
  deny "Worker rule: a task session starts no session (worker.md, Work a message gives you), by start_session or hand_off_to_session. Say in your report what needs one (what, why, whether it only reads): your coordinator starts it by the user's start mode. If the user asked you for it here, show them a card to start themselves: start_session with initiation \"own_initiative\" and no proposal_id." task-start
fi
if [ "$tool" = Bash ]; then
  cmd=$(jq -r '.tool_input.command // ""' <<<"$input")
  [[ $cmd =~ ^[[:space:]]*(cd|pushd)([[:space:]]|$) ]] || exit 0
  deny "Coordinator rule: never cd in your shell; use absolute paths. The Bash tool keeps a cd across calls, and claude --bg then starts the new session in that folder, outside the project's settings. Run it again without the cd." cd
fi
if [ "$tool" = mcp__ccd_session__start_session ]; then
  # NAME whole: `--started p` inside `--started p-v2` isn't p's successor
  # shortcut: NAME is checked against the title, not this coordinator's own name; upgrade if a task ever carries that exact text
  jq -e '.tool_input | (.title // "" | strings) as $t | ($t | endswith("-next") and length > 5) and
    (.prompt // "" | strings | split("--successor --started " + ($t | rtrimstr("-next")))[1:] | any(test("^([^A-Za-z0-9._-]|$)")))' <<<"$input" >/dev/null && exit 0
  ( l=$(cd "${0%/*}/.." 2>/dev/null && pwd)/lib.sh; cd "${cwd:-.}" 2>/dev/null && . "$l" && [ "$(config start.sidebar 2>/dev/null)" = true ] ) && exit 0
  deny "Coordinator rule: start a task with claude --bg (SKILL.md, Rules), never as a Desktop sidebar session: a sidebar session gets no status row, no idle notice, no resume after a restart and no stop, so you would lose sight of it. start_session is only for your successor: if this was your handover, run session-status --successor again and pass the call it prints unchanged. If claude isn't on PATH, hand the user its install: curl -fsSL https://claude.ai/install.sh | bash. Only the user can allow sidebar tasks." sidebar
fi
[ -n "$path" ] || exit 0
here=$(cd "$(dirname "$0")" && pwd)
cd "${cwd:-.}" 2>/dev/null || exit 0
. "$here/../lib.sh"
root=$(find_root 2>/dev/null) && [ -n "$root" ] || exit 0
# realpath of a file that may not exist yet: like find_root's pwd -P, so /tmp and /private/tmp compare equal
real() { python3 -I -c 'import os, sys; print(os.path.realpath(sys.argv[1]))' "$1"; }
path=$(real "$path") || exit 0
case $path in "$root"/*) ;; *) exit 0 ;; esac
under() { [ -n "$2" ] && case $1 in "${2%/}"/*) true ;; *) false ;; esac; }
cd "$root" && ROOT=$root
[ "$path" = "$root/.claude/coordination.local.json" ] && jq -e '.tool_input | [.content, .new_string, (.edits // [] | .[].new_string)] | any(strings | test("sidebar"))' <<<"$input" >/dev/null &&
  deny "Coordinator rule: start.sidebar is the user's choice, never yours: leave it to them (README, Claude Code Desktop)." sidebar-config
abs() { local r=${1/#\~/$HOME}; case $r in '') ;; /*) real "$r" ;; *) real "$root/$r" ;; esac; }
if ! under "$path" "$root/.claude/worktrees" && ! under "$path" "$root/.worktrees"; then
  # .claude/ but its settings and hooks: those fixes are a session's too (SKILL.md, Rules)
  under "$path" "$root/.claude" && case ${path#"$root/.claude/"} in settings*.json|hooks/*) ;; *) exit 0 ;; esac
  under "$path" "$(abs "$(replies_path)")" && exit 0
  p=$(config pending.file 2>/dev/null) && [ -n "$p" ] && [ "$path" = "$(abs "$p")" ] && exit 0
  # the project memory: CLAUDE.md's "Project memory: `PATH`" (project-memory's setup line)
  m=$(abs "$(sed -nE 's/^[^`]*[Pp]roject memory[^`]*`([^`]+)`.*/\1/p' CLAUDE.md CLAUDE.local.md 2>/dev/null | head -1)")
  [ -n "$m" ] && { [ "$path" = "$m" ] || under "$path" "$(dirname "$m")/memory"; } && exit 0
  # an untracked CLAUDE.local.md: no worktree has it, so no session can make the edit
  [ "$path" = "$root/CLAUDE.local.md" ] && ! git ls-files --error-unmatch CLAUDE.local.md >/dev/null 2>&1 && exit 0
fi
deny "Coordinator rule: the only files you change are the memory files, the handoff file and your handover (SKILL.md, Rules). ${path#"$root"/} is a session's to change, however small: give it to the session that owns it, or start one. A CLAUDE.md or settings change goes to a new session (one already running refuses it from a message); a rule for how the sessions work can go in the project memory instead, which you change yourself." edit
