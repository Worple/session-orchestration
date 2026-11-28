# Phone inbox: answering approvals from the user's phone

Read this when the user asks for the phone inbox, says they answered on the phone, or after a plugin update when a
phone inbox is set up. People-facing description: [features/phone-inbox.md](../../features/phone-inbox.md).

The phone inbox is a private claude.ai page, the plugin's `phone-inbox/inbox.html`, that shows your open approval
asks on the user's phone and lets them answer there. You don't handle the page's data: the plugin's hooks module
reads and writes the page database itself, with no model turn from you, and submits a phone answer exactly as a pane
click.

## Rules

- **Set it up only when the user asks.** Publish the plugin's `phone-inbox/inbox.html` unchanged with the Artifact
  tool, capabilities `{db:{}, user:{}}`. Never edit or restyle it: `phone_setup` checks the published page against
  the plugin's file and refuses a changed one. Then call `phone_setup` with the page URL, give the user the URL, and
  tell them to tap "Pair this phone" on it and approve the code in the pane's Phone section (only if the code there
  matches the one on their phone).
- **After a plugin update**, republish `inbox.html` to the same URL (Artifact tool with `url`), then call
  `phone_setup` with that URL again. If it says `The page at <url> isn't the plugin's inbox.html`, republish
  from the plugin and call it again.
- **When the user says they answered on the phone**, call `phone_answers`. It sweeps at once and returns
  `Phone: N delivered (KEYS), M refused (reasons)` or `Phone: nothing new`. Delivered answers arrive as prompts once
  your turn ends.
- **Never write the page's database yourself** (no `ArtifactData` writes to it). The plugin does that, and a row you
  write is refused.
- **A phone answer is a pane click.** It arrives as `Approval pane answer for KEY: OPTION. Asked: QUESTION`. Treat it
  exactly like a pane click: it is the Quote for a relay ([approvals.md](approvals.md)).
- **Turning it off**: `phone_setup` with `""`. Unpairing a phone is the user's press on its Unpair button in the pane.

## When answers arrive

While the coordinator pane is open (an interactive session), the plugin sweeps the page every 60 seconds, so an
answer reaches you within about a minute, plus the rest of your current turn if you are busy. In a background
session nothing sweeps on its own: call `phone_answers`. A `claude -p` session has no Artifact tools, so the phone
inbox doesn't work there.

A refused answer shows on the phone as `Refused: <reason>` and is listed in the `phone_answers` result (the reasons
are in the feature doc). Its ask is still open on the pane: tell the user, or let them answer there. `page changed`
means the published page is no longer the plugin's file, and the pane warns.

The phone offers the listed options only. An answer in the user's own words goes through the terminal's question
dialog. An ask too large to mirror is skipped: it's answered in the pane.
