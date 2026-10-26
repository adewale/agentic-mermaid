# Unified benchmark runner

## Local execution and retained community records

Benchmarks are excluded from CI. Product publication no longer runs or waits for
them. Controller tests and their dependencies belong to the private benchmark
package; run `bun run bench:test`, `bench:typecheck` and `bench:lint` explicitly.

Community runs now reuse matching per-project records by default. To advance one
project, run `bun run bench:community:update -- --projects owner/project`, with
the desired profile, sampling and artifact flags. Add `--markdown
docs/community-benchmark-ranking.md` to update its rolling-record section.
`--force` requests new clocks; `--plan` prepares the selected artifacts and shows
what would be reused. A protocol/input/environment change invalidates reuse.

See [the package boundary and update workflow](../README.md), [the complete
inventory](../INVENTORY.md) and [the coverage assessment](../ASSESSMENT.md).
Historical single-run chart admission does not accept a rolling collection as a
new simultaneous campaign; its original evidence and charts remain unchanged.

`bun run bench` runs the bounded `smoke` profile. `bun run bench:all` selects every
maintained suite, including Dave, release, peer, editor, source-stage diagnostics,
current pinned-reference checks and historical upstream parser/DB tests. All
performance campaigns and diagnostic processes run sequentially. A failing suite
does not prevent the remaining suites from producing evidence.

```sh
bun run bench -- --list --profile full
bun run bench -- --out /tmp/am-unified --rounds 3
bun run bench:all -- --out /tmp/am-complete --rounds 3 --executable /usr/bin/chromium
bun run bench -- --profile full --suites pinned-reference-score,pinned-operation-tests,upstream-imported --out /tmp/am-reference
```

Run `bun run build` before artifact-dependent suites and `bun run website` before
editor suites. The runner never silently builds a different target for an
invocation result. With `--candidate-tarball` and `--candidate-sha256`, unified
Dave runs the shared browser scorecard on that exact artifact with 30 warm-up
attempts. Standalone `bench:dave` retains its build/pack workflow. Its warm-up, case denominator and
exact-artifact behavior remain owned by `dave-bench.ts` and
`release-browser-bench.ts`.

Use `--target CHECKOUT --package-root INSTALLED_PACKAGE` for target-aware
functionality, invocation and community adapters. Existing source diagnostics
and owning tests execute in the **driver checkout**. The report names this
boundary; passing `--target` does not rebind their static imports or make a
main-checkout test pass evidence for a PR.

Release browser comparison needs `--candidate-tarball FILE
--candidate-sha256 HEX` and either `--baseline-lock FILE` or
`--baseline-tarball FILE --baseline-sha256 HEX`. `--site WEBSITE_PUBLIC`,
`--bezel-dir VERIFIED_WRAPPER`, `--mermaid-dir PINNED_SOURCE` and
`--reference-dir INDEPENDENT_INSTALL` point to explicit prerequisites. Missing
prerequisites are retained as **blocked**, not omitted or scored as free wins.
Optional live-provider work additionally needs an explicit model, provider and
configured credential. Credentials are never written to the run manifest.

Acquire the published Node/browser baseline once before timing, using the
maintained resolver, then pass the same lock to the unified run:

```sh
bun run eval/benchmark/release-baseline.ts latest /tmp/release-baseline.json
bun run bench:all -- --out /tmp/am-complete --baseline-lock /tmp/release-baseline.json --candidate-tarball /tmp/agentic-mermaid.tgz --candidate-sha256 VERIFIED_HEX
```

Node release defaults to the published `latest` selector; a supplied lock keeps
the resolved version and integrity fixed across retries. `--baseline DIRECTORY`
selects a local built package for Node release. `--baseline-ref GIT_REF` controls
the separate output-identity source comparison. Those are different identities.

## Evidence

Each output directory contains:

- `report.json`: a small verified reference to `report.json.gz`, which contains
  suite selection, prerequisites, execution status, commands, wall times, test
  scores, declared policies and gaps. Keep both files when copying a report.
- `report.md`: the readable campaign summary.
- Optional `--export-tables` outputs: `coverage.json`, `coverage.csv` and
  `observations.csv`. These contain observed surface/family/operation cells and
  per-observation metrics. Missing cells are unmeasured; enrollment does not
  establish feature completeness.
- One directory per suite, with complete process logs and native suite artifacts.

