# Maintained semantic performance qualification

This is the persistent harness work assigned to #433 in
[the peer scorecard comment](https://github.com/adewale/agentic-mermaid/pull/433#issuecomment-6352969557).
It extends `bench:peers` and its existing adapters, verified-package installer,
worker isolation and raw receipts. The separate campaign in #467 owns production
optimizations. Passing release regression budgets does not establish peer
competitiveness or the original 20% time / 30% allocation goals.

## Populations and tracks

The immutable historical anchor remains
`a9d1551da27ddab542a1ae96329464ad65725448`. The local fixed-baseline runner
and complete release inventory remain available; the anchor is not advanced to
make a gate pass. Its known unsupported families remain failures in its own A/A
coverage report.

The fixed shared cohort is **flow5, tree50, mesh50, seq20, class80, er40, state80**.
It never shrinks to an opportunistic successful intersection. Full Agentic
coverage retains all 14 SVG fixtures and complete receipts. Additional tree100
and mesh100 cases measure larger-input behavior without altering the seven-case
cohort. Unsupported, lost-label and error observations remain explicit for every
peer, round, phase and consumer; third-party receipt APIs are not invented.

`--tracks all` separates:

- **First use:** 21 individually timed first renders, three allocation probes
  and one untimed diagnostic render per case, consumer and round. Every render
  has its own fresh process; no earlier render warms it. Allocation and
  diagnostic calls never enter the timing distribution. Per-worker import/setup
  receipts remain separate, with medians recorded in the aggregate.
- **Warm new source:** warmed engine, real changed visible labels and renamed
  authored identifiers, with a new source variant for each observation.
- **Exact repeat:** identical source bytes after priming.
- **Label edits:** changed visible node/message or relationship labels while
  authored identities stay fixed. Class, ER and State use shared relationship
  syntax, so a peer's ignored declaration aliases do not create a false comparison.

Each phase has separate **consumed SVG** and **complete serialized receipt**
consumers. UTF-8 materialization and a byte checksum run inside the measured call;
receipts serialize the entire returned artifact. Each returned SVG is checked
outside the clock for XML acceptance, expected text, nonempty drawable geometry
and the bounded authored identity/endpoint contract where observable. Missing
endpoint observability is explicitly unavailable, not semantic equivalence.
Those peers retain label-checked timings but cannot pass semantic numeric gates.
These checks do not prove attachment geometry, edge multiplicity or aesthetics.

Warm tracks prime at least 20 real calls and 1,000 ms of elapsed warmup, then
record 201 individual call durations and three independent V8 allocation
probes. The 180-second measurement budget accommodates the complete population
on fresh large meshes; it does not change renderer resource limits. The worker
no-progress cap remains 300 seconds, and the report watchdog remains 90 minutes.
A completed indexed-consumer report must contain its whole declared timing
population; deadline truncation cannot qualify a different
source population on one side.
Actual warmup calls, elapsed time and completion are retained per observation.
A failed or incomplete warmup remains an error; it cannot supply a numeric pass.
Warmup, timing, allocation and diagnostics have separate ordinal counters and
short authored-label/identifier namespaces. New-source and label-edit warmup
advance fresh ordinals on every call, exercising the same source-miss path as
timing instead of priming repeated hits on a 20-variant working set. Faster
priming can therefore consume more distinct warmup inputs; its actual call count
remains recorded. Independent counters ensure that timed source `q1`/`v1_*`
starts identically across peers regardless of how many warm calls fit in the
elapsed interval. Warmup uses `w*`, allocation `a*`, and diagnostics `d*`, so a
warm source cannot prime a measured new-source/edit input. Allocation and
diagnostic inputs also stay identical across sides when timing hits a deadline.
Exact-repeat and first-use deliberately retain original bytes in every stream.
Raw calls record their domain; the domain policy and
`warmupSources: fresh-edit-ordinals-v1` enter the control fingerprint. Controls
from the earlier cyclic priming policy cannot qualify this method. This fixes
the priming workload mismatch; it does not establish stationary tails or claim
that calibration is resolved.
The privately created UTF-8 Buffer is consumed by indexed reads. Earlier
for-of traversal could retain about one iterator-result allocation per byte,
depending on V8 optimization, producing a 3.82 MB same-package artifact in
Mesh full-receipt profiles. The indexed loop preserves exact bytes, checksum
and getter order. API bindings, default font/measurer options, XML-validation
font options and the actual source-freshness mechanism enter report metadata.
The frozen Pele lane remains version 1.6.0; later source research at 1.10.0
does not silently update that pin or turn a public SVG API into browser mount
timing. Neither fresh identities nor one authored label edit means every
unchanged label receives fresh text preparation.
They do not report a percentile of batch averages as call p95. A minimum of 20
complete calls per warm case is required for tail qualification. Quick mode is a
functional smoke policy, never performance qualification. Legacy `bench:peers`
without `--tracks` keeps its existing warmup and calibrated-loop methodology.

## Calibration and decisions

`bench:peers:qualify` runs **two independent A/A reports**, followed by the
candidate comparison, serially on the same host and in the same cache mode.
Each report uses five counterbalanced rounds. Both Agentic sides in A/A install
the exact comparison baseline archive. Package hashes and canonical resolved
runtime dependency graphs must agree, alongside host/runtime, fixture source,
sampling policy and cache policy. Peer package/integrity and dependency graphs
also bind their calibration. Recorded Git revision and a clean harness worktree
prevent reusing controls after changing variant generation, validation or timing
code; full input records are compared directly. Known feature/runtime settings
(`AGENTIC_MERMAID_EXPERIMENTS`, `NODE_OPTIONS`, `BUN_OPTIONS`, `NODE_ENV`, `TZ`)
are recorded and must match. An explicit experiment string, including the empty
string that disables defaults, cannot qualify the default production profile.
Missing or failed mandatory warm controls fail
completeness; they cannot disable an otherwise adverse numeric gate.

Before any benchmark worker, warmup, import measurement or browser launch,
the shared acquisition owner (`release-baseline.ts`) derives an exact runtime
closure from the frozen source `bun.lock`. `--runtime-source` selects that source
directory; a Git-baseline campaign supplies its immutable baseline worktree,
and standalone archive commands default to the current root. The Node
`--baseline` directory mode also defaults to that directory's lock when present.
Both Agentic archives install with the same exact temporary root overrides,
including runtime transitives and native optional packages. Installed versions
and fetched SHA-512 integrities must match the frozen policy, and the actual
resolved dependency graphs must match each other. Equal fresh resolutions alone
are insufficient: both resolving a newer caret-compatible ELK or YAML still
fails the intended frozen policy. Third-party peers retain their own graphs.

Each acquisition retains the separate consumer manifest/override policy,
source policy, npm lock and installed lock, and actual runtime graph. Original
shipped archives, their manifests and archive identities are unchanged. Git
baseline release comparisons install both original archives under this policy;
directory comparisons inspect actual installed versions and the directory's own
frozen Bun identities, with that integrity source recorded explicitly. An
unlocked directory with no installed npm lock is rejected as unverifiable.
Drifted historical reports remain diagnostics for their recorded
graphs and are never relabeled as dependency-matched qualification. Matched local
reports using another explicitly recorded runtime graph remain distinct evidence.

Targets are explicit and distinct:

| Scorecard | p50 target | p95 target | Allocation target |
| --- | ---: | ---: | ---: |
| Candidate / release baseline | ≤1.05× | ≤1.10× | ≤1.05× |
| Candidate / Beautiful and Pele, separately | ≤1.00× | ≤1.00× | ≤1.00× |
| Normalized doubled-size cost growth | ≤1.05× | ≤1.10× | ≤1.05× |

The first two tables pair each case's same-round observations, then take the
median ratio across rounds. Scaling growth is
`(candidate100/candidate50)/(baseline100/baseline50)` per round, then its median.
All 14 Agentic cases and both larger cases retain independent relative-regression gates.
No corpus median can conceal a failing case or tail.

For each metric, calibration uses the largest symmetric A/A ratio across all
control rounds, with a 2% margin. The effective blocking budget is the greater
of the explicit target and that noise bound. Predeclared control noise ceilings
are 15% for p50, 25% for p95 and 10% for allocation. Controls exceeding these
ceilings are **uncalibrated**, not passes; the gate does not expand indefinitely
to accommodate noise. Peer calibration additionally checks the dispersion of
paired baseline/peer ratios across both controls. A calibrated missed budget is
a blocking failure. Gate JSON records every control ratio and effective budget.

First-use p95 requires at least 20 independent first-render workers per round,
and allocation requires three separate fresh-process probes. The default
protocol supplies 21 and three respectively; quick mode supplies only three
timed workers and remains unqualified. Every worker failure is retained in the
aggregate, rather than silently dropping a missing process. Old one-call cold
reports remain insufficient and cannot calibrate the new sampling fingerprint. Uncalibrated checks are advisory until sufficient repeated controls
exist, as requested by the owner. `ok:true` therefore means no blocking failure;
only `performanceQualified:true` means all enrolled performance checks passed.
The summary always distinguishes `failed`, `uncalibrated` and `passed`.

Allocation is a V8 GC-boundary estimate, excluding native/WASM memory. Zero
observations are retained, but never discarded to manufacture a finite favorable
ratio. Short operations may be too noisy to qualify.

The repaired consumer and larger population improve calibration without
changing numerical ceilings. They do not establish steady-state execution:
ordered-window drift and fresh-process uncertainty remain visible. A local
two-control preflight calibrated all four allocation cells and 11/12 total
cells; Sequence p95 remained uncalibrated. Longer priming alone, forced-GC
boundaries, a different allocation estimator and a separate validation heap
did not close that remaining problem and are excluded. No GC policy, affinity
or validation-heap change is selected. Method effects are not renderer gains;
fresh complete controls must qualify any candidate under this new fingerprint.

## Immutable historical anchors

The local previous-npm-release comparison explicitly selects
`normalized-npm-compound` in both the Node and advisory browser commands. The
original exact-version npm archive is retained and its locked SHA-512 integrity,
installed name and version are checked before reading its declared roots/ranges.
Its roots must be a subset of the current frozen source roots, and every range
must admit the current pin. This narrow mode supports stable exact, caret,
tilde and equal version ranges; other syntax is rejected, not treated as a
wildcard. The current frozen closure is projected onto those verified roots,
while the temporary consumer's actual full-current overrides and locks remain
retained. All installed versions/SRI and shared dependency edges still match;
extra closures must be attributable to exclusive declared roots.

This policy is labeled **normalized from current source**, not the published
baseline's original frozen dependency environment. Receipts explicitly mark
`isolatedProductionGain:false`; original archives/manifests remain unchanged.
No coverage or numeric gate is waived. Browser IIFE/lazy code stays exactly as
published: normalizing the external consumer graph does not rebuild or prove
equality of embedded dependency versions. Its scorecard remains advisory and
compound. This mode requires a locked npm baseline; Git/tarball current-main
comparisons and all semantic calibration retain strict full-graph equality.

The local fixed historical campaign explicitly uses `historical-compound` runtime
comparison. Baseline and candidate each install under their own frozen source
policy; the shared dependency versions, SHA-512 integrities and dependency
edges must still match exactly. Only package closures reachable from declared
roots exclusive to one side may differ. Both policies, installed locks, root
differences and closure differences accompany a comparison receipt marked
`isolatedProductionGain:false`. The resulting ratios describe a compound
historical comparison, never an isolated gain from this PR. Current-main and
default commands retain exact full-graph equality; this exception cannot
qualify the calibrated semantic controls. Historical A/A remains baseline-only,
and unsupported inputs and existing numeric/coverage gates remain failures.
Original shipped archive bytes and package manifests remain immutable; install
overrides belong only to temporary consumers. Default validation and timing
behavior remain unchanged.

A local campaign restricted to the fixed historical baseline retains candidate
build, pack and provenance, then runs the original five-round fixed A/A,
comparisons, peers and profiles. Record any skipped current-baseline Node
comparisons, browser scorecard or semantic matrix explicitly; such a run cannot
claim full qualification. Prior reports keep their original harness and archive
identities; controls are never reused across harness revisions.

## Actual cache hits and fallbacks

An internal opt-in symbol observer reports decisions at their owning branches:
ELK, positioned layout, SVG inspection, retained Scene/native drawing and paint
certification caches; native adapter fallback, ELK retry/degradation and rejected
layout candidates. Events contain scalar owner/outcome/reason fields, never
source strings, cache keys or retained user objects. Observer exceptions cannot
change rendering, and no public package export is added.

The observer is absent during timing and allocation. Separate successful
replays collect hits, misses, bypasses, skipped stores and fallback reasons.
Hit rate is `hits/(hits+misses)`, excluding bypasses. Positioned-cache events
count one logical lookup: the private borrowed probe and any following cloned
public probe do not count as two misses for one lookup. A graphical support event
and successful complete replay establish observation; a scope event followed by
an exception does not. Cold diagnostics use their own fresh first-render workers.
Every successful candidate observation, including cold, requires a complete
observed diagnostic replay to qualify. Uninstrumented peers/baselines remain
**unobserved**, never inferred zero hits. No fallback event during a
successful observed replay means zero observed fallbacks at the instrumented
owners; this is not universal coverage of font/parser/routing fallbacks.

## Local reproduction

Build and verify both archives before timing, retaining source/dependency locks.
Then run each cache policy on an otherwise idle host:

```sh
bun run bench:peers:qualify \
  --candidate-tarball candidate/package.tgz --candidate-sha256 <verified-sha256> \
  --baseline-tarball main/package.tgz --baseline-sha256 <verified-sha256> \
  --runtime-source /path/to/frozen-baseline-source \
  --elk-cache off --rounds 5 --out bench-report/semantic-off
```

Repeat with `--elk-cache on` and a separate output directory. `--quick --rounds 1`
checks protocol plumbing only. `bench:peers --tracks all --aa` exposes the same
maintained protocol directly. `performance-gates.ts --candidate <report> --controls
<aa1>,<aa2> --out <prefix>` regenerates scorecards from retained data.

Run cache-off and cache-on calibration as separate local campaigns. Keep the
exact verified candidate and baseline archives, both independent controls,
resolved runtime locks, raw calls, semantic limitations and interrupted status.
Benchmark runners and their controller tests are excluded from CI. Use
`bun run bench:test` for the controlled decision tests; normal source correctness
checks continue to run in product CI. The original early installed-State window
and PNG allocation controls remain separate evidence and are not replaced by
these tracks.

## Complete local campaign execution

Build and pack the pinned main baseline once, then run each phase/consumer
combination separately in each cache lane (16 runs total). Every run retains all
14 Agentic workloads, the fixed seven-case peer cohort and both doubled-size
scaling cases. Run its two independent A/A reports and A/B report serially on the
same otherwise idle host. Its ratios and seven-case means never cross host
boundaries. The 90-minute report and 300-second worker no-progress watchdogs,
rounds, numeric thresholds and historical anchor remain unchanged. Warm
populations contain 201 calls; cold timing retains 21 independent first-render
workers. No hosted job schedules or executes these campaigns.

`qualify-peer-performance.ts --phase <phase> --consumer <consumer>` emits
`scopeComplete`, but leaves global `complete` false. One phase/consumer run cannot
declare full performance qualification. `aggregate-semantic-performance.ts`
requires all 16 scoped evidence directories; it recomputes the decisions from
each candidate and both controls, requires matching archive bytes, peer pins,
harness revision, authored inputs and execution settings, and preserves each
host's provenance. Missing, duplicate, interrupted or incompatible evidence
fails closed. No numeric ratios are pooled across hosts. All adverse and
uncalibrated decisions remain in the aggregate JSON.

Artifacts retain attempt numbers. Duplicate runs for the same scope are rejected
rather than silently selecting a favorable attempt. A complete campaign uses a
fresh campaign directory; partial controls from an interrupted campaign are not
resumed.
