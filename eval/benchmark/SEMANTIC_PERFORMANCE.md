# Maintained semantic performance qualification

This is the persistent harness work assigned to #433 in
[the peer scorecard comment](https://github.com/adewale/agentic-mermaid/pull/433#issuecomment-6352969557).
It extends `bench:peers` and its existing adapters, verified-package installer,
worker isolation and raw receipts. The separate campaign in #467 owns production
optimizations. Passing release regression budgets does not establish peer
competitiveness or the original 20% time / 30% allocation goals.

## Populations and tracks

The immutable historical anchor remains
`a9d1551da27ddab542a1ae96329464ad65725448`. The existing fixed-baseline workflow
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

- **First use:** one call in a fresh process for each case, consumer and round;
  import is recorded separately. No earlier workload warms that process.
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

Warm tracks prime three real calls, then record 31 individual call durations and
three independent V8 allocation probes, subject to the recorded case deadline.
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

First-use p95 has only one independent call per round in the default protocol,
and cold allocation needs separate fresh-process probes. These remain explicitly
unqualified. Uncalibrated checks are advisory until sufficient repeated controls
exist, as requested by the owner. `ok:true` therefore means no blocking failure;
only `performanceQualified:true` means all enrolled performance checks passed.
The summary always distinguishes `failed`, `uncalibrated` and `passed`.

Allocation is a V8 GC-boundary estimate, excluding native/WASM memory. Zero
observations are retained, but never discarded to manufacture a finite favorable
ratio. Short operations may be too noisy to qualify.

## Actual cache hits and fallbacks

An internal opt-in symbol observer reports decisions at their owning branches:
ELK, positioned layout, SVG inspection, retained Scene/native drawing and paint
certification caches; native adapter fallback, ELK retry/degradation and rejected
layout candidates. Events contain scalar owner/outcome/reason fields, never
source strings, cache keys or retained user objects. Observer exceptions cannot
change rendering, and no public package export is added.

The observer is absent during timing and allocation. Separate successful warm
replays collect hits, misses, bypasses, skipped stores and fallback reasons.
Hit rate is `hits/(hits+misses)`, excluding bypasses. A graphical support event
and successful complete replay establish observation; a scope event followed by
an exception does not. Cold diagnostic replay and uninstrumented peers/baselines
remain **unobserved**, never inferred zero hits. No fallback event during a
successful observed replay means zero observed fallbacks at the instrumented
owners; this is not universal coverage of font/parser/routing fallbacks.

## Reproduction and CI

Build and verify both archives before timing, retaining source/dependency locks.
Then run each cache policy on an otherwise idle host:

```sh
bun run bench:peers:qualify \
  --candidate-tarball candidate/package.tgz --candidate-sha256 <verified-sha256> \
  --baseline-tarball main/package.tgz --baseline-sha256 <verified-sha256> \
  --elk-cache off --rounds 5 --out bench-report/semantic-off
```

Repeat with `--elk-cache on` and a separate output directory. `--quick --rounds 1`
checks protocol plumbing only. `bench:peers --tracks all --aa` exposes the same
maintained protocol directly. `performance-gates.ts --candidate <report> --controls
<aa1>,<aa2> --out <prefix>` regenerates scorecards from retained data.

The Release benchmark workflow has separate cache-off/on calibration jobs. Each
downloads the exact verified candidate, records and packs its immutable main
comparison revision, and serially runs both controls before the candidate.
Controls, runtime locks, raw calls, semantic limitations, actual cache/fallback
events, interrupted status and both scorecards upload even after failure.
Source unit CI exercises fail-closed decisions with controlled observations.
This integration does not revive the recipe interpreter or change native/ELK
selection policy. The original early installed-State window and PNG allocation
controls remain separate release evidence and are not replaced by these tracks.
