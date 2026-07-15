# Computational-aesthetics prototyping plan

A plan to prototype the cheap, determinism-safe computational-aesthetics ideas
for Agentic Mermaid, and to measure which **combinations** actually move
quality. It scopes only the closed-form, pure-function ideas (no learned
scores, no stochastic search, no rubric-as-objective — those were explicitly
deferred). Everything here computes from geometry or concrete sRGB the engine
already emits, so it preserves the "identical input → identical output"
contract.

The framing: Agentic Mermaid already does computational aesthetics for
*layout* (`src/layout-rubric.ts` and `src/family-rubric.ts` operationalize
Purchase 1997/2002, Tamassia, Kakoulis–Tollis, Ware 2002). This plan extends
the same rigor to **color** and **whole-canvas composition**, and closes small
gaps in the layout rubric.

## Status legend

- **shipped** — landed in this change, with red→green tests.
- **prototype** — to build behind a flag/metric and evaluate here.

## The ideas

| # | Idea | Home | Status | Primary signal it adds |
|---|------|------|--------|------------------------|
| 1 | OKLCH constant-lightness ramps | `src/shared/perceptual-color.ts`, `src/pie/palette.ts` | **shipped** | even perceived-lightness categorical fills |
| 2 | Minimum ΔE_OK collision floor | `perceptual-color.ts`, `pie/palette.ts` | **shipped** | no two fills read as the same color |
| 3 | APCA polarity-signed contrast floor | `perceptual-color.ts`, `pie/palette.ts` | **shipped** | wedges visible on dark themes (WCAG is polarity-blind) |
| 10 | Common-region purity (region intrusions) | `src/family-rubric.ts` | **shipped** | a foreign node reading inside a group frame |
| 12 | Typographic readability band (CPL) | `src/shared/readability.ts`, `label-wrap.ts`, `readability-audit.ts` | **shipped** | label lines past the comfortable reading measure |
| 4 | Cohen-Or hue-harmony templates | `perceptual-color.ts` + palette generators | prototype | two-color themes fit a harmonic template |
| 5 | Purchase-normalized crosslessness `m_c` | `src/layout-rubric.ts` | prototype | cross-graph-comparable [0,1] crossing score |
| 6 | Consistent flow-direction metric | `layout-rubric.ts` | prototype | fraction of edges respecting rank order |
| 7 | Whole-canvas composition (Ngo balance / equilibrium / symmetry / density / simplicity) | `family-rubric.ts` / `agent/quality.ts` | prototype | figure-level imbalance the graph metrics miss |
| 8 | Crossing-angle / RAC penalty | `layout-rubric.ts` | prototype | acute unavoidable crossings weighted worse |
| 9 | Spine-straightness continuity | `layout-rubric.ts` | prototype | turning angle along multi-edge paths |
| 11 | Proximity / MST-purity | `family-rubric.ts` | prototype | a node reading in the wrong cluster |
| 13 | Info-theoretic order (gzip-ratio) | new eval module | prototype | jitter/misalignment proxy (pin the codec) |

## Cost per idea

Effort: **S** = hours / <~100 LOC · **M** = a day or few. Determinism risk:
**none** (closed-form pure) · **manage** (pin a codec) — nothing here is
stochastic or learned.

| # | Effort | Determinism | Notes |
|---|--------|-------------|-------|
| 1 | S | none | shipped: OKLab/OKLCH conversion ≈50 LOC |
| 2 | S | none | shipped: ΔE_OK + a bounded deterministic separation pass |
| 3 | S | none | shipped: APCA ≈40 LOC of constants |
| 4 | M | none | template geometry + closed-form best-fit over the two seeds |
| 5 | S | none | `c_max` from the degree sequence, ~10 LOC |
| 6 | S | none | measured after layer assignment |
| 7 | M | none | pure bounding-box functions; weight as SOFT priors (validated on GUIs, can fight top-heavy hierarchies) |
| 8 | S | none | angle of each unavoidable crossing |
| 9 | M | none | co-linearity of a routed chain |
| 11 | M | none | Euclidean MST over node centres; boundary-crossing count |
| 13 | S | manage | deterministic only if compressor + level are pinned |
| 10 | S | none | shipped |
| 12 | S | none | shipped |

## Prototyping harness

Reuse what exists — do not build a new evaluator:

1. **Metric plumbing.** Add each prototype metric to the rubric it belongs to
   (`layout-rubric.ts` for ELK graph families, `family-rubric.ts` for the
   rest, `agent/quality.ts` for perceptual bands). Every metric is a pure
   function of the positioned geometry / resolved colors, tagged HARD or SOFT
   with an evidence/`chosen` provenance, exactly like the current entries.

2. **Corpus.** Score across `eval/heuristic-tracker` examples (all families)
   and the `eval/mermaid-docs-corpus`. The tracker's per-metric vector
   (`bun run track`) is the A/B instrument: it records each metric separately
   against `baseline.json`, so a prototype's effect is read as a per-metric
   delta, never collapsed into one number.

3. **Flag discipline.** A prototype metric is *reported* first (no score
   weight, no gate) so it never shifts the committed baseline while being
   evaluated. Only after it earns its place does it get a weight (a scoring
   contract change: regenerate the baseline and say so).

4. **Determinism gate.** Every prototype must pass the existing byte-identical
   checks. Idea #13 additionally pins its compressor + level.

5. **Visual evidence.** For color/geometry changes, render before/after via the
   existing PNG evidence generators (`scripts/pr-assets/*`) so the effect is
   inspectable, not just numeric.

## Measuring effectiveness (single idea)

For each prototype metric M:

- **Coverage** — how many corpus diagrams M flags (a metric that fires on
  nothing, or on everything, is not discriminating).
- **Discrimination** — build a small labeled set of good/bad renders (hand a
  panel a handful of A/B pairs). Report the rank correlation (LCC/SROCC — the
  NIMA *protocol*, not its weights) between M and human preference. This is
  also how the currently *asserted* SOFT thresholds get *calibrated*.
- **Independence** — M earns its place only if it catches defects the existing
  metrics miss. Compute the correlation of M against the current metric vector
  across the corpus; a metric highly correlated with an existing one is
  redundant (Mooney 2024: track the vector, drop redundant axes).
- **Cost** — wall-clock per diagram; all of these are O(n²) at worst over
  nodes/edges and cheap.

## Measuring COMBINATION effectiveness

The interesting question is not "is idea X good" but "which *set* of ideas,
weighted how, best predicts human preference without redundancy." Method:

1. **Group by surface.** Color = {1,2,3,4}. Composition = {7,11}. Layout-rubric
   = {5,6,8,9}. Order = {13}. Within a surface the ideas interact most.

2. **Ablation grid.** For each candidate subset S of a surface, compute the
   combined score vector on the corpus and its LCC/SROCC vs the labeled set.
   Start with the pairs the analysis calls out as natural partners:
   - **1 + 2** (OKLCH ramp + ΔE floor): the ramp spaces colors, the floor
     guarantees it — expected strongly complementary. *(shipped together; the
     ΔE floor test fails if the OKLCH ramp is reverted.)*
   - **1 + 2 + 3** (+ APCA): visibility on dark themes is orthogonal to
     inter-color distinctness — expected additive, low redundancy.
   - **1 + 4** (OKLCH + harmony templates): harmony constrains hue *placement*,
     OKLCH constrains lightness — expected complementary but with a tension
     (harmony may pull hues off the even spread; measure the ΔE cost).
   - **7 + 11** (Ngo composition + proximity purity): both whole-figure; check
     for redundancy (equilibrium may already capture some clustering).
   - **5 + 8 + 9** (crossings + crossing-angle + continuity): all edge-path
     aesthetics; expected partial redundancy — the ablation says how much.

3. **Redundancy filter.** For a subset, drop any metric whose partial
   correlation with human preference (controlling for the others) is ~0. Keep
   the minimal subset that retains the subset's full predictive power.

4. **Pareto view.** Where two metrics trade off (e.g. harmony vs even ΔE
   spread), report the front rather than a single blend, so a future preset can
   pick a point deliberately.

5. **Report.** A table per surface: subset → {coverage, LCC, SROCC, redundancy,
   wall-clock}, with the recommended minimal subset highlighted. That table is
   the deliverable that decides which prototypes graduate from *reported* to
   *weighted*.

## Expected outcomes / hypotheses

- Color {1,2,3} is the highest-value, lowest-redundancy combination and should
  graduate first (shipped). #4 (harmony) is additive but needs the ΔE-cost
  measurement before it earns a weight.
- Composition {7} catches figure-level imbalance no current metric sees, but
  its thresholds must be soft priors (GUI-validated origins) — expect it to
  need the most calibration.