Decode existing compressed, reference or legacy JSON without starting a campaign:

```sh
node eval/benchmark/commands.ts export --input /evidence/run/report.json \
  --out /tmp/report-full.json
```

Omit `--out` to write JSON to stdout for tools such as `jq`. File exports require
a fresh output path; exporting does not rewrite the original evidence.

The runner discovers package `bench:*` entries and excludes its own wrappers to
avoid recursion. Other real executable diagnostics have explicit adapters;
worker/helper modules are not guessed to be runnable from their filenames.
`--list --profile full` shows the complete catalog, selected commands and
prerequisites without starting a workload. The full profile includes the
existing scoped family/agent mutation, query, serializer and route tests,
enrolled by owning conventions and canonical registry family IDs. Passing them
does not establish a dedicated witness for every advertised schema operation;
the family report retains that distinction.
Full also enrolls the canonical `test:browser` runner and CI's public
distribution gates: CLI/offline checkout, compiled executable, built-artifact
fuzz and installed-tarball consumers under the available default Node and an
independent configured Node22. These are driver-owned correctness suites, with
their existing per-test timeouts and build/install setup; passing `--target`
does not credit them to a different artifact. Set `NODE22_EXECUTABLE` to the real
Node22 binary. Its directory leads PATH for that consumer gate.

Canonical browser contracts rebuild the driver website and use managed
Playwright Chromium plus its headless shell, Firefox and WebKit. They accept no benchmark `--site`
or `--executable` override. Install all engines with `playwright install chromium firefox webkit`,
optionally setting `PLAYWRIGHT_BROWSERS_PATH` consistently for preparation and
execution. Missing executables are blocked prerequisites. Screenshot baseline
updates are disabled. Counts sum the separate fresh test-process summaries.
Use `playwright install chromium firefox webkit` for the complete cross-engine
lane. Its canonical runner stops on the first failed file, so those scores are
partial and never imply all ten contract files executed.
The lazy-browser delivery gate separately checks actual built closures and
gzip/Brotli budgets without rebuilding during its evaluation.

The controlled ownership comparison additionally requires reviewed frozen
`original.html` and `candidate.html` pages with their assets. Point
`--ownership-site DIRECTORY` to that pair; normal `--site` production output
does not supply them. Missing variants are blocked. The runner does not create
identical copies or claim a before/after comparison from an unreviewed pair.
Profiles and `--suites` make expensive work explicit. The default per-suite
outer budget is four hours for full and 30 minutes for smoke (`--timeout-ms` changes it); timeout terminates the
entire subprocess group, including browser/reference children.

Current pinned Mermaid is read from
`docs/project/upstream-mermaid-policy.json`. Imported upstream cases and family
companions retain their original historical harvest pins. Their fresh test
scores and process wall time are useful evidence, but are not relabeled as a
pure-parser engine-speed comparison. `pinned-reference-score` owns the separate
paired same-case parser timing and independently expected assertion scope.

Timing, allocation, RSS, browser delivery, verified UI latency and provider
cost are reported separately. Instrumented diagnostic clocks do not enter a
public API speed rank. No elapsed time is awarded for unsupported, blocked or
unmeasured work. A process that exits successfully can still contain rejected
or unqualified corpus inputs; inspect the owning suite artifact.

Community ranks use only the fixed, matched core graph inputs and qualified
rounds. By default, broader family feature attempts execute and qualify once in
the first round, without warm-up or speed samples. `--community-coverage repeated`
retains the earlier repeated-feature protocol as an explicit alternative. Node and external JSONL workers
preserve completed cases, enforce progress deadlines and restart untouched
inputs after crashes, with bounded retries recorded in raw evidence. Browser
realm failures retain earlier rows and explicitly block the remaining cases.
Declared catalog outputs without adapter bindings remain unmeasured capability
rows. Every catalog node receives an acquisition attempt and an eligibility
record. Missing artifacts and unavailable runtime capabilities are not multiplied
into artificial per-input failures or performance wins.

Exit status is `0` when selected suites complete, `1` when any suite fails, and
`2` when selected work is incomplete. `--allow-incomplete` permits blocked work
without hiding it in the report; failures still return `1`.

Active-PR campaigns are listed as explicit orchestration (`bench:prs`, or
`--suites prs`), rather than nested automatically inside `bench:all`. Their
freeze/build/source-equivalence phase and target rounds would otherwise repeat
the invocation campaign. Use a separate output directory for each frozen run.

