# Agent-usage validation

How do we test/verify how agents actually *use* this tool — not just that
the functions work, but that the affordances steer an agent onto the safe path
(new source → parse → inspect verify, or existing diagram → parse → narrow → mutate → inspect verify → serialize) and away
from anti-patterns (existing-diagram string-concat, regenerate-whole-source,
serialize-without-verify, mutate-on-opaque)?

Four layers, cheapest-first.

## Layer 1 — Scripted scenarios (deterministic, CI)

`harness.ts` runs a scripted "agent" through the intended loop against the real
SDK and asserts the supported path works end-to-end:

- **add_node** — the canonical "edit one node and trust the result" loop, with a structural graph oracle.
- **opaque_refusal** — a sequence that can't be cleanly segmented (a stray `end`) falls back to whole-body opaque; the narrower returns `null`, so the agent is steered away from unsafe structured mutation. The refusal is the feature. (BUILD-18: ordinary `alt`/`loop`/Note sequences are now structured-with-segments and mutable — see `sequence_alt_add_message`.)
- **sequence_alt_add_message** — a sequence with an `alt` block is structured-with-segments: `add_message` appends a top-level message while the `alt` block rides along verbatim. Asserts the structured mutation loop AND verbatim preservation.
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

## Layer 3 — Failure corpus (captured bad-agent paths)

`failure-corpus/cases.json` stores captured pi-subagent mistakes and curated
executable regressions for the unsafe paths we want the affordances to prevent:
markdown-only Mermaid fences, whole-source regeneration, prose/CLI advice
instead of Code Mode, serialize-without-verify, ignored verify results, and
opaque mutation attempts. The corpus is intentionally expected to fail:
`agent-usage.test.ts` either classifies raw non-Code-Mode responses or replays
executable snippets through `runAgentUsageEval` and asserts the deterministic
oracle rejects them.

## Layer 4 — Stored, live, and subagent Code Mode evals

`run.ts` executes stored Code Mode scripts through `executeInSandbox({ trace:
true })`, the linter, and exact task oracles. The stored CI baseline covers
flowchart, opaque sequence refusal, timeline, class, ER, and new-source-authoring tasks. Tests also
call the real MCP JSON-RPC `tools/call execute` path and compare its result to a
traced replay of the same code.

For harnesses with subagents, `capture-subagent-prompt-eval.ts` creates a
first-class transcript capture directory. It is harness-agnostic: Pi, Claude,
Codex, or another agent harness can dispatch each generated `requests/*.md` file
to a fresh subagent, save the exact raw response under `responses/*.txt`, then
run `finalize` to gate every response. Use `--mode code` for executable Code
Mode transcripts checked with the sandbox trace linter; use `--mode chat` to
test the raw public prompt response shape by extracting `Updated Mermaid`,
verifying it, and applying the task oracle.

```sh
bun run eval:agent-subagent -- prepare --provider pi-subagent --model delegate --surface homepage --mode chat --cases cache_between_api_and_db,author_api_sequence_source
# dispatch requests/*.md to fresh subagents and save responses/*.txt
bun run eval:agent-subagent -- finalize --run-dir eval/agent-usage/transcripts/pi-subagent-<timestamp>
```

Use `--surface homepage`, `--surface instructions`, or `--surface skill` to test
which agent-facing context is sufficient. The homepage surface uses the exact
fetch-only homepage prompt from `DEFAULT_CASES` plus the task slots; the agent
gets product guidance by following `https://agentic-mermaid.dev/start.md`. The
instructions and skill surfaces inline the corresponding repository docs in the
request.
`--surface none` (chat-only) is the no-docs baseline: the bare task with zero
product guidance, graded on the task oracle alone. Every surface comparison
should anchor on it — a surface earns its tokens only by beating it. Caveat
when dispatching subagents inside this checkout: they can self-discover the
repo's tooling, so treat the baseline's taskOk as an upper bound.

The real API-backed question — "does a frontier model, given only
Instructions_for_agents.md + a task, choose the right safe path?" — is handled
by `live.ts` when model credentials are available:

1. Build the exact system prompt from Instructions_for_agents.md + the Code Mode SDK declaration.
2. Pose tasks across mutable and opaque families.
3. Capture provider/model, prompt, raw response, extracted Code Mode script, and replay result (task score, trace score, findings, and error if any).
4. Replay the captured script through the same sandbox, linter, and structural oracle whenever the transcript test runs.
5. Write one JSON transcript per task plus `summary.json` under `transcripts/<timestamp>/`.

