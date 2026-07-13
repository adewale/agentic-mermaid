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
| **Pseudo / adequacy** | The *tests themselves* are strong enough | Stryker mutation lanes, sabotage suite |
| **Heuristic / perceptual** | Geometry falls inside human-plausible bounds | `measureQuality`/`checkQuality`, ugly-detector, layout rubric, heuristic-tracker |
| **Human / model** | Subjective quality on the axis nothing else covers | LLM-as-judge (periodic), manual visual review |

The rest of this document walks each row: what it is, where it lives,
whether it gates per-PR, and what it does *not* prove.

## 1. Specified oracles — structural correctness

**Tier-1 `verify`** is the non-negotiable structural gate: no
`EMPTY_DIAGRAM`, `EDGE_MISANCHORED`, `OFF_CANVAS`, `GROUP_BREACH`,
`UNKNOWN_SHAPE`, or `LABEL_OVERFLOW`. It is reliable and universal across
families. **Tier-2** (geometric) and **Tier-3** (lint) are advisory.

Alongside it sit the **contract gates**: `am capabilities --json` schema
tests, `doc-sync`/`agent-doc-sync` tests, and the diagram-family
citizenship matrix. For an agent-native product the docs, schemas, CLI
help, and `llms.txt` *are* runtime surface (Loop 14), so they are tested
like code, not treated as prose.

**Runs:** every PR (`bun test src/__tests__/`).
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
per PR — it is the `e2e` job in `ci.yml` (`needs: test`), which installs
Chromium and runs `browser.test.ts` (screenshot diff), the CLI/security e2e,
and the single-binary e2e. The broad contact sheets are not on the per-PR gate.
**Does not prove:** that a *changed* golden is an improvement — only that
change was noticed. Judging the change still needs a human or the
before/after harness (`eval/layout-compare`).

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
  and PNG output hash-stable across 10+ repeated runs.
- **Layout/faithfulness relations** — `property-layout-metamorphic.test.ts`
  formalizes relations that were previously implicit: determinism (same source
  ⇒ identical metrics), node-id **relabeling invariance** (ids carry no
  meaning), **disconnected-node monotonicity** (adding an isolated node adds
  exactly one node and drops nothing), and **edge-add monotonicity**.
  Statement-permutation invariance is deliberately *not* asserted — source
  order is a stated design property, so permuting statements may legitimately
  change geometry.

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
pin the exact seed that exposed their bug, scoped via save/restore so the
global policy survives them).

- Reproduce a specific roll: `AM_FC_SEED=<int> bun test <file>`.
- Finder mode (deliberate randomness): `AM_FC_SEED=random bun test src/__tests__/`.
- The policy is itself gated: `fc-seed-policy.test.ts` fails if the preload is
  unwired; `zzz-fc-seed-policy-epilogue.test.ts` (alphabetically last) fails if
  any suite wipes the pin instead of restoring it.

