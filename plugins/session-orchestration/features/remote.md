# Feature: remote coordinators (your other computers)

> **Start**: check that ListAgents lists your other computers' coordinators; `session-status --remote add` one it lists that `--coordinators` doesn't.
> **Read when**: the user wants a coordinator on another of their computers to reach this one, or a message to or from one went missing.

Off by default, from the release after remote coordinators. On when `features.remote` is `true`
in the person's `.claude/coordination.local.json` or the person-wide `~/.config/session-orchestration/config.json` (a
person key: the repo file can't set it), on each computer: `{"features": {"remote": true}}`.

**What it covers.** Your own coordinators on your other computers, signed in to the same claude.ai account. While a
session is connected to Remote Control, Claude Code's ListAgents lists that account's Remote Control sessions on other
machines (and its cloud sessions), and SendMessage by name reaches them through Anthropic's servers. A message to a
computer that is asleep arrives once it reconnects. The plugin only starts coordinators with Remote Control, lists the
ones you named, and keeps approvals local. A coordinator under another claude.ai account, or another person's, isn't
covered: Remote Control reaches only your own account's sessions.

**What the key does.**
- `--start` opens the coordinator as `claude --remote-control -n NAME 'Act as a coordinator'`, and `--successor`'s
  terminal command passes `--remote-control` too. The session's name titles it on claude.ai, and SendMessage
  addresses that name.
- A coordinator you start by hand: `claude --remote-control -n NAME 'Act as a coordinator'`, or `/remote-control`
  in a running one.
- A Claude Code Desktop app session can't be started with Remote Control: turn it on there with `/remote-control`.
  A Desktop successor's `--successor` says so.
- `session-init --check` warns about a setting below that keeps your other computers out.

**Listing them.** Once ListAgents shows a coordinator on another computer and it has said what it is for, add it:
`session-status --remote add NAME --purpose 'ONE LINE'`. `session-status --remote remove NAME` drops it. It refuses a NAME this computer's own coordinators use: the same
project on both computers names both coordinators alike, and a SendMessage by that name stays here. Rename the other
one there (`/rename`) and add that name. Both write
`remote.tsv` in the state folder (`${XDG_STATE_HOME:-~/.local/state}/session-orchestration/`), yours only and never
committed. `session-status --coordinators` lists them under `Remote`, after this computer's coordinators:
`NAME · another computer (Remote Control) · PURPOSE`. Message one by that NAME while this session is connected to
Remote Control, as sessions.md's Another project's matter says. Without Remote Control on the sender, the message
arrives with no reply address (`from="unknown"`).

**Settings** (Claude Code's, any settings file; `--check` reads the project's, yours and the managed ones):
- `crossSessionInbound`: `accept` or unset delivers a message from your other computers; `hold` and `refuse` (and an
  unrecognized value, which holds) keep it out.
- `disableRemoteControl: true` turns Remote Control off, so coordinators start without it.
- `isolatePeerMachines: true` makes each SendMessage to another computer ask first. A `true` in any file wins.

**A cloud session can't answer** until you allow that one session to reach your computers in the Claude app on a
trusted device. Messages to it get through; its answers are refused (HTTP 401) until then.

**Approvals never cross computers.** The merge/post hook accepts a relay only from a local `uds:` sender, and a
message from another computer comes from `bridge:…`. A coordinator on another computer never relays: a request that
needs the user goes on the pane of the coordinator that owns the work, and the user answers there (also by typing into
that coordinator through claude.ai: a typed line counts as the user's own).
