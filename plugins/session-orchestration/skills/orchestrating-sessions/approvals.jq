# approvals.jq: the approval answers clicked in the coordinator pane, and the coordinator's relays of them, for
# session-status --approvals and --relay. Input (jq -Rn): rows of a coordinator's transcript and its predecessors' that
# name a pane answer or a relay, in any order. Output: one object per distinct answer, newest first,
# {key, ts, quote, relays: [{to, action, ts}]}: quote is the answer as verify-approval.sh matches it, relays the
# SendMessage relays of that quote sent since it (one sent before a later click of the same answer doesn't count).
# quotes, trim and typed are verify-approval.sh's, so a quote round-trips.
def quotes: gsub("\\\\\""; "\"") | gsub("[“”„]"; "\"") | gsub("[‘’]"; "'");
def trim: gsub("^\\s+|\\s+$"; "");
def typed: gsub("\\s*<system-reminder>[\\s\\S]*?</system-reminder>\\s*"; "\n") | trim;
def pane($o): $o.kind == "plugin" and $o.name == "session-orchestration";
def epoch: try (sub("\\.[0-9]+Z$"; "Z") | fromdate) catch 0;
[inputs | fromjson? | objects] as $rows
| [$rows[] | select(.type == "assistant") | (.timestamp | epoch) as $ts
   | .message.content[]? | select(.type == "tool_use" and .name == "SendMessage") | .input
   | (.message? | strings | capture("APPROVAL relayed from the user\nQuote: (?<q>[\\s\\S]*?)\nAction: (?<a>[^\n]*)")) as $m
   | {to: (.to | tostring), action: $m.a, ts: $ts, q: ($m.q | quotes | typed)}] as $relays
| [$rows[] | (.timestamp | epoch) as $ts
   | if .type == "user" and pane(.origin) then
       .message.content | if type == "string" then . else ([.[]? | .text? // empty] | join(" ")) end
     elif .type == "attachment" and .attachment.type == "queued_command" and pane(.attachment.origin) then
       .attachment.prompt | tostring
     else empty end
   | typed | select(startswith("Approval pane answer for "))
   | {key: capture("^Approval pane answer for (?<k>[^:]+): ").k, ts: $ts, quote: .}]
| group_by(.quote) | map(max_by(.ts))
| map((.quote | quotes | typed) as $qn | .ts as $at | .relays = [$relays[] | select(.q == $qn and .ts >= $at) | del(.q)])
| sort_by(-.ts)[]
