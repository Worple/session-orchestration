# Writing instructions

The plugin's skills, feature docs and the reply card are prompts: Claude follows them. Write them by Anthropic's
prompting guides, Agent Skills pages and the pages listed below.

Last reviewed 2026-11-20 against: prompt-engineering/overview,
prompt-engineering/claude-prompting-best-practices, agent-skills/overview, agent-skills/quickstart,
agent-skills/best-practices, agent-skills/enterprise, agent-skills/claude-api-skill,
strengthen-guardrails/mitigate-jailbreaks, strengthen-guardrails/reduce-hallucinations,
strengthen-guardrails/increase-consistency, strengthen-guardrails/reduce-latency,
strengthen-guardrails/reduce-prompt-leak, strengthen-guardrails/handle-streaming-refusals, cc/memory,
cc/best-practices, cc/skills, cc/sub-agents, cc/hooks-guide, cc/context-window, cc/cross-session-messaging,
cc/large-codebases, cc/agent-teams, cc/workflows, cc/goal, cc/plugins/components,
prompt-engineering/prompting-claude-fable-5-2, prompt-engineering/prompting-claude-opus-5-5,
prompt-engineering/prompting-claude-sonnet-5-5, prompt-engineering/prompting-claude-haiku-5-5.

Skipped, older models' pages: prompt-engineering/prompting-claude-fable-5,
prompt-engineering/prompting-claude-fable-5-1, prompt-engineering/prompting-claude-opus-4-8,
prompt-engineering/prompting-claude-opus-5, prompt-engineering/prompting-claude-sonnet-5.

Of the per-model prompting pages (`prompt-engineering/prompting-claude-*`), only the current models' are reviewed;
an older model's page goes on the line of skipped pages above. A new model's page is reviewed like any other page,
and that review moves the page of the model it supersedes to the skipped line. The coordinator of the plugin repo's
project sees a `docs watch:` Notices line for every watched page neither list has
([features/docs-watch.md](features/docs-watch.md)).

To act on one: read the page (a platform page's URL plus `.md` gives its Markdown), change the skills and docs
where it changes how they should be written, then add the page to the list, with a period only at its end, and
update the date.

## From the per-model pages

- **"Never" reads as absolute** (Fable 5.2). Write it only where no exception exists; otherwise "ask before X",
  with the scope and the reason.
- **Approval rules name the exact actions that need a yes**, and the routine steps that don't (Fable 5.2,
  Approvals: a broad "sending messages to people" rule made it hold back routine requests).
- **Asking a session to go on names what to do next**, never a bare "continue" or "go on" (Fable 5.2, Approvals;
  Opus 5.5, unattended runs: name the open items). When the same failure comes back, don't nudge a third time:
  escalate (the coordinator's "same failure twice").
- **Name the early stops to avoid and the ones wanted** (Opus 5.5, Fable 5.2, Sonnet 5.5, Haiku 5.5). The worker's
  "keep working" paragraph, the reply card and the brief's "Keep working until done or blocked" do this: keep them.
- **No instructions to think more or less, or to write reasoning into a reply** (Opus 5.5, Fable 5.2, Sonnet 5.5):
  effort is the control, and asking for written-out reasoning can be refused.
- **No standing instruction to delegate to subagents** (Fable 5.2).
- **No hard sentence-style limits** such as "one instruction per sentence, at most 20 words" (Fable 5.2: they make
  the prose choppy).
- **Reports are for a reader who saw none of the work**: key points first, plain words, no term made up along the
  way (Fable 5.2).
- **Text the harness adds after a tool result stays occasional** (Sonnet 5.5, mid-turn messages: frequent text
  there reads as an injection). The context watch adds it once per mark, the reply card once per session.
- **Effort levels don't carry over to a new model** (all four pages): measure `plan.models` again per model with
  retro's `kinds` report rather than copying the settings.