`safePathRate` counts all acceptable task routes; `structuredPathRate` counts only cases where typed mutation is required. `baseline.json` records the deterministic stored-script baseline. Committed
`pi-subagent-2026-05-26` and `pi-subagent-release-2026-06-10` transcript sets
capture live subagent-backed passes and replay through the deterministic oracle
in `agent-usage-live.test.ts`. Direct API-backed Anthropic/OpenAI-compatible
transcripts remain on-demand because they require credentials and are
nondeterministic; PR CI keeps deterministic replay checks.

## Comparing prompt variants (is a change better or worse?)

Prompt changes are gated three ways, cheapest-first:

1. **Contract tests (CI, deterministic).** `homepagePromptChecklist` pins every
   load-bearing phrase of `website/source/start.md`; `agent-usage.test.ts` also
   proves the homepage CTA is only `Fetch https://agentic-mermaid.dev/start.md
   and follow it.` Truth-pinning tests execute the start.md factual claims
   against the real implementation (authoring facts against the SDK, the quoted
   hosted-MCP JSON-RPC body against `handleHostedRequest`), so the protocol
   cannot claim something the tool does not do.
2. **Replay of committed transcripts (CI, deterministic).** Stored subagent and
   live transcripts re-run through the finalize gates and the trace linter on
   every test run; a change that would have flipped a past-good response
   surfaces here without any model calls.
3. **Paired live runs (on demand).** The homepage surface is fetch-only, so
   prompt variants now belong to `website/source/start.md` experiments rather
   than `--surface homepage --prompt-variant` alone. To compare start.md
   variant A against variant B, prepare each arm with `--inline-start-md
   --prompt-variant <variant>` — the exact (variant-applied) start.md body
   ships inline and the fetch is forbidden, so the arm request sets differ only
   by the toggled text — then dispatch every `requests/*.md` to a fresh
   subagent, run `finalize`, and keep the case list, harness, and model fixed.
   Worked example: `issue-123-literal-reframe-ab.md` (the Haiku A/B of the
   PR #111 tweak-#3 sentence, 4 seeds per arm, observed traces). Follow the `skill-evals/shared-benchmark.json` run
   policy (≥3 runs per variant, 5 recommended) because single runs are noise.
   Prefer `--mode code` when the question allows it so `traceSource` is
   `observed`; otherwise report when chat runs fall back to narrated Trace
   prose. Compare `ok` rate and the `taskOk`/`traceOk` split per case, plus
   response length as a proxy for discovery cost. Commit both transcript sets so
   the comparison replays deterministically in layer 2.

Knowledge-proof cases close the taskOk blind spot: `KNOWLEDGE_CASES` in
`run.ts` (opt-in via `--cases canonical_add_cache_messy,stray_end_source_fallback`)
hinge on facts only the docs/tooling carry. Four-surface matrix
(claude-subagent-2026-07-04-k-* transcripts, 3 runs per arm, same harness):

| Surface | taskOk | safePathRate | mean tokens/case |
|---|---|---|---|
| none (isolated) | 3/6 | 0 | ~20.7k |
| homepage | 6/6 | 1.0 | ~28.8k |
| instructions | 6/6 | 1.0 | ~33.8k |
| skill | 6/6 | 1.0 | ~35.9k |

The no-docs baseline fails canonical serialization every time; every
doc-bearing surface fixes it. At equal outcome the homepage/start.md surface was
the cheapest doc-bearing surface. Single-model harness, n=3: direction, not magnitudes.

Known blind spots of the stored case set: it measures task success and
response shape on fully specified tasks. It does not yet measure discovery
cost (turns/tokens spent before the first productive call), underspecified-task
handling (does the agent ask instead of guessing when placeholders are left
unreplaced), or repo-grounding honesty (are architecture claims traceable to
inspected source). A variant comparison cannot detect regressions on an axis
with no cases — add adversarial cases for those axes before trusting a
comparison on them.

Run deterministic layers: `bun run eval/agent-usage/harness.ts`
Run stored Code Mode eval: `bun run eval/agent-usage/run.ts`
Prepare/finalize subagent transcript capture: `bun run eval:agent-subagent -- prepare` / `bun run eval:agent-subagent -- finalize --run-dir <dir>`
Run live-model transcript capture: `bun run eval:agent-live -- --provider anthropic --model <model>`