- Layout-path {5,6,8,9} will show the most internal redundancy; the ablation
  likely keeps `m_c` (5) and one of {8,9}, not all four.

## Reassessment after shipping #1 / #2 / #3 / #10 / #12

Shipping the first batch (and putting it through a five-reviewer adversarial
audit) taught five things that change how the *remaining* ideas rank:

1. **The color "waist" is the highest-leverage insertion point — and it's an
   existing follow-up, not a new idea.** One change to `pieSliceColors` reached
   radar for free; the same change reaches xychart / journey / mindmap / gitgraph
   the moment they migrate off `getSeriesColor` (cross-family §4 item 4). That
   plain migration now **outranks idea #4 (harmony templates)** as the next color
   move: it propagates a shipped, tested improvement across four families for
   role-tag-level risk, whereas #4 adds a new, unproven constraint. Do the
   migration first; revisit #4 after.

2. **A generator guarantee is not a rubric score.** We made the palette
   *generator* enforce distinctness/visibility by construction, but the rubric
   still doesn't *score* a rendered diagram's palette (cross-family §6). This
   splits the remaining color/composition ideas cleanly: **#4 (harmony) is worth
   more as a generation constraint** (fit the two seeds to a harmonic template
   when deriving a palette) **than as a scored metric**, because the scored path
   needs the human-calibration harness (LCC/SROCC) we haven't built. Prototype #4
   as generation, measure its ΔE cost against the even spread we just shipped
   (they compete), and only score it once the calibration set exists.

3. **A SOFT metric that fires on no fixture has no measurable impact.** #10
   `regionIntrusions` is 0 on every committed fixture — a correctness guard, not
   a discriminator, and its "impact" is invisible in `bun run track`. That is the
   real cost for the **composition/proximity ideas #7 and #11**: a metric that
   never trips on the corpus can't be A/B-measured, so their prototype step must
   *ship trip-fixtures alongside the metric* (diagrams the metric is meant to
   catch) or they're untestable guards. This raises #7/#11's effort from "add the
   pure function" to "add the function **and** a discriminating corpus," and drops
   them below #5 on the cheap-and-provable ranking.

4. **The gamut is a hard ceiling; honest bounds are mandatory.** The ΔE floor is
   realistic-range, not absolute — the audit caught the overclaim. Every
   remaining metric with a threshold (#4 harmony energy, #7 Ngo bands, #8
   crossing-angle) will have a range where it degrades or saturates. Budget, up
   front, the honest-bound statement and the degraded-tail test that #2 needed;
   assume each idea hides one overclaim an audit will surface.

