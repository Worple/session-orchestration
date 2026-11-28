# Feature: phone inbox

> **Start**: nothing to do. Set it up only when the user asks.
> **Read when**: the user asks to answer approvals from their phone, or says they answered on it.

The phone inbox shows the coordinator's open approval asks on the user's phone and takes their answers there. The
coordinator's part (what to publish, which tool to call) is in the orchestrating-sessions skill's `phone-inbox.md`.

## How it works

A private claude.ai page, the plugin's `phone-inbox/inbox.html`, is published unchanged with the Artifact tool
(capabilities `{db:{}, user:{}}`). It shows the open asks and writes signed answers into its database. The
coordinator's hooks module reads and writes that database itself, with no model turn, and submits a phone answer
exactly as a pane click: the coordinator receives the ordinary prompt `Approval pane answer for KEY: OPTION. Asked:
QUESTION`, and relays and their verification work unchanged.

Two tools, both coordinator only:

- `phone_setup {url}` stores the page URL (per account, in the plugin's store), mirrors the asks at once, and checks
  that the published page is exactly the plugin's `inbox.html` (see "The page check" below). If it isn't: `The page at
  <url> isn't the plugin's inbox.html: republish it from the plugin (phone-inbox.md), then call phone_setup again.`
  If the page can't be read back: `Couldn't read the page at <url> back (<why>): check the URL, then call phone_setup
  again.` `phone_setup` with `""` turns the phone inbox off.
- `phone_answers` takes no input. The engine refuses a prompt submitted while a tool call's hook is running, so the
  tool can't sweep inside its own call. It schedules the sweep on the pane's timer and returns at once with `Phone:
  reading the answers now. Those that pass arrive as prompts once this turn ends; the pane's Phone line says what
  came of them.` The counts, `Phone: N delivered (KEYS), M refused (reasons)` or `Phone: nothing new`, appear in the
  coordinator pane's Phone status line, not in the tool result. With no pane open it refuses with `phone_answers:
  open the coordinator pane first (open_pane): its timer is what sweeps.`

## When answers arrive

The phone inbox works only in an interactive coordinator with the pane open. The sweep runs from the pane's timer
every 60 seconds, and `phone_answers` only speeds it up. In a background (`--bg`) session phone answers are not
picked up at all. `claude -p` sessions have no Artifact tools. A busy coordinator gets the answer as a prompt when its
current turn ends. So an answer reaches the coordinator within about a minute, plus the rest of a busy turn.

## Pairing

1. On the phone, tap "Pair this phone" (give it a name, default `Phone`). The phone makes a key that never leaves it
   and shows a code `XXXX-XXXX-XXXX-XXXX`.
2. Within a minute the coordinator pane's Phone section shows `Pair phone "<label>" XXXX-XXXX-XXXX-XXXX? Pair only if
   your phone shows this code.` with Pair and Reject. Pair only if the codes match.
3. A request not approved within 10 minutes expires, and the phone offers Pair again. If you Reject, the phone offers
   Pair again with a new key.

Each paired phone has an Unpair button in the pane. An unpaired phone's answers are refused `unpaired device`, and the
page offers Pair again.

## What the phone shows

Per answer: `Sent — the coordinator picks it up within a minute`, `Queued`, `Delivered`, or `Refused: <reason>`. A
Recent answers list keeps the last 20. Refusal reasons: `malformed answer`, `unpaired device`, `bad signature`,
`expired` (answered more than an hour ago), `clock ahead` (the phone's clock is more than 5 minutes ahead),
`already used` (a replayed answer), `withdrawn or changed` (the ask was cancelled, answered elsewhere, or its
question changed), `not an option`, `already answered`, `not delivered: <why>`, `page changed`.

## Limits

- The phone offers the listed options only. Answers in your own words stay in the terminal's question dialog.
- The mirror shows up to 50 of the oldest asks that fit the page's size limit. An ask too large to mirror is skipped
  and must be answered in the pane.
- Details and activity are cut at 4000 characters. An answer over 8 KiB isn't sent (the card says to answer in the
  terminal).

## Updating the page

After a plugin update the coordinator publishes the new `inbox.html` over the old page and calls `phone_setup` once
more. The phone keeps its pairing across a republish to the same URL. That was tested in
the claude.ai app on one Android phone; other browsers and iOS are untested. Then close the phone page and open it
again (see "The page check").

## The page check

The coordinator only uses the page that `phone_setup` accepted. `phone_setup` reads the published page back and
checks two things: its content is exactly the plugin's `inbox.html`, and its published version is the one
`phone_setup` accepted. Any later publish to that URL counts as a changed page until `phone_setup` is called again,
even an identical republish. While the page counts as changed:

- answers are refused `page changed`;
- pairing requests are hidden, and a Pair press is refused;
- the pane's Phone line shows `The page at <url> isn't the plugin's inbox.html: republish it from the plugin
  (phone-inbox.md), then call phone_setup again.`

When `phone_setup` accepts a new version, it first refuses the answers still waiting with `page changed`, so nothing
written while the page was different gets through. If it can't clear them, it refuses with `Couldn't clear the
phone's pending answers (<why>): call phone_setup again.` and changes nothing.

If the page can't be read back during a sweep, waiting answers are left untouched and the Phone line shows `can't
check the phone page: <why>`.

After a page change, close the phone page and open it again. Code loaded while the page was different keeps running
in an open tab even after the page is fixed and accepted again.

Activity on the phone is one short line per session (name, state, what it's doing), with no ids or paths.

## What the signature protects

- A coding session that can write the page database (any session can call `ArtifactData`) can't forge an answer:
  rows without a paired device's valid signature are refused `bad signature` or `unpaired device`. A replayed answer
  is refused `already used`. An answer is bound to the exact ask id, key and question, and to the listed option.
- Pairing is the trust step: only your Pair press in the pane trusts a device, and only if the codes match.
- Page integrity: `phone_setup` and every sweep with answers to handle check the published page (see "The page
  check"). If a session republished the page with other code (which could make the phone sign things while the page
  is open), its answers are refused `page changed`, new pairing is blocked and the pane warns.

It does not protect against:

- A session that deliberately edits the plugin's store file (a plain JSON file under `~/.claude/plugins/store/`) to
  add its own device. The transcript-based approval gate has the same limit.
- Anyone who holds the unlocked phone.
- A phone page tab that is already open when the page is changed: it keeps running the code it loaded until it is
  closed and opened again.

One residual case: if the coordinator stops between marking an answer `Queued` and submitting it, the answer stays
`Queued`. The ask is still waiting in the pane, so answer it there.
