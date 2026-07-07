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
- ~~`state` diagrams currently share the flowchart body (`body.kind: 'flowchart'`)…~~ **Superseded by BUILD-19.** State diagrams now own a dedicated `StateBody` IR (`body.kind: 'state'`) with state-shaped ops and a real `asState` narrower. `asFlowchart` returns `null` on a state diagram (a breaking change within the unreleased agent surface). Verify still gets full Tier 1 + Tier 2 geometric coverage: the `StateBody` projects to a `MermaidGraph` via the legacy parser (`stateBodyToGraph`) and runs the identical flowchart `verifyGraph`. The modeled subset is simple states/transitions/`[*]` pseudostates/composites/`direction`; unmodeled syntax (`<<fork>>`/`<<choice>>`/`<<join>>`, history, concurrency `--`, notes, `classDef`/`class`/`:::`) falls back to a lossless opaque body. Corpus round-trip for state jumped 5% → 100%.

### Mutation surface is intentionally narrower than Mermaid syntax

Structured mutation is exposed for every built-in renderable family, but only when that body's parser/IR/serializer/verifier can preserve the modeled semantics:

- flowchart/state;
- sequence (BUILD-18 — segment-preserving: participant/message ops stay live while Note/alt/loop/par/activate/autonumber/title ride along verbatim as opaque-block segments; only un-segmentable input such as an unbalanced `end` falls back to whole-body opaque);
- timeline;
- class;
- ER;
- journey (BUILD-15 pilot);
- architecture (BUILD-17 — the modeled subset of groups/services/junctions/edges);
- xychart (BUILD-16 — the modeled subset of title/axes/series);
- pie;
- quadrant;
- gantt.

Opaque/source-level bodies:

- any known-family diagram that falls back to opaque because it contains unmodeled syntax (e.g. architecture `{group}` boundary modifiers, accTitle/accDescr, malformed pie entries, out-of-range quadrant coordinates, or un-segmentable sequence/gantt syntax).

For source-level bodies, agents may render, verify, describe, and round-trip preserved source. They do **not** get typed mutation ops. `am mutate` returns `UNSUPPORTED_FAMILY` for those bodies.

### Structured-or-opaque is load-bearing

Known-family input must never be partially parsed and then re-emitted with unknown constructs dropped. If the structured parser cannot preserve a construct, the body stays opaque/source-preserved and serializes from `body.source`.

BUILD-18 refines "opaque/source-preserved" for sequence into a finer grain: a sequence body now interleaves structured statements with **opaque-block segments** holding unmodeled lines verbatim, so the structured ops survive instead of being forfeited at the first unmodeled line. The never-lossy invariant is unchanged — the segment lines are byte-for-byte preserved — and whole-body opaque is still the fallback for un-segmentable input. Class/ER/timeline can adopt the same segment-preserving body as follow-up work.

This applies even when the diagram renders successfully. Render support is not the same as structured editing support.

### Code Mode is local, synchronous, and lineage-checked

- The MCP server exposes a Code Mode-style `execute(code)` tool backed by local `node:vm`; it is not Cloudflare Codemode and not a container/OS security boundary.
- Code Mode is synchronous: no `async`/`await`, Promise jobs, dynamic import, finalizers, or blocking/realm-creating globals.
- SDK-returned diagrams are read-only. Structured edits must go through `mermaid.mutate(...)` and must use trusted diagram lineage from parse/mutate/narrower outputs.

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