`bench:scorecard -- --run DIR --prs PR_DIR --output FILE` updates the requested
maintained Markdown snapshot from completed evidence. It is report generation,
not a timed suite, so automatic benchmark discovery excludes it.

`bench:charts` is a standalone reporting helper requiring Python, Matplotlib and
NumPy. After the campaigns finish, generate portable SVG, PNG and PDF figures
plus a self-contained searchable HTML report with embedded reduced evidence:

```sh
bun run bench:charts -- --run /tmp/am-complete --prs /tmp/am-prs --out /tmp/am-charts
```

The charts keep API/CLI/browser boundaries separate, show qualified fixed-core
ranks alongside observed family breadth, and retain PR source equivalence,
conflicts and observed control bands. Browser delivery and memory are diagnostic
views with explicit scopes: initial navigation and complete portfolio request
closures, main-document V8 heap and process RSS are separate. The invocation
heatmap keeps recorded runtimes separate, and broader community coverage follows
the enrolled non-core input IDs so CLI paths retain their actual process clocks.
Owning-test wall times and pinned same-case portable
parser scores have separate panels. Missing evidence is listed rather than
invented. The helper never executes benchmarks and is excluded from suite
discovery. Keep generated charts outside the checkout or under an ignored
artifact directory; do not commit them.

When a completed supplemental `community-cli/ranks.json` and its matching
`community-cli-result.json` are present, charts use that fresh cohort for CLI
ranks and retain the original API/browser evidence. Its frozen core inputs must
match the original community cohort. Node CLI and compiled CLI remain variants
of Agentic Mermaid through `variantOf`; they do not become additional catalog
tools. Supplemental CLI feature breadth is unmeasured and omitted from the
performance/breadth scatter, rather than plotted as zero.

PR payload panels distinguish actual npm archive bytes from gzip of the shipped
browser IIFE; separately fetched assets are excluded from the IIFE figure.
Broad PR family/invocation panels show observation statuses with resolved
profiles and rounds, including intentional invocation overrides. They distinguish
N/A, unsupported, blocked, failed and unavailable evidence, and do not imply
exhaustive feature coverage or merge readiness for exploratory heads.

An explicitly reconciled main invocation ledger can be supplied with
`--invocation-correction /path/to/invocation-corrected.json`. Its sibling
`reconciliation.json` must bind the original completed invocation, frozen packed
target, exact style observation keys, three runtimes and three rounds. The chart
reader additionally verifies that every observation outside `library:./svg/styles`
is unchanged and that the normalized counts/status agree with the manifest.
Only the main invocation coverage and diagnostics use this overlay; original run
and suite statuses, other community/API evidence, PR results and all raw files
remain unchanged. Reduced evidence and affected figures identify the protocol
correction and scoped rerun timestamps. This is a mixed-run reporting ledger,
not a new full benchmark or a product fidelity improvement. No correction file
is discovered or applied implicitly.

Supplemental CLI resource panels use the separate GNU time pass after all
uninstrumented latency rounds. Each output keeps its fixed source/label cohort:
peak RSS is the maximum per-case child high-water mark, while user/system CPU
is summed across fresh per-case processes. These scopes never mix with the
varying-portfolio Node worker RSS or browser V8 heap diagnostics. GNU time CPU
fields have 10 ms reporting grain; censored values and conservative bounds must
not be interpreted as zero CPU cost or zero latency. Missing or unqualified
resource cohorts are N/A.

Executable footprint panels distinguish compiled native/Bun CLI files from
external Node and Python/other interpreter executables. Interpreter bytes are
not a compiled tool payload. Earlier recorded delivery scopes remain in the
raw evidence and reduced data when corrected in the presentation. None includes
the full dynamic library/resource closure; external runtime bytes are not the
tool's package/program delivery cost. Git objects bind interpreted programs and
authored dependency helpers separately from shipped compiled byte identities.
When the supplemental cohort includes Agentic's separately built native CLI,
both reporters require `--cli-native-proof FILE`: the explicit clean-source
`build:binary` reproduction must match the frozen revision/package/archive,
the actual measured executable SHA256 and retained original bytes exactly.
A later bit-identical rebuild attests the earlier artifact; it does not replace
its measurements or pretend that archive metadata alone identifies the binary.

