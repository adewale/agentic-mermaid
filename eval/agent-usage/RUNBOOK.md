# Runbook — grading live agents on the homepage prompt

How to measure whether a real agent, given only the agent-facing prompt, can
create and mutate Mermaid diagrams across every registered family. The harness
is agnostic: it emits one request file per case, **you** dispatch each to a
fresh agent, capture the returned message, then `finalize` grades every response
against the deterministic Agentic Mermaid oracle.

The run flow is `prepare` → (you dispatch) → `record` → `finalize`; `list-cases` inspects the executable case registry.

## Case inventory

The executable registry is the source of truth. It contains exactly one create
and one mutate case per registered family. Inspect the current matrix with:

```bash
bun run eval:agent-subagent -- list-cases
```

## Step 1 — Prepare a run (one per model)

```bash
bun run eval:agent-subagent -- prepare \
  --provider <provider> --model <model> \
  --surface homepage --mode chat
```

Creates `eval/agent-usage/transcripts/<provider>-<timestamp>/` with
one `requests/<case>.md` per registry entry and a manifest that binds each
request to its SHA-256 digest. Note the printed run directory. Use `--cases`
only for an intentional subset.

## Step 2 — Dispatch each request to a **fresh** agent

One fresh agent per request — fresh context, no cross-case leakage (pooling
cases into one agent lets it learn the syntax and inflates later cases). Each
agent reads its request file, follows the "Task prompt under test" (the
fetch-only homepage prompt plus task slots, which points at `start.md`), and
returns the chat response (`Updated Mermaid` / `Verification` / `Trace`).

**With the repo (in-checkout):** the agent may use the local library / CLI. This
is the easiest channel but means `taskOk` is an *upper bound* — the agent can
self-discover the tooling.

```
Read <run-dir>/requests/<case>.md. Follow its "Task prompt under test" as a
normal coding agent. This repo is checked out — use the Agentic Mermaid tooling
the prompt points to (import ./src/agent/index.ts, or run `bun run bin/am.ts …`).
Return ONLY the resulting chat response (Updated Mermaid / Verification / Trace)
to the orchestrator. Modify no project file; scratch in /tmp.
```

**Observed tool-use (recommended):** set
`AM_TRACE_LOG=<run-dir>/traces/<case>.jsonl` in the agent's environment before it
works. Every in-process channel writes to that one sink — the `am` CLI, the
library functions (`verifyMermaid`/`mutate`/`buildMermaid`/…, since they all go
through the instrumented leaves in `src/agent/trace-log.ts`), the hosted MCP
`verify`/`mutate`/`build` tools (which route through those same library leaves),
and the Code Mode facade — so it no longer matters which channel the agent
picks. `finalize` grades `traceOk` from those **real calls** instead of inferring
tool use from the `Trace` prose (phrasing-sensitive: a valid `am verify` written
as `` `verify /tmp/f` `` slips past the text heuristic).

The observed signal is **positive-only**: a logged verify/mutate/build CONFIRMS
tool use (`traceSource: "observed"`), but its absence does NOT refute — `finalize`
falls back to the prose heuristic (`traceSource: "narrated"`), since a truly
un-instrumentable third party (hosted MCP over the network, no shared filesystem)
can't write to the log. Code mode (`--mode code`) is always observed: it replays
the script through the sandbox trace linter.

**Without the repo (true third party):** the npm package is unpublished, so the
only channel is the hosted MCP. This measures whether the agent can drive the
HTTP MCP itself — the honest from-scratch condition.

```
You are a third-party agent. You do NOT have the agentic-mermaid repo or npm
package. Read <run-dir>/requests/<case>.md and follow its "Task prompt under
test". For ALL verification/mutation use ONLY the hosted MCP over HTTP:
POST https://agentic-mermaid.dev/mcp with content-type: application/json and a
JSON-RPC tools/call body (tools: execute, render_svg, render_ascii, render_png,
verify, describe, mutate, build). For an edit, send Code Mode JS to the `execute` tool
(mermaid.parseRegisteredMermaid → asX → mutate → verifyMermaid → serializeMermaid). Do NOT
read, import, or run any local agentic-mermaid checkout. Return ONLY the chat
response (Updated Mermaid / Verification / Trace) to the orchestrator; name the
hosted MCP and the tool calls in Trace.
```

