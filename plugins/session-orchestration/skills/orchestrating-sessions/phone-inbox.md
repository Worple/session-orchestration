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
  the plugin's file and refuses a changed one. Then open the pane (`open_pane`: `phone_setup` needs it), call `phone_setup` with the page URL, give the user the URL, and
  tell them to tap "Pair this phone" on it and approve the code in the pane's Phone section (only if the code there
  matches the one on their phone).
- **After a plugin update**, call `phone_setup` with the page URL first. Republish `inbox.html` to the same URL
  (Artifact tool with `url`) only if it refuses, then call it again. Any later publish to that URL, even an identical
  one, counts as a changed page until you call `phone_setup` again: the phone's answers and pairing are blocked
  (feature doc, "The page check"), and the pane's Phone line says to republish and call `phone_setup` again. When
  `phone_setup` accepts a new version or URL it unpairs every phone: tell the user each phone has to pair again
  (and to close the phone page and open it again). If `phone_setup` says `Couldn't read the page …` check
  the URL; if it says `Couldn't clear the phone's pending answers …` call it again.
- **When the user says they answered on the phone**, call `phone_answers`. It returns at once with
  `Phone: reading the answers now. …` and the passing answers arrive as prompts once your turn ends. The sweep runs on the pane's timer, so with no pane open it refuses: `phone_answers: open the
  coordinator pane first (open_pane): its timer is what sweeps.` Open the pane, then call it again. The counts are
  on the pane's Phone line, not in the tool result.
- **Never write the page's database yourself** (no `ArtifactData` writes to it). The plugin does that, and a row you
  write is refused.
- **A phone answer is a pane click.** It arrives as `Approval pane answer for KEY: OPTION. Asked: QUESTION`. Treat it
  exactly like a pane click: it is the Quote for a relay ([approvals.md](approvals.md)).
- **Turning it off**: `phone_setup` with `""`. Unpairing a phone is the user's press on its Unpair button in the pane.

## When answers arrive

The phone inbox works only while you are an interactive coordinator with the pane open: the pane's timer sweeps the
page every 60 seconds, so an answer reaches you within about a minute, plus the rest of your current turn if you are
busy. In a background (`--bg`) session phone answers are not picked up at all, so don't set it up there. A `claude -p`
session has no Artifact tools.

A refused answer shows on the phone as `Refused: <reason>` and on the pane's Phone line (the reasons are in the
feature doc). Its ask is still open on the pane: tell the user, or let them answer there.

The phone offers the listed options only. An answer in the user's own words goes through the terminal's question
dialog. An ask too large to mirror is skipped, and so is a comment post (an ask with a body): both are answered in the
pane.
