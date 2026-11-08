# Trident Native / ELK fairness review —df133

Read-only review of pinned Tridentf080278 portable worker/execution/report code,
the local pilot and retained case/result evidence. No tests, builds, timings,
profiles, network operations or agents were started by this reviewer.

The proposed experiment is defensible as a **backend-selection comparison of
one public Node SVG artifact**, with separate cache lanes and Trident's normal
measurement protocol. It is not a two-implementation bundle comparison or a
solver-only microbenchmark. Keep the following distinctions explicit.

## Concrete issues to handle before interpreting timing

1. **Default probes and preludes.** `worker.mjs:63–64` invokes every prelude with
   undefined options. The accepted configuration-reset prelude therefore uses
   default ELK in both lanes. Its cold timing is the first *final-source* call
   after that prelude, not first-ever engine use: ELK has already initialized
   its selected solver while Native has first executed a different policy.
   Preserve the original prelude and disclose this scope; do not silently relabel
   that row as clean Native-vs-ELK first-use. `measurePortableProject` also creates
   fresh familySupportProbe cases without the selected backend options. If
   probes are used in orchestration, apply the same backend selection to their
   jobs; a default-ELK probe cannot establish Native support.
2. **Observed qualification failure.** The completed54-job pilot has, in each
   lane,25partial,1failed and1passed. Both configuration-reset edited-output
   jobs fail acceptance; the passed case is negative-source rejection. Retain
   that failed row/diagnostic and investigate separately. It is neither a
   successful render nor an eligible speedup observation merely because both
   backends fail. Do not change the original edit expectation to make timing
   eligible.
3. **Observed fidelity gaps.** Current canonical Node index does not expose
   `api.parse`, which the unchanged worker optionally uses. Positive pilot rows
   report model identity/endpoint/label checks unmeasured, and full painted
   semantic correspondence is also unmeasured. This is a legitimate unchanged
   public SVG protocol, but not full semantic or visual parity. Do not add a
   synthetic engine wrapper merely to convert partial qualification to passed.
4. **Lane isolation in reporting.** `portableSummary` keys workers by case,
   round, replica and sample; backend/cache are not protocol key dimensions.
   Feed it separate backend/cache result sets. A0/A1/B are controls of the same
   artifact *and options lane*; their candidateRatio is measurement variation,
   not the Native/ELK effect. Report matched backend timing ratios separately
   from each lane's control spread/calibration. Do not substitute Native into B
   while leaving ELK in A0/A1 and describe that as unchanged calibration.
5. **Environment custody.** Standard environmentIdentity records several host
   settings but omits AGENTIC_MERMAID_ELK_CACHE. Record its0/1 value explicitly
   with every lane/job collection, set it before child startup, and keep other
   relevant experiment/APL settings identical. Cache0 is not a claim that every
   text/schema/preparation cache is disabled.

## What the unchanged timing protocol measures

- The same admitted artifact/entry/providers are used for both backends. The
  selected case mapping changes graphLayout backend/fallback:none in seed and
  edit options, preserving the existing fontSize edit and other options.
- Worker `invoke` clones options before the API clock, then times public
  renderMermaidSVG, promise completion if needed, return validation and UTF8
  byte counting. Import and semantic qualification are outside that clock.
  It does not time the SVG+receipt API, so it cannot replace prior fully
  consumed receipt measurements or claim receipt-equivalent cost.
- First-use batches import concurrently behind an idle barrier but time one
  API at a time and wait for child exit. Preserve that scheduling and use no
  overlapping profiling/build/resource work during timing.
- Warm tracks run in fixed protocol order with bounded adaptive batches.
  Retain `iterations`: faster lanes may execute more calls per2ms sample.
  p95 of per-call batch means is not individual-call tail latency.
- warm-new-source appends comments to otherwise identical semantic graphs.
  It probes source-key behavior, not guaranteed geometry recomputation under
  cache1. Named cache0 and edit tracks provide different evidence; do not pool
  them into one generic warm speed.
- A selected backend may use a shared forest/fast path. SVG-only results do not
  establish that the underlying layered solver ran on every case. Call this
  backend policy cost unless separate unchanged product evidence binds an
  actual solver call; do not instrument the public API inside the timer.

Five rounds,31warm samples and20cold workers per A0/A1/B meet Trident's minimum
counts only if all identities/samples complete and control spread passes.
Missing, failed, blocked or noisy rows remain uncalibrated. For all27cases,
2backends and2cache settings, that plan means34020 timed worker jobs before
baseline/memory/retention diagnostics. A finite incomplete campaign must retain
its denominator and cannot become a general-parity conclusion.

## Memory and delivery scope

Trident memory snapshots are API-return and post-GC deltas from a fresh imported
process, before qualification allocations. GNU time covers the whole fresh
worker, including import, driver, GC and post-snapshot qualification. Keep
those separate; their difference is not an API-only allocation peak. Baseline
jobs execute declared preludes too. Qualify memory delivery and preserve failed
calls rather than comparing a refusal allocation to a completed render.

The clean canonical Node index/runtime-provider build is a valid single
artifact for this comparison, but it is not a published tarball, browser lazy
closure, IIFE, standalone HTML, PNG or CLI build. Both backend lanes necessarily
have the same built artifact bytes. Trident per-file gzip/dependency inventory
is not observed network transfer and cannot establish browser download savings
from selecting Native. First demand/loading and process memory can differ even
when those shared artifact bytes are identical.

The22 excluded cases should remain recorded with their reason (no graph-backend
selection effect). The27 selected cases are the declared comparison domain,
not all Mermaid workloads. Calibration, acceptance, native/model correspondence,
actual paint and delivery cost remain separate results. The pilot is useful
qualification evidence and supplies no calibrated performance verdict.
