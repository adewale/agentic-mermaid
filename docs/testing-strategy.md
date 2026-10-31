# Testing strategy — what we test, how, and why

This document describes the testing approach **as it exists today**: the
tools we run, what each one actually proves, and the reasoning behind the
shape of the suite. It is a map, not a wish list. Where a gate is weaker
than it looks, this document says so — an honest map is more useful than a
flattering one.

For the *definition* of "good looking" and the determinism guarantees, see
[`quality.md`](./quality.md). For the layout/visual
contracts, see [`layout-characterization/README.md`](./layout-characterization/README.md).
The complexity-aware and registry-derived interaction portfolio is implemented
in `src/__tests__/render-conformance-plan.test.ts` and its helpers. The
[July migration record](./project/archive/complexity-aware-test-portfolio-plan.md)
is historical; its removed reports and receipts are not current requirements.

## Local CI parity

Test-order and fresh-process sweeps are manual diagnostics for changes to shared
fixtures or module state. Replay a focused failure with
`AM_TEST_ORDER_SEED=<seed> bun run scripts/ci/find-test-order.ts shuffled <files>`
or replace `shuffled` with `fresh-process`. No scheduled whole-suite order sweep
or issue collector runs. Each test must initialize its own reference fixture;
another test's initialization is not a prerequisite.

Run `bun run quality:check` to execute the complete GitHub **Quality gates**
job locally. The command installs the frozen dependency graph and then runs
the dependency audit, the font-subset, lazy browser-family catalog, and website
regeneration checks, the whole-corpus audit, lint,
repository-wide typechecking, and hero freshness (the
list is `QUALITY_CHECKS` in `scripts/ci/quality-gates.ts`). The workflow calls
this same entry point, so the local list and CI list cannot diverge.

The E2E lanes build their own inputs and start alongside unit tests; only the
final `CI complete` gate waits for every lane. Package manifest and export/type
checks run after the Node 24 tarball consumer has built the package, rather
than rebuilding all browser artifacts in a unit shard. Unit shards build only
the Node bundle. Browser contracts run in two disjoint file shards, retaining
one test process per file. Payload measurement has its own lane: each site
build supplies the lazy bundle for comparison, so neither head nor base needs
a second full package build. Generic PR render evidence is generated on demand
with `scripts/pr-assets/meaning-preservation-evidence.ts BASE_SHA HEAD_SHA OUT_DIR`;
automatic rendering of the same fixtures is no longer appended to every PR.

Both tarball-consumer lanes also execute the Getting Started commands from the
built website's shell blocks and `docs/getting-started.md`'s bash fences in fresh
consumer directories. Only the registry package spec is replaced with the packed
tarball; the guide's separate repository-development alternative is excluded.
The gate checks verification JSON, parsed SVG and PNG files, terminal output,
style discovery, and stdio MCP initialization/tool discovery for both the CLI
command and the version-pinned config card. Failures name the page, step, and
copied command. Run it locally with
`cd e2e && bun test tarball-consumer-fuzz.e2e.test.ts --timeout 600000`.

Committed galleries and before/after sheets are dated review snapshots, not
gates: regenerate one with its `gallery:*` command when the rendering is
reviewed again. Where an evidence script carried a real assertion, the unit
suite now runs it against current code (for example the issue #87 link-rank
gaps and the Section B sheet, which is regenerated in memory and
byte-compared). Generated runtime modules are the narrow committed exception
when production code imports them. Other derived discovery views are generated
at delivery: `am llms-txt` and the website use current registries, while the
repository's authored `llms.txt` points readers to those sources. A second
committed capability roster and its snapshot-freshness test are unnecessary.
There are no input-hash receipts.

The sketch prototype remains an on-demand research tool (`bun run sketch:check`).
Production styling is exercised by the Scene/backend and render-conformance
tests; the browser label-contrast check renders the shipped looks.

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
| **Heuristic / perceptual** | Geometry falls inside human-plausible bounds | `measureQuality`/`checkQuality`, ugly-detector, layout rubric, heuristic-tracker |
| **Human / model** | Subjective quality on the axis nothing else covers | LLM-as-judge (periodic), manual visual review |

The rest of this document walks each row: what it is, where it lives,
whether it gates per-PR, and what it does *not* prove.

## 1. Specified oracles — structural correctness

**Tier-1 `verify`** is the non-negotiable structural gate: none of
<!-- BEGIN GENERATED: warning-codes:structural -->`EMPTY_DIAGRAM`, `EDGE_MISANCHORED`, `OFF_CANVAS`, `GROUP_BREACH`, `UNKNOWN_SHAPE`, `LABEL_OVERFLOW`, `UNRESOLVABLE_SCHEDULE`, `RENDER_FAILED`, `INTERNAL_ERROR`<!-- END GENERATED: warning-codes:structural --> fires. It is reliable and universal across
families. Geometric and lint findings use their canonical severity: most are
advisory, while measured `CONTENT_OCCLUDED` and an explicit error policy fail verification.

