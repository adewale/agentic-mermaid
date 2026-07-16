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
| 4 | Cohen-Or hue-harmony templates | prototype | does preference gain justify the ΔE trade-off? |
| 5 | Purchase-normalized crosslessness `m_c` | prototype | does normalization discriminate across graph sizes? |
| 6 | Consistent flow-direction metric | prototype | does it catch anything ELK does not already guarantee? |
| 7 | Whole-canvas composition | prototype | which Ngo terms correlate with preference on our diagrams? |
| 8 | Crossing-angle / RAC penalty | prototype | incremental value after crossing count |
| 9 | Spine-straightness continuity | prototype | incremental value after {5,8} |
| 11 | Proximity / MST purity | prototype | incremental value after common-region and composition metrics |
| 13 | Information-theoretic order | prototype | is a pinned gzip ratio more than a coarse alignment proxy? |

## What the first implementation taught us

The audit changed the plan in seven ways.

1. **Runtime is part of correctness.** A deterministic pairwise repair still
   fails the product if an allowed 1,000-slice input takes seconds. The ΔE
   guarantee is therefore bounded at 24 and the large-count path is linear.
   Every prototype must declare an input-size budget and a degraded-tail rule.

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

## Shipped color contract

The color work is a generation constraint, not evidence that the quality
rubric predicts human preference.

| Property | 7–24 fills | More than 24 fills |
|---|---|---|
| deterministic | hard | hard |
| valid concrete hex output | hard | hard |
| WCAG ≥ 1.25 and APCA ≥ 15 vs concrete background | hard | hard |
| unique fills | hard | best-effort |
| minimum pairwise ΔE_OK ≥ 0.10 | hard | not claimed |
| asymptotic repair cost | bounded finite packing | linear in fill count |

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
   before/after renders and snapshot review in every affected family.
7. **Gate determinism and cost.** Preserve byte identity and record p50/p95
   runtime over a fixed corpus. Idea #13 must also pin codec and level.

## Evaluation and graduation

For a candidate metric M, record:

- **coverage** — fraction of diagrams on which M varies;
- **discrimination** — LCC/SROCC against a small blinded human A/B set;
- **independence** — partial correlation after controlling for current metrics;
- **stability** — sensitivity to harmless translation, scale, and equivalent
  source ordering where those transforms should not matter;
- **cost** — p50/p95 time and growth at the declared size boundary;
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
- **{1,2,3,4}:** harmony is an optional preference layer over that contract,
  not a replacement for distance or visibility; report a Pareto front.
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
| Foundation | **Keep {1,2,3,10}; reject #12** | shipped contract | The audit now gives color a bounded domain and gives ownership purity the right semantic reach; the extra label warning is redundant. | keep the regression matrix green; do not reopen #12 without an independent public signal |
| 1 | **Controlled {1,2,3} family rollout** | combination | Highest immediate user-visible value now that the shared color waist has hard distance, visibility, and runtime contracts. | migrate one family at a time; theme matrix, goldens, and visual review must pass before the next family |
| 2 | **#5 normalized crosslessness `m_c`** | individual | Small, report-only, scale-comparable, and the best cheap proof that the metric evaluation protocol discriminates. | varies on the corpus and adds signal beyond raw crossings |
| 3 | **#8 → {5,8} crossing-quality bundle** | combination | Adds crossing severity to crossing prevalence with modest cost and a clear ablation. | keep #8 only if preference signal survives control for #5 |
| 4 | **#6 → {5,6,8} directional-legibility bundle** | combination | Direction is cheap, but probably restates ELK behavior; combining it is worthwhile only after an independent trip case exists. | #6 must fire where {5,8} and current ELK guards do not |
| 5 | **#4 → {1,2,3,4} color-harmony bundle** | combination | Harmony may improve preference, but it is subordinate to categorical distance and background visibility. | Pareto gain in blinded preference without breaking the shipped color floors |
| 6 | **#7 whole-canvas composition** | individual | Could detect figure-level imbalance missed by graph-local metrics, but calibration and transform-stability work are substantial. | calibrated terms have nonzero coverage and stable translation/scale behavior |
| 7 | **#11 → {7,10,11} multiscale-grouping bundle** | combination | Figure balance, semantic ownership, and proximity cover three scales; the value is plausible but redundancy risk is high. | ablation retains only terms with independent preference signal |
| 8 | **#9 → {5,8,9} edge-path bundle** | combination | Spine continuity is costlier and likely overlaps the crossing pair, so it belongs behind that evidence. | #9 survives partial-correlation control for {5,8} |
| 9 | **#13 pinned-gzip order** | individual | It is codec-sensitive, coarse, and less interpretable than direct alignment and density features. | beats simpler features under a pinned codec and level |

This supersedes the earlier ordering. Before the audit fixes, palette migration
sat behind #5 because the shared waist had false guarantees and unbounded work.
Those blockers are now removed, so the controlled {1,2,3} rollout is first.
Metric research still starts with #5, and every later bundle is conditional on
an ablation rather than presumed additive value. Harmony remains below the
cheap layout measurements because its benefit is subjective while its
distinctness and visibility costs are concrete.

## Scope boundaries

- This plan covers measurement and closed-form generation, not optimization.
- Flowchart/state subgraph purity remains in `layout-rubric.ts`; the generic
  #10 implementation covers ownership frames projected by architecture, class,
  ER, and timeline.
- `LABEL_OVERFLOW` remains the public label-length signal. It applies the
  caller-configurable cap to the longest rendered line after entity decoding,
  line-break normalization, and formatting-tag removal. A second fixed CPL
  warning would be redundant and less reachable.
- The shared perceptual palette currently reaches pie and radar. Xychart,
  journey, mindmap, and gitgraph migration is deliberately separate because it
  changes family snapshots and aesthetic policy.
- A score of 100 proves only that a renderer clears the measured hygiene floor;
  it does not certify beauty. Each family still needs an aesthetic thesis and
  human visual review.