## Step 3 — Record each raw response

The orchestrator should record the complete returned message rather than asking
the model to write its own capture file:

```bash
bun run eval:agent-subagent -- record --run-dir <run-dir> --case <case> --response-file <file>
```

`record` rejects empty output and common acknowledgement/failure placeholders.
If capture fails, re-dispatch that case once and record the full response.
Directly written response files remain supported, but `finalize` applies the
same validation before grading.

## Step 4 — Finalize (grade)

```bash
bun run eval:agent-subagent -- finalize --run-dir <run-dir>
```

Writes one `<case>.json` + `summary.json`; exits nonzero if capture is incomplete
or any diagram fails the task oracle. Capture failures are not model failures.

## Step 5 — Read results

`summary.json` reports capture integrity and three grading axes separately. Each
`<case>.json` has `.result.{ captureOk, responseContractOk, taskOk, traceOk }`
plus a specific error field for whichever axis failed:

- **`captureOk` / `captureOkRate`** — the full model response was captured and
  its prepared request still matches the manifest digest. Missing, empty,
  acknowledgement-only, and request-mismatch cases appear in `captureFailures`
  with a retry instruction. They are excluded from every model-score
  denominator, but keep `summary.ok` false until recaptured.

- **`taskOk` / `taskOkRate`** — PRIMARY. The returned diagram is structurally
  correct. The real capability signal: the harness independently parses and
  verifies every captured diagram, so it does not depend on trusting narration
  or response formatting. A valid bare Mermaid response can therefore have
  `taskOk: true` while failing the response contract.
  `summary.ok` requires complete capture and every captured case to have
  `taskOk: true`, so a correct diagram with a terse `Trace` no longer reads as
  a capability failure.
- **`traceOk` / `traceOkRate`** — SECONDARY. The agent engaged Agentic Mermaid
  on the safe path (verify; and `mutate`/`build` for existing diagrams) rather
  than hand-writing from memory. Trust it according to `summary.traceSource`:
  `observed` (real `am` verbs via `AM_TRACE_LOG`, or the replayed code-mode
  trace) is ground truth; `narrated` is a phrasing-sensitive prose heuristic —
  a `traceOk` dip under `narrated` is often a narration artifact, not a
  capability change, so confirm against `taskOk` before reading it as a
  regression.
- **`responseContractOk` / `responseContractOkRate`** — the response followed
  the requested chat sections or Code Mode return shape. Failures use
  `RESPONSE_CONTRACT_ERROR` and do not change `taskOk`.
- **`passed`** — the strict composite (`taskOk && traceOk &&
  responseContractOk`) count; not the capability headline.

Create/mutate results are generated from the same registry and included in the
summary:

```bash
jq '.breakdown' <run-dir>/summary.json
```

## Knobs & caveats

- **Surface:** `--surface homepage` (just the prompt) · `instructions` · `skill`
  · `none` (no-docs baseline — bare task, graded on the task oracle only, the
  floor every surface must beat). **Mode:** `--mode chat` (public response) or
  `code` (executable Code Mode, replayed through the sandbox trace linter).
- **Fresh agent per case.** The harness assumes it.
- **In-checkout vs third-party:** in-checkout `taskOk` is an upper bound; the
  hosted-MCP-only run above is the honest from-scratch measurement.
- **Grading channels:** `traceOk` accepts library `verifyMermaid`, CLI
  `am verify`, and the hosted MCP `verify`/`execute` path; new diagrams may be
  authored with `buildMermaid`/`createMermaid` (no parse). The task oracle is
  independent of the channel.
