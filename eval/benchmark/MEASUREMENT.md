# Benchmark measurement rules

The five primary questions are docs rendering, original upstream assertion
compatibility, required-family coverage, entry startup and resource use. Keep
their denominators, units and scopes visible. No weighted overall score ranks a
partial renderer, a source-preserving parser and a complete invocation service
as interchangeable tools.

Dan Luu's [The benchmarkpocalypse](https://danluu.com/benchpocalypse/) describes
how apparent gains can come from changing the work or specializing to exposed
benchmarks. The rules below apply that concern to our actual Mermaid boundaries.

## Preserve the requested work

A qualified render produces a complete consumed artifact. Receipt and metadata
APIs also consume their sidecars. A returned promise, method descriptor, source
echo, unsupported response or fast exception cannot substitute for the requested
SVG/PNG/terminal output. Qualification follows the API clock; malformed or
semantically failed output retains its timing as failed evidence.

Keep interfaces named. A plain SVG call, receipt-bearing call, parser, CLI process,
MCP tool and browser preview do different work. Compare identical tasks at the
same boundary. A missing standalone MCP SVG tool must use the actual advertised
code-execution workflow when that is how callers obtain SVG; do not invent an
API to simplify the benchmark. CLI alias observations are coverage, not extra
independent renderer votes.

An extracted framework or optional plugin remains a distinct configuration.
Loading/registration requirements must be included in first-use measurements.
An external addon missing from reference setup is a prerequisite gap rather than
proof that documented source is invalid. In particular, the ZenUML addon's no-op
parser shim is not an independent DSL syntax oracle.

## Keep the input universe independent

Dave retains every enrolled official fence occurrence, including duplicates,
unsupported diagrams and failures. Shared-success timing uses its explicitly
reported subset; it does not erase full-corpus coverage failures. Changing the
reference pin or excluding a family creates a different comparison.

The selected-input pinned-reference score retains its historical selection and
provenance. Its source harvester used Agentic-derived fields and local admission,
so it cannot certify all upstream assertions. The original-assertion lane instead
executes the current original callbacks with unchanged expectations. Private
assertions, skipped callbacks, AST declarations, expanded callbacks and replayed
source literals remain different units.

The complete tracked-test census includes files that have no assertion adapter.
Literal replay is unscored because literals can belong to negative, disabled,
mock or private-context tests. Accepting more such strings is not a compatibility
win. Unavailable projections cannot satisfy an expected-error assertion.

The required-family set starts with all policy-stable families. A reviewed
uncertainty can add a required probe; it cannot silently remove a stable one.
Passing one representative certifies only that declared admission task, not every
construct. Preserve the broader family operation, grammar, ownership and visual
suites. Report narrow community comparisons as narrow comparisons.

## Do not call exposed cases a holdout

Our authored cases, docs and upstream tests are public and already visible during
optimization. They are not a secret holdout. A new public community regression
can test another failure class, but merely renaming nodes or appending comments
does not create independent algorithmic diversity.

Before a performance change, declare its task and protocol. Validate on the
broader external corpus and on interacting features, not only its motivating
microbenchmark. Preserve failures found after an optimization. Any future
maintainer-held validation corpus needs explicit provenance and an access history;
we currently have no such independently concealed corpus.

## Charge initialization at its own boundary

Fresh processes do not imply cold filesystem or operating-system caches. Artifact
admission and discovery may warm shared file pages. Record configured persistent
compile caches; do not call this a disk-cold measurement.

Startup latency begins before the relevant fresh process/browser or MCP server starts
and ends after a valid first payload is fully consumed. Readiness and module
import have their own timestamps; adding separate timer fragments is not an
end-to-end measurement. Factory construction, lazy backend loading, registration,
MCP initialization/listing and the first real tool call belong inside their
specified workflow. Record harness-only resolution flags and actual runtimes.

The browser fixture HTTP server is prepared before the browser startup clock.
The full editor sample opens an empty editor in a fresh browser, dispatches eight
input events in one browser turn, and waits for the latest labelled SVG, editor
status, fresh receipt-authority flag and two animation frames. The intermediate
inputs change an accessibility-title marker while preserving the graph. This is
fresh-editor burst-to-latest-preview latency, not a single-keystroke preview or
eight independently completed renders. The smoke profile dispatches one input.
Animation-frame checkpoints do not certify GPU completion or perceptual quality.

Warm API calls remain separate. Comment-varied source changes cache keys while
preserving the same graph; it is not uncached-layout evidence. A reset/recovery
prelude makes a measurement post-prelude rather than a first-ever call.

A sample mean from adaptive repeated batches is not a single-call tail. Fresh
startup p95 needs the declared number of independent processes. Keep independent
round identities, raw counts and missing/duplicate checks. For causal speedup
claims, retain paired controls and the predeclared noise rule. Absolute startup
distributions without such controls do not prove a release speedup.

Do not relax a noise ceiling after examining the result or repeat a failed run
until it appears favorable. Correct a demonstrated harness defect, give changed
producers a new identity and retain the original failed attempt.

## Name memory and cost boundaries

Latency and resource passes run separately. Fresh render processes have fresh
runtime/baseline controls. Whole-child GNU-time RSS is a lifetime high-water mark
including runtime, imports, optional backend, consumption, storage and diagnostic
GC; it is not API allocation or peak simultaneous process-tree memory. Preserve
exit status and reporting resolution. Censored zero CPU counters are not free.

JS/RSS snapshots state their phase: before import, ready, consumed output held,
after requested GC, and after benchmark-held references are released. Product
modules/factories may remain alive. Editor DOM can still own its SVG. A browser
main-document heap checkpoint excludes worker heaps, native/WASM/GPU memory and
other processes. Missing peak/attribution measurements remain unavailable.

Fetched package inventory, npm tarball size, individual-file gzip totals,
tree-shaken consumer bytes and observed browser transfer are different costs.
Record the actual module/request graph before claiming a download reduction.
CPU dollars need a supplied rate; model dollars need real provider/model usage
and dated prices. Missing evidence is unavailable, never zero.

## Reuse only matching evidence

Filter project selection before acquisition or execution. Each project and lane
retains immutable attempts and original dates. Identity binds actual target and
dependency bytes, committed producer closure, literal workload/assertions, runtime,
environment, sampling and relevant browser/native/website assets. Qualification
and transport dependencies count too. Changed evidence cannot activate an old
record; cancellation cannot publish a completed attempt.

Cache lookup precedes startup API discovery. An unchanged exact request skips
both measurement and target discovery. Report-only changes outside the measured
producer closure can reuse raw observations. Shared helpers still impose some
conservative invalidation; source-specific invocation helpers remain a documented
extraction seam. Do not claim that every legacy owning suite has incremental
caching.

Benchmarks execute locally and refuse CI. Normal correctness, transport,
distribution and security tests retain their CI owners. No hosting or production
provider cost is inferred from this local benchmark campaign.
