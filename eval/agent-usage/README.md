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
anti-patterns Instructions_for_agents.md warns about:

| Code | Trigger |
|---|---|
| `SERIALIZE_WITHOUT_VERIFY` | a `serialize` after a `mutate` with no inspected successful `verify` for the same diagram |
| `SERIALIZE_AFTER_FAILED_VERIFY` | `verify(ok:false)` followed by `serialize` |
| `VERIFY_NOT_INSPECTED` | a `verify` result was produced but `ok`/`warnings`/`layout` was never inspected |
| `STRING_CONCAT` | building source by hand instead of `mutate` |
| `REGENERATE` | re-emitting whole source instead of mutating |
| `MUTATE_ON_OPAQUE` | `mutate` on an opaque body (statically impossible in real TS; caught here in trace analysis) |

This is the instrument Layer 3 uses to score real agent transcripts.

## Layer 3 — Real-LLM eval (periodic, the real validation)

Layers 1-2 are a proxy: a *human-scripted* agent and a static linter.
The real question — "does a frontier model, given only Instructions_for_agents.md + a task,
stay on the structured path?" — needs a real model. `run.ts` provides the
executable harness without putting nondeterministic model calls in PR CI:

1. Give the model the Instructions_for_agents.md guide + the Code Mode SDK declaration.
2. Pose tasks: "add a cache between API and DB"; "this diagram fails to
   render, fix it"; "rename every node in the auth subgraph".
3. Capture the Code Mode `execute()` script the model produces.
4. Run it through `executeInSandbox({ trace: true })`, `lintAgentTrace`, and
   task-specific success checks.
5. Score: % of tasks completed on the structured path with zero
   anti-patterns. Track the number over time + across model versions.

`baseline.json` records the deterministic stored-script baseline. Live-model
transcripts are tracked as `EVAL-1` in `TODO.md`; run them on demand /
pre-release and compare to the same fields. PR CI keeps only the stored
scripts to avoid cost and nondeterminism.

Run deterministic layers: `bun run eval/agent-usage/harness.ts`
Run stored Code Mode eval: `bun run eval/agent-usage/run.ts`
