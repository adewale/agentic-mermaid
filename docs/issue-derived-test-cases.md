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

## High-value future fixtures

- [mermaid-js/mermaid#6271 — unexpected graph direction](https://github.com/mermaid-js/mermaid/issues/6271)
  - Suggested fixture: a graph whose author order implies a clear primary direction but whose cross/back edges tempt the layout engine to flip ranks. Assert source-order progression and bounded aspect ratio.
- [mermaid-js/mermaid#7785 — collapsible subgraphs via `@{ view: collapsed }`](https://github.com/mermaid-js/mermaid/pull/7785)
  - Suggested fixture: parse/render normal nested subgraphs today; when collapse metadata appears, either model it explicitly or preserve source as opaque. Never silently drop the `@{ ... }` meaning.
- [lukilabs/beautiful-mermaid#69 — fan-in grouping](https://github.com/lukilabs/beautiful-mermaid/pull/69)
  - Suggested fixture: many roots flowing into one hub, plus a cycle variant. Assert no overlaps/off-canvas, deterministic layout JSON, and readable ASCII trunking.
- [lukilabs/beautiful-mermaid#121 — ER/class ASCII label truncation and stray connectors](https://github.com/lukilabs/beautiful-mermaid/issues/121)
  - Suggested fixture: ER relationship labels and class compartments with edge labels. Assert labels are present, connectors touch borders, and no orphan `├` appears.
- [lukilabs/beautiful-mermaid#112 — ASCII connector displaced by sibling edge labels](https://github.com/lukilabs/beautiful-mermaid/issues/112)
  - Suggested fixture: one source box with multiple outgoing edges, one labeled. Assert connector starts at the source border for every sibling edge.
- [lukilabs/beautiful-mermaid#98 — nested-subgraph layout with direction](https://github.com/lukilabs/beautiful-mermaid/pull/98)
  - Suggested fixture: nested subgraphs with explicit direction overrides and cross-boundary edges. Assert children remain inside groups and edges stay finite.

## Fork-network layout search notes

A May 2026 GitHub issue/PR search found recurring layout-quality themes in both Mermaid and Beautiful Mermaid:

- [mermaid-js/mermaid#6049 — Flowchart ugly self linking nodes](https://github.com/mermaid-js/mermaid/issues/6049)
  - Fixture idea: self-loop on a styled node. Assert the loop stays outside the node, has bounded route length, and does not obscure the label.
- [mermaid-js/mermaid#5060 — Avoidable overlapping curves in flow-chart](https://github.com/mermaid-js/mermaid/issues/5060)
  - Fixture idea: repeated parallel edges with long labels. Assert edge-label proximity and crossing/overlap counts stay below a threshold.
- [mermaid-js/mermaid#6046 — subgraph links should affect positioning more than inter-graph links](https://github.com/mermaid-js/mermaid/issues/6046)
  - Fixture idea: nested subgraphs with invisible/loose links. Assert group order follows source intent and cross-group edges do not dominate internal layout.
- [mermaid-js/mermaid#7492 — C4 overlapping labels/text overflow/crossing arrows](https://github.com/mermaid-js/mermaid/issues/7492)
  - Fixture idea: labels near containers. Assert text stays inside boxes and edge labels keep minimum clearance from unrelated nodes.
- [mermaid-js/mermaid#2792 — graph lines sometimes overlap boxes](https://github.com/mermaid-js/mermaid/issues/2792)
  - Fixture idea: route-vs-node collision. Assert no edge segment passes through unrelated node bounding boxes.
- [lukilabs/beautiful-mermaid#83 — TD/TB flowchart layout flipping horizontal](https://github.com/lukilabs/beautiful-mermaid/issues/83)
  - Fixture idea: vertical process with repeated feedback edges. Assert TD/TB diagrams remain height-dominant or within a bounded aspect ratio.
- [lukilabs/beautiful-mermaid#68 — fan-in groups not target-aware](https://github.com/lukilabs/beautiful-mermaid/issues/68)
  - Fixture idea: multiple roots feeding separate targets. Assert roots cluster by target and unrelated routes do not share misleading trunks.
- [lukilabs/beautiful-mermaid#63 — misleading edge overlap in routing](https://github.com/lukilabs/beautiful-mermaid/pull/63)
  - Fixture idea: two fan-in edges followed by two fan-out edges. Assert an outgoing branch does not visually reuse an unrelated incoming corridor.
- [lukilabs/beautiful-mermaid#89 — CJK subgraph title layout drift](https://github.com/lukilabs/beautiful-mermaid/issues/89)
  - Fixture idea: fullwidth group labels. Assert group header bounds account for CJK width.
- [lukilabs/beautiful-mermaid#121 — ER/class ASCII labels truncated/overlapping](https://github.com/lukilabs/beautiful-mermaid/issues/121)
  - Fixture idea: long ER/class labels and attributes. Assert labels survive and connectors remain attached.

## Programmatic bad-layout heuristics

Current useful heuristics:

- `verifyMermaid` warnings: `OFF_CANVAS`, `GROUP_BREACH`, `NODE_OVERLAP`, `ROUTE_SELF_CROSS`, `LABEL_OVERFLOW`, `DUPLICATE_EDGE`, `UNREACHABLE_NODE`;
- `measureQuality(layoutMermaid(d))` / `checkQuality(...)`: edge crossings, label legibility, whitespace balance, label-edge proximity, and aspect ratio;
- family-specific geometry assertions, such as Auth Flow's source-order progression and backward feedback-edge routing;
- layout-quality heuristic tests for declared-direction progress (`TD`/`BT`/`LR`/`RL`), edge-vs-node collisions excluding attached endpoints, feedback-process cleanliness, root node vs top-level subgraph source order, and self-loop clearance;
- PNG/SVG screenshot comparison for artifacts that layout JSON cannot see, such as rounded-fill raster artifacts.

High-value next heuristics for layout-improvement corpora:

- edge-label bounding-box overlap with unrelated nodes/edges;
- route corridor reuse by unrelated edge families;
- target-aware fan-in/fan-out clustering score;
- group-header text fit, especially with CJK/fullwidth labels.

These can drive a generated fixture matrix: vary direction, feedback-edge density, self-loops, parallel edges, label length, CJK labels, nested subgraphs, fan-in/fan-out shape, and styling. Each generated case should assert semantic preservation first, then one or more layout heuristics. Screenshot tests should be reserved for cases where the visual artifact is genuinely pixel/raster-level.

## Test-design rules for issue fixtures

- Prefer smallest meaningful source examples over screenshots alone.
- Assert semantics first: labels, edges, groups, source-preserved metadata.
- Add screenshot/SVG regression only when geometry/visual polish is the bug.
- For unsupported Mermaid syntax, assert opaque/source-preserved fallback rather than lossy normalization.
- For security issues, assert both removal of dangerous refs and preservation of safe SVG output.
