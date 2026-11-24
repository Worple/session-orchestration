---
name: defer-task
description: Use PROACTIVELY the moment you notice or mention a bug, missing feature, refactor, or docs/config/setup gap OUT OF SCOPE of the current task. Writing it as a task file in the project's tasks folder IS the action, not fixing it now or offering a ticket later. Fires on "latent bug", "out of scope", "while I'm here I noticed", "worth a follow-up", "leave that for now". A gap that already cost you is a friction case instead (project-memory).
---

# Defer Out-of-Scope Task

When you spot something worth fixing that is NOT part of the current task, do not fix it now (scope creep) and do not just mention it (it gets forgotten). Capture it, then continue what you were doing.

## Steps

1. **Categorize**: `features` (new capability), `bugfixes` (something broken), or `refactorings` (works but messy). If none fit, use `bugfixes`; a docs, config or setup gap goes there too, `where` naming the doc that should have said it.

2. **Dedup**: List `TASKS/<category>/`, TASKS being the project's tasks folder: what `cases tasks` prints (beside the project-memory skill), `${XDG_STATE_HOME:-~/.local/state}/session-orchestration/projects/<root, encoded>/tasks/`, outside every checkout so a worktree-isolated session writes there too. If a file already covers the same thing, skip — don't create a duplicate.

3. **Write** `TASKS/<category>/YYYY-MM-DD-<short-slug>.md`:

   ```markdown
   # <one-line title>
   - where: path/to/file.ext:LINE
   - found while: <the task you were actually doing>
   suggested: <one-line fix idea, or "investigate">
   ```

   Use today's date. Slug is 2-5 kebab-case words. Fill `where` with a real `file:line` when you have one.

4. **One line to the user**, e.g. `Noted "<title>" as a deferred bugfix.` Then **return to the original task** — do not start working the deferred item.

## Rules

- Capture is cheap, derailing is not. Never expand the current task to "just fix it too" unless the user asks.
- If the finding IS in scope, this skill does not apply — just fix it.
- One finding = one file. Multiple unrelated findings = multiple files.
- The [graduate](../graduate/SKILL.md) pass resolves these files later (ticket it, fix it or drop it, on the user's yes) and deletes them.