PR editor panels read each candidate's own invocation evidence, including the
editor's observed initial gzip and closure through attempted family edits.
These can reveal loader changes that leave the static browser IIFE size tied.
The editor latency portfolio is shown only when frozen main and candidate both
qualify every exact ordered representative source/label case, use the same
actual Chromium version, and record the smoke/one-round single-changed-input
protocol. It remains an observed unpaired DOM interaction portfolio with no
calibrated ratio or confidence interval. Full-main eight-edit bursts are kept
separate. Missing common keys withhold latency while available exact delivery
bytes remain visible. Renderer source aliases never substitute another
candidate's editor measurements; conflicting heads and own bases stay
exploratory.

`--reference-correction /path/to/reference-score-result.json` explicitly selects
a fresh `public-positive-eligibility-v2` parser rerun. Its sibling eligibility,
raw and diagnostic artifacts must agree. The reader validates the original and
corrected source-fixture Git objects, the same current Mermaid/parser/DOM pins,
frozen candidate revision and shipped parser bytes against the original admitted
tarball, and all eligible cases for both engines across three rounds. Reviewed
eligibility partitions the retained raw fixture universe before either parser's
outcome; diagnostic-only sources still execute and retain replies and clocks.
Their counts are excluded from the positive score and timing portfolio.

The explicit overlay affects only main pinned-reference score/timing figures.
It preserves original aggregate statuses, raw attempts and historical imported
test provenance. Figures and reduced evidence identify the scoped rerun and
eligibility census as a baseline protocol repair, never a product improvement or
a replacement full run. The corrected eligible cohort intentionally differs
from the original raw positive denominator; unchanged eligible criteria and
retained diagnostic evidence are checked instead of pretending cohort equality.

The expanded community protocol calibrates the same fixed core in three fresh
rounds. With `communityCoverageOnce`, broader feature inputs execute and qualify
one actual call in round one, with no warm calls or repeated feature timing
samples; later rounds contain core only. Request closures and heap diagnostics
therefore retain their portfolio/round scope instead of pooling full-feature
and core-only costs.

Published extra adapters bind reviewed package APIs and real companion
pipelines. Terminal Pi renderer components and real headless OpenTUI integration
have separate boundaries from plain Node/Bun APIs; React component rendering has
a separate browser boundary. Source formatters and React Flow IR remain source
and IR operations, rather than SVG stand-ins. Validators must reject authored
negative controls before timed core work and accept the independently valid
core without error findings. Broader diagnostic completion retains actual
acceptance/findings and never claims a positive feature oracle. Acquired package,
source, optional native dependency, compiled asset and host prerequisites still
require fresh actual admission; binding code alone is not a passing result.

Community v2 calibrates the fixed core in every round and qualifies the full feature
corpus once per admitted artifact. Source echoes, including framed unsupported-input
code fallbacks, cannot qualify as diagram ink. Catalog enrollment covers all84 nodes;
configuration is not evidence of a working adapter. Each acquisition or host failure
remains explicit. Source-equivalent aliases require actual compiled artifact and
reviewed runtime/protocol equivalence. Interpreted sources retain Git blob proofs.

Use `--community-prepared FILE --community-inputs FILE
--community-browser-prepared FILE --community-artifact-policy frozen` to execute a
reviewed preparation snapshot without installing or bundling during the run.
`--community-coverage repeated` retains the more expensive repeated feature profile.
The matched CLI resource phase runs after its uninstrumented latency clocks.

Charts accept `--community-run /path/to/community-final/community` to select an
explicit completed expanded community campaign. The reader checks the parent
ledger and invocation, frozen target revision/package/tarball, pinned reference,
literal six core and 957 feature inputs, all 84 unique enrollments with recorded
outcomes, three calibrated core rounds, feature-once policy, and final artifact
identity checks. It replaces only community evidence in the presentation; the
original full-run status and raw earlier population remain unchanged. Its
supplemental CLI data comes from the new campaign's sibling `community-cli`
directory. Different population and stronger output qualification are protocol
changes, never evidence of a product speed improvement.

