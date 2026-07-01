# Subagent prompt eval capture

This directory was prepared by `bun run eval:agent-subagent -- prepare`.

Use from Pi, Claude, Codex, or any other harness with subagents:

1. For each `requests/*.md` file, dispatch one fresh subagent with that file as the complete task.
2. Save the exact raw subagent response to the matching `responses/<case-id>.txt` file. Do not edit passing or failing responses.
3. Run:

```sh
bun run eval:agent-subagent -- finalize --run-dir eval/agent-usage/transcripts/pi-subagent-all-families-2026-06-27-chat
```

The finalize step extracts the Updated Mermaid section, verifies it, and checks the task oracle plus response-shape/trace claims.

Provider: pi-subagent
Model: delegate-all-families
Surface: homepage
Mode: chat

Requests:
- cache_between_api_and_db: eval/agent-usage/transcripts/pi-subagent-all-families-2026-06-27-chat/requests/cache_between_api_and_db.md → eval/agent-usage/transcripts/pi-subagent-all-families-2026-06-27-chat/responses/cache_between_api_and_db.txt
- state_add_done_transition: eval/agent-usage/transcripts/pi-subagent-all-families-2026-06-27-chat/requests/state_add_done_transition.md → eval/agent-usage/transcripts/pi-subagent-all-families-2026-06-27-chat/responses/state_add_done_transition.txt
- sequence_alt_add_message: eval/agent-usage/transcripts/pi-subagent-all-families-2026-06-27-chat/requests/sequence_alt_add_message.md → eval/agent-usage/transcripts/pi-subagent-all-families-2026-06-27-chat/responses/sequence_alt_add_message.txt
- timeline_add_event: eval/agent-usage/transcripts/pi-subagent-all-families-2026-06-27-chat/requests/timeline_add_event.md → eval/agent-usage/transcripts/pi-subagent-all-families-2026-06-27-chat/responses/timeline_add_event.txt
- class_add_duck: eval/agent-usage/transcripts/pi-subagent-all-families-2026-06-27-chat/requests/class_add_duck.md → eval/agent-usage/transcripts/pi-subagent-all-families-2026-06-27-chat/responses/class_add_duck.txt
- er_add_order: eval/agent-usage/transcripts/pi-subagent-all-families-2026-06-27-chat/requests/er_add_order.md → eval/agent-usage/transcripts/pi-subagent-all-families-2026-06-27-chat/responses/er_add_order.txt
- journey_add_review_task: eval/agent-usage/transcripts/pi-subagent-all-families-2026-06-27-chat/requests/journey_add_review_task.md → eval/agent-usage/transcripts/pi-subagent-all-families-2026-06-27-chat/responses/journey_add_review_task.txt
- architecture_add_cache: eval/agent-usage/transcripts/pi-subagent-all-families-2026-06-27-chat/requests/architecture_add_cache.md → eval/agent-usage/transcripts/pi-subagent-all-families-2026-06-27-chat/responses/architecture_add_cache.txt
- xychart_add_forecast: eval/agent-usage/transcripts/pi-subagent-all-families-2026-06-27-chat/requests/xychart_add_forecast.md → eval/agent-usage/transcripts/pi-subagent-all-families-2026-06-27-chat/responses/xychart_add_forecast.txt
- pie_add_docs_slice: eval/agent-usage/transcripts/pi-subagent-all-families-2026-06-27-chat/requests/pie_add_docs_slice.md → eval/agent-usage/transcripts/pi-subagent-all-families-2026-06-27-chat/responses/pie_add_docs_slice.txt
- quadrant_add_docs_point: eval/agent-usage/transcripts/pi-subagent-all-families-2026-06-27-chat/requests/quadrant_add_docs_point.md → eval/agent-usage/transcripts/pi-subagent-all-families-2026-06-27-chat/responses/quadrant_add_docs_point.txt
- gantt_add_docs_task: eval/agent-usage/transcripts/pi-subagent-all-families-2026-06-27-chat/requests/gantt_add_docs_task.md → eval/agent-usage/transcripts/pi-subagent-all-families-2026-06-27-chat/responses/gantt_add_docs_task.txt
- author_auth_flow_source: eval/agent-usage/transcripts/pi-subagent-all-families-2026-06-27-chat/requests/author_auth_flow_source.md → eval/agent-usage/transcripts/pi-subagent-all-families-2026-06-27-chat/responses/author_auth_flow_source.txt
- author_api_sequence_source: eval/agent-usage/transcripts/pi-subagent-all-families-2026-06-27-chat/requests/author_api_sequence_source.md → eval/agent-usage/transcripts/pi-subagent-all-families-2026-06-27-chat/responses/author_api_sequence_source.txt