Pinning is for *holding* known ground; randomness is for *finding* new
counterexamples ("an invariant enforced by a random property is a lottery,
not a gate" — `docs/contributing/lessons-learned.md`). Rolling seeds belong in
finder lanes: the deep-fuzz scripts under `eval/`, or deliberate
`AM_FC_SEED=random` sweeps. Before the pin was frozen, every unpinned suite was
swept across 48/24/12 seeds (scaled by runtime; 1,368 suite-runs total) with
zero failures — the pin does not freeze a known-bad ticket, and the sweep is
repeatable from the same knob.

## 5. Pseudo-oracles — is the suite itself strong enough?

Tests can be green and still worthless. Two gates test the tests:

- **Mutation testing (Stryker)** — scoped to the high-value ASCII/route
  core, ~20 named lanes (`stryker.*.config.json`). A *survived* mutant is a
  test gap until classified. Documented baseline kill rates are 38–75%,
  with a written survivor catalog and explicit "accepted" classifications
  (performance guards, unreachable-by-convention). Mutation testing has
  earned its keep: it falsified an audit assumption and found dead code the
  unit tests couldn't.
- **Sabotage suite** (`eval/sabotage/route-regressions.ts`) — deliberately
  reverts a fixed bug in a detached worktree and asserts the suite goes
  **red**, proving the regression test actually bites.

**Runs:** the broad route lanes are **scheduled nightly**
(`nightly-route-mutation.yml`: routes, route-certificates, subgraph-routing,
sabotage-routes — the ascii lane is manual-only), but every scheduled run since
2026-06-19 has been cancelled at the 90-minute cap before producing a score
(the unsharded routes lane alone exceeds it; PR #63 carries the sharding fix) —
until that lands, regenerate scores locally. A narrow module takes 5–15 minutes
locally; the full routes lane substantially longer. A **fast
incremental lane** (`stryker.incremental.config.json`, the `mutation-incremental`
CI job) mutates only the small pure faithfulness counter
(`src/agent/structural-count.ts`) with a sub-second unit runner, so it gates
**per-PR** (~1 min, measured 96% kill / break-threshold 90).
**Why this matters:** line coverage is reported per-PR but is a weak
adequacy signal — coverage is not strongly correlated with fault detection
once suite size is controlled (Inozemtseva & Holmes, ICSE 2014), whereas
mutant detection *is* correlated with real-fault detection (Just et al.,
FSE 2014). The mutation score is the truer number; today it comes from local runs (the nightly lane times out — see above).

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
  improvement/regression deltas, now gated per PR (`heuristic-tracker.test.ts`):
  hard violations must stay 0 and no tracked example may regress on a soft
  metric without a reviewed `baseline.json` update in the same change.
- **route-contract tripwires** — `ROUTE_*` codes that must stay 0; any hit
  means the layout pipeline regressed, not the diagram.

**Runs:** `measureQuality`, ugly-detector, the layout rubric, and the
heuristic-tracker ratchet all gate per PR.
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
spend plus nondeterminism make it unfit for a per-PR gate. In CI it is
replaced by a deterministic mock.
**Protocol hardening (Move 1):** the readability/aesthetics axes of the CI
mock are still derived from the perceptual metrics (it is a wiring stub), but
the **faithfulness** axis now comes from `independentFaithfulness()` — a
structural parse → serialize → re-parse count check that does *not* consult
`measureQuality`, removing the circularity on that axis. The real judge has
primitives for the documented LLM-judge biases (Zheng et al., NeurIPS 2023):
`judgePairwiseDebiased` scores both orders and trusts only an agreeing verdict
(position bias), `assertJudgeIndependence` refuses a judge from the same model
family that authored the diagram (self-enhancement), and `JudgeReference`
threads a golden anchor (reference-guided scoring).
**Known limitation:** the mock's readability/aesthetics axes remain
metric-derived, so they cannot independently validate those metrics — only a
real judge run can.

## What runs where

`ci.yml` is the source of truth for what gates each PR — read it rather than a
table here, which would drift. In broad strokes:

- **Per-PR (`ci.yml`):** the unit/property suite (`bun test src/__tests__/`) —
  Tier-1 verify, goldens, the differential + faithfulness + metamorphic gates,
  `measureQuality`/ugly-detector/layout-rubric, the heuristic-tracker ratchet,
  the corpus/seqbench/upstream benches — plus type check, the hero check, the
  golden-drift gate, the browser/CLI/binary e2e job, and the fast incremental
  mutation lane.
- **Nightly (`nightly-route-mutation.yml`):** the broad Stryker route lanes
  and the sabotage suite (scheduled; currently cancelled at the timeout every
  run — see §5).
- **Manual / periodic:** `layout-compare` before/after, the benchmark vs
  competitors, and the real LLM-as-judge run.

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
   admittedly rough. The CI LLM mock's readability/aesthetics axes remain
   metric-derived (only its faithfulness axis is now independent), so it
   cannot validate those metrics — only a real periodic judge run can.
2. The *broad* mutation lanes and sabotage are scheduled nightly but the
   schedule has never completed a run (timeout — see §5); a fast incremental
   lane gates the faithfulness counter per-PR, so most core modules' adequacy
   is currently measured only by local runs. Line coverage is no
   longer the per-PR headline (it is framed as a finder).
3. The benchmark is not on the PR gate (timing variance). Browser/screenshot
   e2e and the heuristic-tracker ratchet now are.
4. Determinism is proven Bun↔Node on one architecture; cross-architecture
   byte equality is not asserted.
5. `QualityBounds` thresholds are now provenance-tagged, but the `chosen`
   bands are still not validated against human-perception evidence.
6. The snapshot drift sentinel warns but does not block.

The deepest gap is structural, and `project/lessons-learned.md` (Loop 13)
names it: every quality signal here is self-generated. The portfolio above
produces breadth and internal consistency; it cannot substitute for a real
external consumer.

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
