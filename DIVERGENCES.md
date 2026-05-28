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

## Loop 3 audit pass — three more real bugs (found + fixed)

The audit (code-review skill on the loop-3 diff) caught three serialize.ts
defensive-helper bugs I'd written but never adversarial-tested. All
reproduced via standalone runs; all fixed with regression tests:

1. **CRASH: cyclic subgraph stack-overflow.** `normalizeSubgraphs` recursed
   without a visited set; `subgraphs:[a]` where `a.children.push(a)` blew
   the stack. Fix: per-call visited set drops the cyclic edge.
2. **CRASH: null subgraph element.** `[null]` in `subgraphs` triggered
   `TypeError reading .id`. Fix: skip null/non-object elements.
3. **CRASH: non-tuple Array in `toMap`.** `classDefs: ['foo','bar']` threw
   "Iterator value foo is not an entry object". Fix: only accept
   well-formed `[k, v]` tuples; ignore the rest.
4. **DATA LOSS: NaN-keyed `toLinkStyleMap`.** Non-numeric string keys
   (`abc`) silently became NaN-keyed entries unreachable by index lookup;
   fractional keys (`'1.5'`) similarly stored unreachable floats. Fix:
   only accept non-negative integer keys and the literal `'default'`.

Also fixed (subtle): `toMap` now coerces non-string Map keys to strings so
`new Map([[0, ...]])` → `.get('0')` works.

Plus the sandbox `ensureReturn` heuristic — the audit confirmed my own
working-tree replacement already covered all four C-angle findings.

Audit Angle A (refactor): clean — no regressions from the layout-mapping
extraction or `SubgraphLike` → `MermaidSubgraph` swap.

Full suite: 1330/1330. tsc clean. Build clean. Lint green.

## Loop 4 — Closing the "won't fix" list

The user challenged the four items I'd labeled as untractable in loop 3.
Three were cop-outs; the fourth is genuinely hardware-bound. Resolved:

### 1. Stryker plateau on serialize.ts (54.69%)
Surveyed survivors, grouped them, wrote 40 exact-string regression tests
in `agent-serialize-exact.test.ts` covering: every shape literal
(`A[X]`, `A(X)`, `A([X])`, `A[(X)]`, `A((X))`, `A>X]`, `A{X}`, `A{{X}}`,
`A[/X/]`, `A[\X\]`, `A[/X\]`, `A[\X/]`), every flowchart edge style
(`-->`, `-.->`, `==>`, `--o`, `--x`, `~~~`), every sequence arrow
(`->>`, `-->>`, `->`, `-->`, `-x`, `--x`), frontmatter emission rules
(asserts empty frontmatter is NOT emitted), trailing newlines, subgraph
keyword/indent, classDef/class/style/linkStyle keywords. **serialize.ts
mutation score: 54.69% → 78.06%** (one rerun confirmed).

### 2. Timeline structured mutation
Implemented as a third structured family alongside flowchart and sequence.
Added `TimelineBody`, `TimelineSection`, `TimelinePeriod`, `TimelineEvent`,
`TimelineValidDiagram`, `asTimeline()`, and 10 typed ops: `set_title`,
`add_section`, `remove_section`, `set_section_label`, `add_period`,
`remove_period`, `set_period_label`, `add_event`, `remove_event`,
`set_event_text`. Parser is structured-or-opaque (multi-event-per-period
`:` separator + continuation lines handled; unmodeled syntax falls back
opaque, never silently dropped). 29 regression tests in
`agent-timeline.test.ts` cover parsing, mutation, verify, round-trip
fidelity. Skill reference `references/timeline.md` added.

### 3. MermaidSeqBench wired
Located IBM Research's `MermaidSeqBench` (132 human-verified sequence
diagrams) at huggingface.co/datasets/ibm-research/MermaidSeqBench.
Downloaded the CSV (717 KB → `eval/mermaidseqbench/data.csv`). Wrote a
CSV parser handling quoted multi-line fields + `""` escapes (`runner.ts`),
runner reports parse rate / structured-vs-opaque split / verify rate /
round-trip stability. CI gate in `agent-mermaidseqbench.test.ts` asserts
**132/132 parse, 132/132 verify, 132/132 round-trip stable**. All 132 fall
back to opaque — confirms the structured-or-opaque fidelity rule was the
right design (these diagrams use notes/alt/loop/activate constructs we
don't model, and we don't drop them).

### 4. Cross-runtime determinism
Tightened. The earlier "cross-machine" claim was loose. Added
`agent-determinism.test.ts` cross-runtime case: spawn `/opt/node22/bin/node`
on `dist/agent.js`, compute layout in Node, compare to bun's layout. They
agree exactly (same x86_64, same ELK version, two different JS runtimes).
Spec now says: same-architecture, same-ELK-version determinism verified
across bun + node. Different-CPU-architecture (x86 vs ARM) still
genuinely needs hardware we don't have here — kept as a documented gap,
not a claim.

Full suite: 1407/1407. tsc clean. Build clean. Lint green.

## Loop 5 — Comprehensive coverage push (Phases A→F)

In response to "I want comprehensive support for all diagram types and
hooks so that new diagram types automatically get support. All the tiers
should be supported or explained to me." — six phases in order.