Alongside it sit the **contract gates**: `am capabilities --json` schema
tests, the `agent-doc-sync` tests, and the behavioural
diagram-family citizenship loop. For an agent-native product the docs, schemas, CLI
help, and live generated discovery *are* runtime surfaces (Loop 14), so their
behavior is tested like code. The repository `llms.txt` is an authored pointer
to those live surfaces.

Citizenship requires a small smoke input and a domain-rich scenario for every
registered built-in family. Required witnesses in the existing closed
`FAMILY_CONFORMANCE_PROFILES` record specify independent semantic expectations,
visible labels and a meaningful typed edit. Those expectations must survive
canonical export/reload and editing, alongside verification, graphical/terminal
rendering, layout regions and uncached determinism. This closes the former gap
where a minimal count fixture passed citizenship while richer inputs appeared
only in the separate rendering portfolio. Source length and node counts do not
establish representativeness; the interacting domain features do. See the
[citizenship review contract](./contributing/diagram-family-citizenship.md#representative-examples-are-mandatory).

**Runs:** every PR (`bun run test`, including the canonical 30-second per-test budget).
**Does not prove:** that the diagram is *visually* good.

<!-- BEGIN GENERATED: verify-result -->
`verify.ok` means no unsuppressed error was detected, including measured content occlusion and explicit error policies. It is not a visual-quality or semantic-correctness score.
<!-- END GENERATED: verify-result -->

## 2. Derived oracles — goldens and snapshots

Blessed-artifact comparison for output that is deterministic but has no
independent spec:

- **ASCII goldens** — `scripts/update-ascii-goldens.ts`, `testdata/{unicode,ascii}/*.txt`.
- **SVG snapshots** and **contact sheets** — per-family rendered output.
- **Screenshot baselines** — `e2e/screenshots/baseline-*.png`, diffed against
  fresh Playwright renders with a per-channel threshold in `e2e/browser.test.ts`.
- **Golden review** — each PR description lists every changed golden under
  `src/__tests__/testdata/` and why it changed, for reviewer judgment.

**Runs:** ASCII/SVG goldens per PR. The browser/screenshot e2e suite also runs
per PR — the `e2e` matrix in `ci.yml` runs alongside unit and quality checks, including
an installed-tarball consumer run at the advertised Node 22 floor. Its
browser shards retain Chromium/Firefox/WebKit bundle checks, `browser.test.ts`
(screenshot diff), security contracts, and the explicitly enabled
theme/style/accessibility suites. The site-only shard needs Chromium. Each
shard builds the gitignored `website/public` tree once before its contracts serve it (`browser.test.ts` builds only the separate root
`editor.html`). Each browser contract file then runs in its own Bun process so its
Chromium/server hooks cannot overlap and exhaust a constrained hosted runner. The
package and CI both invoke `e2e/run-browser-contracts.ts`, whose canonical file
list also fails if any contract executes zero positive tests, while independent
lanes run the CLI/single-binary, dist-artifact, and tarball-consumer suites.
Broad contact-sheet rendering is periodic/triggered rather than a per-PR sweep.
Human review is recommended for visual releases, but it is advisory rather than
a package-publication gate.
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

Each family profile declares its automatic-outline roles or explains why they
do not apply. The SVG portfolio binds those Scene obligations to the actual
emitted primitives, including class-styled swatches and sketched outline
siblings. It checks positive visible ink and 3:1 source-paint contrast against
known opaque pages, preserves declared opacity, and requires every applicable
family/role/backend to have a witness. Representative looks without explicit
border roles exercise all six strata, including the default crisp look.
Deliberate role colors, `none`, and authored zero-width borders have separate
preservation checks; active family paint aliases are treated as overrides.
These checks do not certify every antialiased pixel or an unknown transparent
host background.

The planner and tuple-verifier helpers describe the interaction obligations;
the retained tests exercise family-profile closure, resolver behavior,
rendered output and determinism. Do not infer current enforcement merely from
the existence of a helper or from the historical plan's removed sabotage suite.
A new `DiagramKind` requires typed profiles and generators, including an
outline declaration. Missing fixture files or eval-corpus examples fail when
the conformance inputs are constructed.

**Runs:** executable conformance runs per PR. The
larger citizenship/interaction/outlier contact sheets run when visual inputs
change, during periodic design review, or before release.
**Does not prove:** an unrendered three-way family/Look/Palette combination is
beautiful. Inspect the current planner, verifier and actual assertions for the
retained obligations; there is no published candidate report to serve as a gate.

## 3. Derived oracles — differential corpora

The strongest defense against our own blind spots is testing against
sources we did not write:

- **Modern semantic gate** (`bun run test:mermaid-modern`, after
  `bun run reference:mermaid` installs the pinned source and reference locally)
  — selected assertions from the current Mermaid policy pin, with the exact
  source commit and independently installed parser admitted before execution. Repeated subgraph declarations
  must retain both member identities and the first title in public IR, typed
  editing, positioned layout and SVG. Repeated class assignments must survive
  typed rename and serialization in author order. Two official XYChart
  examples must serialize to valid Mermaid with their titles, axes, values and
  point labels intact. Reference projections contain those semantic fields;
  Class arrow markers, metadata-shaped Flowchart named edges, quoted Mindmap
  delimiters and reserved Quadrant axis text also have reviewed writer
  assertions. These preservation assertions are complemented by reviewed seeded writer
  regressions and operation checks: each native family's canonical example plus focused
  witnesses compares selected ordered builder operands against the real
  reference. The operation scopes are declared per family and do not imply
  equality of all internal calls.
  The checks do not compare Mermaid geometry or styling. Existing State, Architecture
  and Sequence syntax gaps are recorded as diagnostics, not permanent expected
  failures. This gate has an explicit local command and the dedicated **Modern
  Mermaid semantic compatibility** workflow is a required reusable lane of canonical CI
  for every PR and main revision, including reference policy and corpus changes; it does not change the normal product
  compatibility pin or development dependency.
  The job also publishes all-family documentation outcomes and 100 seeded
  mutations as a seven-day diagnostic artifact. Those counts do not gate
  unsupported families or expand the reviewed assertions.

  **All-family grammar assessment** (`bun run eval:mermaid-grammar`) uses the
  actual selected Mermaid 12+ grammar for every core family, including families
  without native Agentic support. It records lexer tokens, Jison model calls or
  Langium/Chevrotain syntax trees and native renderer-parser admission. Hooks
  inside all 17 native parsers record consumed classified statements and actual
  semantic writes, with values copied before later mutation; Flowchart also
  records its consumed compound fragments. Every observed native attempt has
  an unobserved acceptance/error/model control. A changed result fails the
  assessment as an instrumentation failure.

  Independent per-family adapters compare selected native semantic fields
  against actual reference getters/actions/AST, retaining logical IDs, marker
  sides, labels and parents where applicable. Additional adapters compare
  ordered operands from actual native mutation events and actual reference
  calls, expanding recorded batch arguments rather than returned IR. These
  arrays are never sorted. Each case declares the compared operation scopes
  and counts omitted kinds, methods and batch operands; empty scoped traces
  are unavailable evidence. Stable-getter and original-to-serialized reference
  comparisons remain separate. Parent fields are retained, and generated-looking
  authored strings are not globally rewritten. None of these selected scopes
  proves full semantic fidelity. Manual runs default to 5,000
  seeded mutations per family; required CI uses 100 per family at seed 7.
  The separate weekly contract-discovery job samples at a recorded fresh seed
  with the bounds described below. Mutations draw on the
  corpus's own token images and on fixed lexer-boundary fragments
  (`grammar-fragments.ts`). Each run counts **silent reads** per family (pinned
  Mermaid rejects, ours reads, verify names no problem) and lists them reduced;
  weekly discovery retains confirmed public-contract candidates for human
  review without opening issues. Per-input JSONL and detailed counterexamples are
  ignored build artifacts. This measures native admission and reference grammar
  round trips as well as the scoped native semantics/operations. Agentic has
  no homologous Mermaid token/`yy` interface, so exact protocol equality
  remains unavailable; the actual native units are labelled separately. Exact reference stream differences
  need semantic review and are not conflated with lost content or layout.

- **mermaid-docs corpus** (271 entries) — harvested from Mermaid's own
  documentation; gates parse, verify, and round-trip.
- **MermaidSeqBench** (132 IBM-curated sequence diagrams) — parse rate,
  structured-vs-opaque split, verify rate, round-trip stability.
- **upstream-suite bench** (`eval/mermaid-upstream-suite-bench/`, 742
  executable cases / 752 imported blocks from pinned upstream commits) — with
  a **ratchet** (`ratchet.json`) that fails the build if coverage drops or
  per-family local-gap budgets grow. These imported corpora retain the source
  revisions recorded in their manifests. Mindmap/GitGraph retain their
  `f3dea583…` source revision and account for all 26/69 official spec blocks in
  a dedicated executable oracle; that historical corpus pin is separate from
  the current writing/reference target.
- **Official-fence corpus** (`official-fence-corpus.test.ts`) — every one of
  the Mermaid syntax fences on the pinned upstream pages named by the
  upstream policy. The fences of rendered families must parse to a
  structured body, verify, render, and keep their structural counts through
  serialize → re-parse; the fences of unrendered families must be
  diagnosed `UNSUPPORTED_FAMILY` with their bytes preserved. Deviations live in
  one small expectations table (`id [ outcomes ] # reason`); a new deviation
  and an unexpected pass both fail, so the table cannot go stale.
- **Grammar-based differentials** (`property-upstream-flowchart.test.ts`,
  `property-upstream-sequence.test.ts`) — recursive `fc.letrec` grammars
  generate sources that pinned upstream Mermaid 12.2.0 must accept; ours must
  accept them too, agree on node/edge/participant counts, shapes, labels, and
  arrows, and round-trip. A long-lived upstream worker
  (`helpers/upstream-mermaid.ts`) lets async properties shrink. Known
  divergences are pinned as explicit cases that fail once fixed.
  The worker runs Node (CI uses Node 24) with development-only jsdom 26.1.0,
  public preprocessing and actual DOMPurify; no sanitizer is replaced. The
  Flowchart grammar property observes authored label operands at live builder
  calls while still invoking each original method. Sanitized HTML can lose
  those tokens, so that property is a grammar contract rather than a claim of
  identical sanitized DB text. Selected modern tests independently inspect
  public runtime values. Snapshots retain parent fields and explicit cycles.

These exist because our hand-written fixtures encode what we already knew
the parser modeled. Upstream examples are "adversarial in exactly the
right way" — they encode what real sources contain (wrapper-fidelity
lesson). The `@{shape}` silent-loss and ER `}o` bugs both escaped 2,200+
self-authored tests and were caught only by docs-derived sources.

