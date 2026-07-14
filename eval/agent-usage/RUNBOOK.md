# Runbook — grading live agents on the homepage prompt

How to measure whether a real agent, given only the agent-facing prompt, can
create and mutate Mermaid diagrams across all 15 registered families. The harness is
agnostic: it emits one request file per case, **you** dispatch each to a fresh
agent, save the raw response, then `finalize` grades every response against the
deterministic Agentic Mermaid oracle.

Three subcommands: `prepare` → (you dispatch) → `finalize`.

## The 30 cases (create + mutate, one per family)

```
# 15 mutate (edit an existing diagram):
cache_between_api_and_db state_add_done_transition sequence_alt_add_message
timeline_add_event class_add_duck er_add_order journey_add_review_task
architecture_add_cache xychart_add_forecast pie_add_docs_slice
quadrant_add_docs_point gantt_add_docs_task mindmap_add_evidence_node
gitgraph_add_release_commit radar_add_beta_curve
# 15 create (author a new diagram):
author_auth_flow_source author_api_sequence_source author_state_source
author_class_source author_er_source author_journey_source author_timeline_source
author_gantt_source author_pie_source author_quadrant_source author_xychart_source
author_architecture_source author_mindmap_source author_gitgraph_source
author_radar_source
```

## Step 1 — Prepare a run (one per model)

```bash
CASES="cache_between_api_and_db,state_add_done_transition,sequence_alt_add_message,timeline_add_event,class_add_duck,er_add_order,journey_add_review_task,architecture_add_cache,xychart_add_forecast,pie_add_docs_slice,quadrant_add_docs_point,gantt_add_docs_task,mindmap_add_evidence_node,gitgraph_add_release_commit,radar_add_beta_curve,author_auth_flow_source,author_api_sequence_source,author_state_source,author_class_source,author_er_source,author_journey_source,author_timeline_source,author_gantt_source,author_pie_source,author_quadrant_source,author_xychart_source,author_architecture_source,author_mindmap_source,author_gitgraph_source,author_radar_source"

bun run eval:agent-subagent -- prepare \
  --provider <provider> --model <model> \
  --surface homepage --mode chat --cases "$CASES"
```

Creates `eval/agent-usage/transcripts/<provider>-<timestamp>/` with
`requests/<case>.md` (30 files, each the complete parent-visible task) and a
manifest. Note the printed run directory.

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
Write ONLY the resulting chat response (Updated Mermaid / Verification / Trace)
to <run-dir>/responses/<case>.txt. Modify no other file; scratch in /tmp.
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
(mermaid.parseMermaid → asX → mutate → verifyMermaid → serializeMermaid). Do NOT
read, import, or run any local agentic-mermaid checkout. Write ONLY the chat
response (Updated Mermaid / Verification / Trace) to
<run-dir>/responses/<case>.txt; name the hosted MCP and the tool calls in Trace.
```

## Step 3 — Save each raw response

Have the agent write directly to `<run-dir>/responses/<case>.txt`, or:

```bash
bun run eval:agent-subagent -- record --run-dir <run-dir> --case <case> --response-file <file>
```

## Step 4 — Finalize (grade)

```bash
bun run eval:agent-subagent -- finalize --run-dir <run-dir>
```

Writes one `<case>.json` + `summary.json`; prints `total / passed /
safePathRate / structuredPathRate`; exits nonzero if any case fails.

## Step 5 — Read results

`summary.json` reports the two axes **separately** — read `taskOkRate` first.
Each `<case>.json` has `.result.{ ok, taskOk, traceOk, error }`:

- **`taskOk` / `taskOkRate`** — PRIMARY. The returned diagram is structurally
  correct. The real capability signal: the harness independently parses and
  verifies every returned diagram, so it does not depend on trusting narration.
  `summary.ok` gates on this (every case `taskOk`), so a correct diagram with a
  terse `Trace` no longer reads as a failure.
- **`traceOk` / `traceOkRate`** — SECONDARY. The agent engaged Agentic Mermaid
  on the safe path (verify; and `mutate`/`build` for existing diagrams) rather
  than hand-writing from memory. Trust it according to `summary.traceSource`:
  `observed` (real `am` verbs via `AM_TRACE_LOG`, or the replayed code-mode
  trace) is ground truth; `narrated` is a phrasing-sensitive prose heuristic —
  a `traceOk` dip under `narrated` is often a narration artifact, not a
  capability change, so confirm against `taskOk` before reading it as a
  regression.
- **`passed`** — the composite (`taskOk && traceOk`) count, kept for continuity;
  not the headline.

Break it down by create vs mutate:

```bash
bun -e '
const fs=require("fs"), dir=process.argv[1];
const mut=["cache_between_api_and_db","state_add_done_transition","sequence_alt_add_message","timeline_add_event","class_add_duck","er_add_order","journey_add_review_task","architecture_add_cache","xychart_add_forecast","pie_add_docs_slice","quadrant_add_docs_point","gantt_add_docs_task","mindmap_add_evidence_node","gitgraph_add_release_commit"];
const cre=["author_auth_flow_source","author_api_sequence_source","author_state_source","author_class_source","author_er_source","author_journey_source","author_timeline_source","author_gantt_source","author_pie_source","author_quadrant_source","author_xychart_source","author_architecture_source","author_mindmap_source","author_gitgraph_source"];
const g=id=>{try{return JSON.parse(fs.readFileSync(dir+"/"+id+".json","utf8")).result}catch(e){return{}}};
const t=ids=>ids.reduce((a,id)=>{const r=g(id);return{ok:a.ok+(r.ok?1:0),task:a.task+(r.taskOk?1:0)}},{ok:0,task:0});
const m=t(mut),c=t(cre);
console.log(`MUTATE ok ${m.ok}/${mut.length} (diagram-correct ${m.task}/${mut.length}) | CREATE ok ${c.ok}/${cre.length} (diagram-correct ${c.task}/${cre.length})`);
' <run-dir>
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
