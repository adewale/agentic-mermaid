# Divergences — v4 implementation

Decisions made during the v4 build that differ from, or go beyond, AGENT_NATIVE.md. Carried forward across loops (not deleted on rollback — that was a documented failure of the previous loop).

## Honored from the spec

- No `LayoutContext` / `SeededRNG` / `Clock` / `withSeededRandom` / font-metrics table. The empirical probe proved seeding changed nothing; ELK is already deterministic. Removed entirely.
- `RenderedLayout` has no `seed` field.
- `VerifyOptions = { suppress?, labelCharCap? }` is the only knob surface.
- Sequence parsing is structured-or-opaque: lossless fallback, never silent drop.
- Substrate enforcement is a grep test under `bun test`, not ESLint (not installed).

## Decisions beyond the spec

- **Package name unchanged (`beautiful-mermaid`).** Agent surface via `./agent` subpath. Renaming is a publish-time action needing the owner; out of scope for implementation. (Same as prior loops.)
- **`MermaidGraph` / `renderMermaidSVGAsync` kept**, not removed. Removing them breaks 60+ test files and the Craft Agents consumer. `ValidDiagram` wraps `MermaidGraph` for flowchart.
- **`state` diagrams share the flowchart body** (`body.kind: 'flowchart'`), because the legacy parser produces a `MermaidGraph` for both. `asFlowchart` accepts both; `kind` distinguishes them. So "flowchart + state + sequence" = two body shapes, three kinds.
- **Sequence message styles** modeled as `sync | reply | async | async-dashed | lost | lost-dashed`. Mermaid has more (bidirectional, etc.); these six cover the common arrows. Unmodeled arrow forms trigger the opaque fallback.
- **`am parse` JSON shape**: Maps serialized to plain objects via a replacer. `synthesizeFromGraph` reverses it.

## Known limitations (carried, not hidden)

- Six families (class, ER, timeline, journey, xychart, architecture) parse to opaque; no structured mutation. Documented in spec.
- Cross-machine (different-CPU) float determinism not claimed; cross-process same-machine is tested.
- MermaidSeqBench not wired (external dataset).
- Stryker not installed; substituted with an in-repo fault-injection test that proves the suite catches injected bugs.

## Audit-loop findings (code-review skill, high effort) — fixed

1. **CRASH (high): `synthesizeFromGraph` + subgraph without `children`.** The
   Code Mode SDK declares `FlowchartGraph.subgraphs` as `{id,label,nodeIds}[]`
   (no `children`). An agent building that exact shape then calling
   `mutate`/`verify` hit `undefined.map` in cloneSubgraph / findSubgraphById.
   Fix: `synthesizeFromGraph` now normalizes subgraphs recursively
   (`children ?? []`, `nodeIds ?? []`). Regression test added.
2. **DATA LOSS (medium): `am parse | am serialize` dropped flowchart styling.**
   `toJsonSafe` omitted classDefs/classAssignments/nodeStyles/linkStyles and
   `synthesizeFromGraph` initialized them empty, so the documented round-trip
   silently lost `classDef`/`class`/`style`/`linkStyle`. Both ends now
   serialize and rebuild the four style maps. Regression tests added (library
   + CLI level).
3. **MINOR: OFF_CANVAS else-if masked the second axis.** A node off-canvas on
   both x and y reported only x. Now reports each axis independently.

Both finder angles (correctness + cleanup) confirmed the parser's
`declare`-keyword transpiler bug was already fixed, the sequence arrow
round-trip is correct, and the sandbox timeout path works.

## Cleanup findings (acknowledged, not all applied)

The cleanup finder flagged real duplication: `layoutMermaid` duplicates
`verify.ts`'s layout→RenderedLayout mapping; `detectKind` duplicates
`mermaid-source.ts`'s `detectDiagramType`; double `normalizeMermaidSource`
in parse.ts; the `SubgraphLike` shim appears three times. These are
maintainability costs, not bugs. Deferred deliberately: consolidating them
risks churning the existing renderer's behavior, and the agent surface is
intentionally a thin, self-contained layer. Tracked here rather than fixed
to avoid a large refactor in the same change that ships the feature.
