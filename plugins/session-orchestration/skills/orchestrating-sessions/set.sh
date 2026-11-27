# session-status --set ID [--model M] [--effort E] [--mode P] [--up|--down] [--how auto|live|resume|fresh]
#   [--why TEXT] [--by lead|pane] [-- 'NEXT']: changes a session's model, effort or permission mode, its conversation
#   kept (features/agent-settings.md). Sourced by session-status (its find_session read_row stop_session resume_with
#   mid_turn transcript_of activity_fields, TMP and SELF), and exits with --set's code: 0 done; 1 a listing, stop or
#   resume failed; 2 usage, no such session or a bad value; 3 busy, waiting, locked or interactive; 4 too big to
#   resume; 5 outside policy.
# It changes from the override file's values, else what its transcript's last reply ran on (lib.sh last_model);
# --up/--down move both one rung (lib.sh escalate_rung, deescalate_rung). Tiers, by --how (auto: resume for a mode,
# else live, or resume while LIVE is off):
#  - live: the override file, merged with the change. The agent's turn.step hook applies a model from its next
#    request, an effort from its next turn (the next step that carries input). Running or not, busy, waiting or
#    interactive alike; never a mode.
#  - resume: under --compact's lock, stopped while idle and resumed under its own id with the current model and effort
#    as flags beside the change (a resume can't bring old values back); then the override file goes (RESUME_KEEPS).
#    Refused, nothing stopped: mid-turn, on a prompt, interactive or locked (3); over SESSION_STATUS_MAX_RESUME (4).
#  - fresh: --handover to a new session on the new values, NEXT its brief.
# First, for every tier, lib.sh policy_allows on what changes (a lead: the person's policy.* keys): outside it, exit 5
# with nothing changed, the last line `needs your approval: set "NAME" (ID8) to CHANGES`.
# Override file: ${XDG_CACHE_HOME:-~/.cache}/session-status/settings/ID.json, {"model"?, "effort"?, "by", "why", "at"},
# written to a temp file and moved. Log: $(proj_dir)/settings.jsonl, a line per change made.
LIVE=on RESUME_KEEPS=yes   # the phase 1 spikes (docs/superpowers/notes/2026-11-24-phase1-spikes.md)

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
  if [ -z "$pid" ]; then echo "$who: $changes when it next runs (live)"
  elif [ -n "$ce" ]; then echo "$who: $changes from its next request, effort from its next turn (live)"
  else echo "$who: $changes from its next request (live)"; fi
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
  flags="${nm:+--model $(printf %q "$nm") }${ne:+--effort $ne }${mode:+--permission-mode $mode}"; flags=${flags% }
  text="Settings changed by $by: $changes${why:+ ($why)}. Carry on with your task; if it was finished, end your turn without a message."
  if [ -n "$pid" ]; then
    stop_session "$pre" "$id" || { echo "couldn't stop $who, or confirm it stopped within 30s: not resumed, settings unchanged"; exit 1; }
  fi
  # The override file steps aside while it resumes, so its hook can't put old values over the flags on the first
  # request: gone once it resumed (RESUME_KEEPS=no: kept), back when the resume failed.
  held=; [ "$RESUME_KEEPS" = no ] || [ ! -e "$ovr" ] || { held=$sdir/.$id.held.$$; mv -f "$ovr" "$held" || held=; }
  if ! resume_with "$pre" "$cwd" "$id" "$text" "" "$flags"; then
    [ -z "$held" ] || { [ -e "$ovr" ] || mv -f "$held" "$ovr"; rm -f "$held"; }
    if [ -n "$pid" ]; then echo "stopped $who, but its resume failed (above): settings unchanged; wake it (--send-when-idle ${id:0:8} TEXT) or run this --set again"
    else echo "the resume of $who failed (above): settings unchanged"; fi
    exit 1
  fi
  [ -z "$held" ] || rm -f "$held"
  set_log resume
  echo "$who: $changes, resumed under its own id (resume)"; exit 0
fi

# fresh: --handover on the new values (it refuses mid-turn, on a prompt or interactive itself); logged once it started.
bash "$SELF" --handover "$id" ${nm:+--model "$nm"} ${ne:+--effort "$ne"} ${mode:+--mode "$mode"} --by "$by" -- "$next"; rc=$?
[ "$rc" != 0 ] || set_log fresh
exit "$rc"
