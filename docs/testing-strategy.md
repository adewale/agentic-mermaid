# Testing strategy — what we test, how, and why

This document describes the testing approach **as it exists today**: the
tools we run, what each one actually proves, and the reasoning behind the
shape of the suite. It is a map, not a wish list. Where a gate is weaker
than it looks, this document says so — an honest map is more useful than a
flattering one.

For the *definition* of "good looking" and the determinism guarantees, see
[`quality.md`](./quality.md). For mutation specifics, see
[`mutation-testing.md`](./mutation-testing.md). For the layout/visual
contracts, see [`layout-characterization/README.md`](./layout-characterization/README.md).
The current measured complexity-aware and registry-derived interaction
portfolio is specified in
[`project/complexity-aware-test-portfolio-plan.md`](./project/complexity-aware-test-portfolio-plan.md);
its immutable before and measured candidate reports live under
`eval/test-portfolio/`.

## Local CI parity

Run `bun run quality:check` to execute the complete GitHub **Quality gates**
job locally. The command installs the frozen dependency graph and then runs
the dependency audit, the font-subset, lazy browser-family catalog, and website
regeneration checks, the sketch and whole-corpus audits, lint,
repository-wide typechecking, hero freshness, and the golden-drift guard (the
list is `QUALITY_CHECKS` in `scripts/ci/quality-gates.ts`). The workflow calls
this same entry point, so the local list and CI list cannot diverge.

Committed galleries and before/after sheets are dated review snapshots, not
gates: regenerate one with its `gallery:*` command when the rendering is
reviewed again. Where an evidence script carried a real assertion, the unit
suite now runs it against current code (for example the issue #87 link-rank
gaps, the palette rollout and harmony reports, and the Section B sheet, which
is regenerated in memory and byte-compared). Committed text/JSON generated
from source is refreshed with `bun run generate`, and its unit test fails when
it is stale. There are no input-hash receipts.

## The central problem: this is a partly non-testable program

Most of what this project does has a computable correct answer: did we drop
a node, does the source re-parse, is the output byte-identical across runs.
Those are easy to gate.

But the thing the product is *for* — a **readable, good-looking diagram** —
has no computable oracle. "Looks good" is not a function we can assert. In
the testing literature this is the **test oracle problem**, and a program
whose correctness can't be mechanically decided is a **"non-testable
program"** (Weyuker). Diagram aesthetics are the textbook case.

