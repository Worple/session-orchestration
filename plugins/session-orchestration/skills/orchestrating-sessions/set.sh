# session-status --set ID [--model M] [--effort E] [--mode P] [--up|--down] [--how auto|live|resume|fresh]
#   [--why TEXT] [--by lead|pane] [-- 'NEXT']: changes a session's model, effort or permission mode, its conversation
#   kept (features/agent-settings.md). Sourced by session-status (its find_session read_row stop_session resume_with
#   mid_turn transcript_of activity_fields pre_dir, TMP and SELF), and exits with --set's code: 0 done; 1 a listing,
#   stop or resume failed, or no job state to change; 2 usage, no such session or a bad value; 3 busy, waiting, locked
#   or interactive; 4 too big to resume; 5 outside policy.
# It changes from the override file's values, else what its transcript's last reply ran on (lib.sh last_model);
# --up/--down move both one rung (lib.sh escalate_rung, deescalate_rung). Tiers, by --how (auto: resume for a mode,
# else live, or resume while LIVE is off):
#  - live: the override file, merged with the change. The agent's turn.step hook applies a model from its next
#    request, an effort from its next turn (the next step that carries input). Running or not, busy, waiting or
#    interactive alike; never a mode.
#  - resume: under --compact's lock, stopped while idle; its job's saved options (respawnFlags in Claude Code's
#    jobs/ID8/state.json) get the current model and effort with the change; resumed without flags (with flags, a
#    background session starts a copy under a new id), it keeps its id; then the override file goes. Refused, nothing
#    stopped: mid-turn, on a prompt, interactive or locked (3); over SESSION_STATUS_MAX_RESUME (4); no such job state
#    (1: the file is undocumented, so a changed shape fails closed).
#  - fresh: --handover to a new session on the new values, NEXT its brief.
# First, for every tier, lib.sh policy_allows on what changes (a lead: the person's policy.* keys): outside it, exit 5
# with nothing changed, the last line `needs your approval: set "NAME" (ID8) to CHANGES`.
# Override file: ${XDG_CACHE_HOME:-~/.cache}/session-status/settings/ID.json, {"model"?, "effort"?, "by", "why", "at"},
# written to a temp file and moved. Log: $(proj_dir)/settings.jsonl, a line per change made.
LIVE=on   # the phase 1 spikes (docs/superpowers/notes/2026-11-24-phase1-spikes.md)

set_usage() {
  echo "usage: session-status --set ID [--model M] [--effort E] [--mode P] [--up|--down] [--how auto|live|resume|fresh] [--why TEXT] [--by lead|pane] [-- 'NEXT'] (ID: 8+ characters)"
  exit 2
}
want=${1:-}; [ $# = 0 ] || shift
model= effort= mode= step= how=auto why= by=lead next=
while [ $# -gt 0 ]; do
  case $1 in
    --model|--effort|--mode|--how|--why|--by) [ $# -ge 2 ] || set_usage
      case $1 in --model) model=$2 ;; --effort) effort=$2 ;; --mode) mode=$2 ;; --how) how=$2 ;; --why) why=$2 ;; *) by=$2 ;; esac
      shift 2 ;;
    --up|--down) [ -z "$step" ] || set_usage; step=$1; shift ;;
    --) [ $# = 2 ] && [ -n "$2" ] || set_usage; next=$2; shift 2 ;;
    *) set_usage ;;
  esac
done
[ "${#want}" -ge 8 ] && [[ $want != -* ]] && [ -n "$model$effort$mode$step" ] || set_usage
case $how in auto|live|resume|fresh) ;; *) set_usage ;; esac
case $by in lead|pane) ;; *) set_usage ;; esac
[ -z "$step" ] || [ -z "$model$effort" ] || { echo "--set: $step moves the model and effort a rung together: leave out --model and --effort"; exit 2; }
[ -z "$model" ] || model_ok "$model" ||
  { echo "--model $model: not a model name like opus (fable only under an account config fable.accounts lists, and not while its Fable limit is reached)"; exit 2; }
[ -z "$effort" ] || effort_step "$effort" 0 >/dev/null || { echo "--effort $effort: one of low medium high xhigh max"; exit 2; }
[ -z "$mode" ] || mode_ok "$mode" || { echo "--mode $mode: one of default manual acceptEdits auto dontAsk plan bypassPermissions"; exit 2; }
if [ "$how" = auto ]; then if [ -n "$mode" ] || [ "$LIVE" != on ]; then how=resume; else how=live; fi; fi
[ "$how" != live ] || [ -z "$mode" ] || { echo "--set: a mode changes on a resume (--how resume) or a fresh session (--how fresh), never live"; exit 2; }
if [ "$how" = fresh ]; then [ -n "$next" ] || { echo "--set --how fresh: the fresh session's brief goes last: -- 'WHAT NEXT'"; exit 2; }
elif [ -n "$next" ]; then echo "--set: -- 'NEXT' is the brief of --how fresh's new session, and this is --how $how"; exit 2; fi

