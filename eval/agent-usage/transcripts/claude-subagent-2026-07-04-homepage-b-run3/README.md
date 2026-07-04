# Subagent prompt eval capture

This directory was prepared by `bun run eval:agent-subagent -- prepare`.

Use from Pi, Claude, Codex, or any other harness with subagents:

1. For each `requests/*.md` file, dispatch one fresh subagent with that file as the complete task.
2. Save the exact raw subagent response to the matching `responses/<case-id>.txt` file. Do not edit passing or failing responses.
3. Run:

```sh
bun run eval:agent-subagent -- finalize --run-dir eval/agent-usage/transcripts/claude-subagent-2026-07-04-homepage-b-run3
```

The finalize step extracts the Updated Mermaid section, verifies it, and checks the task oracle plus response-shape/trace claims.

Provider: claude-subagent
Model: general-purpose
Surface: homepage
Mode: chat

Requests:
- cache_between_api_and_db: eval/agent-usage/transcripts/claude-subagent-2026-07-04-homepage-b-run3/requests/cache_between_api_and_db.md → eval/agent-usage/transcripts/claude-subagent-2026-07-04-homepage-b-run3/responses/cache_between_api_and_db.txt
- state_add_done_transition: eval/agent-usage/transcripts/claude-subagent-2026-07-04-homepage-b-run3/requests/state_add_done_transition.md → eval/agent-usage/transcripts/claude-subagent-2026-07-04-homepage-b-run3/responses/state_add_done_transition.txt
- sequence_alt_add_message: eval/agent-usage/transcripts/claude-subagent-2026-07-04-homepage-b-run3/requests/sequence_alt_add_message.md → eval/agent-usage/transcripts/claude-subagent-2026-07-04-homepage-b-run3/responses/sequence_alt_add_message.txt
- er_add_order: eval/agent-usage/transcripts/claude-subagent-2026-07-04-homepage-b-run3/requests/er_add_order.md → eval/agent-usage/transcripts/claude-subagent-2026-07-04-homepage-b-run3/responses/er_add_order.txt
- gantt_add_docs_task: eval/agent-usage/transcripts/claude-subagent-2026-07-04-homepage-b-run3/requests/gantt_add_docs_task.md → eval/agent-usage/transcripts/claude-subagent-2026-07-04-homepage-b-run3/responses/gantt_add_docs_task.txt
- author_auth_flow_source: eval/agent-usage/transcripts/claude-subagent-2026-07-04-homepage-b-run3/requests/author_auth_flow_source.md → eval/agent-usage/transcripts/claude-subagent-2026-07-04-homepage-b-run3/responses/author_auth_flow_source.txt
