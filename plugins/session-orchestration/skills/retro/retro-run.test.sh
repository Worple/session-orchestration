#!/usr/bin/env bash
# Self-check for retro-run and its old entry points: a fake claude, launchctl and crontab in ~/.local/bin (retro-run
# puts that first on its PATH), RETRO_NOW for the clock, TZ=UTC. Run: bash retro-run.test.sh  (prints "ok").
set -euo pipefail; unset XDG_CONFIG_HOME CLAUDE_CONFIG_DIR
here=$(cd "$(dirname "$0")" && pwd)
tmp=$(mktemp -d); trap 'rm -rf "$tmp"' EXIT; trap 'echo "failed at line $LINENO: $BASH_COMMAND" >&2' ERR
fail() { echo "FAIL: $1"; [ -z "${2:-}" ] || echo "$2"; exit 1; }
export HOME=$tmp XDG_STATE_HOME=$tmp/state RETRO_LOG=$tmp/log TZ=UTC
bin=$tmp/.local/bin; mkdir -p "$bin" "$tmp/.claude-work"
# claude --bg's own line; with $tmp/claude.fail present it fails the way a refused start does
printf '#!/bin/sh\n[ -e %q ] && { echo "error: no account" >&2; exit 1; }\necho "$@" >> %q\necho "backgrounded · 1234abcd"\n' "$tmp/claude.fail" "$tmp/claude.calls" > "$bin/claude"
printf '#!/bin/sh\necho "$@" >> %q\n' "$tmp/launchctl.calls" > "$bin/launchctl"
root=$(mkdir -p "$tmp/proj/.claude" && cd "$tmp/proj" && pwd -P)
# an old line for this root, one for another root whose path starts the same, and one unrelated
printf '#!/bin/sh\n[ "$1" = -l ] && printf "%%s\\n" "0 12 * * 1 /x/skills/rnd/rnd-weekly %s" "0 12 * * 1 /x/skills/retro/retro-weekly %s2" "5 * * * * backup"\n' "$root" "$root" > "$bin/crontab"
chmod +x "$bin"/*
echo '{"features":{"retro":true},"retro":{"scope":"both","schedule":"mon 12:00"}}' > "$root/.claude/coordination.local.json"
replies=$XDG_STATE_HOME/session-orchestration/projects/$(sed 's/[^A-Za-z0-9]/-/g' <<<"$root")
mkdir -p "$replies/replies"
at() { python3 -I -c 'import sys,calendar,time; print(calendar.timegm(time.strptime(sys.argv[1], "%Y-%m-%d %H:%M")))' "$1"; }
calls() { [ -f "$tmp/claude.calls" ] && wc -l < "$tmp/claude.calls" | tr -d ' ' || echo 0; }
run() { "$here/retro-run" "$@"; }

# Due: the newest report (rnd-run-3, 11-09) is older than Monday 11-16 12:00, so the first load catches up at once
# and `both` starts two sessions.
touch -t 202611090900 "$replies/replies/rnd-run-3.md"
export RETRO_NOW; RETRO_NOW=$(at '2026-11-16 13:00')
out=$(run "$root" --dry-run)
grep -q '^due: project' <<<"$out" && grep -q '^due: plugin' <<<"$out" && grep -q 'claude --bg --model opus --effort xhigh --disallowedTools=Agent.*ScheduleWakeup -n retro-plugin-' <<<"$out" &&
  [ "$(calls)" = 0 ] && [ ! -e "$replies/retro-project.stamp" ] || fail "--dry-run: both due, nothing started, no stamp" "$out"
# The dry run shows --kind's --advisor too (plan.advisor.retro), only where it pairs.
cp "$root/.claude/coordination.local.json" "$tmp/cfg.bak"
echo '{"features":{"retro":true},"retro":{"scope":"both","schedule":"mon 12:00"},"plan":{"advisor":{"retro":"opus"}}}' > "$root/.claude/coordination.local.json"
out=$(run "$root" --dry-run); grep -q 'claude --bg --model opus --effort xhigh --advisor opus --disallowedTools=Agent.*ScheduleWakeup -n retro-plugin-' <<<"$out" || fail "--dry-run: the advisor" "$out"
echo '{"features":{"retro":true},"retro":{"scope":"both","schedule":"mon 12:00"},"plan":{"advisor":{"retro":"sonnet"}}}' > "$root/.claude/coordination.local.json"
out=$(run "$root" --dry-run); grep -q 'claude --bg --model opus --effort xhigh --disallowedTools=Agent.*ScheduleWakeup -n retro-plugin-' <<<"$out" || fail "--dry-run: no advisor below the model" "$out"
cp "$tmp/cfg.bak" "$root/.claude/coordination.local.json"
run "$root" --scheduled
[ "$(calls)" = 2 ] && grep -q '^--bg --model opus --effort xhigh --disallowedTools=Agent,AskUserQuestion,ScheduleWakeup -n retro-project-.* Session task: retro run, scope project\.' "$tmp/claude.calls" &&
  grep -q -- '-n retro-plugin-.*scope plugin\.' "$tmp/claude.calls" || fail "due: both scopes start one session each" "$(cat "$tmp/claude.calls")"
[ "$(cat "$replies/retro-project.stamp")" = "$RETRO_NOW" ] && [ "$(cat "$replies/retro-plugin.stamp")" = "$RETRO_NOW" ] || fail "a start stamps its scope" ""
# Not due: a second call (RunAtLoad, a wake, a leftover cron line) in the same week starts nothing.
RETRO_NOW=$(at '2026-11-20 08:00') run "$root" --scheduled
[ "$(calls)" = 2 ] && grep -q 'not due: plugin .* next 2026-11-23 12:00' "$tmp/log" || fail "not due: no second run" "$(cat "$tmp/log")"
# Due again the next Monday after 12:00, not before.
RETRO_NOW=$(at '2026-11-23 11:59') run "$root" --scheduled; [ "$(calls)" = 2 ] || fail "not due before the time" ""
RETRO_NOW=$(at '2026-11-23 12:00') run "$root" --scheduled --scope project
[ "$(calls)" = 3 ] && tail -1 "$tmp/claude.calls" | grep -q 'retro-project-' || fail "due at the time; --scope picks one" "$(cat "$tmp/claude.calls")"
# --now skips the check, and stdout says what started (a caller seeing nothing started a duplicate).
out=$(RETRO_NOW=$(at '2026-11-23 12:01') run "$root" --now --scope plugin); [ "$(calls)" = 4 ] || fail "--now" ""
[[ $out == 'started "retro-plugin-'????-??-??'" (1234abcd) · retro opus/xhigh' ]] || fail "--now prints the started line" "$out"
# A failed start: its didn't-start line, exit 1, and the stamp given back.
cp "$replies/retro-plugin.stamp" "$tmp/stamp.bak"; touch "$tmp/claude.fail"
rc=0; out=$(RETRO_NOW=$(at '2026-11-23 12:02') run "$root" --now --scope plugin) || rc=$?
rm "$tmp/claude.fail"
[ "$rc" = 1 ] && [[ $out == '"retro-plugin-'????-??-??'" didn'"'"'t start: error: no account' ]] &&
  cmp -s "$tmp/stamp.bak" "$replies/retro-plugin.stamp" || fail "a failed start: didn't-start line, exit 1, stamp kept" "rc=$rc $out"
# Another call holding the lock: a busy line and exit 1, not silence.
mkdir "$replies/retro-plugin.stamp.lock"
rc=0; out=$(run "$root" --now --scope plugin) || rc=$?
rmdir "$replies/retro-plugin.stamp.lock"
[ "$rc" = 1 ] && [ "$(calls)" = 4 ] && grep -q "didn't start: busy" <<<"$out" || fail "busy: a didn't-start line, exit 1" "rc=$rc $out"

# A new project (no report, no stamp) waits for its first scheduled time.
rm "$replies"/*.stamp "$replies/replies/rnd-run-3.md"
RETRO_NOW=$(at '2026-11-25 10:00') run "$root" --scheduled; [ "$(calls)" = 4 ] || fail "new project: not due at once" ""
RETRO_NOW=$(at '2026-11-30 12:05') run "$root" --scheduled; [ "$(calls)" = 6 ] || fail "new project: due at its first time" ""
# A report of the scope's own series counts as well (retro-project-<N>).
rm "$replies"/*.stamp; touch -t 202611240900 "$replies/replies/retro-project-4.md"
out=$(RETRO_NOW=$(at '2026-12-01 10:00') run "$root" --status)
grep -q 'project: last start none (counts from 2026-11-24 09:00) · next due now (missed 2026-11-30 12:00)' <<<"$out" && ! grep -q overdue <<<"$out" || fail "--status: a missed run" "$out"
# The newest report over 8 days old: an overdue line (RETRO_NOW is UTC, the report's time local: 8 or 9 days)
out=$(RETRO_NOW=$(at '2026-12-03 10:00') run "$root" --status)
grep -qE '^  project: retro overdue: newest report [89] days old$' <<<"$out" || fail "--status: an overdue run" "$out"

# The LaunchAgent: off or without a schedule it starts nothing.
echo '{"features":{"retro":false},"retro":{"schedule":"mon 12:00"}}' > "$root/.claude/coordination.local.json"
RETRO_NOW=$(at '2026-12-01 10:00') run "$root" --scheduled; [ "$(calls)" = 6 ] && grep -q "skip $root: features.retro off" "$tmp/log" || fail "--scheduled: feature off" ""
run --install "$root" 2>/dev/null && fail "--install refuses with the feature off" ""

# --install: the plist's content, loaded with bootstrap, and the cron-line hint.
echo '{"features":{"retro":true},"retro":{"scope":"project","schedule":"sun 07:05","account":"~/.claude-work"}}' > "$root/.claude/coordination.local.json"
out=$(run --install "$root")
pf=$(ls "$tmp"/Library/LaunchAgents/session-orchestration.retro.proj-*.plist)
lb=$(basename "$pf" .plist)
[[ $lb =~ ^session-orchestration\.retro\.proj-[0-9a-f]{6}$ ]] || fail "label: slug and 6 hex" "$lb"
p=$(cat "$pf")
for want in "<key>Label</key><string>$lb</string>" "<string>$here/retro-run</string>" "<string>--scheduled</string>" "<string>$root</string>" \
  "<key>CLAUDE_CONFIG_DIR</key><string>$tmp/.claude-work</string>" "<key>Weekday</key><integer>0</integer><key>Hour</key><integer>7</integer><key>Minute</key><integer>5</integer>" \
  '<key>RunAtLoad</key><true/>' "<key>StandardOutPath</key><string>$tmp/log</string>" "<key>XDG_STATE_HOME</key><string>$XDG_STATE_HOME</string>" \
  "<key>RETRO_LOG</key><string>$tmp/log</string>"; do
  grep -qF -- "$want" <<<"$p" || fail "plist has $want" "$p"
done
grep -q "^bootstrap gui/$(id -u) $pf$" "$tmp/launchctl.calls" || fail "--install bootstraps the plist" "$(cat "$tmp/launchctl.calls")"
[ "$(grep -c 'crontab -l | grep -vxF' <<<"$out")" = 1 ] || fail "--install prints the removal of this root's cron line only" "$out"
rm_cmd=$(sed -n 's/^  \(crontab -l | grep -vxF .*\) | crontab -$/\1/p' <<<"$out")
[ "$(PATH=$bin:$PATH bash -c "$rm_cmd")" = "$(printf '%s\n' "0 12 * * 1 /x/skills/retro/retro-weekly ${root}2" "5 * * * * backup")" ] || fail "the removal keeps the other lines" "$(PATH=$bin:$PATH bash -c "$rm_cmd")"
# --status lists the agent with its schedule and account.
out=$(RETRO_NOW=$(at '2026-12-01 10:00') run --status)
grep -qF "$lb · $root · loaded · schedule sun 07:05 · account $tmp/.claude-work" <<<"$out" && grep -q 'project: last start none .* next due now (missed 2026-11-29 07:05)' <<<"$out" ||
  fail "--status" "$out"
# Installed from the versioned cache, the plist names no version: it resolves installPath at each start.
c=$tmp/.claude-work/plugins/cache/mk/session-orchestration/9.9.9
mkdir -p "${c%/*}"; cp -R "$here/../.." "$c"
CLAUDE_CONFIG_DIR=$tmp/.claude-work "$c/skills/retro/retro-run" --install "$root" >/dev/null
p=$(cat "$pf")
! grep -q 9.9.9 <<<"$p" && grep -q '<string>/bin/bash</string>' <<<"$p" || fail "cache install: no versioned path" "$p"
script=$(sed -n 's/^    <string>\(d=.*\)<\/string>$/\1/p' <<<"$p" | sed 's/&lt;/</g; s/&gt;/>/g; s/&amp;/\&/g')
echo "{\"plugins\":{\"session-orchestration@mk\":[{\"installPath\":\"$c\"}]}}" > "$tmp/.claude-work/plugins/installed_plugins.json"
out=$(CLAUDE_CONFIG_DIR=$tmp/.claude-work bash -c "$script" retro-run --dry-run --now "$root")
grep -q '^due: project' <<<"$out" || fail "the plist's resolve runs the installed launcher" "$out"
# --uninstall
run --uninstall "$root" >/dev/null
[ ! -e "$pf" ] && grep -q "^bootout gui/$(id -u)/$lb$" "$tmp/launchctl.calls" || fail "--uninstall" ""

# The old entry points (a crontab line names retro-weekly): with no schedule there's no due check, and the log names the
# install command.
echo '{}' > "$root/.claude/coordination.local.json"
"$here/retro-weekly" "$root" >/dev/null
if [ "$(uname)" = Darwin ]; then hint="retro-run --install $root"; else hint="point the cron line at .*retro-run"; fi
[ "$(calls)" = 7 ] && tail -1 "$tmp/claude.calls" | grep -q 'retro-project-' && grep -q "called as retro-weekly: .*$hint" "$tmp/log" ||
  fail "retro-weekly shim starts a project run and logs the install" "$(cat "$tmp/log")"
"$here/retro-weekly" "$tmp/nope" 2>/dev/null && fail "a missing root fails" ""
grep -q "no project root $tmp/nope" "$tmp/log" || fail "a missing root is logged" ""
echo ok
