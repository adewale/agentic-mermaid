# Subagent prompt eval capture

This directory was prepared by `bun run eval:agent-subagent -- prepare`.

Use from Pi, Claude, Codex, or any other harness with subagents:

1. For each `requests/*.md` file, dispatch one fresh subagent with that file as the complete task.
2. Save the exact raw subagent response to the matching `responses/<case-id>.txt` file. Do not edit passing or failing responses.
3. Run:

```sh
bun run eval:agent-subagent -- finalize --run-dir eval/agent-usage/transcripts/claude-subagent-2026-07-04-k-instr-run3
```

The finalize step extracts the Updated Mermaid section, verifies it, and checks the task oracle plus response-shape/trace claims.

Provider: claude-subagent
Model: general-purpose
Surface: instructions
Mode: chat

Requests:
- canonical_add_cache_messy: eval/agent-usage/transcripts/claude-subagent-2026-07-04-k-instr-run3/requests/canonical_add_cache_messy.md → eval/agent-usage/transcripts/claude-subagent-2026-07-04-k-instr-run3/responses/canonical_add_cache_messy.txt
- stray_end_source_fallback: eval/agent-usage/transcripts/claude-subagent-2026-07-04-k-instr-run3/requests/stray_end_source_fallback.md → eval/agent-usage/transcripts/claude-subagent-2026-07-04-k-instr-run3/responses/stray_end_source_fallback.txt