### Phase A — Bug fix (opaque-body indentation loss)
The old `canonicalSource` was `normalized.text` (line-trimmed). All
opaque-body diagrams (class, ER, journey, xychart, architecture,
sequence-with-alt/loop/activate/Note — and 132/132 of MermaidSeqBench)
were therefore round-tripping with **flattened indentation** — agents
calling parse → serialize lost formatting silently. Fix exposes the
original body on NormalizedMermaidSource and routes it to `body.source`
for opaque constructions. New `agent-opaque-fidelity.test.ts` asserts
byte-exact serialize-equals-input across families.

### Phase B — Family-plugin registry
New `src/agent/families.ts` defines `registerFamily(plugin)` for
extension families and exposes `getFamily(kind)` for built-ins.
`families-builtin.ts` registers all 9 families with family-specific
label extractors. `verify.ts` now applies LABEL_OVERFLOW to opaque
bodies via the registry — closing the gap where 5+ families never got
label-cap checking. Future external families can plug in by calling
`registerFamily` (exposed from `beautiful-mermaid/agent`).

### Phase E — 247-sample mermaid-js corpus
New `eval/mermaid-docs-corpus/build-corpus.ts` mines all 9 families
from `packages/mermaid/src/docs/syntax/*.md`. Output: **247 examples**
(flowchart 111, class 36, sequence 36, state 20, ER 16, timeline 14,
xychart 7, architecture 6, journey 1). CI gate per family. Baseline
shows all families at 100% parse/verify/round-trip **except state**,
which round-trips at 5% — state currently shares the flowchart IR body,
so the legacy parser rewrites state-specific syntax (`[*]` → `_start`).
Documented; structured state body is future incremental work.

### Phase F — Perceptual quality + LLM-as-judge harness
New `src/agent/quality.ts` ships `measureQuality()` returning 5
deterministic metrics (edgeCrossings, labelLegibility, whitespaceBalance,
labelEdgeProximity, aspectRatio) and `checkQuality(bounds)` for CI
gating. New `eval/llm-judge/judge.ts` ships the harness:
`buildJudgeRequest`, `runWithJudge(JudgeFn)`, `aggregateScores`,
`RUBRIC`. The CI test uses a deterministic mock judge derived from the
quality metrics; the real judge is intended for periodic runs (nightly /
pre-release), not per-PR. New `QUALITY.md` documents the
"good looking" definition: Tier 1 clean + perceptual bounds + LLM-judge
median ≥ 4 on stratified corpus sample. Honest notes on what we DON'T
claim (no pixel comparison, no font substitution check, no WCAG
contrast yet).

### Phase C — Structured mutation for class (10 ops) + ER (7 ops)
New `class-body.ts` ships parser + serializer + mutator + verifier for
class diagrams: 10 typed ops (set_title, add/remove/rename_class,
add/remove_member, add/remove_relation, add/remove_note) covering CRUD
plus cascading delete (relations + notes drop when class removed).
Supported syntax: bare class, `class X { members }`, `class X["label"]`,
`class X as "label"`, all 6 relation kinds (inheritance, composition,
aggregation, association, dependency, realization, link-solid,
link-dashed), cardinality + relation label, notes (attached and free),
title. From the corpus: 14/36 class diagrams parse structurally + 22
fall back to opaque (all 36 round-trip).

New `er-body.ts` ships full ER support: 7 typed ops, all 4 cardinality
glyphs both sides, solid + dashed lines, quoted labels. From corpus:
5/16 structured + 11 opaque (all 16 round-trip).

mutate() now overloads to 5 families (was 3). `asClass`, `asEr`
narrowers exported. journey / xychart / architecture remain opaque-only
in this loop — the Phase B family-plugin registry is ready for them as
future incremental commits.

### Phase D — Real RenderedLayout for sequence + timeline
`layoutMermaid()` now produces real geometric layouts for sequence and
timeline (was previously `emptyRenderedLayout`). Sequence uses the
existing `layoutSequenceDiagram` and maps actors → nodes, messages →
edges. Timeline gets a synthetic grid layout: each event becomes a
node arranged by section then period. Perceptual metrics from Phase F
now apply uniformly to every family that has a layout.

**Honest framing on Tier 2:** NODE_OVERLAP / ROUTE_SELF_CROSS are
flowchart-shaped concepts. They don't translate cleanly to sequence
(actor boxes are placed with mandatory gaps; messages are straight) or
timeline (events are grid-arranged). Rather than inventing fake
warnings that would produce noise, Tier 2 is documented as
flowchart-specific by design, and the geometric question for
non-flowchart families is answered by the Phase F perceptual metrics.

### Result
- 6 structured families (flowchart, state, sequence, timeline, class, ER)
- 3 opaque-only families with plugin slot ready (journey, xychart, architecture)
- Plugin registry for new families
- Universal Tier 1 LABEL_OVERFLOW
- Perceptual quality metrics on every family with a layout
- LLM-as-judge harness (mock in CI, real periodically)
- 247-sample mermaid-js corpus + CI gate
- Documented "good looking" rubric in `QUALITY.md`
- Bug fix: opaque-body indentation preserved (was being silently flattened)

Full suite: 1492/1492. tsc + build + lint green.
