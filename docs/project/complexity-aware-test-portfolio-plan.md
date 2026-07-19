# Complexity-aware test portfolio plan

Status: implemented and measured; tracked by `TODO.md` **TEST-3** until the configured release rows execute, an independent human approves the current contact sheet, and the 30-merge observation window exists. The executable before/candidate authorities are `eval/test-portfolio/{baseline,candidate}.json`.

## Decision

Replace overlapping hand-authored render matrices with a registry-derived, complexity-aware hybrid:

1. exhaustive checks for small finite authorities and one-way citizenship;
2. focused exact goldens for intentional bytes;
3. variable-strength covering arrays for expensive factor interactions;
4. mandatory complexity strata for every registered family;
5. fixed regressions and bounded fault injection for known failures;
6. longer format/runtime/transport sweeps at nightly or release cadence;
7. human and production evidence only where machine oracles cannot answer the question.

Do not delete an existing test until shadow execution and fault injection show that the replacement retains every fault the old test detects.

Upstream testing-method research is tracked at [`adewale/testing-best-practices#21`](https://github.com/adewale/testing-best-practices/issues/21).

## Why change

The current suite is broad but organized as independently authored rectangular slices. It cannot produce one answer to “which family × Look × Palette × format × transport × runtime × security × complexity interactions are covered?”, repeats some expensive rows, and still contains copied family lists.

The most expensive example is `mermaid-doc-showcase.test.ts`: every 15-family × 15-non-default-Look × 20-Palette combination renders one official docs example under strict SVG—4,500 renders. That is exhaustive for one three-factor slice, but exercises one source, one seed, one format, one security mode, and no transport/runtime dimension per family. Other files separately cover fixture × Look goldens, selected stacks, selected outputs, palettes, and family-specific risks.

The aim is not merely fewer tests. The aim is a portfolio where every row has a declared obligation, complexity stratum, oracle, cost class, and cadence, and where new registry members are enrolled without editing a test roster.

## Baseline: capture before implementation

### Immutable baseline captured on 2026-07-19

Source: clean detached worktree at `cb2412b15b48ae41e55ace80f613be3723072d49`. Environment: macOS arm64, Apple M2 Ultra, Bun 1.3.13, warm frozen dependency install. Repository `bunfig.toml` coverage instrumentation was enabled for every `bun test` observation. These single-run numbers are diagnostics, not portable pass/fail thresholds; the machine-readable authority is [`eval/test-portfolio/baseline.json`](../../eval/test-portfolio/baseline.json).

| Surface | Baseline cases/work | Local serial time |
|---|---:|---:|
| Canonical covered unit suite | 6,743 pass, 47 conditional skips, 389 files, 360,233 assertions | 410.73s |
| Exhaustive docs showcase | 15 families × 15 Looks × 20 Palettes = 4,500 SVG renders; 31,626 assertions | 86.50s |
| Styled-output suite | 360 fixture × Look hash renders, duplicate 360 no-throw renders, selected stacks and focused contracts | 13.90s |
| Section B visual evidence | receipt, SVG/PNG/terminal evidence and causal baseline | 6.01s |
| Palette rollout/harmony/performance + Style role gates | four focused files, 12 tests | 2.66s |
| **Visible Style/Palette subtotal** | **>5,620 render/output calls, excluding scattered family/browser/MCP tests** | **109.07s** |
| Browser contracts | website build plus 50 isolated browser tests | 326.71s single observation |

The earlier 131.18s subtotal remains useful as evidence of timing variance, but 109.07s is the pinned pre-change value used for this migration.

Current authorities and test corpus:

- 15 built-in families;
- 15 registered non-default Looks (16 including crisp);
- 20 Palettes;
- 24 layout-comparison `.mmd` fixtures;
- 360 committed styled-output hashes;
- universal all-family fuzz: 30 serializer/cross-parser cases plus 40 layout/output cases per family (1,050 generated cases total), with small family-specific entity ranges and default SVG;
- 389 files discovered by the canonical covered unit command at the baseline commit; browser/e2e files run separately.

Current two-month process diagnostics, useful for the eventual before/after comparison:

- 14 failed `main` CI runs out of 137 since 2026-06-01;
- three PRs merged with final failed checks and nine merged before current checks completed (merge governance is separate from TEST-3, but must not be misattributed to test selection);
- generated evidence/receipt churn is a recurring source of merge-ref failures.

### Baseline command protocol and remaining unknowns

The immutable report records successful executions of these commands on the same base SHA:

```bash
/usr/bin/time -p bun run test
/usr/bin/time -p bun test src/__tests__/mermaid-doc-showcase.test.ts
/usr/bin/time -p bun test src/__tests__/styled-output.test.ts
/usr/bin/time -p bun test src/__tests__/section-b-visual-evidence.test.ts
/usr/bin/time -p bun run test:browser
```

The report also records a 30-run `main` CI window (25 success, five failure; p50 604s, p95 985.8s), and 30-merge generated-artifact churn (332 classified file-touch events across 97 paths; 78,602,504 post-merge bytes presented for review). The latter is review volume, not byte-edit distance.

The baseline schema records:

- commit, runtime/OS/architecture and whether coverage instrumentation was enabled;
- discovered factor values and total generated rows per test layer;
- render calls by SVG/PNG/ASCII/Unicode/browser/hosted boundary;
- wall time, CPU time and output bytes by layer;
- CI p50/p95 job duration over a fixed recent successful-run window;
- failure, retry, cancellation and conditional-skip counts over the same window;
- committed golden/receipt files and bytes changed over the preceding 30 merged PRs;
- current historical fault/sabotage/mutation kill set;
- uncovered required 1-way, 2-way and selected 3-way interactions after modeling the current suite;
- per-family case counts by complexity stratum, oracle type, output format, transport and runtime;
- contact-sheet inventory: cells, source-selection rule, generation time, artifact bytes, last reviewed hash/date, reviewer minutes, findings and resulting fixes.

Do not use machine-specific milliseconds as exact gates. Gate deterministic case/cost units and broad timeout ceilings; use timings as trend diagnostics.

### First implementation result: deduplication and roster closure

The first red→green slice combines the hash and no-throw fixture × Look matrices. Rendering now throws directly before any baseline can be written, so an exception cannot become an approvable `error:` hash. The deterministic row-count contract and test-quality lint enforce one 20-second matrix traversal.

The elevated-family Style-stack witness now uses a `satisfies Record<DiagramKind, ...>` fixture authority and iterates `BUILTIN_FAMILY_METADATA`; Radar is enrolled. A new built-in cannot silently omit this surface: registration/type closure requires a fixture and the registry loop executes it.

Same-machine, same-dependency observations:

| Metric | Pinned baseline | After first slice | Change |
|---|---:|---:|---:|
| Styled golden/no-throw matrix renders | 720 | 360 | −360 / −50% |
| Elevated families covered by the stack witness | 14 | 15 | +Radar |
| Focused styled-output wall time | 13.90s | 8.76s | −5.14s / −37.0% |
| Visible Style/Palette subtotal, holding other baseline observations fixed | 109.07s | 103.93s | −5.14s / −4.7% |

The first full-suite run also supplied direct build-graph evidence: one new test file plus the styled-test edit invalidated four unrelated visual receipts (Pie, Mermaid-doc showcase, Mindmap/GitGraph and Section B) even though all committed gallery PNG bytes remained unchanged. A later merge-ref CI run exposed three more broad authorities after `package.json` changed (palette rollout, palette harmony, and LinkRank feedback packing). Receipt-only refreshes restored green without rewriting their browser-generated PNGs. The implemented transitive local-import graph now excludes unrelated tests while failing closed on unresolved dependencies; the seven visual receipt input sets fell by 59.9–98.5% with zero visual-output byte changes.

### Final measured candidate

The former 4,500-row docs Cartesian test is removed. Its replacement consists of:

- 300 exhaustive pure Look × Palette resolutions;
- 1,047 core SVG rows covering all 2,739 declared pairwise and selected higher-strength obligations;
- 135 mixed SVG/PNG/ASCII/Unicode rows covering all 309 declared obligations;
- 90 mandatory family × complexity-stratum sources;
- 360 retained focused exact-golden rows;
- executable precedence, registration, security, transparency, seed and terminal fault probes;
- a generated 60-cell citizenship contact sheet plus 120-cell interaction and 66-cell outlier selectors.

The coverage verifier independently enumerates obligations rather than reusing the generator's uncovered set. The three-way Look × Palette × background requirement alone has a 900-row lower bound, so the implemented core is larger than the provisional 350–600 estimate rather than silently weakening the requirement.

| Surface | Pinned before | Measured candidate | Change |
|---|---:|---:|---:|
| Canonical covered suite | 410.73s | 311.65s | −99.08s / −24.12% |
| Docs showcase | 86.50s | 1.17s | −85.33s |
| Styled output | 13.90s | 8.22s | −5.68s |
| New conformance portfolio | absent | 25.28s | +25.28s |
| Section B evidence | 6.01s | 6.24s | +0.23s diagnostic variance |
| Palette/role gates | 2.66s | 2.91s | +0.25s diagnostic variance |
| **Visible subtotal** | **109.07s** | **43.82s** | **−65.25s / −59.82%** |

The candidate misses the provisional 20–36s target but retains the declared 900-row triple obligation and stronger output/complexity coverage. Forcing the estimate would have reduced reliability.

## Baseline per-family and all-family gaps

| Gap | Current evidence | Consequence |
|---|---|---|
| No central interaction ledger | Matrices live in many test/evidence files | We cannot prove global pair/triple coverage or identify redundant rows. |
| Hard-coded family rosters remain elsewhere | Baseline `styled-output.test.ts` named 14 fixtures and omitted Radar; the first slice replaced that roster with compile-time `DiagramKind` closure plus registry iteration | Other copied lists must migrate or gain the same exact-set proof; one repaired surface does not establish global enrollment. |
| Exhaustive matrix is narrow in dimensions | Docs showcase exhausts family × Look × Palette but uses one docs source, SVG, strict security, fixed seed and direct library API | High cost does not buy format, complexity, transport or runtime interaction coverage. |
| Complexity is not an authority | Fixtures and fuzzers have no shared structural/text/config complexity vector or required strata | A family can be “covered” mostly by minimal/simple diagrams. |
| Universal fuzz varies limited structure | The shared generator varies small entity ranges, identifier-safe tags and at most one extra primary/relation | It does not systematically cross deep nesting, rich syntax, long/CJK/RTL text, styles, config, output formats or transports for every family. |
| Unicode fuzz is not universal | `property-unicode-labels.test.ts` exercises Flowchart | Unicode/escaping confidence for other families comes from scattered examples, not an all-family obligation. |
| Family-specific depth is uneven | Citizenship requires evidence paths, but not a common mutation/fault-sensitivity or complexity quota | “Has domain properties” does not make oracle strength comparable across families. |
| Output coverage is mostly uncrossed | Citizenship covers SVG/PNG capability and terminal availability; specific matrices cover selected combinations | The same complex source is not systematically checked across SVG/PNG/ASCII/Unicode and backend classes. |
| Transport/runtime coverage is separate | Library, CLI, package, browser and MCP tests each select examples | No central plan proves which family/style/format interactions survive each boundary. |
| Palette/Look integration repeats resolved behavior | 4,500 full renders re-test many palette values after stack resolution | Pure composition/color authorities and renderer consumption are not separated enough from end-to-end sampling. |
| Exact goldens and semantic oracles are mixed | Hash matrices, no-throw tests and evidence receipts overlap | Rows repeat while some assertions remain change detection rather than causal correctness. |
| Expensive historical evidence stays broadly invalidated | Several receipts hash large source/test trees | Unrelated edits trigger regeneration and merge-ref churn. |
| Cross-platform scope is narrow | CI is Ubuntu/Chromium with Node 18/22 and Bun; local macOS checks are manual | Windows, WebKit/Firefox, ARM Linux and cross-architecture byte stability are not established. |
| Production/client evidence is separate and recent | PR #189 added TypeScript/Python/Go MCP conformance, while hosted deployment smoke and exact live identity remain separate | Internal all-family coverage and local reference clients still do not establish deployed behavior. |
| Aesthetic oracle remains weak | Deterministic geometry metrics and approved galleries exist | Human readability/taste is not implied by exhaustive matrix success. |

Positive foundations to preserve:

- `BUILTIN_FAMILY_METADATA`, family descriptors, style and palette registries;
- exact-set citizenship gates and mandatory family fuzz generators;
- upstream/docs differential corpora;
- strong semantic, finite-geometry, determinism, security and route oracles;
- focused mutation and sabotage where measured cost is justified;
- explicit human approval for visual claims.

### Gap-closure map

Every baseline gap has an implemented owner below. Evidence requiring an external release runner, production deployment, independent human, or elapsed 30-merge window remains explicitly pending.

| Current gap | Owning change | Closure evidence |
|---|---|---|
| No interaction ledger | One registry-derived plan plus independent obligation enumerator | Machine report has zero missing declared tuples and names every excluded tuple/reason. |
| Hard-coded family rosters | Planner consumes the family registry; no local family arrays | Injected fake-family test changes plan rows and obligations without planner edits. |
| Narrow 4,500-row exhaustion | Separate pure Style resolution from family consumption; add complexity/format/security arrays | Shadow report shows broader declared dimensions and no lost historical fault kills before removal. |
| No complexity authority | Derived complexity vector and six mandatory per-family strata | Exact registry × stratum census; every selected source re-detects as its family. |
| Limited shared fuzz variation | Complexity generators add nesting, topology, config and text strata; longer random finder stays periodic | Each family has bounded generated cases for the declared feature tags plus replayable finder seeds. |
| Flowchart-only Unicode fuzz | Generic structured-label transformation plus family-specific safe insertion hooks | Every family executes text/Unicode stress through SVG and terminal or declares a closed-model `not-applicable` reason. |
| Uneven per-family depth | Common oracle-strength floor plus family-owned domain oracle | Per-family report names independent semantic oracle, fault probe and complexity census; presence-only evidence is insufficient. |
| Uncrossed formats | Variable-strength family × backend × format × complexity layer | Zero missing declared output tuples; same semantic inventory survives each applicable output. |
| Scattered transports/runtimes | Shared data conformance cases and a boundary covering plan | Every public transport/tool/runtime has required positive and negative rows; packaging/infrastructure failures remain boundary-specific. |
| Repeated resolved palette behavior | Exhaustive pure Look × Palette resolution plus fewer full renders | All 300 resolver pairs pass; family integration tuples and palette-sensitive semantic assertions pass. |
| Goldens mixed with weak oracles | One render feeds byte, semantic, finite and security assertions | Duplicate call count is zero and every changed golden has a causal assertion. |
| Broad receipt invalidation | Per-artifact declared dependency graph and trigger policy | Unrelated-source sabotage leaves artifact freshness valid; a true dependency change invalidates it. |
| Narrow platform scope | Risk-tiered runtime/OS/browser release matrix | macOS/Windows jobs are configured fail-loud for release but await execution; Chromium is the explicit browser contract and other engines remain unclaimed. |
| Separate production/client evidence | Release/post-deploy conformance layer | Exact artifact identity plus TS/Python/Go client and live positive/negative probes. |
| Weak aesthetic oracle | Periodic plan-derived contact sheets and structured human review | Artifact/manifest/review schema exist and release fails closed; independent reviewer identity, minutes and findings remain honestly pending. |

## Sources of truth and automatic enrollment

### One test-plan builder

The pure test-support authority is:

```text
src/__tests__/helpers/render-conformance-plan.ts
```

It consumes, never copies:

```ts
families   <- FamilyDescriptor registry / BUILTIN_FAMILY_METADATA projection
looks      <- knownStyleDescriptors(kind = look)
palettes   <- knownStyleDescriptors(kind = palette)
formats    <- closed graphical/terminal conformance projection
sources    <- descriptor example + mandatory metamorphic generator + exact family profile + discovered eval corpora
boundaries <- existing canonical library/CLI/MCP/browser/package/runtime gates, referenced by the candidate report
```

No optional `covered`, `enrolled` or `testThisFamily` field is allowed.

### Required family conformance material

Enrollment is automatic, but valid family syntax cannot be invented generically. Family registration must structurally provide or reference:

- canonical minimal example;
- representative/dense generator;
- semantic inventory projection;
- family hallmark/domain invariant evidence.

This is mandatory registration data, not an opt-in to individual tests. The implementation uses the exact-closed `FAMILY_CONFORMANCE_PROFILES: Readonly<Record<DiagramKind, FamilyConformanceProfile>>` alongside mandatory `METAMORPHIC_FAMILIES`; compile-time closure and runtime registry equality make a missing new family fail.

### Independent enrollment proofs

The plan is accepted only if tests prove:

1. exact equality with every canonical registry;
2. every family has mandatory complexity strata;
3. every source detects/parses as its declared family;
4. every factor value appears in required layers;
5. every required pair/triple is present;
6. constraints have explicit, stable `not-applicable` reasons;
7. injecting a conforming fake family into the input registry automatically adds its rows and obligations without changing planner code;
8. removing a member removes all and only its rows;
9. plan ordering and row IDs are code-point deterministic.

The coverage verifier must independently enumerate obligations rather than reuse the generator's internal uncovered-set calculation.

## Complexity model

Do not rely on one scalar. Derive a vector from parsed source and rendered layout:

```ts
interface DiagramComplexity {
  entities: number
  relations: number
  nestingDepth: number
  parallelEdges: number
  reciprocalEdges: number
  cycles: number
  authoredTextCells: number
  maxLabelCells: number
  unicodeClasses: readonly string[]
  activeConfigFields: number
  semanticFeatureTags: readonly string[]
}
```

Track post-render diagnostics separately: mark count, route-point count, output bytes, pixel area and elapsed time.

Every family must contribute at least:

- minimal;
- representative;
- structurally dense;
- text/Unicode stress;
- family-risk topology/syntax;
- real-corpus outlier.

Select quantiles within each family and retain absolute cross-family stress thresholds. Two equal node counts with different cycles, nesting or text are not equivalent.

### Complexity in the Cynefin sense

This plan uses “complexity” in two related but distinct ways:

1. **Computational/structural complexity** is measurable: entities, nesting, routes, text, output area and runtime.
2. **A complex domain in the Cynefin sense** has contextual, emergent cause/effect that can be understood reliably only in retrospect. Diagram aesthetics, visual hierarchy and cross-family coherence live here; parser closure and schema admission generally do not.

Following Snowden and Boone's [Cynefin decision model](https://hbr.org/2007/11/a-leaders-framework-for-decision-making), machine contracts handle clear/complicated constraints, while visual work uses **probe → sense → respond**. A contact sheet is a bounded probe: render a diverse, reproducible portfolio, let a human perceive patterns and outliers across neighboring cells, record what was learned, then adjust design or future probes. It is a sense-making instrument and sanity check, not a proof that the unrendered space is beautiful.

The plan therefore budgets both compute and human attention. More cells can reduce review quality; a smaller diversity-maximizing sheet with readable native-size drill-downs is more useful than thousands of thumbnails.

## Hybrid portfolio

### Layer A — correctness by construction and bounded exhaustive authorities

Run on every PR; expected cost below one second.

- exact registry equality and descriptor closure;
- exhaustive Style stack resolution for all 15 Look × 20 Palette pairs as pure data, not full family renders;
- exhaustive palette/color/contrast algebra where the domain is finite;
- exhaustive schema enums, backend inference, option normalization and invalid-state reachability;
- compile-time exhaustive switches and mandatory descriptor fields;
- a pure resolved-style equivalence/signature describing backend class, palette channels, font class, backdrop, transparency and role fields consumed downstream.

This decomposition is load-bearing: the former 4,500 renders jointly retested stack resolution and family consumption. The implementation proves all 300 Look × Palette resolutions cheaply, then proves that every family consumes the resulting semantic classes through variable-strength full renders. It does not assume palette or Look orthogonality merely to save time.

### Layer B — one-way family citizenship

Run every PR.

For every registered family, execute its canonical and representative sources through:

- detect → parse → serialize → reparse;
- verify → layout → Scene;
- default SVG and terminal outputs;
- semantic inventory conservation;
- finite geometry, determinism and security;
- generic long/multiline/CJK/RTL/combining/ZWJ label transformations through every applicable text-bearing construct;
- all mandatory complexity strata and declared semantic feature tags;
- declared mutation/domain invariant hooks plus one family-specific fault probe.

This layer is registry-looped and does not use covering-array sampling. A family descriptor that cannot provide safe generic label insertion or a dense source must expose a mandatory closed-model reason; absence is never silently interpreted as not applicable.

### Layer C — focused exact goldens

Keep the current 24-fixture × 15-Look hash matrix initially, but render each cell once. The same result must satisfy no-throw, well-formedness, finite-output and hash assertions. Never serialize an exception into an approvable baseline.

Pinned baseline cost: 720 renders / 11.17s inside the two large loops. First-slice result: 360 renders / 5.83s for the combined loop; the complete focused file fell from 13.90s to 8.76s while adding Radar to the separate elevated-stack witness.

Retain exact bytes only where exact bytes are intentional. Pair every changed golden with a semantic/geometric causal assertion.

### Layer D — complexity-aware variable-strength SVG array

Factors:

- family;
- Look;
- Palette;
- security mode;
- transparency/background polarity;
- complexity stratum.

Derived coverage metadata includes backend class and font class.

Obligations:

- pairwise across all factors, including every family × Look, family × Palette and Look × Palette pair in real renders;
- 3-way for family × backend-class × complexity;
- 3-way for Look × Palette × background polarity;
- 3-way for family × security × external-reference feature;
- 3-way for palette-sensitive role signatures × backend-class × palette polarity;
- stronger fixed cases for known layout/style/security failures.

The removed 4,500-row matrix guaranteed every named family × Look × Palette triple for one simple source. Pairwise replacement alone would have weakened that guarantee. Removal therefore followed executable pure stack resolution; all family/Look and family/Palette integration pairs; role-signature and palette-sensitive triples; complexity-stratified rows; and fault injections that make family-specific Look/Palette consumption wrong. The replacement does not claim the removed triple exhaustiveness.

Each row asserts semantic identity, finite positive geometry, selected palette precedence, deterministic behavior where scheduled, strict reference safety, transparency truth, route/layout hard invariants and backend selection. A non-empty SVG is not an adequate oracle.

The executable plan contains 1,047 SVG rows. The provisional 350–600 estimate was infeasible because 15 Looks × 20 Palettes × three background polarities already requires 900 distinct rows. The implementation preserves that obligation and reports the estimate miss honestly.

### Layer E — expensive output formats

Per PR, the 135-row pairwise/variable-strength array crosses family, backend class, SVG/PNG/ASCII/Unicode and complexity. Every family/format text-stress triple is mandatory, so the measured result is slightly above the provisional 60–120 estimate. Compare semantic inventories where outputs expose different geometries; never demand pixel imitation from terminal output.

Nightly/pre-release runs the denser family × backend × format × complexity obligations, every-family Unicode/text stress, and randomized finder seeds. The report distinguishes unsupported output from untested output and requires an explicit authority for either state.

### Layer F — transport and runtime conformance

Test shared behavior primarily at the public library waist. Use shared JSON conformance cases (“Pirate tests”) at the boundaries.

Per PR:

- every public transport/tool has a golden path and schema rejection path;
- pairwise transport × tool × format × security over local deterministic environments;
- Node 18 minimum, current Node, Bun and Chromium requirements remain fail-loud;
- the plan reports unexecuted supported OS/browser/architecture cells rather than implying Ubuntu/Chromium proves them.

Release/post-deploy:

- installed tarball and binary;
- browser/Worker;
- hosted MCP;
- reference TypeScript/Python/Go clients;
- exact deployed artifact/version identity;
- the supported-platform policy's risk-selected Windows/macOS/Linux, architecture and Firefox/WebKit/Chromium rows, or an explicit narrowed support claim when those environments are not provisioned.

Do not multiply every core rendering row by every transport when adapters consume the same tested application service; retain boundary cases for failure modes unique to packaging, serialization or infrastructure.

### Layer G — fixed regressions, mutation and sabotage

Every escaped defect retains a deterministic regression. Use focused mutation/sabotage to validate oracle sensitivity in high-risk modules. Do not restore broad mutation infrastructure without a bounded cost and measured decision value.

The new portfolio and retained focused regressions execute or reference these fault classes:

1. omit a newly registered/fake family;
2. reverse Look/Palette precedence;
3. drop strict external-reference stripping;
4. repaint transparent output with a page backdrop;
5. make rough output seed-independent or nondeterministic;
6. drop a PNG-only option at the MCP boundary;
7. break font fallback;
8. emit Unicode when ASCII is requested;
9. lose a semantic node/edge during canonicalization;
10. reintroduce a dense feedback/reciprocal route defect.

### Layer H — contact sheets, human sense-making and production evidence

Contact sheets are a first-class periodic technique for the complex aesthetic space. They complement—not replace—semantic contracts, interaction arrays, focused before/after evidence and native-size inspection.

Generate four plan-derived sheet types:

1. **Change sheet (triggered per visual PR):** 12–24 before/after cells for changed factor rows, adjacent controls and the highest-risk affected complexity strata.
2. **Citizenship sheet (periodic—monthly while the visual system is active—or after registry growth):** a 60-cell base crosses every family with four crisp/rough/hybrid and light/dark polarity witnesses, choosing its canonical or representative source by a deterministic rule; up to 30 additional risk-source cells cover family outliers. All 60–90 cells are selected from registries rather than a copied roster.
3. **Interaction sheet (pre-release):** 60–120 diversity-maximizing rows from the variable-strength plan, emphasizing combinations not present in the citizenship sheet and expensive PNG/font/transparency cases.
4. **Outlier sheet (periodic/finder):** worst hard/soft metric candidates, corpus complexity outliers, newly shrunk fuzz cases and historical regressions. This sheet deliberately challenges the metric rather than displaying only passing examples.

Every cell carries a stable row ID, family/source provenance, complexity tags, Look, Palette, backend, output format, dimensions and candidate/base commit. Sheets must provide native-size files or drill-down links; a dense thumbnail alone cannot establish label readability. Generated manifests bind exact inputs, selection algorithm/version and output hashes.

Human review protocol:

- inspect the sheet as a whole for repeated patterns, family outliers, hierarchy, rhythm, color semantics and suspicious metric-green ugliness;
- inspect every changed/high-risk cell at native size;
- randomize or blind before/after side assignment where comparative judgment could be biased;
- record reviewer, reviewed artifact hash, date, minutes spent, cell IDs, findings, severity, disposition and follow-up issue/test;
- treat “no finding” as a result, not proof; approval expires when sheet bytes or its selection plan changes;
- prefer a second independent human for release-level visual approval when available.

The 60-cell citizenship artifact and manifest are committed; 120-cell interaction, 66-cell outlier and bounded change selectors are executable. The compute artifact can be regenerated automatically, but human review is scheduled only when information can change a decision: a visual PR, registry/style growth, periodic design review or release. Heavy historical galleries such as the Section B 60-cell artifact regenerate only when precise declared dependencies change or at pre-release—not after unrelated source/test edits.

Live smoke, SLOs and external-consumer evidence remain separate from deterministic render conformance. Contact-sheet findings feed new fixed regressions, complexity tags or interaction-strength changes; they do not become an ever-growing screenshot gate by default.

## Cost model and cadence

Use deterministic planning units, calibrated from telemetry:

| Operation | Initial planning units |
|---|---:|
| Pure validation/schema | 0.1 |
| Crisp SVG or terminal | 1 |
| Rough/hybrid SVG | 2 |
| PNG | 5 |
| Browser process/page | 20 |
| Worker/reference-client E2E | 50 |
| Live production request | 100 |
| Human native-size visual review | tracked in minutes, never converted to fake CPU units |

Complexity multipliers start at minimal ×1, representative ×2, dense ×4 and adversarial ×6. These are selection weights, never performance assertions.

Optimize the portfolio for risk obligation × oracle strength × oracle independence under separate per-PR, nightly and release budgets. Include environment startup, execution, oracle, maintenance/baseline review, expected flake rerun and diagnosis cost. Start with ordinal risk classes; do not invent precise defect probabilities. Human review has its own attention budget: cell count, minutes, findings and decision impact are reported separately from machine runtime.

### Changed steady-state costs

| Per-PR layer | Executed work | Measured local serial time |
|---|---:|---:|
| Registry, source strata, pure resolution, tuple verification, 1,047 core + 135 mixed rows, selected determinism | 12 tests/plan layers | 25.28s |
| Combined exact fixture × Look goldens and focused Style contracts | 360 exact rows plus focused checks | 8.22s |
| Official docs canonical family witnesses | one per family | 1.17s |
| Section B causal/visual evidence | retained | 6.24s |
| Palette/role evidence gates | retained | 2.91s |
| **Visible Style/Palette subtotal** | broader declared interaction/complexity coverage | **43.82s** |

This is **65.25s / 59.82% lower** than the pinned 109.07s subtotal. It is above the provisional 20–36s target because the implemented three-way background obligation has a 900-row lower bound. The target was not allowed to erase coverage.

The final 60-cell citizenship sheet generated in 1.86s and produced a self-contained HTML artifact plus a hash-bound manifest. Human attention remains separately budgeted at approximately 15–30 minutes; no machine time is converted into fake review minutes. Change, interaction and outlier sheets remain triggered/periodic rather than per-PR rendering gates.

Shadow execution was bounded to the migration: the pinned old suite ran on the clean baseline, the candidate ran against the same registries and retained fault probes, and then the 4,500-row test was removed. The permanent suite no longer pays both costs.

## Phased migration

1. **Measure — complete:** immutable baseline and content-addressed candidate reports publish commands, environment, cost, churn, rows and limitations.
2. **Deduplicate — complete:** the duplicate 360-render loop is gone; render failures cannot be serialized into an approvable baseline.
3. **Centralize — complete:** one registry-derived planner and a separately implemented tuple enumerator report zero missing obligations; fake/removed-family sabotage bites.
4. **Stratify complexity — complete:** every family has minimal, representative, dense, text/Unicode, family-risk and discovered eval-corpus-outlier sources plus a measured vector.
5. **Decompose — complete:** all pure Look × Palette resolutions are exhaustive; family rendering consumes systematic interaction rows.
6. **Shadow — complete:** the pinned old run and measured candidate preserve fault evidence; the old 4,500-row test is removed.
7. **Contact-sheet probe — implemented, human evidence pending:** four selectors, generator, manifest, committed citizenship artifact and fail-closed release review validator exist. Independent human approval cannot be manufactured here.
8. **Fault-validate — complete for executable/local evidence:** new probes cover enrollment, precedence, security, transparency, seed and terminal faults; PNG/font/semantic/route regressions remain retained.
9. **Replace — complete:** the variable-strength portfolio is the current per-PR strategy.
10. **Rebalance cadence — complete/configured:** per-PR library/boundary checks remain; contact-sheet rendering and macOS/Windows platform smoke are release/triggered surfaces. Chromium is the explicit browser target; unprovisioned Firefox/WebKit/Linux ARM are not implied.
11. **Review after 30 merges — time-blocked:** the candidate report marks future CI/flake/churn/escape observations pending rather than fabricating them.

## Before/after measurement contract

The versioned [`baseline.json`](../../eval/test-portfolio/baseline.json) and [`candidate.json`](../../eval/test-portfolio/candidate.json) reports use schema version 1, disclose environment/provenance, and distinguish measurements, configured-but-unexecuted rows, pending human evidence and future observations.

| Metric | Before | Candidate target | After |
|---|---:|---:|---:|
| Canonical covered-suite wall time | 410.73s | lower with no failed tests | 311.65s (−24.12%, one-machine diagnostic) |
| Style/Palette serial diagnostic time | 109.07s | lower without reducing declared fault evidence | 43.82s (−59.82%) |
| Exhaustive family × Look × Palette renders | 4,500 | replace with stronger declared obligations | removed; 300 pure resolutions + 1,047 core rows |
| Duplicate styled-output renders | 360 | 0 | 0 |
| Required one-way family enrollment | scattered | 100%, independently verified | 100%; exact registry/profile closure |
| Core interaction obligations | not centrally measurable | zero missing | 2,739/2,739 |
| Mixed-output obligations | not centrally measurable | zero missing | 309/309 |
| Mandatory complexity strata per family | none centrally enforced | six | 90/90 family-stratum sources |
| Every-family Unicode/text stress | scattered | graphical and terminal | every family × SVG/PNG/ASCII/Unicode text-stress triple |
| Historical/new fault probes | fragmented | no known loss | retained paths plus seven new executable probes |
| Contact-sheet compute and review | no central ledger | bounded and hash-bound | 1.86s generation; independent human minutes/findings pending |
| Receipt dependency inputs | broad `src/**/*.ts` trees | precise fail-closed import graphs | 59.9–64.5% fewer inputs; zero output-byte change |
| Supported platform/client rows | Ubuntu/Chromium centered | explicit release/narrowed policy | macOS/Windows configured; TS/Python/Go clients present; Firefox/WebKit/Linux ARM unclaimed/unprovisioned |
| CI p50/p95, flake, churn and escaped defects after 30 merges | baseline captured | report after observation window | pending by definition, not fabricated |

The provisional runtime target is not an acceptance shortcut. If stronger coverage costs the same but measurably kills more relevant faults and reduces drift, that can still be a better portfolio. Conversely, a faster array with weaker oracles is a regression.

## Acceptance criteria

- [x] Baseline and candidate reports use schema version 1 with environment, commands, provenance and explicit rebuttals.
- [x] Every family/factor value and required complexity stratum derives from canonical authorities or an exact-closed mandatory profile.
- [x] Fake/removed-family sabotage proves automatic enrollment and missing obligations.
- [x] Independent verification reports zero missing pairwise/variable-strength obligations.
- [x] The duplicate 360-render styled loop is removed without reducing its oracles; red→green lint and same-machine timing are recorded.
- [x] Pure Look × Palette composition is exhaustive, with real-render pairwise and selected higher-strength consumption rows.
- [x] Every family has structured Unicode/text stress through SVG, PNG, ASCII and Unicode output.
- [x] Every family meets the common semantic/finite/security floor in addition to its retained domain properties.
- [x] Output, transport, runtime and client evidence distinguish configured, executed and unprovisioned states; browser support is explicitly Chromium rather than implicitly all engines.
- [x] No known historical regression path is deleted; new fault probes execute for the replacement's load-bearing assumptions.
- [x] Expensive rows have per-PR versus triggered/release cadence and fail-loud capability requirements.
- [x] Exact goldens remain focused and exceptions cannot become approvable baseline values.
- [ ] An independent human must complete the current hash-bound citizenship review; model sanity is explicitly not approval and publication fails closed meanwhile.
- [x] Receipt dependency sabotage proves unrelated tests stay outside visual graphs and unresolved/changed true dependencies invalidate them.
- [x] Before/after runtime, compute, churn, fault and coverage results are published; estimates are distinguished from measurements.
- [ ] CI/flake/churn/escaped-defect after-results require the declared 30-merge observation window.
- [x] `docs/testing-strategy.md` now describes the implemented portfolio.
