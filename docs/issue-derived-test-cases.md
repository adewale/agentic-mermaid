# Issue-derived test-case candidates

These are public Mermaid / Beautiful Mermaid issues worth turning into small, educational fixtures. The goal is not to clone every upstream bug; it is to keep representative examples that teach the renderer/agent surface what users actually expect.

## Already covered or newly covered

- [mermaid-js/mermaid#5227 — Backwards arrows](https://github.com/mermaid-js/mermaid/issues/5227)
  - Why it matters: feedback edges are common in auth/retry flows and should not scramble the primary left-to-right path.
  - Current coverage: `src/__tests__/agent-auth-flow.test.ts` builds an auth flow through Agentic Mermaid mutations and asserts `C→B` / `F→E` route backwards while the primary LR path stays source-ordered.
- [mermaid-js/mermaid#7645 — block loading of external images](https://github.com/mermaid-js/mermaid/issues/7645)
  - Why it matters: agent-generated diagrams are untrusted input.
  - Current coverage: strict SVG/security tests assert external-fetch references are removed.
- [mermaid-js/mermaid#7695 — Trusted Types / CSP](https://github.com/mermaid-js/mermaid/issues/7695)
  - Why it matters: generated SVG/HTML must be embeddable in locked-down apps.
  - Current coverage: browser CSP/Trusted Types e2e exercises enforcement and strict render paths.
- [mermaid-js/mermaid#5632 — screen-reader/accessibility support](https://github.com/mermaid-js/mermaid/issues/5632)
  - Why it matters: diagrams need non-visual summaries for users and agents.
  - Current coverage: `am describe` / `describeMermaid(...,{format:'json'})` expose an AX-style tree and docs sync tests guard the surface.
- [lukilabs/beautiful-mermaid#119 — CJK label alignment](https://github.com/lukilabs/beautiful-mermaid/issues/119)
  - Why it matters: ASCII renderers often break on fullwidth text.
  - Current coverage: CJK width tests and ASCII rendering tests.
- [lukilabs/beautiful-mermaid#115 — text contrast on custom fills](https://github.com/lukilabs/beautiful-mermaid/issues/115)
  - Why it matters: themeable diagrams must remain readable.
  - Current coverage: auto-contrast and theme/renderer contrast tests.
- [lukilabs/beautiful-mermaid#111/#112 — ASCII fan-out trunks and box-start connectors](https://github.com/lukilabs/beautiful-mermaid/issues/111)
  - Why it matters: sibling fan-outs should share a readable trunk and edge labels should stay on branches rather than forcing detours or floating connectors.
  - Current coverage: `src/__tests__/ascii-pathfinder-trunk.test.ts` covers TD/LR labeled fan-out repros and bidirectional-label separation; `src/__tests__/ascii-box-start.test.ts` covers source-border connectors; ASCII determinism tests guard repeated routing stability; golden files pin exact ASCII/Unicode output.
- [lukilabs/beautiful-mermaid#69 — fan-in grouping](https://github.com/lukilabs/beautiful-mermaid/pull/69)
  - Why it matters: unrelated fan-in groups should not cross into ambiguous shared trunks.
  - Current coverage: `src/__tests__/ascii-fan-in-grouping.test.ts` covers target-aware grouping and cycle guards.
- [lukilabs/beautiful-mermaid#98 — nested-subgraph layout with direction](https://github.com/lukilabs/beautiful-mermaid/pull/98)
  - Why it matters: subgraph direction overrides and container edges should not create phantom nodes or move children outside groups.
  - Current coverage: `src/__tests__/subgraph-direction.test.ts` covers SVG geometry, ASCII one-row inner LR layout, subgraph-id edge attachment, 7-bit ASCII mode, nested child subgraph targets, styled/labeled container edges, and multi-edge containers; golden files pin exact ASCII/Unicode output.
- [lukilabs/beautiful-mermaid#121 — ER/class ASCII label truncation and stray connectors](https://github.com/lukilabs/beautiful-mermaid/issues/121)
  - Why it matters: ER/class ASCII labels and compartment text are semantic content, not decoration; long labels must not silently disappear when connectors are tight.
  - Current coverage: exact ASCII/Unicode golden files cover class compartments/relationship labels and ER relationship labels. ER same-row layout now widens the inter-entity gap to preserve full labels.

## High-value future fixtures

- [mermaid-js/mermaid#6271 — unexpected graph direction](https://github.com/mermaid-js/mermaid/issues/6271)
  - Suggested fixture: a graph whose author order implies a clear primary direction but whose cross/back edges tempt the layout engine to flip ranks. Assert source-order progression and bounded aspect ratio.
- [mermaid-js/mermaid#7785 — collapsible subgraphs via `@{ view: collapsed }`](https://github.com/mermaid-js/mermaid/pull/7785)
  - Suggested fixture: parse/render normal nested subgraphs today; when collapse metadata appears, either model it explicitly or preserve source as opaque. Never silently drop the `@{ ... }` meaning.
- [Mermaid v11.3+ `@{ shape: ... }` typed node metadata](https://mermaid.js.org/syntax/flowchart.html) — **safety floor fixed as BUILD-23 / [#29](https://github.com/adewale/beautiful-mermaid/issues/29); full typed-shape vocabulary remains #44**
  - Why it matters: this syntax carries the ISO 5807/ANSI X3.5 flowchart symbol vocabulary (manual input, document, delay, preparation, …); Mermaid's docs use it extensively, so agent-generated sources will contain it.
  - Current behavior (June 2026): the three issue #29 repro classes are pinned by `src/__tests__/flowchart-metadata.test.ts`; they no longer silently drop targets/edges or fabricate `shape`/`label` phantom nodes. Unsupported forms preserve source opaquely; supported label metadata renders as a conservative rectangle fallback.
  - Future fixtures: #44 should model the full Mermaid v11 typed-shape vocabulary without weakening the no-silent-loss safety floor.
- [Mermaid frontmatter `config.layout`/`config.look`](https://mermaid.js.org/intro/syntax-reference.html) — **wrapper-fidelity gaps found by probing the official examples, fixed as BUILD-21**
  - Why it mattered: round-tripping a diagram through the editor flattened `config:`-nested frontmatter to top-level keys Mermaid ignores (silently killing the author's layout/look request on interop), duplicated `%%{init}%%` directives into synthesized frontmatter, and dropped leading comments.
  - Current coverage: `src/__tests__/agent-wrapper-fidelity.test.ts` pins byte-verbatim wrapper round-trip (frontmatter, directives incl. multiline, leading comments, combined), mutation wrapper preservation, canonical-mode config nesting + directive folding, and the `COMMENT_DROPPED` lint matrix.

## Fork-network layout search notes

A May 2026 GitHub issue/PR search found recurring layout-quality themes in both Mermaid and Beautiful Mermaid:

- [mermaid-js/mermaid#6049 — Flowchart ugly self linking nodes](https://github.com/mermaid-js/mermaid/issues/6049)
  - Fixture status: `src/__tests__/aesthetic-issue-regressions.test.ts` renders a flowchart self-loop and asserts the loop has no hard geometric defects; `src/__tests__/layout-quality-heuristics.test.ts` keeps the broader self-loop clearance guard.
- [mermaid-js/mermaid#5060 — Avoidable overlapping curves in flow-chart](https://github.com/mermaid-js/mermaid/issues/5060)
  - Fixture status: `src/__tests__/aesthetic-issue-regressions.test.ts` renders repeated parallel labeled edges and asserts distinct edge paths, zero crossings, no hard defects, and separated label boxes.
- [mermaid-js/mermaid#6046 — subgraph links should affect positioning more than inter-graph links](https://github.com/mermaid-js/mermaid/issues/6046)
  - Fixture idea: nested subgraphs with invisible/loose links. Assert group order follows source intent and cross-group edges do not dominate internal layout.
- [mermaid-js/mermaid#7492 — C4 overlapping labels/text overflow/crossing arrows](https://github.com/mermaid-js/mermaid/issues/7492)
  - Fixture idea: labels near containers. Assert text stays inside boxes and edge labels keep minimum clearance from unrelated nodes.
- [mermaid-js/mermaid#2792 — graph lines sometimes overlap boxes](https://github.com/mermaid-js/mermaid/issues/2792)
  - Fixture status: `src/__tests__/aesthetic-issue-regressions.test.ts` renders a transitive route and asserts the ugly-detector reports no edge-through-node defect.
- [lukilabs/beautiful-mermaid#83 — TD/TB flowchart layout flipping horizontal](https://github.com/lukilabs/beautiful-mermaid/issues/83)
  - Fixture idea: vertical process with repeated feedback edges. Assert TD/TB diagrams remain height-dominant or within a bounded aspect ratio.
- [lukilabs/beautiful-mermaid#68 — fan-in groups not target-aware](https://github.com/lukilabs/beautiful-mermaid/issues/68)
  - Fixture idea: multiple roots feeding separate targets. Assert roots cluster by target and unrelated routes do not share misleading trunks.
- [lukilabs/beautiful-mermaid#63 — misleading edge overlap in routing](https://github.com/lukilabs/beautiful-mermaid/pull/63)
  - Fixture idea: two fan-in edges followed by two fan-out edges. Assert an outgoing branch does not visually reuse an unrelated incoming corridor.
- [lukilabs/beautiful-mermaid#89 — CJK subgraph title layout drift](https://github.com/lukilabs/beautiful-mermaid/issues/89)
  - Fixture idea: fullwidth group labels. Assert group header bounds account for CJK width.
- [lukilabs/beautiful-mermaid#121 — ER/class ASCII labels truncated/overlapping](https://github.com/lukilabs/beautiful-mermaid/issues/121)
  - Fixture status: representative class/ER golden files now assert labels survive and connectors remain attached; keep this theme in the generated matrix for longer label/attribute variants.

## Aesthetic-issue coverage audit (issue-keyed)

A June 2026 audit turned the 13 layout-aesthetic complaints in
[`mermaid-layout-complaints.md`](./mermaid-layout-complaints.md) into an
explicit coverage ledger. Direct issue-keyed fixtures now guard the complaints
that can be expressed against supported diagram families; broader existing
assertions are tagged where they already covered the behavior; unsupported,
deferred, and policy-out-of-scope cases remain recorded below.

- **Issue-keyed regression fixtures** —
  [`src/__tests__/aesthetic-issue-regressions.test.ts`](../src/__tests__/aesthetic-issue-regressions.test.ts)
  renders a small repro graph per complaint and asserts, through the real
  renderer, that Agentic Mermaid does not exhibit it: `#6476` (avoidable edge
  crossings → 0 on a planar bipartite graph), `#5601` (planar state diagram
  stays planar), `#5060` (parallel labeled edges use distinct rendered paths,
  keep labels separate, and produce no geometric defects),
  `#2792` (transitive edge does not pass through an intervening node, via the
  ugly-detector `edge-through-node` check), `#2131` (edge labels keep
  clearance from unrelated nodes and from each other), and `#6336`/`#6049`
  (state and flowchart self-loops render without hard defects).
- **Tagged existing assertions** (now greppable by issue number): `#815`
  (declared node/source order — `agent-auth-flow.test.ts`,
  `layout-quality-heuristics.test.ts`), `#1984`/`#3262` (scale-collapse
  whitespace + aspect — `agent-quality.test.ts`), `#1301` (long-range Gantt
  axis labels stay clear of task bars — `gantt-layout.test.ts`), and `#1765` (activation/note/block
  clearance — `sequence-layout.test.ts`).
- **`#7492` (C4 overlapping labels/arrows)** — no fixture yet: the C4 family
  is not rendered. Tracked under **BUILD-6** (new upstream families); add the
  fixture when C4 lands.
- **`#3723` (same-rank constraint) and `#5420` (manual node positioning)** —
  documented **won't-do by policy**, no fixture. `#3723` is "watch-only"
  (adopt only if Mermaid core standardizes a `config:` key — see C6); `#5420`
  is out of scope (the agent loop is the substitute — see C1). Neither is a
  bug we can regression-guard, because not implementing them is the decision.

These guards assert "Agentic Mermaid does not exhibit the complaint," not
"the upstream Mermaid bug is fixed" — every cited issue is a defect in
mermaid-js's own dagre renderer, which this fork does not share (see
[`mermaid-layout-complaints.md`](./mermaid-layout-complaints.md) R4).

## Programmatic bad-layout heuristics

Current useful heuristics:

- `verifyMermaid` warnings: `OFF_CANVAS`, `GROUP_BREACH`, `NODE_OVERLAP`, `ROUTE_SELF_CROSS`, `LABEL_OVERFLOW`, `DUPLICATE_EDGE`, `UNREACHABLE_NODE`;
- `measureQuality(layoutMermaid(d))` / `checkQuality(...)`: edge crossings, label legibility, whitespace balance, label-edge proximity, and aspect ratio;
- issue-keyed fixtures that gate selected repro diagrams individually, including zero crossings and label-vs-label box separation for parallel edge labels;
- family-specific geometry assertions, such as Auth Flow's source-order progression and backward feedback-edge routing;
- layout-quality heuristic tests for declared-direction progress (`TD`/`BT`/`LR`/`RL`), edge-vs-node collisions excluding attached endpoints, feedback-process cleanliness, root node vs top-level subgraph source order, and self-loop clearance;
- PNG/SVG screenshot comparison for artifacts that layout JSON cannot see, such as rounded-fill raster artifacts.

High-value next heuristics for layout-improvement corpora:

- promote edge-label bounding-box overlap with unrelated labels/nodes/edges from fixture-local checks into a shared metric;
- route corridor reuse by unrelated edge families;
- target-aware fan-in/fan-out clustering score;
- group-header text fit, especially with CJK/fullwidth labels.

Convention-derived validator candidates (from the ANSI X3.5/ISO 5807
drafting conventions catalogued in
[`mermaid-layout-complaints.md`](./mermaid-layout-complaints.md) R3 —
practitioner guides consistently name these as the top flowchart mistakes):

- **unlabeled decision branches**: a diamond node with two or more outgoing
  edges where any edge lacks a label — cheap Tier 3 lint candidate
  (`DECISION_BRANCH_UNLABELED`); complements issue #25 §8.2 diamond port
  semantics;
- **entry/exit shape**: flowcharts conventionally have one start (a single
  in-degree-0 node) and clearly marked endpoints (at least one sink) —
  fits issue #26 workstream 14 as an analysis fact alongside the existing
  graph entry/feedback-edge outputs, not as a hard error.

These can drive a generated fixture matrix: vary direction, feedback-edge density, self-loops, parallel edges, label length, CJK labels, nested subgraphs, fan-in/fan-out shape, and styling. Each generated case should assert semantic preservation first, then one or more layout heuristics. Screenshot tests should be reserved for cases where the visual artifact is genuinely pixel/raster-level.

## Test-design rules for issue fixtures

- Prefer smallest meaningful source examples over screenshots alone.
- Assert semantics first: labels, edges, groups, source-preserved metadata.
- Add screenshot/SVG regression only when geometry/visual polish is the bug.
- For unsupported Mermaid syntax, assert opaque/source-preserved fallback rather than lossy normalization.
- For security issues, assert both removal of dangerous refs and preservation of safe SVG output.