We do not pretend to solve this with one gate. The strategy is a
**portfolio of partial oracles**: many independent, mostly-cheap checks,
each catching a different class of regression, with the expensive
human/LLM judgment reserved for the axis nothing else can cover. The
sections below are organized by *oracle type* — the kind of correctness
each gate can actually establish — because knowing what proof a gate
provides is the whole game (Loop 19: "CI-green is not the same as
audit-clean").

## Oracle types and the gates that use them

| Oracle type | What it can prove | Our gates |
|---|---|---|
| **Specified** | Output matches an explicit contract | Tier-1 structural `verify`, capabilities/schema tests, doc-sync guards |
| **Derived (golden)** | Output matches a previously-blessed artifact | ASCII goldens, SVG snapshots, contact sheets, screenshot baselines |
| **Derived (differential)** | Our output agrees with an external reference corpus | mermaid-docs corpus, MermaidSeqBench, upstream-suite bench |
| **Metamorphic** | Related inputs produce related outputs (no ground truth needed) | round-trip idempotence, cross-process/cross-runtime determinism |
| **Pseudo / fault sensitivity** | Selected seeded faults make the intended tests fail | incremental Stryker gate, sabotage suite |
| **Heuristic / perceptual** | Geometry falls inside human-plausible bounds | `measureQuality`/`checkQuality`, ugly-detector, layout rubric, heuristic-tracker |
| **Human / model** | Subjective quality on the axis nothing else covers | LLM-as-judge (periodic), manual visual review |

The rest of this document walks each row: what it is, where it lives,
whether it gates per-PR, and what it does *not* prove.

## 1. Specified oracles — structural correctness

**Tier-1 `verify`** is the non-negotiable structural gate: none of
<!-- BEGIN GENERATED: warning-codes:structural -->`EMPTY_DIAGRAM`, `EDGE_MISANCHORED`, `OFF_CANVAS`, `GROUP_BREACH`, `UNKNOWN_SHAPE`, `LABEL_OVERFLOW`, `UNRESOLVABLE_SCHEDULE`, `RENDER_FAILED`<!-- END GENERATED: warning-codes:structural --> fires. It is reliable and universal across
families. **Tier-2** (geometric) and **Tier-3** (lint) are advisory.

Alongside it sit the **contract gates**: `am capabilities --json` schema
tests, the `agent-doc-sync` tests, and the diagram-family
citizenship matrix. For an agent-native product the docs, schemas, CLI
help, and `llms.txt` *are* runtime surface (Loop 14), so they are tested
like code, not treated as prose.

**Runs:** every PR (`bun run test`, including the canonical 30-second per-test budget).
**Does not prove:** that the diagram is *visually* good. `verify.ok` is
structural only — stated repeatedly because it has burned us (the Auth
Flow episode, Loop 15).

## 2. Derived oracles — goldens and snapshots

Blessed-artifact comparison for output that is deterministic but has no
independent spec:

- **ASCII goldens** — `scripts/update-ascii-goldens.ts`, `testdata/{unicode,ascii}/*.txt`.
- **SVG snapshots** and **contact sheets** — per-family rendered output.
- **Screenshot baselines** — `e2e/screenshots/baseline-*.png`, diffed against
  fresh Playwright renders with a per-channel threshold in `e2e/browser.test.ts`.
- **Snapshot drift sentinel** — CI flags any change under `testdata/` so a
  golden never moves silently.

**Runs:** ASCII/SVG goldens per PR. The browser/screenshot e2e suite also runs
per PR — it is the five-lane `e2e` matrix in `ci.yml` (`needs: test`), including
an installed-tarball consumer run at the advertised Node 22 floor. Its
browser lane installs Chromium and runs `browser.test.ts` (screenshot diff)
plus the security contracts and the explicitly enabled theme/style/accessibility
browser suites. The browser lane builds the gitignored `website/public` tree once
before those contracts serve it (`browser.test.ts` builds only the separate root
`editor.html`). Each browser contract file then runs in its own Bun process so its
Chromium/server hooks cannot overlap and exhaust a constrained hosted runner. The
package and CI both invoke `e2e/run-browser-contracts.ts`, whose canonical file
list also fails if any contract executes zero positive tests, while independent
lanes run the CLI/single-binary, dist-artifact, and tarball-consumer suites.
Broad contact-sheet rendering is periodic/triggered rather than a per-PR sweep;
the committed citizenship manifest and pending review state remain cheap
per-PR contracts. Structured human review is recommended for visual releases
and remains hash-bound when recorded, but it is advisory rather than a package-publication gate.
**Does not prove:** that a *changed* golden is an improvement — only that
change was noticed. Judging the change still needs a human or the
before/after harness (`eval/layout-compare`).

## 2a. Registry-derived combinatorial conformance

`render-conformance-plan.test.ts` replaces the former exhaustive
family × Look × Palette docs-example matrix. The new family registry,
Style registries and mandatory family conformance profiles generate:

- exhaustive pure Look × Palette resolution;
- pairwise real-render coverage across family, Look, Palette, security,
  background polarity and six complexity strata;
- higher-strength Look/Palette/background, family/backend/complexity,
  palette-sensitive role, external-reference and contact-sheet obligations;
- a separate SVG/PNG/ASCII/Unicode portfolio with every-family Unicode stress.

An independently implemented tuple enumerator must report zero missing
obligations. Fake/removed-family, precedence, strict-reference, transparency,
seed and terminal sabotage probes guard fault sensitivity. A new `DiagramKind`
cannot compile without its minimal, representative, dense, text-stress,
family-risk and eval-corpus-outlier conformance material.

**Runs:** executable conformance and the bounded fault probes run per PR. The
larger citizenship/interaction/outlier contact sheets run when visual inputs
change, during periodic design review, or before release.
**Does not prove:** an unrendered three-way family/Look/Palette combination is
beautiful. The exact retained obligations are published by the candidate
report rather than implied by the word “exhaustive.”

## 3. Derived oracles — differential corpora

The strongest defense against our own blind spots is testing against
sources we did not write:

- **mermaid-docs corpus** (271 entries) — harvested from Mermaid's own
  documentation; gates parse, verify, and round-trip.
- **MermaidSeqBench** (132 IBM-curated sequence diagrams) — parse rate,
  structured-vs-opaque split, verify rate, round-trip stability.
- **upstream-suite bench** (`eval/mermaid-upstream-suite-bench/`, 736
  executable cases / 746 imported blocks from pinned upstream commits) — with
  a **ratchet** (`ratchet.json`) that fails the build if coverage drops or
  per-family local-gap budgets grow. Mindmap/GitGraph use their declared
  `f3dea583…` compatibility revision and account for all 26/69 official spec
  blocks in a dedicated executable oracle.
- **Official-fence corpus** (`official-fence-corpus.test.ts`) — every one of
  the 481 official syntax fences on the 31 pinned upstream pages, matched to
  the manifest by digest. The 331 fences of rendered families must parse to a
  structured body, verify, render, and keep their structural counts through
  serialize → re-parse; the 150 fences of unrendered families must be
  diagnosed `UNSUPPORTED_FAMILY` with their bytes preserved. Deviations live in
  one small expectations table (`id [ outcomes ] # reason`); a new deviation
  and an unexpected pass both fail, so the table cannot go stale.
- **Construct fidelity cases** (`fidelity-receipts.test.ts`) — classify pinned
  constructs per surface with semantic oracles (shapes, measured text widths,
  marks inside the viewBox), and regenerate the shipped capability report in
  memory. No raw-observation receipt or whole-SVG hash is committed.
- **Grammar-based differentials** (`property-upstream-flowchart.test.ts`,
  `property-upstream-sequence.test.ts`) — recursive `fc.letrec` grammars
  generate sources that pinned upstream Mermaid 11.16 must accept; ours must
  accept them too, agree on node/edge/participant counts, shapes, labels, and
  arrows, and round-trip. A long-lived upstream worker
  (`helpers/upstream-mermaid.ts`) lets async properties shrink. Known
  divergences are pinned as explicit cases that fail once fixed.

These exist because our hand-written fixtures encode what we already knew
the parser modeled. Upstream examples are "adversarial in exactly the
right way" — they encode what real sources contain (wrapper-fidelity
lesson). The `@{shape}` silent-loss and ER `}o` bugs both escaped 2,200+
self-authored tests and were caught only by docs-derived sources.

