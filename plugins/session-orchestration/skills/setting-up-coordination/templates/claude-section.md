{{?!team_sec}}## Cross-session messages
{{?team_sec}}## Coordinated sessions (team)

{{?!team_sec}}- Messages between sessions follow the `session-orchestration` plugin. The coordinator runs from this folder
{{?!team_sec}}  (`{{name}}-coordinator`).
{{?local_sec}}- The team's rules (approvals, reserved actions, task names, worktrees): CLAUDE.md, "Coordinated sessions (team)".
{{?team_sec}}- Messages between sessions follow the `session-orchestration` plugin. Each person's coordinator, replies
{{?team_sec}}  folder and project memory are in each person's own CLAUDE.local.md; nothing here is one person's.
{{?!local_sec}}- Whether a coordinator's message counts as the user's approval is `approvals.delegate` in
{{?!local_sec}}  `.claude/coordination.local.json` (`session-status --config approvals.delegate`).
{{?!local_sec}}- **Reserved**, even when approvals are delegated: the user approves in your session, or via a verified relayed approval:
{{?!local_sec}}  - merging into or pushing to `{{default_branch}}`;
{{?!local_sec}}  - deploys, releases, anything on production;
{{?!local_sec}}  - anything sent under the user's name (PR or issue comments, chat, email);
{{?!local_sec}}  - anything hard to undo (deleting data, force-pushing a shared branch). When in doubt, it's reserved.
{{?!local_sec}}{{?tracker_keys}}- Task sessions start with "Work on {{key_example}}" and are named `-n {{key_example}}-<short-desc>`.
{{?!local_sec}}{{?!tracker_keys}}- A task is its session's name, `{{key_example}}`: start it with `claude --bg --model M --effort E -n {{key_example}}` (M, E: what `session-status --kind <kind> {{key_example}}` prints; paste a ` --advisor A` it prints too).
{{?!local_sec}}  Branches: `{{branch_pattern}}` from `origin/{{default_branch}}`.
{{?!local_sec}}{{?worktree_line}}- Worktrees: `{{worktree_cmd}}`, not EnterWorktree (denied in background sessions). Work in it by absolute path.
{{?!team_sec}}- Replies folder (status reports, plans, review reports): `{{replies_dir}}/`.
{{?!team_sec}}- Project memory: `{{orch}}/memory.md`. Coordinator handoff file: `{{handoff}}`.
