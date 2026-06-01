# Agent-usage validation

How do we test/verify how agents actually *use* this tool — not just that
the functions work, but that the affordances steer an agent onto the safe path
(new source → parse → inspect verify, or existing diagram → parse → narrow → mutate → inspect verify → serialize) and away
from anti-patterns (existing-diagram string-concat, regenerate-whole-source,
serialize-without-verify, mutate-on-opaque)?

Three layers, cheapest-first.

## Layer 1 — Scripted scenarios (deterministic, CI)

`harness.ts` runs a scripted "agent" through the intended loop against the real
SDK and asserts the supported path works end-to-end:

- **add_node** — the canonical "edit one node and trust the result" loop, with a structural graph oracle.
- **opaque_refusal** — a sequence with `alt`/`loop` falls back to opaque; the narrower returns `null`, so the agent is steered away from unsafe structured mutation. The refusal is the feature.
- **verify_catches_bad_edit** — an overflowing label is flagged by `verifyMermaid`, so the agent can revert before serializing.
- **timeline/class/ER mutation** — representative typed mutations with parse-back structural oracles, not substring checks.
- **source authoring** — a brand-new diagram is authored as Mermaid source, parsed, verified, and returned without fake mutation ceremony.

These run in CI (`agent-usage.test.ts`). They prove the safe paths are
reachable and rewarding.

## Layer 2 — Anti-pattern linter (tooling)

`lintAgentTrace(trace)` takes real or stored SDK-call traces and flags the
anti-patterns Instructions_for_agents.md warns about:

| Code | Trigger |
|---|---|
| `SERIALIZE_WITHOUT_VERIFY` | `serialize` after `mutate` with no inspected successful `verify` for the same diagram before that serialize |
| `SERIALIZE_AFTER_FAILED_VERIFY` | `verify(ok:false)` followed by `serialize` |
| `VERIFY_NOT_INSPECTED` | a `verify` result was produced but `ok`/`warnings`/`layout` was never inspected |
| `STRING_CONCAT` | editing existing structured source by hand instead of `mutate` in a stored/annotated transcript |
| `REGENERATE` | re-emitting an existing parsed diagram instead of mutating in a stored/annotated transcript |
| `MUTATE_ON_OPAQUE` | `mutate` on an opaque body |

The MCP sandbox emits ordered `parse` / `narrow` / `mutate` / `verify` /
`verify_inspect` / `serialize` events plus diagram-state fingerprints. SDK
results returned into Code Mode are read-only, so direct IR writes fail early;
structured edits must go through `mutate`. A verify only clears a dirty diagram
if `ok`, `warnings`, or `layout` was read before the serialize call and the
serialized diagram state still matches what was verified; returning `{source:
serialize(d), verify}` is still flagged.

## Layer 3 — Stored and live Code Mode evals

`run.ts` executes stored Code Mode scripts through `executeInSandbox({ trace:
true })`, the linter, and exact task oracles. The stored CI baseline covers
flowchart, opaque sequence refusal, timeline, class, ER, and new-source-authoring tasks. Tests also
call the real MCP JSON-RPC `tools/call execute` path and compare its result to a
traced replay of the same code.

The real question — "does a frontier model, given only Instructions_for_agents.md
+ a task, choose the right safe path?" — is handled by `live.ts` when model
credentials are available:

1. Build the exact system prompt from Instructions_for_agents.md + the Code Mode SDK declaration.
2. Pose tasks across mutable and opaque families.
3. Capture provider/model, prompt, raw response, extracted Code Mode script, and replay result (task score, trace score, findings, and error if any).
4. Replay the captured script through the same sandbox, linter, and structural oracle whenever the transcript test runs.
5. Write one JSON transcript per task plus `summary.json` under `transcripts/<timestamp>/`.

`safePathRate` counts all acceptable task routes; `structuredPathRate` counts only cases where typed mutation is required. `baseline.json` records the deterministic stored-script baseline. A committed
`pi-subagent-2026-05-26` transcript set captures one live subagent pass and
replays through the deterministic oracle in `agent-usage-live.test.ts`.
API-backed release-model transcripts remain on-demand/pre-release because they
require credentials and are nondeterministic; PR CI keeps deterministic replay
checks.

Run deterministic layers: `bun run eval/agent-usage/harness.ts`
Run stored Code Mode eval: `bun run eval/agent-usage/run.ts`
Run live-model transcript capture: `bun run eval:agent-live -- --provider anthropic --model <model>`
