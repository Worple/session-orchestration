# WSL baseline, 2026-11-24

Upstream at `e73af91` (session-orchestration 0.170.0), run inside WSL Ubuntu 24.04.5 on kernel 6.18 (WSL2).

## Environment

| Tool | Version | Where |
|---|---|---|
| Claude Code | 2.1.331 | `~/.local/bin/claude` (native installer) |
| Node | 22.20.0 | `~/.local/node/bin/node` (already installed; the NodeSource step was skipped) |
| git | 2.43.0 | `/usr/bin/git` |
| jq, gh, perl, openssl, python3, curl, tmux | Ubuntu 24.04 packages | `/usr/bin` |

None of them resolves under `/mnt/c`.

## Results

- 22 of 24 `*.test.sh` files pass, including every file Phase 1 touches: `session-status.test.sh` (all 27 sections) and `coordinator-guard.test.sh`.
- `claude plugin validate .`: passes.
- `claude plugin test plugins/session-orchestration`: 87 pass, 0 fail.

## Failures (recorded, not fixed: neither is in a file Phase 1 touches)

**`plugins/session-orchestration/skills/orchestrating-sessions/history-git.test.sh`**, exit 1:

```
history-git.test: versions
```

The assertion at line 43 expects `history-git versions "$P"` to print 2 lines. Not investigated further. git 2.43.0 is a likely suspect.

**`plugins/session-orchestration/skills/retro/retro.test.sh`**, exit 1:

```
partial: the usage log starts 2026-10-12, inside the window
FAIL: search: ~ finds the home path
```

The assertion at line 553 expects `retro search '~/x/docs' 7` to match the searcher session. It's probably how the home path is spelled on Linux compared with macOS. Not investigated further.