row=$(find_session "$want") || { echo "couldn't list the sessions; try again"; exit 1; }
[ -n "$row" ] || { echo "no session $want in any account"; exit 2; }
read_row id name st pre started cwd kind status pid
who="\"$name\" (${id:0:8})"

# What it runs on now: the override file's fields (a bad one dropped), else its transcript's last reply.
sdir=${XDG_CACHE_HOME:-$HOME/.cache}/session-status/settings; ovr=$sdir/$id.json
vm=$(jq -r '.model | strings' "$ovr" 2>/dev/null); FABLE_OK=1 model_ok "$vm" || vm=
ve=$(jq -r '.effort | strings' "$ovr" 2>/dev/null); effort_step "$ve" 0 >/dev/null || ve=
tm= te=; read -r tm te < <(last_model "$(transcript_of "$id")")
om=${vm:-$tm} oe=${ve:-$te}
if [ -n "$step" ]; then
  [ -n "$om" ] && [ -n "$oe" ] || { echo "$who: the model or effort it runs on is unknown: pass --model and --effort instead of $step"; exit 2; }
  if [ "$step" = --up ]; then r=$(escalate_rung "$om" "$oe"); else r=$(deescalate_rung "$om" "$oe"); fi ||
    { echo "$who runs on $om/$oe, with no rung $([ "$step" = --up ] && echo above || echo below) it: nothing changed"; exit 2; }
  read -r model effort <<<"$r"
fi
# What changes (a rung's unchanged half isn't a change), and the values it ends up on.
cm=$model ce=$effort
[ -z "$step" ] || { [ "$model" != "$om" ] || cm=; [ "$effort" != "$oe" ] || ce=; }
changes=${cm:+model $cm}
[ -z "$ce" ] || changes="${changes:+$changes, }effort $ce"
[ -z "$mode" ] || changes="${changes:+$changes, }mode $mode"
nm=${model:-$om} ne=${effort:-$oe}

# policy_allows reads policy.* quietly, so a mistyped value would fall back to the loosest default unseen: say so here.
for k in models max_effort modes; do config "policy.$k" >/dev/null; done
reason=$(policy_allows "$by" "$cm" "$ce" "$mode")
case $? in
  0) ;;
  1) [ -z "$reason" ] || echo "$reason"; echo "needs your approval: set $who to $changes"; exit 5 ;;
  *) set_usage ;;
esac

set_override() {   # the override file merged with the change: a temp file beside it, then mv
  local t
  mkdir -p "$sdir" && t=$(mktemp "$sdir/.$id.XXXXXX") || return 1
  jq -n --arg m "${model:-$vm}" --arg e "${effort:-$ve}" --arg by "$by" --arg why "$why" --argjson at "$(date +%s)" \
    '{model: $m, effort: $e} | with_entries(select(.value != "")) + {by: $by, why: $why, at: $at}' > "$t" && mv -f "$t" "$ovr" ||
    { rm -f "$t"; return 1; }
}
set_log() {   # TIER
  local d; d=$(proj_dir)
  mkdir -p "$d" && jq -nc --argjson at "$(date +%s)" --arg id "$id" --arg name "$name" --arg by "$by" --arg why "$why" --arg tier "$1" \
    --arg om "$om" --arg oe "$oe" --arg nm "$nm" --arg ne "$ne" --arg mode "$mode" 'def v: if . == "" then null else . end;
    {at: $at, id: $id, name: $name, by: $by, why: $why, tier: $tier, old: {model: ($om | v), effort: ($oe | v)},
     new: {model: ($nm | v), effort: ($ne | v), mode: ($mode | v)}}' >> "$d/settings.jsonl" ||
    echo "warning: the change isn't in $(tilde "$d")/settings.jsonl" >&2
}

if [ "$how" = live ]; then
  set_override || { echo "couldn't write $(tilde "$ovr"): nothing changed"; exit 1; }
  set_log live
  timed=${cm:+model $cm from its next request}
  [ -z "$ce" ] || timed="${timed:+$timed, }effort $ce from its next turn"
  if [ -z "$pid" ]; then echo "$who: $changes when it next runs (live)"; else echo "$who: $timed (live)"; fi
  exit 0
fi

