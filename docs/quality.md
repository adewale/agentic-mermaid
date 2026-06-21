# What "good looking" means in Agentic Mermaid

A diagram is considered **good looking** when it satisfies, in order:

1. **All Tier 1 structural checks pass.** No `EMPTY_DIAGRAM`, no
   `EDGE_MISANCHORED`, no `OFF_CANVAS`, no `GROUP_BREACH`, no
   `UNKNOWN_SHAPE`, no `LABEL_OVERFLOW` (default cap: 40 chars).
   This is non-negotiable — fix the source before judging visuals.

2. **Tier 2 geometric checks are within bounds.** `NODE_OVERLAP` count
   and `ROUTE_SELF_CROSS` count are advisory but not catastrophic. A
   diagram with a single intentional overlap (e.g., a self-loop) is
   still considered good. The `ROUTE_*` codes (`ROUTE_HITCH`,
   `ROUTE_UNEXPLAINED_BEND`, `ROUTE_LABEL_ON_SHARED_TRUNK`,
   `ROUTE_CONTAINER_MISANCHOR`, `ROUTE_SHAPE_MISANCHOR`,
   `ROUTE_STALE_AFTER_NODE_MOVE`) should always be zero — they are
   route-contract tripwires (see `docs/design/system/route-contracts.md`), and
   any hit means the layout pipeline regressed, not the diagram.

3. **Perceptual metrics fall in the default `QualityBounds` band:**

   | metric | meaning | default |
   |---|---|---|
   | `edgeCrossings` | pairs of edge segments that visually intersect | ≤ 5% of edge pairs |
   | `labelLegibility` | fraction of node labels whose rendered length fits the node width | ≥ 85% |
   | `whitespaceBalance` | node area ÷ canvas area | 5%–55% (too sparse AND too dense lose) |
   | `labelEdgeProximity` | min pixel distance between any edge-label box and a non-attached node, another edge-label box, or another edge path | ≥ 4 px |
   | `aspectRatio` | canvas w/h | 0.2–5.0 |

   These are computed by `measureQuality(layout)` and gated by
   `checkQuality(layout)`. They are **deterministic** and cheap — they
   run on every PR.

4. **LLM-as-judge median ≥ 4.0** on a stratified sample of the
   mermaid-docs corpus (5 diagrams × 12 families = 60 samples) across
   three axes. Since QUAL-1 the perceptual metrics cover every renderable
   family (flowchart, state, sequence, timeline, class, ER, journey,
   architecture, xychart, pie, quadrant, gantt), so judge sampling should now
   include all twelve — not just the graph families — across:
   - **Readability** — labels legible, arrows clear, no overlap chaos
   - **Faithfulness** — every node and edge from the source is present
   - **Aesthetics** — balanced layout, professional feel

   This is **periodic**, not per-PR (model spend + nondeterminism). It
   supports pre-release sign-off when explicitly run. See
   `eval/llm-judge/judge.ts`.

## The rubric (used by both the LLM judge and the perceptual checker)

```
Rate the rendered Mermaid diagram on three axes, 1 (poor) to 5 (excellent).

1. Readability — Are all labels legible? Do labels overlap nodes or
   edges? Are edges easy to follow? Are arrows pointing the right way?

2. Faithfulness — Does the rendered diagram represent every node and
   edge in the source? Any silently dropped content?

3. Aesthetics — Is the layout balanced? Are nodes evenly spaced?
   Are crossings minimized? Is the overall feel professional?

Output strict JSON: { "readability": N, "faithfulness": N, "aesthetics": N, "notes": ["..."] }
```

## Why a definition matters

Without one, "looks good" is a vibes-check, and vibes drift. The
combination above gives:

- **Verifiability** — every claim has a number behind it.
- **Repeatability** — the metrics are deterministic; layouts don't
  change between runs (ELK + the verified cross-runtime/cross-process
  determinism we already prove).
- **Tractability** — the Tier 1 + perceptual checks run in seconds on
  any PR. The LLM judge is reserved for explicit pre-release or periodic
  evaluation runs.
- **Honest gaps** — `whitespaceBalance` band is rough; aspect-ratio is
  a sanity check, not an aesthetic. We do not claim our metrics match
  a human designer's eye — they catch the worst regressions.

## Why the same Mermaid can look worse here than in Mermaid

Agentic Mermaid is not Mermaid's renderer. It parses Mermaid source and
renders through this project's own layout/style stack: ELK layered layout,
source-order preservation, conservative node/diamond sizing, and the
Agentic Mermaid theme system. Mermaid's default flowchart renderer uses
its own Dagre/ELK configuration, text wrapping, spacing, and CSS. The same
source can therefore have different rank choices, edge routes, node sizes,
and aspect ratio.

The Auth Flow regression is the concrete example. Mermaid can choose a more
compact-looking rendering for the feedback loops; Agentic Mermaid now
prioritizes semantic LR source order (`A → B → C → ... → H`) and routes
`No` loops backward. That preserves author intent and avoids the earlier
misordered layout, but it also makes the diagram wider. `verify.ok` still
only means structurally valid; visual quality needs layout metrics,
geometry assertions, screenshot/PNG review, or human inspection.

## What we do NOT claim

- **No universal Mermaid visual parity.** We aim for faithful, deterministic,
  agent-verifiable output, not pixel/layout equivalence with Mermaid's own
  renderer. When parity matters, compare rendered artifacts and add a
  geometry/screenshot regression for that source.
- **No pixel comparison for the whole corpus.** We render SVGs but don't compare
  every corpus sample to a golden image. Mermaid-js itself uses an external
  service (Applitools) for visual regression; we don't ship reference images.
  If a glyph changes width by one pixel, our perceptual metrics may move
  slightly, but the bands have headroom.
