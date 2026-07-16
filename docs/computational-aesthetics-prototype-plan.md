# Computational-aesthetics prototype plan

This is the revised plan for cheap, deterministic computational aesthetics in
Agentic Mermaid. It covers pure functions over geometry and concrete sRGB. It
does not turn a rubric into an optimizer, add learned scores, or introduce
stochastic search.

The governing rule is stricter than “the formula is deterministic”:

> An aesthetic mechanism is ready only when its domain, runtime, product
> reachability, and evidence are all explicit.

Agentic Mermaid already operationalizes graph-layout research in
`src/layout-rubric.ts` and `src/family-rubric.ts`. The work below extends that
discipline to categorical color and whole-canvas composition without pretending
that one scalar score certifies beauty.

## Status

- **shipped** — implemented on a product path with discriminating tests.
- **prototype** — report-only until the evaluation harness justifies a weight.
- **rejected** — considered, but redundant or insufficiently specified.

| # | Idea | Status | Contract / next question |
|---|---|---|---|
| 1 | OKLCH constant-lightness categorical ramps | **shipped** | deterministic concrete-sRGB generation |
| 2 | Minimum ΔE_OK collision floor | **shipped** | hard for 7–24 fills; best-effort and linear-time above 24 |
| 3 | APCA plus WCAG background-visibility floors | **shipped** | every derived fill clears both for valid concrete backgrounds |
| 10 | Common-region ownership purity | **shipped** | architecture, class, ER, and timeline ownership frames |
| 12 | Separate typographic CPL warning | **rejected** | duplicates public universal `LABEL_OVERFLOW`; no independent signal |
| 4 | Cohen-Or hue-harmony templates | **rejected as a default** | 4/360 cases retain {1,2,3}; experiment remains reproducible |
| 5 | Purchase-normalized crosslessness `m_c` | prototype | does normalization discriminate across graph sizes? |
| 6 | Consistent flow-direction metric | prototype | does it catch anything ELK does not already guarantee? |
| 7 | Whole-canvas composition | prototype | which Ngo terms correlate with preference on our diagrams? |
| 8 | Crossing-angle / RAC penalty | prototype | incremental value after crossing count |
| 9 | Spine-straightness continuity | prototype | incremental value after {5,8} |
| 11 | Proximity / MST purity | prototype | incremental value after common-region and composition metrics |
| 13 | Information-theoretic order | prototype | is a pinned gzip ratio more than a coarse alignment proxy? |

## What the first implementation taught us

The audit and controlled rollout changed the plan in twelve ways.

1. **Runtime is part of correctness.** A deterministic pairwise repair still
   fails the product if an allowed 1,000-slice input takes seconds. The ΔE
   guarantee is therefore bounded at 24 and the large-count path has expected
   linear work. Portable CI asserts the real branch and its operation counts;
   wall-clock observations live in `eval/palette-performance/report.json` with
   their machine, protocol, input hashes, and limitations. Every prototype must
   declare an input-size budget and a degraded-tail rule.

2. **A threshold needs a corpus, not one friendly example.** The 0.10 ΔE claim
   initially failed on shipped themes and custom accent/background pairs. The
   contract now runs across every built-in theme, every count from 7 through
   24, and adversarial saturated backgrounds. Future thresholds need the same
   domain matrix before they can be called guarantees.

3. **Use the perceptual quantity that controls the decision.** HSL lightness
   misclassified a bright saturated yellow-green background as dark. Palette
   polarity now uses OKLab lightness, and visibility repair searches both
   lightness directions before falling back to a visible achromatic extreme.

4. **A shared waist multiplies risk as well as value.** `pieSliceColors` already
   reaches pie and radar, so one defect reaches both. Migrating four more
   families remains valuable, but only after the waist has an explicit range,
   a hard runtime bound, adversarial tests, and per-family visual review.

5. **Reachability precedes novelty.** A test-only finding is not a product
   capability. The proposed `LABEL_LINE_OVERLONG` finding was not surfaced by
   verify, CLI, API, or MCP and overlapped the existing public
   `LABEL_OVERFLOW` warning. It is removed rather than wired twice.

6. **Independence applies before implementation too.** A new metric must state
   which existing defect it detects that current metrics miss. Idea #12 fails
   that test. Ideas {7,11} and {5,8,9} must pass it through ablation.

7. **Semantic scope must follow every real model.** Common-region purity is not
   architecture-only: class namespaces, ER groups, and timeline sections also
   express ownership. Ancestor walks must be cycle-safe without arbitrary
   depth cutoffs.

8. **Visual evidence needs its own reproducibility contract.** The rollout now
   freezes pre-change SVGs, extracts the categorical colors actually serialized
   by each renderer, writes a machine-readable comparison, and hashes every
   source input plus the generated report/contact sheet. `--check` fails when
   code, baseline, metrics, or images drift.

