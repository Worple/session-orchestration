# A session's last `done` reply for task $k (its `key` $k, or none) the reply tool let through (its result `Sent to …`
# or `Queued …`), from its transcript slurped (`jq -rs --arg k KEY`; session-status's reported_done greps it to reply
# calls and user lines first): DONE \037 WORKTREE (the reply's absolute worktree, else its cwd, as the tool does) \037
# PROMPTS (the user's or a session's prompts since, a background task's notification aside). \037, not a tab: `read`
# merges empty tab fields. Nothing when it sent none.
. as $all
| [.[] | select(.type == "user") | .message.content | arrays | .[] | select(.type == "tool_result" and (.is_error | not))
    | select(.content | if type == "array" then map(.text? // "") | join("") else tostring end | test("^(Sent to|Queued)")) | .tool_use_id] as $ok
| [to_entries[] | .key as $i | .value | select(.type == "assistant") | .cwd as $c | .message.content[]?
    | select(.type == "tool_use" and .name == "mcp__session-orchestration__reply" and (.input.done | type) == "string"
      and ((.input.key // $k) == $k))
    | .id as $u | select($ok | index($u))
    | {i: $i, d: .input.done, wt: ((.input.worktree | select(type == "string" and startswith("/"))) // $c // "")}] | last // empty
| [.d, .wt, ([$all[(.i + 1):][] | select(.type == "user" and (.isMeta | not) and (.message.content | type) == "string"
    and (.message.content | startswith("<task-notification>") | not))] | length)] | map(tostring) | join("\u001f")