- **Perceptual metrics cover every renderable family (QUAL-1).** `layoutMermaid`
  now has `RenderedLayout` adapters for ALL renderable families, so
  `measureQuality` / `checkQuality` and the comparison harness see real geometry
  (not bytes-only) for each. The adapters parse `d.canonicalSource` via the
  legacy per-family parser + layouter — the same geometry the SVG renderer draws
  — so an opaque-but-renderable body is still measured; an invalid opaque body
  degrades to an empty layout instead of throwing. What `nodes` / `edges` /
  `groups` mean per family:

  | Family        | nodes                              | edges        | groups               |
  |---------------|------------------------------------|--------------|----------------------|
  | flowchart     | graph nodes (ELK)                  | graph edges  | subgraphs            |
  | state         | states (projected to a graph)      | transitions  | composites           |
  | sequence      | actor boxes                        | messages     | —                    |
  | timeline      | period + event boxes               | —            | —                    |
  | class         | class boxes                        | relations    | —                    |
  | er            | entity boxes                       | relations    | —                    |
  | journey       | task boxes                         | —            | section frames       |
  | architecture  | services + junctions               | edges        | groups (flattened)   |
  | xychart       | bars + line-point markers          | —            | plot area            |
  | pie           | slice label boxes (legend anchor + approx bbox) | — | —                    |
  | quadrant      | plotted points                     | —            | quadrant regions     |
  | gantt         | task bars + milestone diamonds     | —            | section bands        |

  Families with no structural relations (pie/quadrant/xychart/journey/gantt) carry an
  honestly-empty `edges` array. Bounds is the family layout's canvas size.
- **No font-substitution check.** Different OSes render different
  default fonts. Our `labelLegibility` heuristic uses a 7 px-per-char
  approximation; under condensed fonts it under-estimates fit.
- **No quality-metric color-contrast score.** Runtime auto-contrast exists
  for custom fills, but `measureQuality` does not include a separate WCAG
  contrast metric. Promote to `TODO.md` only if it becomes release-gating.

## ASCII determinism

Loop 7 added an ASCII determinism guard at
`src/__tests__/ascii-determinism.test.ts`. It hashes the output of
`renderMermaidASCII()` over 10 invocations on three multi-edge fixtures
and asserts a single SHA-256 across all 30 runs per fixture. The probe
that motivated it (per the Loop 7 plan: "probe FIRST, then act") found
the existing code already byte-identical across 10 runs — the test
lands as a regression guard, not a behavior change.

What the guard catches:
- Any future introduction of `Math.random()` / `Date.now()` /
  `performance.now()` into an ASCII rendering or pathfinder code path
  (set size > 1 → fail).
- Set / Map iteration-order surprises if a code path adopts a hash key
  whose ordering changes between Bun and Node.

What the guard covers now:
- **Representative pathfinder fixtures** over 10 invocations.
- **Full 271-entry mermaid-js docs corpus**: every entry must have a stable
  ASCII outcome (byte hash or deterministic error) across repeated runs.

What the guard does NOT yet cover:
- **Cross-architecture byte equality** (x86_64 output hash compared directly
  to ARM64 output hash from a recorded manifest).
- **Input-order independence.** The current same-input tests do not
  stress edge-insertion order. If this becomes release-gating, add a focused
  property/differential test rather than treating corpus determinism as proof.

## PNG determinism

Loop 8 added PNG export via `@resvg/resvg-js` (pinned exact `2.6.2`,
napi-rs native build). The rasterizer choice was hardened by the Loop 8
critic pass:

- `loadSystemFonts: false` is mandatory — fontconfig differs between
  OSes and CI images, so system fonts would collapse cross-runtime
  parity.
- Bundled `assets/fonts/DejaVuSans.ttf` + `-Bold.ttf` ship with the
  package. `defaultFontFamily: 'DejaVu Sans'` so resvg has a known
  font for every text node.
- SVG input passes `embedFontImport: false` so resvg doesn't fetch
  Google Fonts at rasterization time. CSS variable `--font` still
  declares family preference for browser consumers.

What's tested:
- `agent-png.test.ts` (6 tests) — PNG magic bytes, scale proportionality,
  ValidDiagram input, background variation.
- `agent-png-determinism.test.ts` (3 tests) — 5x same-input SHA-256
  stability with a warm-up render to factor out napi init differences.
  Plus length-stable defence against partial-buffer truncation
  masquerading as a hash collision.
- `agent-determinism.test.ts` "cross-runtime PNG" — renders in bun,
  spawns Node on `dist/agent.js`, compares SHA-256 when Node and built `dist/`
  artifacts are present. In bare `bun test` environments it skips rather than
  pretending cross-runtime evidence exists. In the full local verification loop
  after `bun run build`, bun ≡ node on same-machine x86_64 and ARM64 hosts
  where those runtimes and native resvg are installed.

What's NOT tested (honest gaps):
- **Cross-architecture byte equality (x86_64 hash compared to ARM64 hash).**
  The guard verifies Bun ≡ Node on the current machine/architecture, not that
  two different CPU architectures emit identical PNG bytes to each other.
- **Resvg version drift.** A future bump of `@resvg/resvg-js` may
  change PNG bytes (zlib compression, font hinting). The version is
  pinned exact (no caret) to prevent silent drift on `npm install`,
  but a deliberate bump needs re-baseline.
- **Different system fonts.** Bundled DejaVu is what we render with;
  consumers post-processing the output font-substituted SVGs will get
  different pixels. By design.
