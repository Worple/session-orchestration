# session-orchestration

## Releasing a plugin change

1. `version` lives only in `plugins/<plugin>/.claude-plugin/plugin.json`, and a branch leaves it alone: the release
   workflow (`.github/workflows/release.yml`, running `.github/release.sh`) numbers each plugin from main's version
   when the change lands, one push at a time, so two branches never claim the same number. Commit as
   `<plugin>: <what changed, in plain words>`; the release commit becomes `<plugin> <version>: <that text>`: the next
   minor, or the next patch when every commit of the change carries a `Release: patch` trailer
   (`git commit --trailer 'Release: patch'`). A plugin's docs ship with its code, so they carry no "from the release
   after <feature>" note (`docs-lint.py` refuses one outside migrations.md, whose From column says it that way, never
   with a version that doesn't exist yet). A branch that bumped `version` in its last commit keeps that number.
   A change to what setup writes, or to where a project's files live, ships its migration: see "Adding a migration" in
   `plugins/session-orchestration/skills/setting-up-coordination/migrations.md`. A change to where coordinator files
   live, or to what is kept out of git, says in its doc and migration what is shared and what stays personal: other
   people may work in the project, with or without this plugin, and committing the shared files is a per-project
   choice.
2. Before committing: `claude plugin test plugins/<plugin>`, `tsc -p plugins/<plugin>` (needs the
   engine's generated `.claude-plugin/types/`, untracked: copy it from the main checkout into a new worktree first, or
   tsc finds no tsconfig and writes stray `.js` next to the sources; if `claude plugin test` fails, compare with
   main before blaming your change), `claude plugin validate plugins/<plugin>` and
   `./scrub-check.sh` (no personal or company names: examples use `PROJ-123`, paths `/home/u/…`), `./docs-lint.py`
   on a docs change (a rule in one doc only, flags the scripts have, links that resolve; its header says how to list a
   known hit in `docs-lint-allow.txt`), and only the shell
   suites (`*.test.sh`) beside the files you changed. In `session-status.test.sh` run only the sections your change
   touches: `bash session-status.test.sh NAME…`, picking each `if section NAME; then` block that runs the option or
   behaviour you changed (`grep -n -e '--yourflag' -e '^if section'` shows which; a fixture or helper change at the
   top touches all of them). The full suite is CI's (`test.yml`, macOS and Ubuntu), not a local step.
3. Push, open the PR, land, install and reload: read `LANDING.md` first.
