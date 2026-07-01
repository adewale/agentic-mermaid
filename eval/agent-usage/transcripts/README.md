# Live model transcripts

`bun run eval/agent-usage/live.ts` writes one JSON transcript per task plus a
`summary.json` into a timestamped directory here. API-backed transcripts are
intentionally not generated in CI: they require a live model API key and are
nondeterministic. The committed `pi-subagent-2026-05-26` and
`pi-subagent-release-2026-06-10` directories are captured live subagent-backed
passes replayed deterministically by the test suite.

Required fields per transcript:

- `schemaVersion: 1`
- `capturedAt`
- `provider` / `model`
- `caseId`
- `task.prompt` / `task.input`
- prompt payload in `prompts.system` and `prompts.user` (for pi-subagent-backed runs, `prompts.system` records the parent-visible harness context because Pi's hidden subagent system prompt is not exposed)
- raw model response
- extracted Code Mode script
- deterministic replay result from `runAgentUsageEval`

API-backed capture example:

```sh
ANTHROPIC_API_KEY=... AGENT_USAGE_LIVE_MODEL=... \
  bun run eval/agent-usage/live.ts --provider anthropic
```

Subagent-backed release-model capture is first-class via the harness-agnostic
capture script:

```sh
bun run eval:agent-subagent -- prepare --provider pi-subagent --model delegate --surface homepage --mode chat
# Give each generated requests/*.md file to a fresh Pi/Claude/Codex/etc. subagent.
# Save exact raw responses to responses/<case-id>.txt.
bun run eval:agent-subagent -- finalize --run-dir eval/agent-usage/transcripts/pi-subagent-<timestamp>
```

`prepare` writes request files and response targets. In `--mode code`, `finalize`
extracts Code Mode JavaScript from raw responses and replays each script with
`runAgentUsageEval`. In `--mode chat`, it extracts the `Updated Mermaid` source,
verifies it, and applies the same task oracle plus response-shape checks.
Both modes write one transcript per task plus `summary.json` and exit nonzero
unless the oracle accepts every response. Use `--surface homepage`, `--surface
instructions`, or `--surface skill` to capture which agent-facing context was
tested.

A passing live transcript must replay through the same sandbox trace linter and
structural task oracles as the stored deterministic baseline. Do not hand-edit
passing transcripts; if a model returns markdown or an async Cloudflare-style
arrow function, keep the raw response and let the extracted script/result show
what happened. Persist known-bad raw responses under
`../failure-corpus/cases.json` when the transcript is useful as a regression
fixture rather than a passing release-model sample.
