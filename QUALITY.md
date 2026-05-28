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
