# session-orchestration

## Releasing a plugin change

1. `version` lives only in `plugins/<plugin>/.claude-plugin/plugin.json`, and a branch leaves it alone: the release
   workflow (`.github/workflows/release.yml`, running `.github/release.sh`) numbers each plugin from main's version
   when the change lands, one push at a time, so two branches never claim the same number. Commit as
   `<plugin>: <what changed, in plain words>`; the release commit becomes `<plugin> <version>: <that text>`: the next
   minor, or the next patch when every commit of the change carries a `Release: patch` trailer
   (`git commit --trailer 'Release: patch'`). Docs on the branch say "from the release after <feature>", never a
   version that doesn't exist yet. A branch that bumped `version` in its last commit keeps that number.
   A change to what setup writes, or to where a project's files live, ships its migration: see "Adding a migration" in
   `plugins/session-orchestration/skills/setting-up-coordination/migrations.md`. A change to where coordinator files
   live, or to what is kept out of git, says in its doc and migration what is shared and what stays personal: other
   people may work in the project, with or without this plugin, and committing the shared files is a per-project
   choice.
2. Before committing: `claude plugin test plugins/<plugin>`, `tsc -p plugins/<plugin>` (needs the
   engine's generated `.claude-plugin/types/`, untracked: copy it from the main checkout into a new worktree first, or
   tsc finds no tsconfig and writes stray `.js` next to the sources; if `claude plugin test` fails, compare with
   main before blaming your change), `claude plugin validate plugins/<plugin>` and
   `./scrub-check.sh` (no personal or company names: examples use `PROJ-123`, paths `/home/u/…`), and only the shell
   suites (`*.test.sh`) beside the files you changed. In `session-status.test.sh` run only the sections your change
   touches: `bash session-status.test.sh NAME…`, picking each `if section NAME; then` block that runs the option or
   behaviour you changed (`grep -n -e '--yourflag' -e '^if section'` shows which; a fixture or helper change at the
   top touches all of them). The full suite is CI's (`test.yml`, macOS and Ubuntu), not a local step.
3. Land it through a PR: push the branch, open the PR and, once the task is approved, `gh pr merge <N> -R OWNER/REPO --auto --rebase`
   (`mergeStateStatus` already `CLEAN`: `gh pr merge <N> -R OWNER/REPO --rebase`, no `--auto`, which gh refuses there;
   a refused merge leaves the relay usable while the PR stays open with no auto-merge).
   In a coordinated session, approved means the coordinator's relay naming that PR (`merge OWNER/REPO#N`): send the
   done report first (`reply` with `done: pr` and `key`), then merge once the relay arrives. An approval in the start
   brief is the coordinator's to relay, not the session's to act on, and the approval hook refuses the merge before
   the relay; none comes: ask for it as worker.md's "Posting and merging" says.
   `main` takes only rebase merges of a branch green in CI; nothing pushes `main` by hand. A branch need not be up to
   date with `main`: each landing adds a release commit, so `BEHIND` is normal and GitHub rebases the branch as it
   merges. Until yours shows merged, after each `gh pr checks <N> -R OWNER/REPO --watch` check
   `gh pr view <N> -R OWNER/REPO --json state,mergeStateStatus` (they may share the merge's command, and a wait loop may
   test them: `[ "$(gh pr view …)" = MERGED ]`); `BEHIND` needs nothing, only a conflict (`DIRTY`) does:
   `git fetch origin && git rebase origin/main && git push --force-with-lease`. Auto-merge stays on and merges once CI
   is green. No merge queue: GitHub offers it only to organization repos.
   Since no PR is tested on top of the others, `test.yml` runs again on each push to `main`. Once yours is merged, watch
   the run on its landing commit (`gh pr view <N> -R OWNER/REPO --json mergeCommit` names it;
   `gh run list -R OWNER/REPO -w test -c <sha>` finds the run, listed a few seconds after the merge;
   `gh run watch <id> -R OWNER/REPO --exit-status` waits). Red, with the run on the commit before yours green: your
   change broke `main` together with one that landed before it. Tell the coordinator, then fix it forward in a new PR
   through these same steps (`Release: patch`), or revert your commit that way when the fix isn't quick. Red before
   yours too: tell the coordinator; the fix is the session's whose landing turned it red first.
4. Install it: the project's coordinator runs the install once per release commit (until the user says otherwise):
   `claude plugin update <plugin>@session-orchestration` once the marketplace source has the release commit, then it
   checks `installed_plugins.json` lists `<plugin>` at the new version. A worker's done report says "released", with
   no command handed to the user.
5. Reload. Running sessions pick up a new tool or hook after `/reload-plugins`: the coordinator calls
   session-orchestration's `reload_plugins` tool, which runs it in its own session when the turn ends (from
   0.27.1; a worker reloads the same way when messaged to). Restart a session where the new tool doesn't show.