**Runs:** every PR (corpus + seqbench + upstream-suite ratchet).
**Faithfulness count-oracle:** the corpus gate now also asserts that the
structured `{nodes, edges, groups}` tally survives a parse → serialize →
re-parse cycle for **every** renderable family
(`eval/shared/structural-count.ts`, gated in `agent-mermaid-corpus.test.ts`).
Round-trip *byte*-stability only proves serialize∘parse is idempotent; this
count check proves parse did not silently drop content — the ER `}o` class of
bug ("100% parse success is not faithfulness", Loop 17) now fails CI directly
rather than only where a hand-written oracle happened to bite.

## 4. Metamorphic oracles — relations instead of ground truth

When we can't say "the output is correct," we can say "these related runs
must agree." This sidesteps the oracle problem without a human:

- **Round-trip idempotence** — `parse → serialize → parse` is stable;
  structured-mutation invariants via `fast-check` (the `property-*.test.ts`
  suite).
- **Determinism** — three separate processes produce byte-identical layout
  JSON; Bun and Node produce byte-identical JSON on the same source; ASCII
  and PNG output hash-stable across 10+ repeated runs. CI builds the Node bundle
  before the unit shards so the Bun↔Node contracts cannot silently skip in a
  clean checkout.
- **Layout/faithfulness relations** — `property-layout-metamorphic.test.ts`
  formalizes relations that were previously implicit: determinism (same source
  ⇒ identical metrics), node-id **relabeling invariance** (ids carry no
  meaning), **disconnected-node monotonicity** (adding an isolated node adds
  exactly one node and drops nothing), and **edge-add monotonicity**.
  Statement-permutation invariance is deliberately *not* asserted — source
  order is a stated design property, so permuting statements may legitimately
  change geometry.
