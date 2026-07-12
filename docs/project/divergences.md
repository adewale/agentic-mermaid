# Divergences

Current implementation decisions that differ from, or materially narrow, the broader `AGENT_NATIVE.md` architecture. This file is **not** a backlog; active work lives only in `TODO.md`. Historical loop logs were removed because they had become process noise. Use Git history for archaeology.

## What still matters

### Determinism is structural, not seeded

- Removed the old `LayoutContext` / `SeededRNG` / `Clock` / `withSeededRandom` / font-metrics apparatus.
- `RenderedLayout` has no `seed` field.
- `VerifyOptions` is intentionally small: `{ suppress?, labelCharCap? }`.
- Claim scope: same-input structural layout determinism is tested for the supported runtime/version matrix. Cross-machine or cross-architecture float equality is **not** claimed.

### Package and compatibility choices

- Product/docs, npm package name, and repository path are **Agentic Mermaid** / `agentic-mermaid` / `adewale/agentic-mermaid`. The agent surface ships as the `./agent` subpath.
- `MermaidGraph` and `renderMermaidSVGAsync` remain for compatibility with existing renderer/tests/consumers.
- State diagrams own a dedicated `StateBody` IR with state-shaped operations and `asState`; `asFlowchart` returns `null`. Notes, pseudostates, history, concurrency, paint, composites, and direction are modeled. Unsupported extensions remain lossless through the structured-or-opaque boundary.

### Mutation surface is intentionally narrower than Mermaid syntax

Structured mutation is exposed for every built-in renderable family, but only when that body's parser/IR/serializer/verifier can preserve the modeled semantics:

- flowchart/state;
- sequence (BUILD-18 — segment-preserving: participant/message ops stay live while Note/alt/loop/par/activate/autonumber/title ride along verbatim as opaque-block segments; only un-segmentable input such as an unbalanced `end` falls back to whole-body opaque);
- timeline;
- class;
- ER;
- journey (BUILD-15 pilot);
- architecture, including group-boundary semantics;
- xychart;
- pie;
- quadrant;
- gantt;
- mindmap;
- gitgraph.

Opaque/source-level bodies:

- any known-family diagram that falls back to opaque because it contains syntax its family model cannot preserve safely, such as malformed entries or un-segmentable blocks.

For source-level bodies, agents may render, verify, describe, and round-trip preserved source. They do **not** get typed mutation ops. `am mutate` returns `UNSUPPORTED_FAMILY` for those bodies.

### Structured-or-opaque is load-bearing

Known-family input must never be partially parsed and then re-emitted with unknown constructs dropped. If the structured parser cannot preserve a construct, the body stays opaque/source-preserved and serializes from `body.source`.

Sequence, Gantt, and ER refine "opaque/source-preserved" into ordered typed and **opaque-block segments**, so structured operations survive around unmodeled lines. Whole-body opaque remains the fallback for un-segmentable input. Class and Timeline are the remaining segment-preservation candidates tracked in `TODO.md`.

This applies even when the diagram renders successfully. Render support is not the same as structured editing support.

### Code Mode has two checked runtimes

- Local MCP uses synchronous `node:vm`; it is not a container/OS security boundary.
- Hosted MCP uses per-request Cloudflare Dynamic Worker isolates with bounded CPU/subrequests and no outbound network. It deliberately differs from local execution in strict-module and CPU-time details; differential tests pin the shared contract and named divergences.
- SDK-returned diagrams are read-only. Structured edits go through `mermaid.mutate(...)` and trusted lineage from parse/mutate/narrower outputs.

### Runtime surfaces are part of the contract

Keep these in sync when changing agent behavior:

- `src/agent/*` public API;
- `am capabilities` and CLI help;
- MCP SDK declaration and server instructions;
- `Instructions_for_agents.md` / `am --agent-instructions`;
- `skills/agentic-mermaid-diagram-workflow/*`;
- `skills/agentic-mermaid-live-editor/SKILL.md`;
- `llms.txt`;
- `docs/agent-api-cookbook.md`.

Doc-sync tests exist because agents consume docs and capability JSON as runtime surface, not just prose.

## Important fixed issues worth remembering

These are retained only because they explain guardrails that may otherwise look excessive:

- **Opaque fidelity:** opaque bodies serialize from preserved `body.source`, not normalized `canonicalSource`, so indentation/comments/source text survive parse → serialize.
- **`am parse | am serialize`:** JSON payloads preserve flowchart styling maps and defensively normalize loose SDK-shaped subgraphs.
- **Subgraph payload hardening:** `synthesizeFromGraph` tolerates missing `children`, null entries, cyclic references, non-tuple map arrays, and non-integer linkStyle keys.
- **Timeline mutation:** timeline edits update `canonicalSource`, validate mutation text, allocate unique IDs, and fall back to opaque for header-suffix/lossy syntax.
- **Shared routing cleanup:** SVG, ASCII, and agent parsing use shared diagram-family detection from `src/mermaid-source.ts`; agent parsing adds only a loose known-family path so malformed known headers can round-trip as opaque.
- **Source-based `LABEL_OVERFLOW`:** verification checks labels for opaque/source-level families via family label extractors, so fallback does not mean "unverified."

## Evidence and limits

What the current suite demonstrates:

- typed mutation works for the exposed structured families;
- unsupported/opaque/source-level bodies refuse structured mutation instead of losing source;
- verify-before-serialize and Code Mode trace linting catch key agent anti-patterns;
- corpus gates cover Mermaid docs examples and MermaidSeqBench round-trip stability;
- docs/capabilities/CLI/MCP declarations are checked for consistency.

What it does **not** yet prove:

- market demand;
- that a real external consumer likes the API;
- that a selected release model follows the intended loop from docs alone.

Those validation items remain in `TODO.md`.
