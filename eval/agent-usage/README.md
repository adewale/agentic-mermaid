# Agent-usage validation

How do we test/verify how agents actually *use* this tool — not just that
the functions work, but that the affordances steer an agent onto the safe,
structured path (parse → narrow → mutate → verify → serialize) and away
from the anti-patterns (string-concat, regenerate-whole-source,
serialize-without-verify, mutate-on-opaque)?

Three layers, cheapest-first.

## Layer 1 — Scripted scenarios (deterministic, CI)

`harness.ts` runs a scripted "agent" through the intended loop against the
real SDK and asserts the supported path works end-to-end:

- **add_node** — the canonical "edit one node and trust the result" loop.
- **opaque_refusal** — a sequence with `alt`/`loop` falls back to opaque;
  the narrower (`asSequence`) returns `null`, so the agent is *steered* to
  edit `canonicalSource` rather than call `mutate`. The refusal IS the
  feature.
- **verify_catches_bad_edit** — an overflowing label is flagged by
  `verifyMermaid`, so the agent can revert before serializing.

These run in CI (`agent-usage.test.ts`). They prove the structured path is
reachable and rewarding.

## Layer 2 — Anti-pattern linter (tooling)

`lintAgentTrace(trace)` takes a sequence of SDK calls and flags the
anti-patterns AGENTS.md warns about:

| Code | Trigger |
|---|---|
| `SERIALIZE_WITHOUT_VERIFY` | a `serialize` after a `mutate` with no intervening `verify` |
| `STRING_CONCAT` | building source by hand instead of `mutate` |
| `REGENERATE` | re-emitting whole source instead of mutating |
| `MUTATE_ON_OPAQUE` | `mutate` on an opaque body (statically impossible in real TS; caught here in trace analysis) |

This is the instrument Layer 3 uses to score real agent transcripts.

## Layer 3 — Real-LLM eval (periodic, the real validation)

Layers 1-2 are a proxy: a *human-scripted* agent and a static linter.
The real question — "does a frontier model, given only AGENTS.md + a task,
stay on the structured path?" — needs a real model. The design (parallel to
the Phase F LLM-as-judge, intentionally periodic not per-PR):

1. Give the model the AGENTS.md guide + the Code Mode SDK declaration.
2. Pose tasks: "add a cache between API and DB"; "this diagram fails to
   render, fix it"; "rename every node in the auth subgraph".
3. Capture the Code Mode `execute()` script (or the verb sequence) the
   model produces.
4. Run it through `lintAgentTrace` + check task success.
5. Score: % of tasks completed on the structured path with zero
   anti-patterns. Track the number over time + across model versions.

This is the only layer that validates the *instructions* (AGENTS.md,
llms.txt, capabilities) actually work — i.e. that the documentation, not
just the API, steers behavior. It's not wired to a live model in CI (cost +
nondeterminism), exactly like the quality judge; run it on demand /
pre-release. Layers 1-2 ship the scenarios + the linter it would reuse.

Run layers 1-2: `bun run eval/agent-usage/harness.ts`