- **Colour and source relations** — `property-invariance-colour.test.ts`:
  palettes, colour options, named themes, theme colour variables, and family
  colour config never move geometry (layout and paint-free SVG, via the shared
  `helpers/svg-normalize.ts` `stripPaint` option), and an invalid value in any
  painted key is refused by name rather than emitted or dropped (the #303
  class, for every family at once). `property-invariance-source.test.ts`:
  inserting `%%` comments and blank lines leaves SVG byte-identical, and a
  chained flowchart edge equals its split form in facts, layout, and bytes.
- **Model-based editing** — `property-er-model.test.ts` drives the typed ER
  edit operations with `fc.commands` against a simple model, including invalid
  commands whose error code the model predicts.

**Runs:** every PR.
**Does not prove:** cross-architecture equality (x86_64 hash vs ARM64 hash
is not compared). That is the natural next place to *extend* the metamorphic
set, since the technique is the same.

### Seed policy: pinned gates, rolling finders

Every fast-check suite runs at one pinned global seed, set process-wide by
`src/__tests__/fc-seed.preload.ts` (wired via `bunfig.toml` `[test].preload`;
default seed `20260702`). A red property in CI is therefore a real,
reproducible counterexample — never a seed lottery. The 2026-07 audit caught
three suites flaking on rolled seeds (the route-contracts certificate property
at ~1 CI run in 7, issue #83; the parser Cartesian-product property; both now
pin the exact seed that exposed their bug through per-assert options, without
mutating process-global configuration).

- Reproduce a specific roll: `AM_FC_SEED=<int> bun test <file>`.
- Finder mode (deliberate randomness): `AM_FC_SEED=random bun run test`.
- A suite that needs its own regression seed passes it to `fc.assert`
  options; process-global configuration belongs to the preload alone.

