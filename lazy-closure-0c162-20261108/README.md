# Native/ELK closure comparison and stopped causal probes

Runtime source: `0c162c446b58ad98d0a5550719592a0d868619f8`.
Documentation checkpoint: `df133c69480e71d230a0e9256b1103cc5068bd22`.
Main reference: `e7cb05baa7f68154942a9ce9c6e9aaaee163dc94`.
No runtime source changes ship in this cycle. The Native replacement objective
remains unfulfilled; neither failed probe is described as a repair.

## Actual built-module transfer

Reused the canonical lazy tsup configuration and existing browser-lazy-report.ts.
Builds write to fresh evidence directories, without cleaning retained dist files.
The reporter adaptations change only input/catalog paths; --measure-only reports
the existing graph, skipping structural checks and budgets. Gzip9/Brotli11 are
measured for every complete emitted module and summed over the existing static
plus selected-provider closure. This is not browser request capture or startup.

| Family | Native gzip / Brotli bytes | ELK gzip / Brotli bytes | Native / ELK module count |
|---|---:|---:|---:|
| Flowchart |378,598 /320,974|746,952 /590,334|29 /25|
| Class |301,679 /253,597|676,503 /528,610|21 /18|
| ER |337,438 /284,986|705,792 /554,346|23 /19|
| Requirement |272,136 /228,228|638,478 /495,728|16 /10|

All nine graph families with a Native provider in this report have smaller
raw/gzip/Brotli closures. Native needs more modules; fewer bytes do not establish
lower latency, less decode work, lower heap or delivery of an unsupported case.
QUALIFIED-CLOSURES.json retains all families and each selected dependency closure.
ELK is the same pinned0.11.1 in the qualified PR/main builds.

This backend difference is separate from the PR's common correctness-pipeline
growth versus main. Equal-dependency budgeted closures grow46,076gzip bytes for
Flowchart and40,813 for Timeline. Pre-compaction attribution points primarily to
capture, serialization and final-paint checking. Attribution is not removable
compressed cost. The independent checks remain necessary.

## Forced-grouping hypothesis: stopped

The outside-source without-forced-union.ts trial removes only the two build-time
reachability hints that force families/providers into the render-core union.
It makes every family closure larger: selected gzip deltas about+900bytes,
Brotli about+2,700bytes and two more modules. Initial transfer also grows.
STOPPED-UNION-TRIAL.json retains every result. The hypothesis is falsified;
the production build configuration is unchanged. No runtime improvement claimed.

## Sparse32 hypothesis: stopped

The existing owner reproduces2passes/1failure and13,729 assertions: the32-marker
case delivers SVG but remains unverified at400k. A fresh profile runs before the
new trial. The inherited phase named edit repeats the same fixture; it is not an
edit measurement. Full outputs, receipts, profiles and transform maps are retained.

The outside-source deferred-token trial replaces known-name hash/duplicate work
with fixed attribute bits while keeping validation deferred. It still exhausts
the original cap; emitted SVG stays exact. It does not ship.

Count-only diagnostic variants relax emission accounting to measure remaining
work, while the public final-proof cap still rejects. They report450,245 baseline
emission operations and421,715 for the token trial, before remaining proof work.
Neither is an admissible candidate or passed public proof. These diagnostics
must not be cited as correctness or cap-preserving repair results.

The independent Astra review finds the suggested paint-replay fusion targets
an unused path: these labels have own paint. Even deleting all six-event dispatch
overhead would save at most18,000 operations, short of the additional estimated
35,033 needed after the token trial. It recommends stopping this hypothesis.
See sparse-value-review.md; no review tests/builds/source edits were performed.
The earlier eager-streaming trial remains stopped for its authority concern.

## Failed acquisition/build attempts retained

- Initial esbuild invocation failed under the sandbox; the same build ran with
  child-process support. The first programmatic tsup invocation unexpectedly
  inherited the root configuration; canonical runs explicitly set config:false.
- First reference node_modules symlink resolved ELK0.11.0 despite the locked
  repository0.11.1. That build is excluded from equal-dependency results. The
  original symlink is retained as node_modules.initial-symlink; corrected builds
  use the PR's installed dependency links. No package lock/version was changed.
- Initial reporter/trial entry resolution failures are retained. A local link
  to existing dependencies fixes resolution without installing new packages.

## Completion and remaining blockers

The documentation checkpoint corrects stale payload/runtime scope and records
completed runtime CI failure42431021452: Sparse32, lazy/website payload limits
and generated-layout advisory. Browser/site, package-consumer, CLI, semantic
conformance and two other unit shards passed. New documentation CI does not
repair this underlying runtime failure.

No unchanged broad corpus replay is counted as progress. Only the named Sparse
owner was rerun to reproduce the loss; no full local suite or giant package build.
Source caps, defaults, versions and caches are unchanged. Literal public meaning,
actual ink, visible contacts, runtime and memory remain separate from these
module-byte measurements. Native's remaining correctness/quality and performance
losses prevent a general replacement claim. Replacement24 stays sealed.

The archive retains every failed probe and build. Restore under the original
/tmp/pr449-week-comparison-20261101 directory with the recorded repository and
existing installed tools. No new qualification framework was introduced.
