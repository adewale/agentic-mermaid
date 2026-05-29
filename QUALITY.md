# What "good looking" means in agentic-mermaid

A diagram is considered **good looking** when it satisfies, in order:

1. **All Tier 1 structural checks pass.** No `EMPTY_DIAGRAM`, no
   `EDGE_MISANCHORED`, no `OFF_CANVAS`, no `GROUP_BREACH`, no
   `UNKNOWN_SHAPE`, no `LABEL_OVERFLOW` (default cap: 40 chars).
   This is non-negotiable — fix the source before judging visuals.

2. **Tier 2 geometric checks are within bounds.** `NODE_OVERLAP` count
   and `ROUTE_SELF_CROSS` count are advisory but not catastrophic. A
   diagram with a single intentional overlap (e.g., a self-loop) is
   still considered good.

3. **Perceptual metrics fall in the default `QualityBounds` band:**

   | metric | meaning | default |
   |---|---|---|
   | `edgeCrossings` | pairs of edge segments that visually intersect | ≤ 5% of edge pairs |
   | `labelLegibility` | fraction of node labels whose rendered length fits the node width | ≥ 85% |
   | `whitespaceBalance` | node area ÷ canvas area | 5%–55% (too sparse AND too dense lose) |
   | `labelEdgeProximity` | min pixel distance between any edge-label and a non-attached node | ≥ 4 px |
   | `aspectRatio` | canvas w/h | 0.2–5.0 |

   These are computed by `measureQuality(layout)` and gated by
   `checkQuality(layout)`. They are **deterministic** and cheap — they
   run on every PR.

4. **LLM-as-judge median ≥ 4.0** on a stratified sample of the
   mermaid-docs corpus (5 diagrams × 9 families = 45 samples) across
   three axes:
   - **Readability** — labels legible, arrows clear, no overlap chaos
   - **Faithfulness** — every node and edge from the source is present
   - **Aesthetics** — balanced layout, professional feel

   This is **periodic**, not per-PR (model spend + nondeterminism). It
   gates nightly eval runs and pre-release sign-off. See
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
  any PR. The LLM judge runs once a night.
- **Honest gaps** — `whitespaceBalance` band is rough; aspect-ratio is
  a sanity check, not an aesthetic. We do not claim our metrics match
  a human designer's eye — they catch the worst regressions.

## What we do NOT claim

- **No pixel comparison.** We render SVGs but don't compare them to a
  golden image. Mermaid-js itself uses an external service (Applitools)
  for visual regression; we don't ship reference images. If a glyph
  changes width by one pixel, our perceptual metrics may move slightly,
  but the bands have headroom.
- **No font-substitution check.** Different OSes render different
  default fonts. Our `labelLegibility` heuristic uses a 7 px-per-char
  approximation; under condensed fonts it under-estimates fit.
- **No color contrast.** We don't yet check WCAG contrast on
  label-on-fill pairs. Tracked as future work.

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

What the guard does NOT yet cover:
- **Cross-runtime parity** (bun ≡ node on the SAME fixture). We have
  this for SVG layout (`src/__tests__/agent-determinism.test.ts`
  spawns `node` on `dist/agent.js` and compares). Not yet for ASCII —
  deferred to Loop 8 per `ROADMAP.md`.
- **Cross-architecture parity** (x86_64 vs ARM). Same as SVG: needs
  hardware we don't have.
- **Input-order independence.** The current 10-run-same-input test
  does not stress edge-insertion order. A Set whose iteration order
  depends on insertion order would pass this test and fail a different
  one. Loop 8 candidate.

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
  spawns Node on `dist/agent.js`, compares SHA-256. **As of Loop 8: this
  test passes.** bun ≡ node on the same x86_64 machine.

What's NOT tested (honest gaps):
- **Cross-architecture (x86_64 vs ARM64).** Resvg's tiny-skia
  intentionally avoids system float libraries to make this *theoretically*
  deterministic, but we don't have ARM hardware to verify.
- **Resvg version drift.** A future bump of `@resvg/resvg-js` may
  change PNG bytes (zlib compression, font hinting). The version is
  pinned exact (no caret) to prevent silent drift on `npm install`,
  but a deliberate bump needs re-baseline.
- **Different system fonts.** Bundled DejaVu is what we render with;
  consumers post-processing the output font-substituted SVGs will get
  different pixels. By design.