Pinning is for *holding* known ground; randomness is for *finding* new
counterexamples ("an invariant enforced by a random property is a lottery,
not a gate" — `docs/contributing/lessons-learned.md`). Rolling seeds belong in
finder lanes: the scheduled `nightly-finder.yml` workflow, the deep-fuzz scripts
under `eval/`, or deliberate `AM_FC_SEED=random` sweeps.

The nightly finder rolls fresh seeds across every fast-check file with
`AM_FC_NUM_RUNS=300` (raises the default run count; a per-assert `numRuns`
still wins). It never blocks a pull request. A failure files or comments on one
issue carrying the seed, path, and counterexample
(`scripts/ci/nightly-finder-report.ts`). Fix a real counterexample and keep it
forever as a fast-check `examples` entry on the property: seeds and paths do not
survive fast-check upgrades, `examples` do. Its first local run found a real
Architecture routing counterexample (`AM_FC_SEED=1102132276` in
`architecture-layout.test.ts`) that the pinned seed never reached. It is not
fixed yet: the shrunk case is an `examples` entry inside an `it.failing` pin
that names BUG-37 in `TODO.md`.

Before the pin was frozen, every unpinned suite was
swept across 48/24/12 seeds (scaled by runtime; 1,368 suite-runs total) with
zero failures — the pin does not freeze a known-bad ticket, and the sweep is
repeatable from the same knob.

## 5. Pseudo-oracles — do selected seeded faults make the suite fail?

Tests can be green while missing faults. Two bounded gates challenge selected
behaviors:

- **Incremental mutation testing (Stryker)** — mutates the small, pure
  faithfulness counter on every PR. A full run takes about one minute and its
  measured floor is enforced. Broader ASCII, route, and family configs remain
  available as opt-in survivor harvests, not scheduled gates. A *survived*
  mutant is a test gap until classified; the historical catalogs record
  reviewed performance guards and unreachable-by-convention cases. Mutation
  testing has earned its keep when focused: it falsified an audit assumption
  and found dead code the unit tests couldn't.
- **Sabotage suite** (`eval/sabotage/route-regressions.ts`) — deliberately
  reverts a fixed bug in a detached worktree and asserts the suite goes
  **red**, proving nine named route/link regression tests actually bite.
- **Red → green** (`scripts/ci/red-green.ts`, the `red-green` CI job) — when a
  pull request changes production source and tests, at least one changed test
  must fail against the base branch's production code. This mechanically
  checks the "tests that fail when the fix is reverted" rule for every PR,
  instead of a hand-written probe per fix. Pure refactors opt out with the
  `no-red-green` label.

The broad scheduled mutation matrix was retired after 26 consecutive scheduled
runs produced no success and its final repair grew to 39 coverage workers (41
jobs total). The configs still
emit useful local scores and JSON reports, but have no break floors and carry no
acceptance authority. `docs/mutation-testing.md` records the commands, survivor
history, retained operational evidence, and re-enrollment criteria.

**Why this matters:** line coverage is reported per-PR as one merged LCOV
artifact assembled from the three unit shards, but it is a weak
adequacy signal — coverage is not strongly correlated with fault detection
once suite size is controlled (Inozemtseva & Holmes, ICSE 2014), whereas
mutant detection *is* correlated with real-fault detection (Just et al.,
FSE 2014). That supports focused mutation as one useful instrument, not mutation
score as a universal truth. Behavioral, property, differential, sabotage,
coverage, and mutation evidence answer different questions.

## 6. Heuristic / perceptual oracles — geometry inside human bounds

This is where we approximate aesthetics deterministically:

- **`measureQuality` / `checkQuality`** — edge crossings, label
  legibility, whitespace balance, label-edge proximity, aspect ratio,
  gated by `QualityBounds`. Cheap and deterministic; covers every registered
  renderable family via `RenderedLayout` adapters.
- **ugly-detector** (`eval/ugly-detector/`) — geometric defect detection:
  diagonal segments, floating endpoints, edges through nodes, hitches.
- **layout rubric / visual-rubric** — hard violations (must be 0) plus soft
  thresholds (crossings, bends, port-anchored rate).
- **heuristic-tracker** — baseline-comparison of routing metrics with
  improvement/regression deltas. `heuristic-tracker.test.ts` gates the
  portable part per PR: every tracked example scores without error and hard
  violations stay 0. The soft-metric comparison (bends, crossings, straight
  counts) is not gated, because those integers come from floating-point ELK
  geometry that differs across machines; run
  `bun run eval/heuristic-tracker/run.ts` to see soft deltas when tuning
  routing.
- **route-contract tripwires** — `ROUTE_*` codes that must stay 0; any hit
  means the layout pipeline regressed, not the diagram.
- **chart-honesty pixel oracle** (`chart-honesty-text-*.test.ts`,
  `property-chart-honesty.test.ts`) — every text of every family, in every
  registered style, rasterized by resvg: WCAG contrast against the pixels
  around its glyphs, glyphs on the canvas, authored text drawn or reported by
  `verify`, and the same reading in every style
  ([`design/system/chart-honesty.md`](design/system/chart-honesty.md)).

**Runs:** `measureQuality`, ugly-detector, the layout rubric, the
heuristic-tracker ratchet, and the chart-honesty oracle all gate per PR.
**Bound provenance (Move 6):** each `QualityBounds` band now carries an
explicit basis — `edgeCrossings` is `evidence` (the one aesthetic with strong
human-subject support: Purchase 1997/2002), `labelLegibility` is `derived`
(labels must physically fit), `whitespaceBalance`/`labelEdgeProximity` are
`chosen` (plausible but unvalidated), and `aspectRatio` is a `sanity`
guardrail. `checkQuality` returns `ranked` violations tagged primary /
secondary / sanity so a consumer weights a crossings violation above a
whitespace one (`BOUND_PROVENANCE` in `src/agent/quality.ts`).
**Does not prove:** that the diagram is good to a *human* eye. The bands
are honest approximations with headroom — "we do not claim our metrics
match a human designer's eye; they catch the worst regressions"
(`quality.md`). Provenance makes the calibration honest; it does not make a
`chosen` band correct.

## 7. Human / model oracles — the axis nothing else covers

- **LLM-as-judge** (`eval/llm-judge/judge.ts`) — scores readability,
  faithfulness, aesthetics (1–5) on a stratified corpus sample.
- **Manual visual review** — required reproducible artifacts for
  layout/rendering changes (`contributing/visual-review-evidence.md`).

**Runs:** the real LLM judge is **periodic / pre-release only** — model
spend plus nondeterminism make it unfit for a per-PR gate, and it has no CI
stand-in. Its **faithfulness** axis comes from `independentFaithfulness()` — a
structural parse → serialize → re-parse count check that does *not* consult
`measureQuality`. The judge has
primitives for the documented LLM-judge biases (Zheng et al., NeurIPS 2023):
`judgePairwiseDebiased` scores both orders and trusts only an agreeing verdict
(position bias), `assertJudgeIndependence` refuses a judge from the same model
family that authored the diagram (self-enhancement), and `JudgeReference`
threads a golden anchor (reference-guided scoring).

## What runs where

`ci.yml` is the source of truth for what gates each PR — read it rather than a
table here, which would drift. In broad strokes:

- **Per-PR (`ci.yml`):** the three-shard unit/property suite (`bun run test`) —
  Tier-1 verify, goldens, the differential + faithfulness + metamorphic gates,
  `measureQuality`/whole-corpus ugly-detector/layout-rubric, the heuristic-tracker ratchet,
  the corpus/seqbench/upstream benches — plus the high/critical dependency audit,
  type check, the hero check, the
  golden-drift gate, the parallel browser/CLI/binary/fuzz e2e matrix (whose
  browser lane checks route payload budgets and, on pull requests, the gzip
  delta against the base branch built on the same runner), the fast
  incremental mutation lane, the independent focused sabotage lane, and the
  red → green changed-test check. Each unit shard runs its files with
  `--parallel=2` (isolated worker processes), so a test file cannot depend on
  another file's imports. A final `CI complete` job waits for the required
  test aggregate, every E2E matrix job, mutation, and red → green, providing one
  protectable result that cannot turn green early.
- **Nightly (`nightly-finder.yml`):** random-seed sweeps of every property
  suite; failures become an issue, never a blocked PR.
- **Manual / periodic:** opt-in broad Stryker survivor harvests,
  `layout-compare` before/after, the benchmark vs competitors, and the real
  LLM-as-judge run.

## Boundary-contract matrix — lessons applied from the 2026-07 agent audit

The PR #162 audit exposed a blind spot that family/layout coverage did not
address: a contract could be correct in one helper and false at another public
boundary. The review of
[`adewale/testing-best-practices`](https://github.com/adewale/testing-best-practices)
led to four concrete changes in how this suite treats those seams:

| Risk boundary | Previous false confidence | Required evidence now |
|---|---|---|
| JSON-RPC wire lexemes | hosted integer example only | one shared exact-id codec; property tests over unsafe integer, decimal, exponent, batch, nested-id, sentinel-collision, and malformed-text cases; real local HTTP and installed stdio-bin checks |
| CLI bootstrap/package | formatter helper unit test | walking-skeleton E2E against the real `am` and MCP source entrypoints in a copied checkout with Bun auto-install explicitly disabled |
| cache before dispatch | normalized-key examples | non-idempotent `execute` is uncacheable; remaining keys retain the complete raw argument object so a warm valid request cannot mask an invalid one; warm-cache regression tests inject the collision |
| docs/catalog claims | selected-subset presence checks | ordered exact equality against runtime registries, uniqueness, and existence of every catalog target; public `llms.txt` is checked after generation |
| sequence semantics | global message count | one shared branch-aware message-context model feeds describe, facts, verify/layout and typed edits; unsupported nested semantics must emit a warning |
| sockets/proxies/chunks | helper could return early | socket tests fail when bind/startup fails, proxy-origin SSE is read from the real stream, and split UTF-8 chunks are exercised at the byte boundary |

These follow the research's trust-boundary lens, walking-skeleton smoke tests,
property-based parser contracts, exact doc-sync, fault injection, and
correctness-by-construction guidance. Shared validators/codecs/context models
replace repeated per-layer checks; tests remain at the untyped HTTP/stdio/CLI
boundaries where TypeScript cannot enforce the wire contract.

The dated provenance and prevention analysis, including the reviews of PRs
#157 and #160, is recorded in
[`project/agent-interface-contract-audit-2026-07.md`](./project/agent-interface-contract-audit-2026-07.md).

The validation rule for future cross-surface changes is: enumerate every
public consumer first, then require at least one non-vacuous proof at the
lowest honest tier and one shipped-boundary proof where packaging, transport,
or generation can change the result. A test that silently returns because its
environment is unavailable is not evidence for a CI-required capability.

## What makes a good test

The sections above say which oracles the suite uses. This one is the standard
each test is held to. A good test catches a real regression, for the right
reason, cheaply, and says clearly what broke.

1. **It can fail.** Breaking the behaviour it names turns it red. Check this
   by mutating the code under test, not by reading the assertion. The common
   failures are an assertion something else always satisfies (`toContain('v')`
   when a label contains a `v`; a marker id that every SVG defines in
   `<defs>`), and a fixture that never reaches the code (suppressing a warning
   the input never raises).
2. **It tests behaviour through a stable seam**: the API, CLI, MCP tool,
   rendered output or a documented contract. It does not grep source text,
   compare `Function.prototype.toString()`, or pin private names.
3. **Its expectation comes from outside the code**: a specification, pinned
   upstream Mermaid, a metamorphic relation, a property, or a reviewed golden
   whose meaning is stated. A value harvested from our own output and pasted
   back is not an oracle. The upstream bench's self-harvested labels once
   pinned a wrong ellipse label as correct.
4. **It has one reason to fail and a readable failure.** The name states the
   behaviour; the assertion is object-shaped and carries the case, not a bare
   `toBe(true)` over a conjunction.
5. **It is deterministic and hermetic.** Pinned seeds, no wall clock, no
   sleeps, no network, no dependence on file order, no leaked temp files or
   environment variables.
6. **It asserts something it did not set.** No assertion on a value the test
   just assigned, on a mock's configured return, or on a `Record` completeness
   that `tsc` already enforces. An early `return` or an `if (x) expect(…)`
   that can skip every assertion is a missing assertion: assert the
   precondition, or use `test.skipIf` with a reason. A property whose success
   branch can go unexercised counts how often it ran and fails at zero.
7. **It is not redundant**, and it does not make a doc or a second list copy
   data the code owns; iterate the registry instead of a hand list of
   families.
8. **Its label is honest.** A test that pins a known bug says so and names
   the `TODO.md` entry. A regression guard that cannot discriminate says so.
9. **Its cost is proportionate.** Expensive work (renders, layouts, PNG
   rasterization, a website build) is done once per file and shared.
10. **It reads as arrange, act, assert**, with many cases as a table.

Shared helpers carry the common arrangements: `src/__tests__/helpers/temp-dir.ts`
for temporary directories that are removed after the file,
`src/__tests__/helpers/cli-capture.ts` for in-process CLI output, and
`src/__tests__/helpers/complexity.ts` for growth checks in place of wall-clock
ceilings.

A test protects observable behaviour or an independent public contract
(API, package contents, security, protocol, config, shipped bytes, and the
agent-facing runtime docs: `llms.txt`, CLI help, MCP instructions,
`am --agent-instructions`). There are no tests of tests: no lint over test
source, no grep over production source, no check that a doc's prose or a
second list matches the code, and no test of an eval or CI helper for its own
sake. Determinism is proven on output (`agent-determinism.test.ts`,
`ascii-determinism.test.ts`), not by banning tokens in source.

Files worth copying: `src/__tests__/property-upstream-flowchart.test.ts`
(grammar-generated differential against pinned upstream),
`src/__tests__/property-er-model.test.ts` (model-based test with a shadow
model), `src/__tests__/release-publish-steps.test.ts` (runs workflow shell
steps with stub tools), `src/__tests__/theme-color-admission.test.ts`
(table-driven across output routes), and
`src/__tests__/property-validator-surface-fuzz.test.ts` (the non-vacuity
counter).

## Why the suite is shaped this way

- **Cheap-and-deterministic gates per PR; expensive-and-noisy gates
  off it.** Anything that is slow (full mutation), costly (live model), or
  nondeterministic (real LLM judge, timing benchmarks) is deliberately not
  a merge blocker, because a flaky or budget-dominating gate trains people
  to ignore it.
- **Differential corpora over hand-written fixtures for compatibility
  claims.** Self-authored tests share the author's blind spots; sources we
  did not write do not.
- **Metamorphic relations where there is no oracle.** Determinism and
  round-trip laws assert correctness without a blessed answer.
- **Mutation/sabotage to keep the suite honest**, because green tests and a
  high coverage number are not the same as a suite that detects faults.
- **Layered verification (Tier 1/2/3)** so the reliable structural signal
  is never diluted by the advisory geometric/lint signals.

## Honest gaps (current, not aspirational)

These are real today and are the natural targets for *enhancing* existing
gates rather than adding new machinery:

1. The per-PR aesthetic signal is still the weakest gate; the metrics are
   admittedly rough, and nothing per-PR validates them independently — only a
   real periodic judge run can.
2. Automatic mutation assurance is deliberately narrow: PR feedback uses the
   fast incremental faithfulness-counter lane plus nine focused sabotage probes;
   diff-scoped mutation of each PR's changed lines is tracked in issue #355.
   Broad mutation configs are manual diagnostics because the retired scheduled
   matrix did not justify its runner and maintenance cost. Line coverage is
   framed as a finder, not a headline score.
3. The benchmark is not on the PR gate (timing variance). Browser/screenshot
   e2e and the heuristic-tracker ratchet now are.
4. Determinism is proven Bun↔Node on one architecture; cross-architecture
   byte equality is not asserted.
5. `QualityBounds` thresholds are now provenance-tagged, but the `chosen`
   bands are still not validated against human-perception evidence.
6. Golden movement still needs human judgment, but the snapshot drift sentinel
   blocks unless the change is committed with the explicit `[approve-goldens]`
   review token; the token proves acknowledgment, not visual quality.

The deepest gap is structural, and `project/lessons-learned.md` (Loop 13)
names it: every quality signal here is self-generated. The portfolio above
produces breadth and internal consistency; it cannot substitute for a real
external consumer. One boundary is now an exception: the MCP transport is
exercised by the reference `@modelcontextprotocol/sdk` client
(`src/__tests__/mcp-client-interop.test.ts`, per
`project/mcp-client-interop-verification-plan.md`) — a consumer we did not
write — over a real socket (hosted) and a real subprocess (stdio). That
closes the self-generated loop for the one boundary where a canonical
external consumer exists off the shelf; every other signal above remains
self-generated.

## References

- Barr, Harman, McMinn, Shahbaz, Yoo — *The Oracle Problem in Software
  Testing: A Survey*, IEEE TSE 2015.
- Chen et al. — *Metamorphic Testing: A Review of Challenges and
  Opportunities*, ACM Computing Surveys 2018.
- Purchase — *Which Aesthetic Has the Greatest Effect on Human
  Understanding?* (GD 1997) and *Metrics for Graph Drawing Aesthetics*
  (JVLC 2002).
- Inozemtseva & Holmes — *Coverage Is Not Strongly Correlated with Test
  Suite Effectiveness*, ICSE 2014.
- Just et al. — *Are Mutants a Valid Substitute for Real Faults in Software
  Testing?*, FSE 2014.
- Zheng et al. — *Judging LLM-as-a-Judge with MT-Bench and Chatbot Arena*,
  NeurIPS 2023.