The same `--community-run` flag can explicitly select a qualification composition
produced by `reconcile-community.mjs`. The reader checks both completed source
ledgers, fixed target/artifacts/cohort/pins, exact untouched rows, and fresh
SVG/React Flow rows. Both measurement windows remain visible. The authored-text
SVG repair shares namespace-aware inert-container filtering, literal XML text,
positioned text runs and token-bounded decorated-label matching across Node and
browser hosts. It still does not establish CSS/paint visibility, geometry, roles,
multiplicity or pixel fidelity. Identical legacy failure rows with missing round
fields retain a set of committed raw-record round candidates; no individual old
failure is assigned an invented round. Optional composed CLI evidence replaces
only its explicitly fresh SVG latency/resource lane and preserves original
terminal observations. Qualification repair is a benchmark protocol change,
not product improvement; original raw reports and helper assets stay intact.

Conditional family charts reuse the existing fixed core, grouped by family,
output and invocation boundary. Flowchart has two inputs and the other SVG or
parser families have one each; terminal covers flowchart and sequence. Every
required input must qualify across all rounds. These charts let narrow tools
participate in an appropriate comparison without inventing broader coverage.
Supplemental CLI variants receive the same conditional family views derived
from their actual fixed-core raw rows, with every required case in all three
rounds. They retain `variantOf` and do not acquire feature-corpus coverage.
Search the standalone HTML by family or boundary to select a panel and inspect
qualified and unqualified evidence rows. Source-equivalent measurements retain
their shared-evidence labels. Full-feature round-one payload/heap observations
are scoped separately from later core-only rounds and from other output formats.

`--ownership-site DIRECTORY` selects the editor ownership suite's actual frozen
`original.html`/`candidate.html` pair, with its local assets. A historical pair
must retain its own page artifact identities and provenance; running that pair
does not establish current-main performance. The family functionality suite
preserves proxy configuration while bypassing IPv6 loopback through both
`NO_PROXY` and `no_proxy`, so owning transport checks exercise the local server.

The Markdown updater accepts the same explicit `--community-run`,
`--invocation-correction` and `--reference-correction` selections as charts. It
calls `charts.py --validate-only` through Python 3 (override `PYTHON_BINARY` if
needed), sharing the exact cohort/artifact admission rules without importing
plotting dependencies or rendering figures. A failed admission leaves the
existing snapshot intact. The generated snapshot retains the original complete
suite ledger, records replay provenance, and separates diagnostic memory by
runtime, output, round, worker attempt and portfolio scope. Its per-operation
status tables preserve unsupported, blocked and not-applicable outcomes.

Use `--prs LATEST_DIR --historical-prs OLDER_DIR` to retain a separately labeled
older full campaign alongside the latest focused open-head snapshot. Each needs
its completed target/job marker. An API-only campaign publishes only its actual
`selectedCoreMetrics`; omitted terminal/edit/PNG metrics and invocation suites
are unmeasured. Supplemental GitGraph cases stay outside the fixed six-input
portfolio and retain separate paired ratios, cache flags and integration state.
Known exact missing-saxes qualifier errors in older invocation rows are shown
as harness-blocked/unscored, preserving raw failure statuses and paths. This
classification does not repair or rerun the affected historical partition.

`--current-invocation-run DIRECTORY --current-invocation-assets FILE` selects an
independent completed latest target invocation/Dave/pinned-reference campaign:
full/three-round ledger, actual Git/archive/package
bytes, unchanged representative sources and pinned reference, and repaired
library qualifier/dependency provenance. The explicit clean-source public-build
proof separately binds compiled native and website assets omitted from the npm
archive. It gets separate coverage, Dave/parser views and
target/count table; it does not replace older invocation, community or pinned
Dave/parser evidence. Repeat `--suite-run DIRECTORY` for completed owning or
environment correction ledgers. Their driver source Git objects, statuses,
process walls and test counts remain independent; historical ownership pages
retain their external fixture scope rather than establishing current-main speed.
The latest invocation reader checks executed library import/end checkpoints
for every installed executable export × Node22/Node24/Bun × three rounds,
actual representative-family transport rows, and render/watch round sidecars.
It labels missing bootstrap/cohort attempts incomplete while retaining genuine
failed operations. A completed process/full-profile option is not a complete
attempt census. Actual callable exports without direct operation witnesses
remain separate gaps; helpers may run during preparation, so this does not
assert that they were never called. Common CLI helper verbs run once by design.
Family functionality executes one pass; historical requested rounds3 metadata
does not establish three passes. Latest focused receipt assertions run before
and after timed samples; historical receipt costs include those assertions.
Receipt timing comparisons across these protocol versions cannot establish a
product improvement. PR worker RSS remains scoped to its selected APIs/cases;
focused four-metric and older thirteen-metric snapshots do not share equal work.

