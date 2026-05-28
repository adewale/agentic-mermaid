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

## Loop 3 — Remaining-issues sweep

### Applied
- **Sandbox `ensureReturn` improved.** Bare single expressions (`1+2`,
  `mermaid.parseMermaid(s).ok`) now return the value; multi-statement bodies
  without an explicit `return` produce `ok:true; value:null` instead of a
  non-serializable error. New sandbox-shapes tests cover all four cases.
- **GitHub Action path validated** against live `mermaid-js/mermaid` — confirmed
  `docs/syntax` exists at the path the workflow uses.
- **Cleanup #1 applied:** extracted `positionedToRenderedLayout` and
  `emptyRenderedLayout` to `src/agent/layout-to-rendered.ts`; both verify.ts
  and index.ts (layoutMermaid) now share one implementation.
- **Cleanup #3 applied:** removed the triplicate `SubgraphLike` shim;
  verify.ts and mutate.ts both use the existing `MermaidSubgraph` type.
- **Cleanup #2 mitigated** (not consolidated — the three detectors have
  genuinely different return shapes, consolidation risks renderer routing
  changes). Added a drift-guard test that asserts the agent's `parseMermaid`
  and the legacy `detectDiagramType` agree on the families they share.

### Mutation testing (Stryker)
- Installed `@stryker-mutator/core` and added `stryker.agent.config.json`
  for the agent surface.
- **`src/agent/types.ts`: 94.87% → 100%** (37 → 39 killed). The two
  survivors were a never-exercised `asFlowchart` negative branch and an
  unasserted `toFinite` error message — both fixed by targeted tests.
- **`src/agent/serialize.ts`: 48.44% → 54.69%** after adding 6 targeted
  tests for `synthesizeFromGraph` defensive paths (`null`/`undefined` style
  maps, array-of-tuples nodes, missing `edges`, invalid body kind,
  subgraph with explicit-undefined label/nodeIds, linkStyles `default`
  key, pre-built `Map` payloads). Remaining survivors cluster in
  `renderShape`/`renderEdgeArrow` string literals whose mutations still
  produce parseable output — round-trip tests catch real regressions
  but Stryker rightly flags weaker assertions.
- **`src/agent/mutate.ts`: ~50%** (one chunked run). Not chased further
  this loop; mostly survivor clusters in boolean/conditional mutants of
  error paths.
- Documented honestly: real coverage on critical paths is now in the
  ~55–100% range; remaining survivors are known to be lower-payoff.

### Not done (and why)
- **Timeline structured mutation** considered but skipped: the spec already
  documents the six families as opaque-by-design ("sequence proved the
  pattern extends"); adding timeline would be scope expansion, not closing
  a documented gap. The opaque fallback for timeline already provides
  lossless round-trip + verify.
- **MermaidSeqBench** still needs external dataset.
- **Cross-machine determinism** still requires multiple-CPU hardware.
