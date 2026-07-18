# Subagent prompt eval capture

This directory was prepared by `bun run eval:agent-subagent -- prepare`.

Use from Pi, Claude, Codex, or any other harness with subagents:

1. For each `requests/*.md` file, dispatch one fresh subagent with that file as the complete task.
2. Save the exact raw subagent response to the matching `responses/<case-id>.txt` file. Do not edit passing or failing responses.
3. Run:

```sh
bun run eval:agent-subagent -- finalize --run-dir eval/agent-usage/transcripts/claude-haiku-2026-07-17-issue123-a-run7
```

The finalize step extracts the Updated Mermaid section, verifies it, and checks the task oracle plus response-shape/trace claims.

Provider: claude-subagent
Model: claude-haiku-4-5
Surface: homepage
Mode: chat
Prompt variant: baseline
Inline start.md: yes (variant-applied body inlined; fetch forbidden)

Requests:
- state_add_done_transition: eval/agent-usage/transcripts/claude-haiku-2026-07-17-issue123-a-run7/requests/state_add_done_transition.md → eval/agent-usage/transcripts/claude-haiku-2026-07-17-issue123-a-run7/responses/state_add_done_transition.txt
- class_add_duck: eval/agent-usage/transcripts/claude-haiku-2026-07-17-issue123-a-run7/requests/class_add_duck.md → eval/agent-usage/transcripts/claude-haiku-2026-07-17-issue123-a-run7/responses/class_add_duck.txt
- gantt_add_docs_task: eval/agent-usage/transcripts/claude-haiku-2026-07-17-issue123-a-run7/requests/gantt_add_docs_task.md → eval/agent-usage/transcripts/claude-haiku-2026-07-17-issue123-a-run7/responses/gantt_add_docs_task.txt