If the community campaign measures a newer Agentic revision, both reporting
commands additionally require `--allow-community-target-change`. This admits
only an explicit `targetAdvance.from`/`to` manifest matching the original and
new actual Git revision, package paths and admitted tarball identities. The new
Git checkout must have no unrecorded tracked product/build changes, and the
measured public entry must match the actual new tarball bytes. Previously
admitted peers retain their exact versions/revisions/artifact identities and
the same literal inputs/reference. The community-only target and measurement
time appear in captions and Markdown; invocation, reference and owning suites
retain their original target. A simultaneous population/protocol/product
change is not presented as a like-for-like optimization speedup.

`--current-run /path/to/current-main` adds separate current-target Dave and
pinned-parser panels/tables. It never replaces the original full-run ledger or
its older-target corrections. Admission verifies the actual current Git
checkout and tarball, the Dave candidate's embedded archive identity, exact
unchanged 1095-occurrence corpus/browser/clock policy and historical comparator
versions, and the same reviewed 580-positive/586-raw parser fixture universe.
Parser replay sources come from the admitted Git blob and independently expected
criteria remain identical; actual shipped parser bytes must match the new
tarball. Actual tool versions must agree throughout the comparison set; older
version experiments remain separate historical sets. Complete
attempt cost includes failures, while each matched Dave ratio uses its own
explicit shared-success input set. Current parser timings use the common
all-engine/all-round positive-success cohort.
For this legacy-baseline comparison, also supply `--reference-correction` so
the current positive/diagnostic assignment is checked against the independently
reviewed original baseline rather than an outcome-selected current subset.

SVG qualification uses lazy `saxes` XML parsing in Node and native `DOMParser`
in browsers, after API clocks stop. Both require the SVG namespace/root and a
positive finite viewBox or explicit dimensions; malformed CSS entity references
are rejected without repairing tool output. The actual Node parser identity is
recorded in community evidence. Public Mermaid syntax validators occupy a
separate `node:public-parse-validation` lane. Known legacy void-success returns
are admitted only after two authored negatives reject, including malformed
classic `graph` syntax; raw return type/value remain recorded. This does not
credit native-model or label fidelity, and the first measured positive follows
negative admission rather than being a pristine first-ever parser call.

`--additional-run /path/to/late-maintained` adds a separate completed ledger for
maintained suites introduced on the selected newer target. It requires explicit
current/community target selection, the same actual archive, target-owned
working directory and tracked owning-source Git objects. Status, complete wall
time, observed qualification gates, prerequisites and artifact links are kept
separate from original suites and comparative ranks. A completed process never
substitutes for passing qualification gates.

`--current-dave-run DIRECTORY` explicitly selects a fresh same-target Dave-only
rerun for the latest display. It must bind the same Git target, package/archive,
frozen corpus and comparators. The failed original Dave ledger remains visible;
no observation is overwritten or treated as a measured result before acquisition.
An additional peer qualification ledger uses its actual supplied baseline. A
previous-main 0.4.2 comparison does not establish the published 0.4.1 historical
budget, even if the owning policy retains a historical Git anchor constant.
Owning `uncalibrated` status and `performanceQualified:false` take precedence in
the presentation over a historical outer runner's generic passed process status.

`--family-correction FILE` is an explicit latest-PR display overlay for reviewed
empty-source SVG fixture eligibility. The reader binds each candidate archive,
original/fresh/composed key partition and independent fixture Git object/source/
assertions. Only original failed empty SVG rows may become exact fresh N/A rows
when independently expected and observed node/edge/group counts are all zero
and no visible labels are expected. Every unselected old row is byte-equivalent
as JSON evidence; performance and older snapshots remain unchanged. This is a
benchmark eligibility correction, not improved product rendering fidelity.

`--cli-resource-run DIRECTORY` explicitly admits a later resource-only fixed-work
GNU-time pass against the exact selected baseline CLI cohort/variants/target.
The reader verifies actual observer bytes/version/acquisition provenance and every
declared per-case diagnostic key. It replaces displayed RSS/CPU evidence only;
all earlier latency observations, ranks and windows remain unchanged, and old
missing-observer capability rows remain raw. RSS/CPU qualification requires actual
rendered-output admission; failed work is not a cheap successful renderer.