Harvesting an upstream source is different from porting its assertions. A
fixture count recorded from our own implementation protects existing behavior;
it does not independently establish agreement with Mermaid's semantic model.
The selected modern assertions use reviewed upstream expectations and narrow
reference projections to close that gap for the covered behavior.

**Runs:** every PR (corpus + seqbench + upstream-suite ratchet); a separate CI
job installs the pinned modern reference for the selected semantic gate when
its code inputs change. Its broader
[`eval/mermaid-modern-compat`](../eval/mermaid-modern-compat/README.md) runner
reports documentation coverage across every modern core family, including
unsupported families. Optional extracted spec literals and seeded mutations
remain diagnostic seed corpora. Extracted test titles, CSS fragments and empty
scaffolds are not feature support or ported upstream assertions. Raw getter
differences are drift candidates requiring review; only the narrow assertions
above fail the semantic gate.
**Faithfulness count-oracle:** the corpus gate now also asserts that the
structured `{nodes, edges, groups}` tally survives a parse → serialize →
re-parse cycle for **every** renderable family
(`eval/shared/structural-count.ts`, gated in `agent-mermaid-corpus.test.ts`).
Round-trip *byte*-stability only proves serialize∘parse is idempotent. The
count check detects changes in the number of nodes, edges and groups, including
the ER `}o` class of bug. It cannot establish that identities, labels, class
assignments or group membership remain correct, or that SVG displays every
parsed element. The modern semantic gate checks selected identity and content
contracts through independent upstream expectations and actual output.

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
  options through `fcParameters(...)` from `src/__tests__/helpers/fc-parameters.ts`;
  process-global configuration belongs to the preload alone. The helper keeps
  local pins in ordinary gates, lets explicit `AM_FC_SEED` replay/finder controls
  override them, and applies `AM_FC_NUM_RUNS` as a minimum without lowering a
  stronger local case count. Use it for explicit `fc.assert`/`fc.check` options
  and exploratory `fc.sample` calls. No-options runners inherit the preload
  directly. A calibrated fixed-corpus ratchet must retain its exact seed and
  cardinality: its finding budget is not a universal property. The hard-metric
  properties beside the layout-rubric ratchets remain eligible for finders.