5. **Closed-form determinism held effortlessly** — OKLab/OKLCH/ΔE/APCA were
   byte-identical across runs with zero special handling, and the search pass
   stayed deterministic. This **confirms the "none" determinism rating** for the
   remaining closed-form ideas (#5, #6, #8, #9, #11) and reinforces that the only
   ones needing care are #13 (pin the codec) and anything that would become an
   optimization objective (still out of scope).

### Stack rank (singles + combinations)

Ranked by (impact × provability × cheapness × propagation), incorporating the
five lessons above. **Kind:** ◆ combination · ● single · ▲ migration (propagates
shipped work through a shared kernel). ✅ = shipped.

| # | Item | Kind | Rationale |
|---|------|------|-----------|
| 0 | **{1,2,3}** OKLCH + ΔE_OK + APCA | ◆ ✅ | Shipped. The reference: highest value, low redundancy, all closed-form. Everything below is ranked relative to it. |
| 1 | **{1,2,3} → `getSeriesColor` families** (the migration) | ▲◆ | Highest *remaining*. Propagates a shipped, tested palette to xychart/journey/mindmap/gitgraph through the shared kernel — role-tag-level risk, four families of impact. Beats any new metric. |
| 2 | **{5}** normalized crosslessness `m_c` | ● | The one metric both cheap (~10 LOC) and rigorous: closed-form, cross-graph-comparable [0,1]. Best standalone layout add. A *measure*, invisible until it gates. |
| 3 | **{5,8}** crossings + crossing-angle | ◆ | Strong low-redundancy pair: 5 counts crossings, 8 weights the *unavoidable* ones by acuteness (RAC). The angle term does real work only where 5 can't remove the crossing. |
| 4 | **{1,4}** OKLCH + harmony-as-generation | ◆ | A **tension**: harmony constrains hue *placement*, shipped #1 constrains even lightness — they compete. Report a Pareto front, not a blend, and measure #4's ΔE cost first. Demoted below the migration. |
| 5 | **{5,8,9}** edge-path bundle | ◆ | Fuller, but **partial redundancy** — ablation likely keeps 5 + one of {8,9}. Ship after #3 shows which of 8/9 adds signal. |
| 6 | **{7}** Ngo composition (balance/equilibrium/symmetry) | ● | Catches figure-level imbalance no current metric sees. The #10 lesson bites: ship with *trip-fixtures* or it's a 0-on-everything guard. Effort re-rated up. |
| 7 | **{7,11}** composition + proximity purity | ◆ | Whole-figure combo; check **redundancy** (equilibrium partly captures clustering). Both need trip-fixtures. |
| 8 | **{6}** flow-direction metric | ● | Near-free but **guaranteed-by-ELK** already — low novelty; a scored restatement of an existing invariant. |
| 9 | **{9}** spine straightness (alone) | ● | Measure-only, mostly subsumed by the {5,8,9} bundle — little reason to ship solo. |
| 10 | **{11}** proximity / MST-purity (alone) | ● | Real defect class (node reads in the wrong cluster) but weakest standalone: needs trip-fixtures and overlaps #7. |
| 11 | **{13}** info-theoretic order (gzip-ratio) | ● | Lowest: coarse signal, and the only remaining idea with a determinism caveat (pin the codec). |
| — | **{10}, {12}** | ● ✅ | Shipped as SOFT guards/detectors — correctness value, but 0-on-every-fixture, so no measurable *impact* delta. |

**How the combinations behave** (the part that decides what to build as a unit):

- **Synergistic (whole > parts) — build as units:** **{1,2}** (the ramp needs
  the floor; the floor needs the ramp's headroom — shipped together);
  **migration ⊗ {1,2,3}** (one shared-kernel change, N families — the single
  highest-leverage move); **{5,8}** (count + quality of crossings).
- **Additive (whole = parts, low redundancy) — safe to stack:** **{1,2,3}**
  (APCA visibility is orthogonal to inter-color distinctness).
- **Tension (compete — report a Pareto front, don't blend):** **{1,4}** (harmony
  placement vs even ΔE spread).
- **Redundant (whole ≈ largest part — don't pay for all):** **{5,8,9}** and
  **{7,11}** — ablate and keep the minimal subset that retains predictive power.

The through-line: **the biggest wins are propagating shipped work through shared
kernels, not adding new metrics.** Prototype-plan lesson #6 ("share mechanisms,
not family policy") applies to the aesthetic layer too — the color waist is a
shared kernel, and improving it once beats scoring each family separately.

## Honest scope notes

- This plan is measurement + closed-form generation only. Turning any metric
  into an optimization *objective* (rubric-as-objective, multi-objective
  presets, mental-map stability, learned scores) was explicitly out of scope
  and is not planned here.
- The shipped color work (#1–#3) lives in the shared high-count `pieSliceColors`
  path (the documented-defect locus in `src/pie/palette.ts`). That path is the
  categorical-color *waist*: **pie and radar both already route through it**, so
  a >6-curve radar inherited the OKLCH palette for free (proven end-to-end in
  `src/__tests__/perceptual-palette-impact.test.ts`). The families that still use
  the plain `getSeriesColor` ladder — xychart / journey / mindmap / gitgraph —
  are a follow-up: migrating them onto `pieSliceColors` (cross-family §4 item 4)
  propagates the perceptual palette but regenerates those families' SVG
  snapshots, so it is tracked separately.
- The shipped readability band (#12) ships as a **detection metric only** — the
  `LABEL_LINE_OVERLONG` audit finding, the agent-facing signal to rewrap. An
  earlier revision also shipped a corrective `readableMeasure` wrap option, but
  after the flowchart auto-wrap was reverted (it overrode an explicit
  `wrappingWidth`, a user directive) the option had no product caller — every
  renderer already wraps narrower than a paragraph measure — so the audit
  flagged it as dead code and it was removed. The corrective wrap returns only
  when a caller with a wide budget needs it. Surfacing the finding through
  `verifyMermaid` is the render-side rollout.
- Region-intrusion purity (#10) is scoped to ownership-frame families
  (architecture) in `family-rubric.ts`. Flowchart/state subgraph purity belongs
  in `layout-rubric.ts` and is a separate follow-up.
