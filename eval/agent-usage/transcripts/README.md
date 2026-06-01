# Live model transcripts

`bun run eval/agent-usage/live.ts` writes one JSON transcript per task plus a
`summary.json` into a timestamped directory here. API-backed transcripts are
intentionally not generated in CI: they require a live model API key and are
nondeterministic. The committed `pi-subagent-2026-05-26` directory is a captured
live subagent pass replayed deterministically by the test suite.

Required fields per transcript:

- `schemaVersion: 1`
- `capturedAt`
- `provider` / `model`
- `caseId`
- `task.prompt` / `task.input`
- exact `prompts.system` and `prompts.user`
- raw model response
- extracted Code Mode script
- deterministic replay result from `runAgentUsageEval`

Example:

```sh
ANTHROPIC_API_KEY=... AGENT_USAGE_LIVE_MODEL=... \
  bun run eval/agent-usage/live.ts --provider anthropic
```

A passing live transcript must replay through the same sandbox trace linter and
structural task oracles as the stored deterministic baseline. Do not hand-edit
passing transcripts; if a model returns markdown or an async Cloudflare-style
arrow function, keep the raw response and let the extracted script/result show
what happened.