if [ "$how" = resume ]; then
  # --compact's lock: the two never stop and resume it at once. ponytail: one left by a killed run expires after 10 minutes.
  lock=~/.cache/session-status/compact-$id; mkdir -p ~/.cache/session-status
  [ -z "$(find "$lock" -maxdepth 0 -mmin +10 2>/dev/null)" ] || rmdir "$lock" 2>/dev/null
  mkdir "$lock" 2>/dev/null || { echo "$who is being compacted or resumed: try again in a minute"; exit 3; }
  trap 'r=$?; rmdir "$lock" 2>/dev/null; rm -rf "$TMP"; exit_fault $r' EXIT
  [ "$kind" = background ] ||
    { echo "$who is interactive, so it isn't resumed: a model or effort changes live (--how live), a mode only in its own terminal"; exit 3; }
  if [ -n "$pid" ]; then
    mid_turn && { echo "$who is mid-turn: not stopped; try when its turn ends"; exit 3; }
    [ "$status" != waiting ] || { echo "$who is waiting on a prompt: not stopped; answer it first ($pre attach ${id:0:8})"; exit 3; }
  fi
  f=$(transcript_of "$id"); c=0 max=${SESSION_STATUS_MAX_RESUME:-200000}
  [ -z "$f" ] || c=$(activity_fields "$f" | cut -f4)
  [ "${c:-0}" -le "$max" ] ||
    { echo "$who holds $c tokens of context, over $max: not resumed to change its settings. Hand its task to a fresh session: this --set with --how fresh -- '<what next>'$([ -n "$mode" ] || echo ', or --how live')"; exit 4; }
  # A background session resumed with flags starts a copy under a new id: the change goes into its job's saved
  # options instead, Claude Code's jobs/ID8/state.json (undocumented: its shape is checked before anything stops).
  job=$(pre_dir "$pre")/jobs/${id:0:8}/state.json
  jq -e --arg id "$id" '.sessionId == $id and (.respawnFlags | type == "array")' "$job" >/dev/null 2>&1 ||
    { echo "$(tilde "$job"): missing, or not $who's, so --set can't change its saved options (no job state): try --how fresh"; exit 1; }
  text="Settings changed by $by: $changes${why:+ ($why)}. Carry on with your task; if it was finished, end your turn without a message."
  if [ -n "$pid" ]; then
    stop_session "$pre" "$id" || { echo "couldn't stop $who, or confirm it stopped within 30s: not resumed, settings unchanged"; exit 1; }
  fi
  after_stop() {   # WHAT: a failure once it may be stopped, said so
    if [ -n "$pid" ]; then echo "stopped $who, but $1: settings unchanged; wake it (--send-when-idle ${id:0:8} TEXT) or run this --set again"
    else echo "$who: $1: settings unchanged"; fi
    exit 1
  }
  job_put() {   # FILE: its content becomes the job state, through a temp file beside it (the state's mode kept), then mv
    local t; t=$(mktemp "${job%/*}/.state.json.XXXXXX") || return 1
    cp -p "$job" "$t" && cat "$1" > "$t" && mv -f "$t" "$job" || { rm -f "$t"; return 1; }
  }
  # The rewrite, once it's stopped (a running job writes its own state), the original kept to put back: each --model
  # and --effort entry with its value (or a --model=… one) out where a new one replaces it, a --permission-mode only
  # when the mode changes; the new ones appended, every other entry kept in order.
  cp "$job" "$TMP/job.orig" && jq --arg id "$id" --arg m "$nm" --arg e "$ne" --arg p "$mode" '
    def gone($f): ($m != "" and ($f == "--model" or ($f | startswith("--model="))))
      or ($e != "" and ($f == "--effort" or ($f | startswith("--effort="))))
      or ($p != "" and ($f == "--permission-mode" or ($f | startswith("--permission-mode="))));
    if .sessionId == $id and (.respawnFlags | type) == "array" then
      .respawnFlags |= ((reduce .[] as $f ({o: [], skip: false};
          if .skip then .skip = false
          elif ($f | type) == "string" and gone($f) then .skip = ($f | contains("=") | not)
          else .o += [$f] end) | .o)
        + (if $m != "" then ["--model", $m] else [] end) + (if $e != "" then ["--effort", $e] else [] end)
        + (if $p != "" then ["--permission-mode", $p] else [] end))
    else error("not its job state") end' "$TMP/job.orig" > "$TMP/job.new" && job_put "$TMP/job.new" ||
    after_stop "couldn't rewrite its saved options ($(tilde "$job"))"
  # The override file steps aside while it resumes, so its hook can't put old values over the saved options on the
  # first request: gone once it resumed, back when the resume failed.
  held=; [ ! -e "$ovr" ] || { held=$sdir/.$id.held.$$; mv -f "$ovr" "$held" || held=; }
  if ! resume_with "$pre" "$cwd" "$id" "$text"; then
    job_put "$TMP/job.orig" || echo "couldn't put $(tilde "$job") back as it was: its saved options carry the change"
    [ -z "$held" ] || { [ -e "$ovr" ] || mv -f "$held" "$ovr"; rm -f "$held"; }
    after_stop "its resume failed (above)"
  fi
  [ -z "$held" ] || rm -f "$held"
  set_log resume
  echo "$who: $changes, resumed under its own id (resume)"; exit 0
fi

# fresh: --handover on the new values (it refuses mid-turn, on a prompt or interactive itself); logged once it started.
bash "$SELF" --handover "$id" ${nm:+--model "$nm"} ${ne:+--effort "$ne"} ${mode:+--mode "$mode"} --by "$by" -- "$next"; rc=$?
[ "$rc" != 0 ] || set_log fresh
exit "$rc"
