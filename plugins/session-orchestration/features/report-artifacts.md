# Feature: report pages

> **Start**: nothing to do until the person file lists report kinds; then a session that finishes a report of a
> listed kind runs the check below before its done report.
> **Read when**: you finish a research, retro, design or review report and `session-status --config
> features.report_artifacts` prints anything; the user asks to publish reports as pages, or about a report page, its
> comments or the `Report pages` footer.

From the release after report artifacts. Off by default. With it on, a session that finishes a long report also
publishes the report's `.md` as a private claude.ai page and puts the link in its done report. The user reads the
rendered page and can comment on it. The `.md` in the replies folder stays the record that every other session reads.

## Turning it on

Two keys, in the project's own person file (`.claude/coordination.local.json`) only:

```json
{ "features": { "report_artifacts": ["research", "retro", "design"] },
  "report_artifacts": { "account": "~/.claude" } }
```

- **`features.report_artifacts`**: the report kinds that may be published, from `research` (a research run's
  `<KEY>.md`), `retro` (`retro-<scope>-<N>.md`), `design` (a design doc, or a plan written for sign-off) and `review`
  (a PR review report, and only where `features.review_inbox` is off: an inbox takes the findings). Unset or empty
  means off. There is no `true`: each kind that may leave the machine is named. A value that isn't such a list warns
  and counts as off.
- **`report_artifacts.account`**: the Claude config dir (absolute or `~/…`, an existing folder) whose sessions
  publish for this project. Needed when `features.accounts` is on: unset there, nothing is published. A session under
  another account keeps the report local. This stops a work project's report from landing in a personal claude.ai
  account when a session runs there as a fallback.
- **Never from a committed file, and never person-wide.** The repo file's copies of both keys are dropped, as every
  person key's are. The person-wide `~/.config/session-orchestration/config.json` doesn't set them either: what may
  leave the machine differs between a work project and a personal one. `session-status --config KEY` prints either.
- **Turning it off** stops new publishes. Pages already published stay until the user deletes them.

## Publishing a report

The session that wrote the report publishes it, since the text is already in its context.

1. Write the report's `.md` in the replies folder and run the HTML script, as you do today. Write home paths as
   `~/…`: the done check accepts them, and a home path blocks the publish.
2. Run `session-status --report-publish FILE --kind KIND`, FILE an absolute path. It prints `publish: yes`, or `publish: no (<why>)` and
   exits 1. The script decides, not you. Each `no`:
   - `off in this project` or `kind K isn't in config features.report_artifacts`: keep the report local and say
     nothing about a page.
   - `the review inbox takes review findings`: the inbox is where the user answers them.
   - `isn't an absolute path to a .md file`, `isn't in the replies folder`, `is a draft, a status, handoff or
     coordinator file`: only a report in the replies folder is published. Status reports and handoffs, chunk briefs
     and reports (`*-report.md`, `*-build.md`, `*-archive.md`), the coordinator's inbox and handoff file, memory,
     feedback cases and post drafts (`*.body.md`, whose sha256 an approval names) are never published, whatever the
     key says. The check refuses those it can tell by name. It can't tell a task's `<KEY>.md` status file from a
     research run's `<KEY>.md` report, so never run it on a status file.
   - `features.accounts is on and report_artifacts.account names no account`, `config report_artifacts.account=…
     is not an absolute folder`, or `this session runs under A, and report_artifacts.account is B`: keep it local,
     and say in the done report that it wasn't published and why.
   - `personal markers`, followed by one line per hit (`FILE:LINE: a home path`, an email, a name on the scrub list,
     a token-shaped string, `a session id`): fix what you can (`~/…` for a home path; drop a session id the reader
     doesn't need) and run the check again. What you can't remove without losing meaning (a colleague's name in a
     review) stays local: the done report says "not published: line N, <kind of marker>". `--allow-markers` skips
     this gate, and only on the user's yes to publishing that file (said in your session, or relayed): their "publish
     it anyway" covers that one file, that one run.
3. On `publish: yes`, publish **the `.md` itself** with the Artifact tool: publish this report as Markdown, the
   file as it is, with no `.html` page authored beside it, so the page can't drift from the record. Never share the
   page: it is private to the account that published it, and sharing is the user's own click on the page.
4. Send the done report with `reply`, `done: report`, `key`, and `artifact`: `{url, version_id, file, kind}` (the
   link and version id from the publish result, the absolute path of the `.md`). The tool records the page first and
   adds `Page: <url>` to the message when the text lacks the link. One reply records one page: two pages, two
   replies. When it can't record the page it sends nothing: fix what it says and reply again. It also refuses
   `report` when the published file is `<KEY>.md` (a research run's report), since `report` would overwrite it.

When the publish fails (artifacts turned off by the organization, the session not signed in to claude.ai), the
report stays local: that isn't an error. Send the done report without `artifact`, saying "not published: artifacts
unavailable".

## The registry and the footer

`<replies>/report-artifacts.tsv` holds one row per page: link, key, kind, file, account, session id, publish time,
the sha256 of the published file, its version id, and `open`. A republish of the same link replaces its row. It is
personal state in the replies folder, never committed.

The coordinator's status sweep lists the open rows published in the last 14 days under a `Report pages` footer, and the pane shows each as a card
with an **Open the page** link: `KEY · KIND · TITLE · URL · ~ACCOUNT`, plus `· page behind the file` when the `.md`
changed since its publish, or `· file gone`. The footer isn't news, so `--changes` never reports it.

## What to know about the pages

- **With no session watching, claude.ai answers a sent comment itself.** The session that published a page watches
  it, and a comment the user sends to Claude wakes it while it runs. Once that session has stopped (the plugin stops a
  finished one after 10 quiet minutes), claude.ai opens a new web chat in the user's claude.ai chat list, which edits
  the page and replies in the thread. It never changes the `.md`: the page can then be ahead of the file.
- **Revising a report**: work only in the replies folder (where the `.md` lives) or in a registered worktree; any
  change the comment asks for in the repo goes through the usual worktree. Before publishing again, read the page.
  If the page is ahead of the file, carry its changes into the `.md` first, then publish. A publish built on an older
  version is refused, with the live page to merge onto: merge into the `.md` and publish again, never with `force`.
- **Pages are per account.** A session under the other account gets HTTP 404 for the page: it can't read, watch or
  revise it.
- **The plugin never deletes a page or a web chat.** The user deletes them (`/artifacts`, or the claude.ai gallery
  and chat list).
- **On a Team or Enterprise plan** the organization's owners can list, read and set retention for published pages.
  That is why the key is per project and names the account.
