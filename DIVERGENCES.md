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

## Loop 6 — Abandoned mermaid-ast integration

**Status:** Dependency installed (`mermaid-ast 0.8.2`, pinned exact, in
`package.json`); implementer agent stalled silently with no code commits.
The architectural call (do NOT replace our parsers; use as cross-validator)
was the correct one — `mermaid-ast`'s `render()` re-emits canonical form
which would break the byte-exact opaque-body round-trip established in
Loop 5 Phase A. The structured-or-opaque rule with byte-fidelity round-trip
is load-bearing; `mermaid-ast` doesn't preserve it.

What we kept for Loop 8: the dependency, the architectural reasoning
(documented in `LESSONS_LEARNED.md`), the cross-validation pattern
sketched in the Loop 6 plan.

What we cut: the structured-uplift for journey + xychart via `mermaid-ast`
(can ship as cross-family-via-plugin in Loop 8); the parallel parser
comparison test gate (defer until we have evidence it catches anything
the 247-corpus doesn't).

The Loop 6 implementer is also the cautionary tale that drove the
"commit per milestone, push on every commit" rule in Loop 7's plan.

## Loop 7 — Network survey + ASCII fixes + agent-contract verbs

In response to "we should make sure they make sense locally and rewrite
them to better match our quality/verification/testing standards" — a
9-item network research sweep across `lukilabs/beautiful-mermaid` PRs/
forks + adjacent repos (LeviTK/bm-cli, raiscui, ktrysmt, zhenhuaa/mdv,
etc.) produced a backlog the autopilot workflow then hardened with 5
critics and shipped as seven milestones.

### Milestone landings
- **M1 Wire FamilyPlugin.verify dispatcher** — was declared in `families.ts`
  but never called. `verify.ts:33-37,137-147` now dispatches to plugins
  alongside per-body verifiers. 3 new tests. Loop 7 review fix added
  warning dedup via `warningKey()` so plugin and per-body verifiers
  returning the same warning don't double-count.
- **M2 Consolidate Unicode ranges** — `src/shared/unicode-ranges.ts`
  (neutral module) replaces duplicated ranges in `width.ts` +
  `text-metrics.ts`. Avoids ascii→core import direction the correctness
  critic flagged.
- **M3 Six ASCII bugs fixed:**
  - 3.1 Self-arrow `<br/>` not split (`sequence.ts:316-335`)
  - 3.2 Self-arrow extent in `alt`/`loop` block width (`sequence.ts:408`)
  - 3.3 CJK sequence-label centering uses `visualWidth()` at 3 sites + a
    4th site (self-arrow drawing loop) caught by Loop 7 review bug-hunt
  - 3.4 FE0F / FE0E / ZWJ width handling via lookahead in `visualWidth()`
  - 3.5 Pathfinder determinism — probe first found the existing code is
    already byte-identical across 10 runs; landed as a regression guard,
    not a behavior change (faithful to "probe FIRST, then act" plan)
  - 3.6 (rolled into M2)
- **M4 Regression tests for 3 already-covered upstream items:**
  yhatt PR #74 (CJS exports), mk668a PR #110 (`--o`/`--x` markers),
  rnbguy PR #54 (pre-message notes).
- **M5 Agent-contract verbs:**
  - `am capabilities --json` emits `{ sdkVersion, families, warningCodes,
    outputFormats }` from the registry. JSON Schema fixture committed at
    `src/__tests__/__fixtures__/capabilities.schema.json`.
  - `am batch --jsonl` reads JSONL stdin, emits per-line JSON envelopes,
    continues past malformed lines.
  - Exit codes 0/2/3/4 in `src/cli/exit-codes.ts`; `EXIT_VERIFY_FAILED=3`
    is the new code Loop 7 introduces.
- **M6 Code Mode justification** — paragraph in `AGENT_NATIVE.md` citing
  manuareraa PR #42 as the render-tool-per-format counter-example.
- **M7 Docs** — `LESSONS_LEARNED.md` rewritten across loops 1-7; new
  top-level `ROADMAP.md` tracks the three pillars.

### Network items cut from Loop 7 (deferred to Loop 8)
- SVG `--compact` mode (rounding + whitespace) per GauBen #77 — keeps
  data-* attrs (they're agent inspection hooks)
- CSS-variable fonts + `embedFontImport: false` (offline/CSP friendly)
  per 2017fighting fork
- Per-family CLI smoke matrix per vinceyyy #51
- TTY-stdin guard per vinceyyy #51 — needs `node-pty` for honest test
- mermaid-ast structured-uplift for journey + xychart
- `renderAsciiWithMeta()` for TUI integration per raiscui fork +
  zhenhuaa/mdv consumer signal
- Cross-runtime ASCII parity (bun ≡ node), Loop 5 has this for SVG
- Pathfinder trunk-sharing for fanouts per rmvegasm PR #113 (advanced)

### Network items rejected (counter-examples, documented)
- manuareraa PR #42 (4-tool render-only MCP) — conflicts with Code Mode
  bet
- mingway426 fork (Cloudflare Workers MCP) — subset of #42 with even less
  to recommend

### Loop 7 review pass — autopilot Review phase
Two reviewers: bug-hunt (rapid) + completeness (deep). Bug-hunt caught
1 ship-blocker (M3.3 missed a 4th self-arrow drawing site) + 1 soft
hazard (plugin-verify warnings not deduped against per-body warnings).
Both fixed in commit `0c295b6` with regression test. Completeness check
confirmed all 7 milestones complete.

### Numbers
- Test count: 1492 → 1523 (one Loop-7-review test included)
- 247-sample mermaid-docs corpus: floor holds
- MermaidSeqBench: 132/132 holds
- Build + tsc + lint: all clean
- 9 commits on `claude/agentic-mermaid-on-ast`; PR #11 open

### Process lessons (also in `LESSONS_LEARNED.md`)
- Survey the ecosystem BEFORE building (would have saved several days
  on the parser rewrites had we found mermaid-ast in Loop 1).
- Commit per milestone (Loop 6 implementer stalled silently because it
  was holding work in-flight).
- Use autopilot Workflow for end-to-end cycles (5 critics catch the cuts
  before the implementer wastes effort).

## Loop 8 — PNG export + SVG polish + 2 audit items

User ask: "I also want to be able to export PNGs." Autopilot ran the
full cycle (plan + 5 critics + implementer + cleanup). Implementer
agent completed M1-M4 then terminated mid-M5 with a content-filter
error; I picked up and finished M5 + M6 directly.

### Milestones landed
- **M1 (A2)** Wired `FamilyPlugin.detect` in `parse.ts:detectKind` —
  registry-driven detection replaces the hard-coded if-cascade.
- **M2 (S2)** CSS-variable fonts via `--font` on SVG root + gate
  Google Fonts `@import` behind new `RenderOptions.embedFontImport`.
  **Default kept `true`** per critic 3 (existing
  `renderer.test.ts:77-81` asserts `fonts.googleapis.com` in default
  SVG; 4 fixtures bake it in). Loop 7 simplicity critic was wrong to
  recommend flipping the default.
- **M3 (S1)** SVG `--compact` mode — round coords ≤2dp, collapse
  whitespace, keep `data-*` and `class` attrs (agent inspection hooks).
- **M4 (A1)** Registered `verify` hooks on built-in class/ER plugins.
  Per-body branches in `verify.ts` left in place; Loop 7 review fix's
  `dedupedConcat` makes the double-call observationally invisible.
  Branch removal deferred to Loop 9 (requires careful layout handling).
- **M5+M6 (P)** PNG export via `@resvg/resvg-js@2.6.2` (exact pin, no
  caret), napi-rs native build (NOT WASM — same `.node` binary under
  Bun and Node via N-API compat), `loadSystemFonts: false`, bundled
  DejaVu Sans fonts. `renderMermaidPNG(input, opts): Uint8Array` —
  synchronous (resvg's `.render()` is native-sync; only the import was
  async). CLI: `am render --format png --output file.png`. MCP tool
  deferred (small follow-up). 21 new tests across 3 files.

### Cross-runtime PNG result
**Bun ≡ Node SHA-256 on x86_64.** The Loop 8 critic 2 pre-declared
threshold ("if >0 bytes diverge, weaken claim") was NOT triggered.
The critic-2 prediction of p~0.9 success held. Documented in
`QUALITY.md` "PNG determinism" with honest gaps (cross-arch x86 vs
ARM untested; resvg version drift; system-font substitution).

### Architectural notes
- napi-rs over WASM: critic 1 was right. Same prebuilt binary +
  N-API compat = no init-time divergence between Bun and Node.
- Bundled fonts in `assets/fonts/` (DejaVu Sans + Bold, 1.4 MB total,
  permissively licensed) are load-bearing. Without them, resvg falls
  back to system fonts and parity collapses.
- Sync `renderMermaidPNG`: deliberate. Bundles resvg eagerly into
  `dist/agent.js` (~5 MB additional weight) but eliminates an entire
  class of CLI integration headaches. Library consumers who care about
  bundle weight can ship their own dynamic import wrapper.

### Implementer agent stall (handoff lesson)
Loop 6 implementer stalled silently; Loop 7 implementer succeeded
fully; Loop 8 implementer stalled mid-M5 with an "Output blocked by
content filtering policy" error after 19 minutes. The four committed
milestones (M1-M4) all landed cleanly because the agent followed the
"commit per milestone" rule from the hardened plan. Handoff cost was
minimal: I picked up at M5 with the dependency + fonts already prepped,
wrote the PNG implementation + tests in ~10 minutes of focused work.

The hardened-plan + commit-per-milestone discipline is what made the
handoff possible. The Loop 6 stall failed because it held all work in
flight; Loop 8 stall recovered because each milestone was a clean
checkpoint.

### Numbers
- Tests: 1523 → 1552 in `src/__tests__/` (+29 across 3 new files), plus
  4 new e2e/ tests for the PNG CLI path
- Build: dist/agent.js grew from 571 KB to ~5.7 MB (resvg napi binary
  bundled inline). dist/index.js unchanged.
- 247-corpus + MermaidSeqBench floors: hold.
- Bundled fonts: +1.4 MB to package install size.

### Cut from Loop 8 (deferred Loop 9)
- MCP `render_png` tool — the library function is the dependency; an
  MCP wrapper is a thin shim. Defer until first MCP consumer asks.
- `--format unicode` and `--format json` from the user's stated vision.
- `renderAsciiWithMeta()` for TUI integration (raiscui inspiration).
- Cross-architecture (ARM64) PNG parity — needs hardware.
- Delete the class/ER per-body verify branches now that A1 wired the
  plugin hooks. Requires careful layout-handling restructure.

## Loop 9 — finish-the-backlog (recovery after two implementer stalls)

User directive: "don't stop until it's all finished." Two implementer
agents stalled — Loop 8 mid-M5 (content filter), Loop 9 mid-B11 (500
server error after 27 minutes). The commit-per-milestone rule made
both recoverable: pick up at the next-uncommitted milestone with the
hardened plan as the checkpoint structure.

### Landed (13 milestones across 11 commits)

**Tier A (small, high-value) — ALL 10 shipped:**
- A1 (046ec13) — MCP `render_png` + `describe` helpers alongside the primary `execute` tool
- A2 (ee881cc) — Delete class/ER per-body verify branches; dispatcher path is now single source of truth (Loop 8 TODO closed)
- A3 (6f627c9) — `am render --format json` emits layout JSON
- A4 (6f627c9) — `am render --format unicode|ascii` (combined with A3)
- A5 (e099aca) — TTY-stdin guard: exit 2 with "needs file arg or piped stdin" rather than blocking forever
- A6 (8e49aa1) — Per-family CLI smoke matrix (9-family e2e)
- A7 (ed21dd6) — Cross-runtime ASCII parity test (bun ≡ node on x86_64)
- A8 (58bd311) — Extract `runBatchedOperations` / `collectBatched` shared scaffold; `runBatchLine` + `runWithJudge` both use it
- A9 (f5f2ccb, combined with A10) — Consolidate corpus runner across `agent-mermaid-corpus.test.ts` + `eval/mermaidseqbench/runner.ts` into `runParseVerifyRoundtrip`
- A10 (f5f2ccb, combined) — Collapse `dedupedConcat` + `mergeFinalize` into one path (`mergeFinalize` delegates fully to `dedupedConcat` → `finalize`)

**Tier B (medium) — 3 of 4 shipped:**
- B11 (c738ffa, combined with B12) — `renderMermaidASCIIWithMeta` returns `{ ascii, regions }` with kind/id/canvasRow/colStart/colEnd. 7 tests including try/catch fallback for unparseable sources
- B12 (c738ffa, combined) — `describeMermaid` natural-language summaries per family. 7 new tests covering flowchart, sequence, timeline, class, ER, opaque, unparseable
- B13 (6301985) — ASCII `maxWidth` + word-wrapping via pre-render label preprocessor. New exported `wrapLabel` helper. 7 tests

### Cut from Loop 9 (deferred Loop 10)

**B14 pathfinder trunk-sharing.** Cut for context-budget. Requires deep
understanding of `src/ascii/pathfinder.ts` (215 lines) plus careful
determinism preservation (A7's test must keep passing byte-identical).
Loop 10 candidate.

**C15 mermaid-ast structured uplift for journey + xychart.** Hard
blocker discovered: `mermaid-ast`'s transitive dep tree is broken in
this environment. `mermaid-ast` → `langium` → `vscode-jsonrpc` →
`@chevrotain/regexp-to-ast` → ... all are missing. Adding
`vscode-jsonrpc` revealed more missing chevrotain deps. The cascade
suggests the published mermaid-ast bundle on npm may be missing
`bundledDependencies` declarations, OR the test environment has an
incomplete install. Loop 10 candidates: (a) investigate the dep
cascade, (b) shim/vendor the specific journey + xychart parsers, or
(c) write our own structured parsers for these two families since
they're small. Either way, mermaid-ast as currently published is not
usable here.

**C16 family-plugin parse/serialize/mutate consolidation.** Largest
architectural item. Pure refactor — replace if-cascades in
`parse.ts` + `serialize.ts` + `mutate.ts` with registry dispatch via
new `FamilyPlugin.parse|serialize|mutate` hooks. Would require
careful per-family migration so the 1592 tests hold. High value but
high blast radius. Cut for budget. Loop 10 candidate.

### Implementer-stall lessons

Two implementer agent stalls in two consecutive loops — Loop 8 hit a
content filter mid-M5, Loop 9 hit a 500 server error after 27
minutes. Recovery was clean in both cases because:

1. **Commit per milestone** was treated as load-bearing in the
   hardened plan. Loop 9 implementer committed A1-A10 before
   stalling at B11. The 8 commits were on origin; B11's
   uncommitted work was a clean re-pickup.
2. **Each milestone is a discrete checkpoint** in the hardened
   plan — so picking up doesn't require reverse-engineering the
   implementer's mental model.
3. **Cut policy explicit in the plan** — when budget runs short,
   cut from the bottom of the priority list. Both Loop 8 and Loop
   9 ended up cutting items honestly.

The autopilot Workflow handled this gracefully because each layer
of the plan was a checkpoint. The lesson for Loop 10+: stalls are
inevitable in long sessions; the plan structure is what makes
them recoverable.

### Numbers
- Tests: 1552 → 1592 in src/__tests__/ (+40 across 6 new test files)
- All 1592 pass; tsc + build + lint green
- 247-corpus floor holds; MermaidSeqBench 132/132 holds
- 11 commits on the branch from Loop 9 work
- 3 items cut (B14, C15, C16) — documented above as Loop 10 candidates

## Loop 10 — close the verified ecosystem gaps

User: "Resolve the remaining gaps (except SkillKit)." Ran the gap list
from the fork-network crawl against current code. Notable theme: THREE
of the five "gaps" turned out to be ALREADY IMPLEMENTED — the earlier
verification pass had checked the wrong file. Honest correction over
re-building.

### M1 (#81) — external CSS class emission: BUILT
Node `<g>` carried only structural `class="node"`. Now appends user-assigned
Mermaid class names (`class A hot` → `<g class="node hot">`) so external
stylesheets can target semantic classes. classAssignments flows graph →
PositionedNode.classNames → renderer; names sanitized to valid CSS idents.
data-* attrs + classDef inline styling unchanged. 6 tests.

### M2 (#116) — auto-contrast on custom fills: ALREADY DONE
Verification miss: I checked theme.ts's `isColorDark` (used only for
drop-shadow flood-color) and concluded #116 was absent. In fact
renderer.ts's `contrastTextColor` + `nodeTextColor` already implement it:
dark fill → white text, light fill → black text, no custom fill → theme
default. Added the missing regression coverage (6 tests). Discovered a
SEPARATE real bug while testing: `style A fill:rgb(10,10,10)` is mangled
by the style-statement parser (comma split → `rgb(10`). Logged as a
Loop 11 candidate; hex fills are the supported path.

### M3 (#113) — fanout trunk-sharing: ALREADY DONE
Verification miss: src/ascii/edge-bundling.ts already implements fan-out
bundles with shared paths + junctions. rmvegasm #113 fixed #111/#112 in
an earlier upstream state; our fork already produces correct shared
trunks (TD + LR), deterministically. Added regression coverage: fork
glyph present, no floating connectors (#112), determinism over 10 runs.
5 tests.

### M4 (ktrysmt #66/#67) — ASCII robustness: #66 BUILT, #67 ALREADY DONE
- #66 A* OOM guard (REAL BUG FIXED): pathfinder's `isFreeInGrid` only
  guarded x/y < 0 — no upper bound. An unreachable/walled target let A*
  explore the +x/+y plane unboundedly → OOM/hang. Now bounds to grid
  extent + 4-cell margin, plus a hard iteration cap (max(10k, area*4));
  on exhaustion returns null → caller falls back to a direct route.
- #67 root detection: already implemented in grid.ts (`initialRoots`,
  no-incoming-edge nodes at top, subgraph-aware). Added 2 tests.
- #69 fan-in grouping: DEFERRED to Loop 11 (layout aesthetics, risks
  determinism snapshots for marginal gain).
5 tests.

### M5 (raiscui) — reverse ASCII→Mermaid: BUILT (best-effort)
New src/ascii/reverse.ts: `asciiToMermaid(ascii, {direction})`. Detects
boxes (Unicode + ASCII) → nodes, arrowheads → edges by adjacency, with
junction-hopping across fan-out trunks. LOSSY BY DESIGN: ASCII carries
labels not ids, so ids are synthesized (N0…); round-trip is structural
(label set + edge count), not byte-identical. Edge labels / shapes /
subgraphs / styling not recovered. Reliable for linear chains + simple
fan-outs. 7 tests. Exported from beautiful-mermaid/agent.

### Honest takeaway
The Loop 10 verification pass was wrong on 3 of 5 items — I grepped the
wrong files (#116 contrast, #113 trunk-sharing) or under-counted existing
coverage (#67). The lesson: a verification pass that greps ONE file and
concludes "not done" is unreliable. Better: render the actual feature and
observe behavior before claiming a gap. The cost here was low (added
regression tests for already-working features — net positive), but the
same mistake on a "build it" call would have meant rebuilding what exists.

### Loop 11 candidates
- #69 fan-in grouping (deferred)
- rgb()/comma values in `style` statements (real parser bug found in M2)
- C15 mermaid-ast journey/xychart (dep chain still broken — Loop 9 blocker)
- C16 family-plugin parse/serialize/mutate consolidation (Loop 9 cut)
- B14 was Loop 9's pathfinder trunk item — resolved here as M3 (already done)

### Numbers
- Tests: 1592 → 1621 (+29 across 5 new test files)
- All pass; tsc + build + lint green
- 247-corpus + MermaidSeqBench 132/132 floors hold; determinism snapshots unchanged
- 5 milestone commits (M1-M5)

## Loop 11 — agent-runtime hardening (security + AX + batch + discovery)

Crawl requirements (mermaid-cli + Mermaid PR signals). Verification done by
OBSERVATION first (render + inspect), per the Loop 10 lesson — and this time
the verification was accurate: all 5 targeted items were genuine gaps/bugs,
no false negatives.

### M1 (#7540/#6621) — unique SVG ids: REAL BUG FIXED
Two diagrams on one HTML page collided on shared <defs> ids (arrowhead,
bm-shadow, color-suffixed markers). New RenderOptions.idPrefix (default ''
= unchanged) + namespaceSvgIds post-pass rewrites def ids + url(#…) refs.
am batch auto-assigns d{lineIndex}-. Determinism + 247-corpus snapshots
unchanged (default off). 7 tests.

### M2 (#7254/#7255 + #7349) — SVG AX + AX tree: BUILT
- accTitle→<title>, accDescr→<desc>, role="img"+aria-labelledby, injected
  via localized post-pass (legacy SVG path doesn't carry acc through the
  parser; no threading through 8 family renderers). idPrefix-aware,
  XML-escaped, back-compat (no acc → no title).
- describeMermaid(d,{format:'json'}) + describeMermaidTree(d) → structured
  { kind, nodes, edges, entryPoints, sinks } AX tree. 15 tests.

### M3 (#7645/#7695) — strict security mode: BUILT
External-fetch surface audit: the ONLY real vector is the Google Fonts
@import (remaining http:// is the xmlns declaration, not a fetch).
RenderOptions.security:'strict' forces embedFontImport off → zero external
refs. verifyNoExternalRefs(svg) scanner (excludes xmlns) as CI gate +
agent self-check. CLI --security strict. MCP already strict-by-construction
(render_png offline; SVG via execute). SECURITY.md documents the threat
model + guarantee. 8 tests.

### M4 (#6430) — llms.txt: BUILT
am llms-txt + buildLlmsTxt() derived from capabilities; committed snapshot
+ doc-sync test. 6 tests.

### Deferred (Loop 12 candidates)
- #7785 collapsible subgraphs (large layout work)
- #1018 single-binary distribution (needs publish access + bundling)
- #543 markdown fenced-block conversion with skip-bad-diagrams
- #930 --watch, #959 glob input (CLI conveniences)
- termaid / mmd-cli / mmdc benchmark harness (separate eval)
- #7695 formal Trusted Types browser verification (static markup is
  CSP-compatible but unverified against a live TT policy)
- rgb()/comma values in `style` statements (Loop 10 parser bug, still open)

### Numbers
- Tests: 1621 → 1652 (+31 across 4 new test files)
- tsc + build + lint green; 247-corpus + MermaidSeqBench 132/132 floors hold
- All determinism (SVG/PNG/ASCII, in-process + cross-runtime) byte-identical
- 5 commits (M1-M4 + docs)

## Loop 12 — consistency fixes + benchmark numbers + feature backlog

User authorized all three explicitly. Executed directly per milestone
(four prior implementer-agent stalls → direct execution is the reliable
mode). Verification by observation throughout (Loop 10 lesson).

### M1 — CLI structured error envelope (consistency wart #1)
The CLI buried ParseError[] as a JSON-stringified string in error.message.
New parseErrorEnvelope() emits { code:'PARSE_FAILED', message:<human>,
details:<ParseError[]> } at every PARSE_FAILED site. Success path (bare
ValidDiagram JSON) unchanged — pipe contract intact. 3 tests.

### M2 — removed stale Loop-9 TODO comments (consistency wart #2)
families-builtin.ts claimed verify.ts still had duplicate per-body class/er
branches; Loop 9 M2 had already deleted them (confirmed: verify.ts routes
class/er through pluginWarnings only). Doc-rot removed.

### M3 — benchmark harness + RESULTS.md (HONESTY-CRITICAL)
Measured ours over the 247-corpus: SVG p50 3.7ms/p90 14.9ms, ASCII p50
0.37ms, SVG p50 2.9KB, parse 247/247, cold CLI ~870ms. Competitors
attempted LIVE, reported faithfully:
- mmdc: installs; headless Chrome refuses root without --no-sandbox (the
  #750/#1015/#1013 pain). With --no-sandbox: ~3000ms cold, 10.8KB output
  (4.8x ours). Browserless win measured.
- termaid: installs, renders Unicode well, ~102ms cold — FASTER than our
  Bun CLI cold-start. Reported honestly: termaid wins on cold ASCII; our
  edge is the agent surface (AST/verify/mutate/SVG/PNG/MCP) it lacks.
- mmd-cli (Go): not built; assessed from architecture (single-binary =
  Loop 13 distribution lesson #1018).
No fabricated head-to-head latency. The honest finding — termaid beats our
cold-start — is in RESULTS.md, not spun.

### M4 — rgb()/rgba()/hsl() in style statements (real bug, Loop 10 deferral)
parseStyleProps split on every comma, mangling fill:rgb(10,10,10) →
"rgb(10". New splitTopLevelCommas splits at paren-depth 0 only. rgb fill
now drives auto-contrast end-to-end (closes the Loop 10 M2 documented gap).
Multi-prop hex still splits (no regression). Applies to style + classDef.
8 tests.

### M5 (#543) — render-markdown, skip-bad-diagrams
am render-markdown extracts ```mermaid fenced blocks, renders each,
continues past invalid ones. { blocks:[{index,ok,format,output|error}] },
exit 0. 6 tests.

### Cut
- M6 (#959 glob/multi-input) — context budget. Loop 13.

### Numbers
- Tests: 1652 → 1672 (+20 across 5 new test files)
- tsc + build + lint green; 247-corpus + MermaidSeqBench floors hold
- determinism (SVG/PNG/ASCII, in-process + cross-runtime) byte-identical
- 6 commits (M1+M2, M3, M4, M5, docs)

### Loop 13 candidates
- #959 glob/multi-input; #930 --watch
- #1018 single-binary (would close the cold-start gap the benchmark exposed)
- #7785 collapsible subgraphs; #7695 formal Trusted Types browser test
- mermaid-ast journey/xychart (dep chain broken); ARM64 PNG parity (hardware)

## Loop 13 — distribution + conveniences + agent-usage testing + hygiene

Direct execution per milestone. Verify by observation.

- **M1 TODO.md** — prepended a Project Backlog: blocking owner-decisions
  (rename+publish, merge PR #11, get a real consumer), build backlog,
  blocked items. The three non-code blockers are now first-class.
- **M2 LESSONS_LEARNED** — the meta-lesson: 13 loops in one unmerged PR
  with only self-generated quality signal; should have sought merge +
  real consumer around Loop 5-6. Closed build→self-review loop has a
  ceiling.
- **M3 single-binary (#1018)** — `bun build --compile` → dist/am (112MB,
  gitignored), full surface incl. PNG (resvg native addon embeds).
  MEASURED cold-start: binary ~440ms vs bun-run ~570-870ms — halves it,
  does NOT reach termaid's ~102ms (Bun runtime init is the floor).
  Reported honestly in RESULTS.md. 5 e2e tests.
- **M4 multi-input (#959)** — `am render <a> <b> <c>` → results array,
  skips bad files. Single-input unchanged.
- **M5 --watch (#930)** — fs.watch re-render; pure renderFileOnce core is
  unit-tested; live-watch timing smoke-only (documented).
- **M6 agent-usage harness** — 3 layers: scripted scenarios + anti-pattern
  linter (CI) + real-LLM eval (design). The honest answer to "how do we
  test how agents use it"; even L1 uses a scripted not real agent — L3
  (real model + AGENTS.md + tasks) is the true validation, needs a live
  model + ideally a real consumer's tasks.
- **M7 FEATURES.md** — full capability inventory by area.

### Numbers
- Tests: 1672 → 1686 (+14 src) + 5 e2e binary tests
- tsc + build + lint green; corpus + determinism floors hold
- 8 commits

### Loop 14+ — the recommendation is NOT more features
Per TODO.md + LESSONS_LEARNED: merge/park PR #11, make the rename+publish
decision, get one real external consumer. Remaining build items
(collapsible subgraphs #7785, Trusted Types #7695) and blocked items
(mermaid-ast deps, ARM PNG) are documented but secondary to leaving the lab.