9. **A controlled rollout is a compatibility policy, not a global recolor.**
   Counts up to six retain each family's existing derived colors byte-for-byte
   (including Journey's established actor wheel). Authored
   `plotColorPalette`, `actorColours`, `sectionFills`/`sectionColours`, and
   `git0..7` remain authoritative. Only derived high-cardinality peer-category
   colors change.

10. **Harmony and categorical distinctness compete at this density.** Across
    20 built-in themes × counts 7..24, the Cohen-Or/Matsuda experiment reduced
    mean harmony loss from 8.8303° to 0.0084°, but reduced mean minimum ΔE_OK
    from 0.1107 to 0.0456. Only 4/360 palettes retained {1,2,3}; no count above
    seven passed. That rejects #4 as a default layer over this palette.

11. **A measurement must not claim more than it measures.** The performance
    corpus measures one palette-generation call, not a complete diagram render.
    Most controlled families have one peer-category channel; Journey has two
    independent channels (sections and actors). Following the
    [testing-best-practices guidance](https://github.com/adewale/testing-best-practices/tree/e50479920006aa010850a2c37f9bee1e02b5badf),
    CI gates deterministic complexity and evidence freshness, never a portable
    millisecond threshold.

12. **Normalize at the algorithm boundary without erasing compatibility.**
    StyleSpec accepts concrete `#RGB`, named, `rgb()`, and `hsl()` colors, while
    the perceptual math requires six-digit sRGB. The high-count path now
    normalizes every parser-resolvable concrete color before repair. The ≤6
    path deliberately preserves each family's historical spelling or fallback
    policy byte-for-byte; a global normalizer at that boundary would be a
    compatibility regression disguised as cleanup.

## Shipped color contract and family reach

The color work is a generation constraint, not evidence that the quality
rubric predicts human preference. The neutral shared waist now reaches pie,
radar, xychart, journey, mindmap, and gitgraph. SVG and terminal xychart/gitgraph
use the same derived palette; the other terminal families do not currently
encode peer categories with color.

The scope rule for this rollout, and for any future shared-palette expansion,
is explicit:

> The scope is intentionally limited to families where color identifies peer
> categories. Semantic colors—status, hierarchy, role, or user-authored
> meaning—should not be automatically redistributed.

| Property | 7–24 fills | More than 24 fills |
|---|---|---|
| deterministic | hard | hard |
| valid concrete hex output | hard | hard |
| WCAG ≥ 1.25 and APCA ≥ 15 vs concrete background | hard | hard |
| unique fills | hard | best-effort |
| minimum pairwise ΔE_OK ≥ 0.10 | hard | not claimed |
| asymptotic repair cost | bounded `O(M·n²)`, with `n ≤ 24` and fixed corpus `M` | expected `O(n)` with average `O(1)` set membership |

The established local palette is preserved when it meets the contract. If it
does not, a deterministic farthest-point packing pass selects background-visible
concrete sRGB candidates. Above 24, pairwise enforcement is skipped.

## Prototype protocol

Reuse the existing evaluator; do not create a second quality system.

1. **Define the contract first.** State applicable families, input-size range,
   asymptotic and wall-clock budgets, degraded-tail behavior, and exclusions.
2. **Prove product reachability.** Identify the public result, warning, or
   report that exposes the metric. A private helper plus unit test is not done.
3. **Report before weighting.** Add the metric to the per-metric tracker with
   zero score weight. A weight is a separate scoring-contract change.
4. **Add trip fixtures.** Include healthy and deliberately bad examples that
   make the metric move. Zero on every committed fixture is a guard, not a
   demonstrated discriminator.
5. **Measure the full domain.** Use the Mermaid docs corpus, heuristic tracker,
   deterministic family fuzzers, all built-in themes where color is involved,
   and adversarial boundary inputs.
6. **Keep visual evidence.** Any generation or geometry change needs
   before/after renders and snapshot review in every affected family. The
   palette rollout operationalizes this rule in
   `scripts/pr-assets/palette-rollout-evidence.ts`.
7. **Gate determinism and cost.** Preserve byte identity and deterministically
   assert that the intended bounded algorithmic path engaged. Keep p50/p95
   observations over a fixed corpus in a separate, provenance-bound report;
   do not use cross-machine wall time as a CI threshold. Idea #13 must also pin
   codec and level.

## Evaluation and graduation

For a candidate metric M, record:

- **coverage** — fraction of diagrams on which M varies;
- **discrimination** — LCC/SROCC against a small blinded human A/B set;
- **independence** — partial correlation after controlling for current metrics;
- **stability** — sensitivity to harmless translation, scale, and equivalent
  source ordering where those transforms should not matter;
- **cost** — deterministic operation growth at the declared size boundary,
  plus environment-qualified p50/p95 observations where useful;
- **reach** — public surfaces and diagram families that consume the result.

Graduate a metric from report-only only when it fires on trip fixtures, varies
on the corpus, adds preference signal after current metrics, and stays inside
its cost budget. Otherwise remove it or retain it explicitly as a correctness
guard with no aesthetic weight.

For combinations, run small ablations rather than blending everything. Treat
each combination as a gated ladder: validate the cheaper base term, add one
term, and stop when independence disappears.

- **{1,2,3}:** lightness structure, categorical distance, and background
  visibility are complementary and already ship as one generation contract.
- **{1,2,3,4}:** the completed experiment found no useful Pareto front at
  8–24 categories: hue-sector contraction almost eliminates harmony loss but
  breaks minimum categorical distance. Do not ship this bundle as a default.
- **{5,8}:** crossing prevalence and crossing quality should be complementary.
- **{5,6,8}:** add direction only if #6 catches defects not explained by the
  crossing pair or by ELK's existing directional constraints.
- **{5,8,9}:** likely redundant; add #9 only if partial correlation survives.
- **{7,10,11}:** composition, common region, and proximity span figure,
  ownership, and local grouping scales, but need ablation because the signals
  can collapse onto the same cluster structure.

## Revised stack rank

The rank uses five axes: user-visible value, independence from existing
signals, product reach, bounded runtime, and validation burden. “Foundation” is
not optional feature work. An arrow means “validate the new idea alone, then
admit it to the combination”; it is not permission to ship an opaque aggregate.

| Rank | Work package | Form | Why it is here | Stop / go gate |
|---|---|---|---|---|
| Foundation | **Keep {1,2,3,10}; reject #12** | shipped contract | Color and ownership have bounded, reachable contracts; the extra label warning is redundant. | keep the regression matrix green |
| Delivered | **Controlled {1,2,3} family rollout** | shipped combination | 14/14 fixture violations corrected; 8/8 family/theme cases pass; ≤6 colors and authored overrides remain compatible; six rich website examples expose the peer mapping at inspectable size. | palette evidence, complexity, website, and family gates |
| Rejected | **#4 → {1,2,3,4} color-harmony default** | completed experiment | 4/360 pass rate; mean minimum ΔE_OK falls 0.1107 → 0.0456. | reconsider only with a new constraint-preserving algorithm and blinded preference evidence |
| Paused 1 | **#5 normalized crosslessness `m_c`** | telemetry, postponed | Still the cheapest next metric experiment, but telemetry work is intentionally deferred. | resume only on explicit telemetry restart |
| Paused 2 | **#8 → {5,8} crossing-quality bundle** | telemetry, postponed | Clear ablation after #5. | #8 must add signal after #5 |
| Paused 3 | **#6 → {5,6,8} directional-legibility bundle** | telemetry, postponed | Likely overlaps ELK behavior. | independent trip case first |
| Paused 4 | **#7 whole-canvas composition** | telemetry, postponed | Potential figure-level value, high calibration burden. | stable, nonzero corpus coverage |
| Paused 5 | **#11 → {7,10,11} multiscale grouping** | telemetry, postponed | Plausible value with high redundancy risk. | term-by-term ablation |
| Paused 6 | **#9 → {5,8,9} edge-path bundle** | telemetry, postponed | Costlier and likely redundant. | partial-correlation survival |
| Paused 7 | **#13 pinned-gzip order** | telemetry, postponed | Codec-sensitive and coarse. | beat simpler direct features |

This supersedes the earlier ordering. The highest-ranked product change is now
delivered and its evidence gate is permanent. The harmony experiment has also
resolved its decision: it is not merely lower priority; this formulation is a
bad default. With telemetry postponed, there is no authorized next aesthetic
metric package. If telemetry resumes, it still starts with #5 and every later
bundle remains conditional on ablation.

## Scope boundaries

- This plan covers measurement and closed-form generation, not optimization.
- Flowchart/state subgraph purity remains in `layout-rubric.ts`; the generic
  #10 implementation covers ownership frames projected by architecture, class,
  ER, and timeline.
- `LABEL_OVERFLOW` remains the public label-length signal. It applies the
  caller-configurable cap to the longest rendered line after entity decoding,
  line-break normalization, and formatting-tag removal. A second fixed CPL
  warning would be redundant and less reachable.
- The shared perceptual palette reaches only families where color denotes peer
  categories: pie slices, radar curves, xychart series, journey actors/sections,
  mindmap top-level branches, and gitgraph branches. Structural families use
  color for roles, status, hierarchy, or authored semantics; automatic hue
  spreading there would invent category meaning and can weaken brand/status
  cues. Timeline/gantt/quadrant have family-specific categorical contracts and
  are not silently swept into this rollout.
- A score of 100 proves only that a renderer clears the measured hygiene floor;
  it does not certify beauty. Each family still needs an aesthetic thesis and
  human visual review.