Pinning is for *holding* known ground; randomness is for *finding* new
counterexamples ("an invariant enforced by a random property is a lottery,
not a gate" — `docs/contributing/lessons-learned.md`). Rolling seeds belong in
finder lanes: the weekly `contract-discovery.yml` workflow, the deep-fuzz scripts
under `eval/`, or deliberate `AM_FC_SEED=random` sweeps.

The weekly **Contract discovery** workflow is a single read-only job capped at
ten runner-minutes, including setup. It first rolls one recorded seed through
the existing Flowchart and ER shadow-model command properties and the valid
Architecture round-trip property. Valid model generators construct legal grammar
contexts; reserved/malformed identifiers have separate source-preservation,
diagnostic and mutation-refusal tests. The normal pinned gate remains deterministic.

A finder-only fast-check reporter writes structured seed/path, counterexample,
callsite, run/shrink counts and failure details. Bun's JUnit result supplies the
owning named test and setup errors. Capturing a property failure still throws;
recording a failure cannot turn it into a pass. There is no display-log scraper,
property-title suppression list or GitHub issue-writing permission. Model failure
stops further search for that run and retains the replay evidence.

The grammar stage uses a seed-selected corpus sample (at most eight short inputs
per native family), 100 text mutations per family, two workers, at most two
retained candidates per contract/family and eight reduction checks. These are
bounded discovery settings, not a claim of exhaustive grammar coverage. It keeps
portable-write, native reload/meaning and source-diagnostic candidates separately
from raw reference token/action/model differences. A reduction must retain the
same candidate contract violation; otherwise the original witness remains. Partial
summaries and the last source survive an interrupted search. Expensive native/
reference instrumentation is a diagnostic; parser disagreement alone is not a bug.

Canonical CI still replays the reviewed corpus in
`eval/mermaid-modern-compat/corpus/grammar-finder-494.json` with `--check` and runs
the required pinned semantic and packed-consumer gates. The historical filename
retains provenance; it is not an issue-notification channel. Review-pin changes
invalidate reporting matches. A repaired input may improve: the corpus never
requires a known defect to persist.

Discovery emits JSON, a step summary and retained artifacts for human review;
it never creates or comments on issues. A failed run must be classified as a
product contract violation, test-domain/oracle mistake, reference/setup failure,
or interrupted search before assigning finite work. Replay on the current pin
and main; retain a minimal original/model counterexample in the existing owning
property and fix the failure class. Review existing finite grammar issues before
opening additional work. Useful yield is reproducible confirmed failure classes
per runner/review hour, with replay completeness and triage time alongside it;
mutation, disagreement and ticket counts do not measure correctness.
Pause recurring discovery while confirmed findings await repair or its oracle
needs correction; replay those finite inputs before spending another search budget.

The former nightly workflow and #362 collector are retired. Historical runs and
counterexamples remain evidence. Their open-ended notification infrastructure is
not needed to keep valid regression coverage. Larger grammar or order searches
remain explicit manual commands for targeted changes and reference upgrades.

Before the pin was frozen, every unpinned suite was
swept across 48/24/12 seeds (scaled by runtime; 1,368 suite-runs total) with
zero failures — the pin does not freeze a known-bad ticket, and the sweep is
repeatable from the same knob.

### Applying Hegel guidance with fast-check

Keep fast-check; use the upstream [Hegel skill](https://github.com/hegeldev/hegel-skill/tree/main/skills/hegel)
and [review checklist](https://github.com/hegeldev/hegel-skill/blob/main/skills/hegel-review/SKILL.md)
to improve properties, not to require a library migration. Derive expectations
from public contracts or an independent model, and check exact values as well
as validity. Cover valid inputs and near-valid rejection separately; preserve
the source when an agent parser deliberately falls back to opaque.

`fc.string()` defaults to printable ASCII. Choose `unit: 'grapheme'` for
printable Unicode, `unit: 'binary'` for Unicode scalars including controls, or
an explicit UTF-16 code-unit arbitrary for helpers accepting arbitrary JS
strings. Keep hostile tokens alongside broad generators. Construct valid
grammar contexts instead of filtering out failures; an explicit `examples`
entry bypasses the generator, including its maps and filters.

For cheap string/parser properties, run thousands of cases. Bound expensive
render materialization deliberately, vary relevant configuration, and add a
separate scale probe without a machine-specific timing threshold. Independent
XML parsing proves well-formedness; finding `<svg` and `</svg>` does not.
Use `fc.assert(fc.property(...))` for per-input invariants so failures shrink;
reserve `fc.sample` for aggregate/distribution measurements.

When applying the skill, have a separate reviewer derive missing properties
from implementation and contracts without seeing the tests. Record every
observed failure as either a reduced product finding or a corrected test
mistake. Do not silently trim a generator or relax an assertion after it fails.

## 5. Pseudo-oracles — do selected seeded faults make the suite fail?

Tests can be green while missing faults. The red-green-refactor cycle is the
defence: write the test, watch it fail for the right reason, then fix.

- **Red → green** is evidence for a bug fix, not a universal PR formality.
  Run `bun scripts/ci/red-green.ts --base <sha>` when comparing changed tests
  with base production helps demonstrate the intended regression. It is an
  opt-in diagnostic: missing imports, setup failures, timeouts and aborted
  runners do not count as behavioral evidence. A located assertion failure
  still needs review; one unrelated red test cannot establish coverage for all
  changed contracts. Refactors preserve behavior and need no failing-base
  assertion or approval label.

**Why this matters:** line coverage is collected weekly and on manual dispatch
by `coverage.yml`, as one merged LCOV artifact assembled from three unit shards.
Locally, `bun run test:coverage` collects the same diagnostic. The required
`bun run test` suite runs every assertion without coverage instrumentation.
Coverage is a weak adequacy signal — coverage is not strongly correlated with fault detection
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

- **Documentation-only changes:** explicitly recognized Markdown paths run
  generated-fact checks, documented CLI/API examples, installed-guide checks
  and website regeneration. Unknown paths and unavailable diff history receive
  full qualification. The final `CI complete` job rejects failures, cancellations
  and skips outside the selected mode.
- **Runtime changes and manual qualification (`ci.yml`):** the three unit
  shards, semantic conformance, type/lint/dependency checks, installed quickstarts
  and browser/CLI/binary/packed-consumer suites remain required. One producer
  builds the portable bundles, website fixture and verified tarball; compatible
  consumers reuse those bytes and install independently under Node 22 and 24.
  Native binary tests and release platform builds retain their own compilation.
  Browser payload checks retain real request graphs and base-branch comparisons.
- **Extended layout review:** rendering/layout changes on PRs select the
  advisory backend-image and generated-layout campaigns. A manual CI dispatch
  always runs full qualification and can request these extra artifacts with
  `layout_evidence`. Ordinary docs changes do not generate the campaigns.
- **Release qualification:** publication requires successful outcomes from
  every full runtime lane on the exact release SHA. A green documentation-only
  run cannot authorize publication; dispatch full CI for that main commit.
- **Weekly (`contract-discovery.yml`):** one bounded model/grammar discovery job;
  findings remain replay artifacts for human triage, without automated issues.
- **Per deploy (`deploy-cloudflare.yml`):** an unpublished package version
  skips deployment with a warning and Actions summary. It opens no issues.
  Verified promotion can close an existing release-to-do issue. Candidate
  website/MCP probes, production identity checks and rollback protect actual
  promotion; a green skipped workflow is not deployment evidence.
- **Local performance campaigns:** benchmark suites are excluded from CI,
  scheduled workflows, hosted manual Actions and publication dependencies.
  `bun run bench:release` retains the matched Node corpus, scaling, agent edit,
  allocation and memory diagnostics; `bun run bench:release:browser` compares
  the exact packed candidate with pinned browser peers. Run them on an owned
  local host and retain candidate/baseline identities and raw results. Controller
  tests live in [Trident](https://github.com/adewale/trident) and run through `bun run bench:test`.
  Normal product correctness, distribution and pinned-Mermaid semantic tests
  remain CI gates. See [Trident](https://github.com/adewale/trident/blob/main/README.md), its
  [unified runner](https://github.com/adewale/trident/blob/main/unified/README.md) and [the launcher](../eval/trident/README.md) for invocation coverage,
  project updates and explicit gaps.
- **Normal local benchmarks:** `bun run bench` runs the bounded unified smoke
  profile; `bun run bench:all` selects the full maintained catalog.
  `bun run bench:samples` runs the website SVG/terminal samples;
  `bun run bench:dave` runs just the full browser comparison (three rounds,
  the same first 30 warm-up attempts, all 1,095 pinned fence occurrences
  including duplicates and unsupported families). It builds and packs the
  checkout, then reuses the publication scorecard against pinned Pele 1.9.0
  and Mermaid 12.2.0. Chromium and initial npm access are required;
  `--executable /path/to/chromium`, `--out DIR`, `--rounds N` and
  `--case occurrence-id,...` are forwarded to the browser runner. A case
  filter is a partial diagnostic, not a full-corpus result. Results go to
  gitignored `bench-report/dave/`; competitor ratios remain advisory.
  The local release browser scorecard retains its full-corpus warm-up by
  default; `--warmup 30` selects Dave's
  warm-up policy. Both disable AM's ELK result cache before loading the
  library, so duplicate sources measure layout rather than memo lookup.
  Timing is source through SVG return, not visual/semantic fidelity or
  paint. The post does not specify its warm-up selection; choosing the
  first 30 is an explicit adaptation. Generated reports are not committed.
  To include Bezel's Rust renderer, install Rust's `wasm32-unknown-unknown`
  target and `wasm-bindgen-cli` 0.2.104, then run:

  ```sh
  (cd ../trident && bun run bezel-wasm/build.ts --checkout ../bezel --out /tmp/bezel-bench)
  bun run bench:dave --bezel-dir /tmp/bezel-bench --executable /path/to/chromium
  ```

  The adapter compiles an unmodified, clean Bezel checkout at `opt-level=3`
  with LTO. Its manifest records the revision, compiler, dependency lock and
  wrapper/WASM byte identities. Instantiation is outside the render timer;
  timed calls use `render(source, &Options::default(), &Metrics).svg`. Reported
  bundle size includes the WASM embedded in its JS wrapper. This measures
  standalone browser rendering, not Bezel's GPUI gallery or native execution.
  WASM memory is outside the separate V8 JS-memory diagnostic.
  `bun run bench --profile full --suites editor-preview` complements that
  render-only score with actual editor input through verified DOM and two
  animation frames. It changes the root label in 5/50/150-node trees, keeps
  default cache behavior and adaptive debounce, and records a 5 ms main-thread
  heartbeat. Run baseline and candidate builds sequentially on an otherwise
  idle runner. These targeted UI samples are separate from the full corpus.
  The standalone editor embeds one module used by both the main thread and
  its Blob worker; it does not embed separate copies of the rendering engine.
  The real-browser standalone contract also caps the complete generated HTML
  at 4,100,000 raw / 1,264,000 gzip bytes and checks worker crash recovery,
  text output and the actual Canvas PNG download. The hosted editor retains
  its separate, lazy worker asset and existing route payload budgets.

  Two optional investigations expand these diagnostics without adding timing
  gates:

  ```sh
  # AGENTIC_ROOT contains package.json and the actual dist/browser.global.js.
  bun run bench --profile full --suites renderer-profile --package-root /path/to/extracted/package --bezel-dir /tmp/bezel-bench
  bun run bench --profile full --suites editor-session
  ```

  The renderer investigation records family-level SVG acceptance, differential
  inputs/errors and paired timing over the complete occurrence inventory. Its
  separate source-build pass attributes stages over distinct sources after
  warmup, both through SVG return and fully consumed receipts; layout includes
  ELK, so those stage totals must not be added together. Chrome CPU profiles
  cover the slowest shared-success example in eight families. Source profiles
  retain function names; only the packaged pass establishes competitor ratios.
  `--timing-report /path/to/renderer-profile.json` can reuse a completed timing
  pass with identical artifact hashes/rounds and a complete adjacent
  `samples.json`; it still reruns stage attribution and profiling.

  The editor session runner covers trees, nested crosslinks, sequence, class,
  ER, state, mindmap, Gantt and pie. Defaults are five fresh browser contexts,
  20 warm edits, 60 subsequent edits and a 30-edit burst requesting 80 ms intervals per
  case. It records median/p95 latency, heartbeat gaps, receipt invalidation,
  visible final labels, worker concurrency and forced-GC JS heaps in both
  realms. Fresh contexts do not clear browser-process or OS caches; localhost
  transfer is uncompressed and unshaped. Heap figures exclude native/DOM/Blob
  backing allocations and process RSS. Use `--case tree-150` for longer focused
  sessions, `--memory-every 100` for periodic retained-heap checkpoints outside
  timed edits, and `--entry /original.html` for standalone builds served in a site
  directory alongside its `capabilities.json` and fonts. Baseline/candidate
  runs must remain sequential on an otherwise idle runner.

  The editor's persistent worker owns preview/verification, ASCII/Unicode and
  PNG projection/validation. A PNG operation invokes the existing main-thread
  font/Canvas callback and transfers an allocation-bounded copy of its bytes
  back for canonical PNG validation. Callback buffers are never detached.
  One operation is active, with one replaceable preview and four queued exports;
  source/config changes cancel stale work, including a PNG awaiting font/Canvas
  I/O, so a new preview can proceed. Timeouts and crashes reject all waiters and
  the next operation starts a fresh worker.

  `editor-ownership-bench.ts --site /path/to/site --out bench-report/ownership
  --executable /path/to/chromium` compares frozen `original.html` and current
  `candidate.html` in alternating fresh contexts. Serve their fonts alongside
  them. It separately measures the empty shell, first preview, ASCII/Unicode
  and a real Canvas PNG, with heap checkpoints before/after preview and exports.
  `--case tree-5,tree-50,tree-150,nested-crosslinks,sequence-40,class-20,er-20,state-25,mindmap-30,gantt-20,pie-12`
  expands it to the full editor portfolio; `--style hand-drawn` measures a seeded
  alternate backend. The runner attempts every format even after a render
  rejection, retains incremental samples and reports per-format acceptance.
  Successful SVG/ASCII/Unicode/PNG bytes and request identities must match
  across variants and repetitions; rejected outputs must have matching errors.
  Report rejected attempts separately from successful-operation latency.
- **Manual / periodic:** `layout-compare` before/after, the benchmark vs competitors,
  `bun run bench:micro` (per-stage hotspot timings, allocation per call under
  `--runtime node`, and `--baseline <ref>` for interleaved revision ratios;
  advisory, never a gate). Filter `^source-edit:` for opaque Class/Flowchart
  edits at 32, 256 and 2,048 nodes, including ten-edit chains and exact label
  no-ops. These start from a warm parsed input and time complete result JSON
  materialization; they exclude verification, layout and rendering. Reports
  retain source/output byte counts and growth. Node allocation estimates cover
  V8, not native memory or peak RSS. Compare with `--baseline <source-edit-ref>`
  and calibrate timing noise with `--aa`; an unavailable baseline API is not a
  fast successful edit. `bun run bench:peers` (the built package against
  the pinned browserless and terminal peers in `eval/fork-graph/`, with output checks outside timing/allocation and label
  checks before timing; includes the native Go Sketch worker, requiring Go >=1.25).
  `bench:peers --corpus` attempts every official fence occurrence, including
  unsupported families, with one warmup and three single-call samples per
  successful input per round. This mode checks output presence rather than
  labels or semantic/visual fidelity; the ordinary calibrated workloads keep
  their label assertions. `bun run check:output-identity --baseline <ref>`
  (byte identity of the distinct corpus inputs across SVG backends, SVG
  post-passes, ASCII, Unicode and verify, for refactors that must not change
  output), the real LLM-as-judge run, and the production freshness check
  (`scripts/ci/production-freshness.ts`, in `docs/contributing/releasing.md`).
  That check compares the build agentic-mermaid.dev serves with the `main`
  commit it is given (the tip of `main`, in the documented command) and fails
  once `main` has held undeployed commits for more than three days. A deploy run proves only the deploys that
  ran; this proves deploys are still reaching production. **Does not prove:**
  that the served build works (the deploy's candidate probes do that).

## Contract review and completion

Before implementing a cross-surface change, put a short contract/evidence table
in the PR description. For a small change, use a sentence. Each contract states
observable behavior, its owning producer and consumers, and what could falsify
it. Choose expectations from public behavior or independent source evidence
before examining existing assertions. Reuse existing tests and probes; this is
a review method, not another generated manifest or test-presence gate.

Preserve distinctions until the component that owns the decision can resolve
them. Examples from PR #470 show why this matters:

| Contract | Distinction to preserve | Evidence at the owning boundary |
| --- | --- | --- |
| Worker recovery | An obsolete operation can still report a broken worker; deferred loading differs from an optional rendering failure | Cancel an export while its import fails, then exercise the queued preview and first retry; compare cold and warm receipts. |
| Deployment recovery | A temporary network failure differs from an old document requesting retired asset URLs | Serve two actual asset generations and preserve the latest draft/settings across explicit reload, including storage/encoding failure. |
| Benchmark identity | A rendered SVG or equal input count does not establish the requested theme or measured source | Assert active/restored theme identity and exact input/module/config identity; reject invalid resume before overwriting evidence. |
| Repository matching | Missing metadata differs from explicit unsupported, malformed or conflicting metadata | Enter through raw repository normalization and matching together; include URI ports and scp-style addresses. |
| Responsibility categories | A known member and valid labels do not establish complete source review | Cite pinned public APIs/authoring flows for assigned roles; leave unreviewed responsibilities explicit. |

Review purposeful transitions and interacting boundaries, rather than every
combination. Where the change applies, consider cold/warm state, cancellation
and failure ordering, representation changes, multiple consumers/platforms and
deployment generations. State exclusions instead of treating untested cases as
passed. Tests should still protect one contract at its owning boundary; do not
combine unrelated UI, persistence and export contracts into one test.

For each confirmed finding, identify the failed assumption and trace it from
raw input through all affected consumers. Distinguish a pre-existing defect
from one introduced by a repair. Review adjacent paths that share that
assumption, extend an existing behavioral test where possible, and demonstrate
red → green for the bug. If only the example is fixed, keep the broader gap
open. If exhaustive review is infeasible, narrow the claim and state the gap.

When multiple reviewers are requested, assign independently falsifiable
hypotheses and explicit ownership of interactions, not just folders. One review
must connect the changed producers to their consumers. Ask reviewers to derive
expected behavior before reading existing tests; permit no finding and require
a reproduction for actionable defects. The change author reconciles findings
against the combined candidate. A severity label or number of agents does not
replace that reconciliation.

Completion requires resolved confirmed in-scope defects, evidence for the
declared contracts, disclosed remaining limitations, and successful required CI
for the exact final head. Record the base/head and dependency revision, link
the CI run, wait for terminal results, then recheck the current base and PR head.
Read the base branch's live remote ref: the PR's recorded base commit and the
workflow event's base SHA can be stale. Inspect the actual CI checkout and its
parents to confirm which base/head combination ran; the workflow run's head SHA
alone does not identify its merge checkout.
After a push, follow the new run. A base update requires a fresh check of the
combined candidate; after code/dependency changes, requalify affected contracts.
Retained measurements may apply when their shipped/input bytes are unchanged;
keep their original revision, date and limits. Never report a pending run as
ready. The hygiene script reports heuristics, not this completion decision.

Repeat an audit to answer a named unresolved question or examine a material
change to a contract. Repeating the same prompt until no reviewer finds
anything is not a stopping rule. New discoveries can reopen an affected
contract; a clean audit alone neither proves completeness nor invalidates
sound evidence for other contracts. Do not create more gates or approval
artifacts merely to certify that the review procedure was followed.

### Boundary-contract matrix — lessons applied from the 2026-07 agent audit

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

`section-a-family-descriptor-conformance.test.ts` exercises built-in layout,
Scene lowering and terminal hooks through public operations, then inspects emitted
Scene roles, primitives and marker resources. Public dispatch and authored meaning
are checked by `characterization-families.test.ts` and
`diagram-family-citizenship.test.ts`. These executable witnesses also protect the
shared style, security and certification integration boundary.
Layout pass tests exercise production enforcement and resulting geometry; a
particular pass name or decomposition is not a rendering contract.

Call counts need an observable reason. Retain them for work admission (for
example, refusing oversized input before ELK or text measurement), deferred
optional graphical work, lazy terminal certification, and the single
positioned-artifact extension protocol.
Do not require an internal serializer or evidence enumerator to run exactly once
when the output, ownership and certificate are the actual contract. Default
pathfinder tie order and sequence spacing constants are likewise implementation
choices; test repeatability, valid routes and painted clearance, and use reviewed
goldens for intentional appearance baselines.

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
2. There is no automatic mutation lane in the current PR workflow. Red → green
   proves an assertion in a changed test file discriminates the base; it does not
   prove every changed behavior is protected. Focused isolated faults can audit
   weak oracles locally. The diff-scoped mutation proposal #355 was closed
   `not_planned`; it is not an active implementation commitment. Line coverage
   remains a finder, not an adequacy score.
3. Performance comparisons are local campaigns and do not run in CI or gate
   publication. Their recorded results require an explicit update. Product
   browser/screenshot e2e and the heuristic-tracker ratchet remain on the PR gate.
4. Determinism is proven Bun↔Node on one architecture; cross-architecture
   byte equality is not asserted.
5. `QualityBounds` thresholds are now provenance-tagged, but the `chosen`
   bands are still not validated against human-perception evidence.
6. Golden movement needs human judgment: each PR description lists every changed
   golden and why it changed. Passing snapshot tests proves consistency with the
   committed baseline, not that a changed baseline improves visual quality.

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
