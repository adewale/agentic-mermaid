# Issue #26 audit — heuristics inventory, syntax-range coverage, conformance review

Audited: 2026-06-13, branch `claude/mermaid-spec-doglegs-yypj8g` (PR #30), at the
commit following "Record route-lane mutation score at 0b43c90".
Scope: everything issue #26 claims or implies for this branch, audited against
the code, the test battery, the Mermaid flowchart syntax reference, and
`adewale/testing-best-practices`.

Verdict in one line: the routing/port/rubric workstreams (WS1–4, the routing
slices of WS6/WS11/WS12) are genuinely done and well-evidenced; class/ER
route-contract adoption (WS7) is **not** done despite a doc claim to the
contrary (now corrected in `route-contracts.md`); the Mermaid edge-syntax
range had real untested-but-supported corners (now covered by
`src/__tests__/route-contracts-syntax-range.test.ts`) and three silent parser
misparse/drop bugs recorded below as known gaps.

---

## (a) Issue #26 workstreams: status, evidence, gaps

| WS | Claim | Status | Evidence | Gap |
|---|---|---|---|---|
| 1 | Shared layout-intent + certificate model | **done** (graph route, family edge, and region certificates) | `RouteCertificate`, `FamilyEdgeRouteCertificate`, and `RegionContainmentCertificate` in `src/types.ts`; every graph positioned edge certified (`route-contracts.test.ts`); debug exposure via `layoutMermaid(d, { debug: true })`; class/ER `orthogonal-box`, architecture `side-anchored`, sequence `lifeline-message`, and timeline/chart element-containment certificate tests in `agent-family-layouts.test.ts` | Graph-route adoption for sequence/timeline/charts remains intentionally out of scope; they use family edge/region certificates. |
| 2 | Route classes before layout | **done** (flowchart/state graph route pass) | `classifyRoutes` (`src/route-contracts.ts`); tests `classifyRoutes` describe block (primary/feedback/self-loop/container/cross-hierarchy, author-order reciprocal pairs, long cycles) | Class/ER `relation`/`dependency` subclasses do not exist; ASCII router does not consume `RouteClass` (see WS6); architecture final side reroutes use family endpoint-side certs, not graph `RouteClass` certs |
| 3 | Semantic ports + shape-aware anchors | **done** | `shapePorts` (`route-contracts.ts`), port ranking §6.2, dynamic `sourcePortAssignment`/`targetPortAssignment`, port-lane alignment §6.2.2, and conservative primary-DAG ELK `FIXED_SIDE` pre-layout hints; tests: "semantic ports", "port ranking", dynamic side/slot/role certificate tests, `lean-shapes.test.ts`, `contact-sheet.test.ts` A–V, property oracle "certificate port fields always agree with the geometric port oracle" (`layout-rubric.test.ts`) | Broad fixed-position/feedback/container port mutation is deliberately skipped; final certifying repair remains load-bearing |
| 4 | Certifying route simplifier | **done** | §6 of `route-contracts.md`; MFA regression suite, blocked-lane regression ("a blocker node ... is named in the certificate"), `directLaneBlockers` unit battery on both axes, determinism test | — |
| 5 | Gantt pure semantic resolver | **done** | `src/gantt/schedule.ts` resolves schedules without renderer/DOM/wall-clock dependency; `UNRESOLVABLE_SCHEDULE` closes verify-ok/render-throws seams; `analyzeMermaid` exposes critical path/slack; Gantt parser/scheduler/layout/agent tests pin behavior | Deeper upstream parser/DB suite harvest remains BUILD-20; new PR #54 seed bench is only a ratchet. |
| 6 | ASCII/Unicode first-class | **partial** | ASCII longest-path layering + widest-segment labels (§3 principle 5); exact goldens (`goldens:ascii:check`); ASCII mutation lane; converter now seeds edges with shared `classifyRoutes()` `routeClass` metadata and the grid consumes `primary-forward` for placement parity | ASCII still does not emit graph `RouteCertificate` objects; parity is an explicit mapping contract, not SVG certificate reuse. |
| 7 | Class/ER semantic layout contracts | **partial, now certified for accepted invariant** | Compartment-aware sizing exists (`src/class/layout.ts` CLS compartments, `src/er/layout.ts` attribute rows); QUAL-1 adapters project real geometry; debug layouts emit `family-layout` / `orthogonal-box` relationship certificates; verify covers on-canvas, non-overlap, endpoint-on-box tripwires; `route-contracts.md` documents why graph-route adoption would discard row/compartment semantics or require stale re-clipping | Generic graph route classification/straightening/port ranking remains intentionally deferred until evidence shows it improves class/ER without losing family semantics. |
| 8 | Text measurement contract | **done (V1)** | `TEXT_MEASUREMENT_CONTRACT`, `measureText`, and `measureTextWidth` are exported; CJK/fullwidth/emoji/ambiguous-width cases are pinned in `text-metrics.test.ts`; route/layout/render paths use the shared contract | Browser-font exactness remains intentionally approximate/deterministic rather than platform-dependent. |
| 9 | Security action records | **partial, V1 implemented** | `DiagramActionRecord` / `DiagramAnalysis` plus `analyzeMermaid(Source)` expose source-only href/call/callback records; unsafe schemes (`javascript:`, `data:`, `vbscript:`) are classified unsafe; debug `layoutMermaid` aligns actions to `node:<id>` regions; tests in `agent-analysis.test.ts` and `agent-region-tree.test.ts` | SVG/PNG/ASCII still do not share a single richer interactive action renderer model; V1 sidecars are source-only and non-executing. |
| 10 | Stable region tree | **partial, V1 shipped** | `RenderedLayoutGroup.parentId`, SVG `data-region`/`data-parent-id`, ASCII best-effort region metadata, and debug layout JSON `regions`/source-only `actions` sidecars are pinned in `agent-region-tree.test.ts`; source maps now cover more family elements | Not the full `RegionKind` tree yet (compartments/attributes/legend item regions remain richer follow-ups). |
| 11 | Family-specific validators | **done, broadened** | Six `ROUTE_*` Tier-2 tripwires + `DECISION_BRANCH_UNLABELED`; class/ER rendered-layout geometry tripwires; Gantt schedule/geometric tripwires; sequence/timeline verify now carries real layout geometry; QUAL-1 family adapter tests include sequence/timeline; debug `FamilyEdgeRouteCertificate` and `RegionContainmentCertificate` values cover sequence/timeline/chart layouts | Richer semantic certificates beyond containment/anchor checks can be proposed as follow-ups, but the deferred no-schema gap is closed. |
| 12 | Reproducible visual evidence | **done** | contact sheet (`bun run contact:sheet` + `contact-sheet.test.ts` snapshot pins), `eval/layout-compare` (corpus 0 regressions recorded in §11.7), `bun run rubric:visual` HTML galleries | — |
| 13 | Source-preservation ladder | **done as contract, partial by family** | Formal L0–L4 ladder in `docs/design/system/source-preservation-ladder.md`, doc-sync test ensures every built-in family is listed; `editPolicy` in `am capabilities`, opaque fallbacks, source maps, wrappers, and region/action sidecars tie implementation to the ladder | Some families remain below full L4 by design; richer source spans/regions are follow-ups, not a missing contract. |
| 14 | Analysis outputs | **done for requested facts** | `analyzeMermaid` / `analyzeMermaidSource` / `collectActionRecords` expose deterministic feedback edges, Gantt schedule summary, and action records without mutating source/render output; tests in `agent-analysis.test.ts` | Additional family-specific facts can be added incrementally. |

**Definition-of-done check**: documented model ✓; primary/feedback
classification ✓; MFA hitch fixed via certified invariant (not blind cleanup)
✓; ASCII consumes route classes ✗ (explicitly mapped as out of scope, but the
issue's DoD wording allows "explicitly map them to grid route policies" —
the longest-path-layering/label-policy mapping is documented in §3, so this
is arguably satisfied-by-mapping; flagged for the issue owner to adjudicate);
≥3 non-hitch workstreams represented ✓ (WS3, WS11, WS12); no-renderer-guessing
policy documented ✓.

---

## (b) HEURISTICS INVENTORY

Every explicit/implicit layout heuristic on this branch. "Doc" = where
documented; "Test" = where directly tested. Flags note anything lacking either.

| # | Heuristic | Doc | Test | Flag |
|---|---|---|---|---|
| 1 | **Edge classification** (author-order cycle closing = feedback; self-loop; container; cross-hierarchy) | `route-contracts.md` §5 | `route-contracts.test.ts` `classifyRoutes` block | — |
| 2 | **Proof-free simplifier** (duplicate + collinear point removal, fixed-point incl. zero-net spikes) | §6, §6.3 | `simplifyPolyline` block; "no edge contains consecutive duplicate points" | — |
| 3 | **Proof-carrying straightener** (candidate lanes, span/node/pill/channel/crossing blockers, label capacity, fixed-point) | §6 | MFA suite, blocked-lane, `directLaneBlockers` both axes, `findLabelSlot`, properties; mutation harvest (170 killed, `docs/mutation-testing.md`) | — |
| 4 | **Vertex emit** (single-line diamond side uses the exact vertex) | §6.2 rule 1 | "port ranking — sharp bits win..." block; contact sheet A–D | — |
| 5 | **Facet spread** (multi-line side spreads; vertex capacity 1) | §6.2 rule 2, §6.2.1 | "two lines out of one diamond side spread on the facet"; contact sheet E–F; source-diamond-fan-out never aligns (§6.2.2 proof) | — |
| 6 | **Fan-in merge** (same-target edges converge collinearly at the shared port; merge outranks hook) | §6.1, §6.2 rule 1.ii | MFA "F→G merges into G at its exact W port"; contact sheet A–D, L–P, T–V; `lean-shapes.test.ts`; NEW: `&`-declared fan-in (`route-contracts-syntax-range.test.ts`) | — |
| 7 | **1-bend hook** (blocked vertex emit hooks into facing cross-side port; `HOOK_STUB_MIN = 8`) | §6.2 rule 1.ii | "a blocked vertex emit hooks into the target's facing cross-side port" | — |
| 8 | **Port-seeking Z** (explained-detour with off-port entry seeks an equal-bend port-exact Z) | §6.2.2 closing paragraph | "the side input converges at the same port" assertions in the alignment `it.each` (LR/RL/TD/BT) | — |
| 9 | **Reciprocal pairs** (two EQUAL parallel lines at `center ± PAIR_SEPARATION/2`; upgradeable successes re-proved) | §6.2 rule 5 | "unlabeled reciprocal pairs straighten into two parallel lanes"; "bi-directional pairs render as TWO EQUAL parallel lines"; RL/BT block; contact sheet G/H/S | — |
| 10 | **Port-lane alignment** (`alignPortLanes`) + gates (lane clear, bent sibling edges, swept-corridor proof, no group members) + freezes (aligned endpoints frozen) + proofs | §6.2.2 | alignment `it.each` over 4 directions; "includes diamonds"; "feedback out-edge does not veto"; contact sheet K/Q; `lean-shapes.test.ts` PORT_EXACT promotion; property oracles | — |
| 11 | **Outer feedback** (`elk.layered.feedbackEdges`) + **loop tightening** (cut the forward-side excursion via the channel-facing port) | §6 "Feedback routing" | "labeled feedback routes around through the outer channel"; "feedback retry edges certify as outer-channel"; "TD cycle" channel-lane test; loop exits exact S vertex / enters S midpoint tests; contact sheet R | — |
| 12 | **Bundling contract** (trunk proved clear of non-endpoint nodes; blocked member falls out; junction re-derived) | §6 "Bundle contract" | "bundle contract — trunks never pass through nodes" block; NEW: unlabeled `&` fan-out certifies `bundle` from the vertex port | — |
| 13 | **Occlusion-safe layer alignment** (`alignLayerNodes` refuses snaps onto routed corridors) | §6.3 | `heuristic-coverage.test.ts` isolates the refusal branch with a foreign edge corridor that would be occluded by a snap, plus a control where the snap fires | — |
| 14 | **Through-node Z-repair** (occlusion removal outranks never-increase-crossings) | §6.3 | rubric `edgeThroughNode` gates + "repairs never increase edge crossings" block (the converse rule) | — |
| 15 | **Never-increase-crossings rule** | §6 | "a back-lane that would cut through a fan-out trunk stays a certified loop" | — |
| 16 | **On-lane label slots** (midpoint → 1/3 → 2/3; labels only ON their own route) | §6 | `findLabelSlot` unit block; `labelOffRoute` hard metric | — |
| 17 | **Container repair** (border-to-border under SEPARATE hierarchy) | §6 "Container repair", §11.5 | container blocks incl. axis-selection harvest + perimeter tolerance | reversed-order gaps noted as open in `docs/mutation-testing.md` |
| 18 | **Cross-hierarchy orthogonalizer** (`orthogonalizeEdgePoints`, SEPARATE-mode only) | §2 claims table | `heuristic-coverage.test.ts` directly rewrites a bare diagonal into axis-aligned elbows and asserts the identity short-circuit for already-orthogonal paths; subgraph-direction integration keeps `diagonalSegments = 0` | — |
| 19 | **Residual diagonal orthogonalization** (45° feedback joins → axis-aligned elbow) | §6.3 | indirect via `diagonalSegments = 0` properties (this is the counterexample fix itself) | acceptable: property-pinned |
| 20 | **ELK crash degradation ladder** (`layoutGraphSync` retries plainer option sets, `layout-engine.ts:1959–1998`) | §6.3 | `heuristic-coverage.test.ts` pins issue #34's 3-node/9-edge dense cyclic multigraph: tier-0 ELK throws `Invalid hitboxes for scanline constraint calculation`, tier 1 (`feedbackEdges=false`) succeeds, and `layoutGraphSync` returns finite geometry | — |
| 21 | **ASCII longest-path layering** + **widest-segment label choice** + FIFO tie-breaking | §3 principle 5 | ASCII goldens + `ascii-fanout-trunk-labeled.test.ts`, `ascii-pathfinder-units.test.ts`, ASCII mutation lane | — |
| 22 | **ROUTE_\* tripwires** (six zero-noise post-certification validators) | §7 | tripwire + boundary-harvest blocks; "validation never mutates the layout" | — |
| 23 | **PORT_EXACT catalog / slanted family ports** (slant midpoints, flag point) | §6.2.2 | `lean-shapes.test.ts`; contact sheet T–V | — |
| 24 | **Dynamic port allocator** (physical side + ordered side slot + semantic endpoint role; exact `AnyPort` remains additive) | §6.2.5 | route-contract certificate tests for fan-out slot order and feedback flipped roles; `layoutMermaid(d, { debug: true })` exposure | — |

Summary: 24/24 heuristics now have both documentation and direct tests. The
last historical gap, degradation ladder #20, is pinned by issue #34's
crash→fallback fixture rather than broad crash-freedom stress tests alone.

---

## (c) Diagram-type matrix: who inherits which heuristics

`applyRouteContracts` is called from exactly one place: `layoutGraphSync`
(`src/layout-engine.ts`). Inheritance is therefore decided by who calls
`layoutGraphSync`:

| Family | Layout path | Inherits route contracts / ports / rubric heuristics? | Evidence |
|---|---|---|---|
| flowchart | `parseMermaid` → `layoutGraphSync` | **yes — everything** (#1–20, 22–24) | `src/index.ts`, `src/agent/index.ts`, `src/agent/verify.ts` |
| state | `stateBodyToGraph` → `layoutGraphSync` | **yes — everything**; pseudostates are PORT_EXACT port-only shapes | `src/agent/index.ts`, `src/agent/verify.ts`; contact sheet Q |
| architecture | own placement → graph placement helper + final side-anchored rerouting | **family certificate** — debug layouts expose final-geometry `side-anchored` endpoint certificates, not stale graph certs | `src/architecture/layout.ts`; `src/__tests__/agent-family-layouts.test.ts` pins architecture family certs |
| class | own ELK engine | **family certificate only** — `elkLayoutSync` direct; no graph route classes/straightening, but debug `orthogonal-box` certs exist | `src/class/layout.ts`; `src/__tests__/agent-family-layouts.test.ts` |
| ER | own ELK engine | **family certificate only** — same class of `orthogonal-box` debug certs; no graph route classes/straightening | `src/er/layout.ts`; `src/__tests__/agent-family-layouts.test.ts` |
| sequence | own engine (lifelines) | no graph heuristics by design; real layout geometry now feeds quality and verify | `src/sequence/*`, `src/agent/family-layouts.ts` |
| timeline / journey / xychart / pie / quadrant / gantt | own engines | no graph heuristics; real family layout adapters feed quality/verify; Gantt adds schedule/geometric tripwires and schedule analysis | `src/agent/family-layouts.ts` |
| ASCII (all graph families) | separate grid pathfinder | **separate stack with shared route intent**: converter seeds `classifyRoutes()` route classes; grid placement consumes `primary-forward`; terminal routing still emits ASCII warnings rather than SVG route certificates | `src/ascii/*`; `docs/mutation-testing.md` ASCII lane |

The `route-contracts.md` §6.1/§10 claim that class/ER inherit graph route
contracts via `layoutGraphSync` was **false** and has been corrected. The
current accepted adoption is family-specific (`orthogonal-box` certs and
geometry tripwires). A future graph-route adoption for class/ER would require
projecting relation graphs through the contract pass or porting `shapePorts`
to entity boxes (issue #26 WS7).

---

## (d) Mermaid flowchart syntax-range check

Against <https://mermaid.ai/open-source/syntax/flowchart.html> (and the syntax
reference index). "Heuristic interaction tested" = the construct provably
flows through classification/straightening/ports with assertions.

### Shapes (bracket forms)

| Syntax | Shape | Parser | Heuristic interaction tested |
|---|---|---|---|
| `[x]` `(x)` `([x])` `[[x]]` `[(x)]` `((x))` `{x}` `{{x}}` `(((x)))` | rect/rounded/stadium/subroutine/cylinder/circle/diamond/hexagon/doublecircle | ✓ (`NODE_PATTERNS`, `src/parser.ts:433`) | ✓ rubric simple battery (chains + reciprocal per shape × 4 directions), property oracles' 13-wrapper pool, contact sheet L–P |
| `[/x/]` `[\x\]` (parallelograms) | lean-r / lean-l | ✓ (fixed on this branch) | ✓ `lean-shapes.test.ts`, contact sheet T |
| `[/x\]` `[\x/]` (trapezoids) | trapezoid / -alt | ✓ | ✓ `lean-shapes.test.ts`, contact sheet U |
| `>x]` (asymmetric) | asymmetric | ✓ | ✓ contact sheet V, rubric chains |
| `A@{ shape: ... }` (v11.3+ generalized) | — | ✗ unsupported | n/a — record as explicit non-goal or follow-up |
| markdown strings ``"`**bold**`"`` | — | ✗ unsupported | n/a |

### Edge types

| Syntax | Parser | Heuristic interaction tested |
|---|---|---|
| `-->` `---` | ✓ | ✓ everywhere |
| `-.->` `-.-` (dotted) | ✓ | **was untested in route contracts** → NOW ✓ (`route-contracts-syntax-range.test.ts`: dotted chains straighten, dotted labeled feedback classifies feedback, style preserved) |
| `==>` `===` (thick) | ✓ | **was untested** → NOW ✓ (thick chains straighten + certify) |
| `<-->` `<-.->` `<==>` (bidirectional) | ✓ (single edge, `hasArrowStart`) | **was untested** → NOW ✓: one primary-forward edge (NOT a reciprocal pair), straightens port-to-port, both arrowheads survive; bidi + explicit reverse forms a true reciprocal pair |
| `o--o` `x--x` `--o` `--x` (circle/cross markers) | ✓ (`startMarker`/`endMarker`) | **was untested** → NOW ✓: markers are decoration, edges straighten/certify like solid |
| `~~~` (invisible link) | ✗ — **silently drops the edge AND the target node** (`graph LR\nA ~~~ B` parses to one node, zero edges) | n/a. **KNOWN GAP (parser bug class):** silent drop violates the "error loudly" doctrine. Not fixed here (engine change out of audit scope) |
| Length variants `--->` | accidental ✓ (matches the unescaped-dot `-.->` alternative, falls through to solid — correct visual) | covered implicitly; fragile |
| Length variants `---->`, `-..->`, `====>` | ✗ — **misparse**: `A ----> B` creates a phantom node `-` with edge `A->-` and drops `B`; `-..->`/`====>` silently drop the edge | n/a. **KNOWN GAP (parser bug):** recorded, not fixed (engine code). Deserves its own issue |

### Edge labels

Both syntaxes (`-->|text|` and `-- text -->`, incl. `-. text .->`/`== text ==>`)
parse to identical graphs (verified) — NOW pinned by the layout-equivalence
test ("`-->|go|` and `-- go -->` produce byte-identical layouts"; dotted
labeled feedback certifies identically to solid). Label heuristics themselves:
`findLabelSlot` unit battery + `labelOffRoute` hard metric.

### Subgraphs + direction overrides

`subgraph id[Label]`, nesting, `direction TB/LR/BT/RL` inside subgraphs: ✓
parser (`src/parser.ts:119–158`); heuristics tested via container-edge
classification tests, container repair tests, `subgraph-direction.test.ts`,
rubric complicated set (nested direction overrides fixture). Mermaid's own
documented limitation (external link → inherited direction) is *solved* here
and pinned (CHANGELOG, mermaid-js#2509 reference).

### Multi-edge chains

`A --> B & C`, `A & B --> C`, `A --> B --> C`: ✓ parser (Cartesian product,
`parseEdgeLine`). Parser-level tests existed (`parser.test.ts` Batch 2.6);
heuristic interaction **was untested** → NOW ✓: `&` fan-out lays out
byte-identically to the expanded form; `&` fan-in merges at the shared entry
port; unlabeled `&` diamond fan-out certifies `bundle` with a vertex-port
trunk (facet spread is a labeled-branch behavior — `&` cannot express
per-branch labels, documented in the test).

### Untested-but-supported syntax remaining (post-audit)

- `linkStyle` / `classDef` / `class` / `:::` interaction with layout: parsed
  and rendered (styles tests) — they cannot affect geometry, so no heuristic
  interaction exists to test. OK.
- `click`/`href`: out of flowchart-layout scope (WS9; renderer-security
  tests exist).
- Self-loop `A --> A` with non-rect shapes: classification tested; per-shape
  self-loop geometry relies on the rubric battery's self-loop pattern only
  for the shape pool it samples. Minor.

---

## (e) testing-best-practices conformance

Against `adewale/testing-best-practices` (SKILL.md modes, antipatterns,
property/mutation/golden guidance):

| Practice | Status | Evidence | Missing |
|---|---|---|---|
| **Red-first** | ✓ claimed and plausible | `route-contracts.md` §9 "written failing against the pre-change renderer"; `lean-shapes.test.ts` header "Red-first TDD battery"; MFA fixture is the original failing case | Red-first is asserted in docs, not mechanically provable post-hoc; acceptable |
| **Property-based oracles** | ✓ strong | fast-check in `layout-rubric.test.ts` (4 oracles × 120 runs: outline, port truthfulness, zero hitches, hard metrics) and `route-contracts.test.ts` properties (certificates exist, no hitch survives, straightened endpoints on boundary, determinism); `property-*.test.ts` family (crash-freedom, ascii routing, svg wellformedness, …). Oracles found 7+ real bugs (documented §6.3) | New syntax-range constructs (bidi, `&`, dotted/thick ops) are not yet in the property generators' vocabulary — the `randomFlowchart` arbitrary emits only `-->`/`-- go -->`. Worth a follow-up generator extension |
| **Goldens** | ✓ | exact ASCII/Unicode goldens + `goldens:ascii:check`; contact-sheet geometry snapshots as a deliberate-re-pin visual gate; SVG via `eval/layout-compare` regressions-first | — |
| **Mutation testing** | ✓ with a documented debt | `stryker.routes.config.json` / `bun run mutation-test:routes`; `docs/mutation-testing.md`: route-lane score **54.31% at 0b43c90 (2659 mutants, 1444 killed)** after the module grew ~3×; five survivor-harvest passes killed 170; survivors classified (equivalent/perf-guard/bounded-iteration) per policy | Re-run pending after the slanted-family batch; survivor harvest named "the next quality batch". The new syntax-range tests should kill marker/style passthrough mutants — include them in the next run |
| **Sabotage/tripwires** | ✓ | six ROUTE_* tripwires with tests that corrupt post-certification geometry and assert firing; "disabling the direct-lane proof reintroduces a failing test" (§11.3); mutation policy requires sabotage-verifying new tests | Degradation ladder (#20) has no sabotage coverage |
| **Determinism** | ✓ | byte-identical repeated layouts (route-contracts + property), `agent-determinism.test.ts`, `agent-png-determinism.test.ts`, ASCII FIFO ties, deterministic label sort tie-breaks (CHANGELOG) | — |
| **Anti-patterns check** | mostly clean | assertions are concrete (exact ports, exact points, named blockers), no logging-instead-of-asserting observed in audited files | Known flaky: 'advertised CLI verbs' timeout (pre-existing); `~~~`/long-arrow silent drops violate the repo's own "error loudly" doctrine at the parser layer |

---

## Known gaps recorded by this audit

> **Update (follow-up commits): gaps 1–4 resolved.** The first four were
> addressed directly after the audit; their resolutions are noted inline.

1. **Class/ER route-contract adoption** (WS7): own ELK engines bypass the
   entire heuristic stack; doc overclaim corrected.
   **RESOLVED as a deliberate, evidence-backed boundary** — measured that
   ELK ORTHOGONAL already yields zero diagonals and zero duplicate points
   for class/ER relationship edges (up to 11 cross-linked relationships),
   so the straightener would be a no-op. Pinned by
   `src/__tests__/class-er-edge-quality.test.ts`; full adoption stays an
   optional future enhancement gated on that guard ever failing.
2. **Parser: `~~~` invisible links** silently drop edge + node; **`---->`**
   creates a phantom `-` node and drops the real target; **`-..->`/`====>`**
   silently drop.
   **RESOLVED**: variable-length and invisible links now parse, render,
   and round-trip (new `'invisible'` EdgeStyle + `MermaidEdge.length`),
   pinned by `src/__tests__/link-grammar.test.ts`.
3. **Degradation ladder untested** (heuristic #20): no fixture pins the ELK
   crash → plainer-options retry → route-pass repair path.
   **RESOLVED**: `src/__tests__/heuristic-coverage.test.ts` now pins issue
   #34's deterministic 3-node/9-edge cyclic multigraph: tier 0 throws
   `Invalid hitboxes for scanline constraint calculation`, tier 1
   (`elk.layered.feedbackEdges=false`) succeeds, and public
   `layoutGraphSync` returns finite geometry.
4. **Occlusion-safe `alignLayerNodes` and `orthogonalizeEdgePoints`** have
   only indirect (rubric-metric) coverage; neither is in a mutation lane.
   **RESOLVED (direct tests)**: `src/__tests__/heuristic-coverage.test.ts`
   unit-tests both (control-vs-guard for the occlusion check; diagonal→elbow
   for the orthogonalizer). Mutation-lane coverage still pending.
5. **Property generators** don't sample the wider edge-syntax vocabulary
   (bidi/dotted/thick/markers/`&`).
6. **Route-lane mutation score** at 50.69% (1381/2740 at 526d9cf; was 54.31% at 0b43c90 before the slanted-family batch grew the denominator); survivor
   harvest is the declared next batch.
