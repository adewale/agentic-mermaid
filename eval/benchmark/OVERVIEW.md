# Trident benchmark suite

Trident is being prepared for extraction into its own project. Its compiled
artifact runner and report readers work without Agentic source; repository
diagnostics remain an explicit optional adapter.

The suite answers four different questions: whether a diagram's meaning survives
an operation, how a caller can invoke the implementation, what that work costs,
and how the result compares with another implementation. Those questions share
inputs and artifact identities, but they do not share one overall score.

Benchmarks run locally and stay outside CI and npm publication. Product
correctness, security, package and browser contracts still run in CI. The private
benchmark package owns its runners, community adapters, qualification, records,
reports and controller tests. It is excluded from the published library.

For individual entry points and prerequisites, use the [inventory](INVENTORY.md).
The [assessment](ASSESSMENT.md) explains the limits of existing measurements.
The [package guide](README.md) covers installation, updates and extraction seams.

Pinned Mermaid 12.2.0 is the baseline for every comparable public operation.
Reports use tool cost divided by actual Mermaid cost, with Mermaid at **1**.
Lower cost is better; coverage and checked meaning use absolute denominators
and differences from Mermaid's observed result. Missing APIs, missing evidence
and unresolved noise do not become zero-cost wins. A single overall score would
hide these distinctions.

## Primary questions

| Question | Owning benchmark | What the result can establish |
| --- | --- | --- |
| How well do we render Mermaid's docs? | Original Dave browser comparison | Every official fence occurrence remains in its denominator. SVG acceptance and shared-success time are measured; acceptance alone does not certify drawing fidelity. |
| How well do we match Mermaid's own tests? | `upstream-original` and `upstream-fidelity`; historical `upstream-test-assertions` and `pinned-reference-score` retained | Execute genuine unchanged Mermaid core Vitest tests as the baseline. Run original callbacks through reviewed peer public APIs separately; private imports, state and matchers remain unavailable. Declarations, expanded callbacks and individual assertions are different counts. |
| Does authored meaning survive, and is the actual drawing usable? | `mermaid-fidelity` and `community-fidelity` | Independently authored identities, endpoints, direction, multiplicity, parents and values; actual source/configuration/edit workflows; measured owned ink, text, markers, clipping, images and quantitative chart geometry. Every required family stays in the declared criterion ledger. |
| Do we cover every required diagram family? | `stable-support`, with `family` functionality | Executed public SVG/label admission for every policy-stable family, plus unresolved exclusions conservatively retained. Native operations and painted fidelity need their own evidence. |
| How quickly can each entry return its first usable result? | `entry-startup`, alongside the wider `invocation` matrix | Fresh process through fully consumed first payload; import/readiness/API clocks remain separate. Browser launch, CLI inputs, factory setup, optional backends and MCP initialization belong inside their declared startup boundaries. |
| How much memory and CPU does it use? | Separate paired resource passes in `entry-startup` and the portable campaign | Whole-child high-water RSS/CPU and named JS/RSS snapshots. Browser document heap is not whole-browser, worker, native or GPU memory. |
| Where do we stand against pinned Mermaid? | `mermaid-baseline-browser`, `mermaid-baseline-compatibility` and the baseline report reader | Same-source public SVG and syntax-admission work, first-result startup, scoped resources and delivery; same-artifact Mermaid controls qualify fresh renderer comparisons. |

[Measurement rules](MEASUREMENT.md) explain how these lanes address interface
changes, selection bias, warmup, missing cases and overfitting. Public docs and
public tests are external validation, not a secret holdout.

Browser startup includes browser launch; its fixture HTTP server is prepared
before the clock. The full editor sample measures a fresh editor followed by an
eight-input burst through the latest verified DOM preview. It does not measure
eight completed renders or a single-keystroke preview; the measurement rules
describe the marker, receipt-authority and animation-frame checks.

## Fidelity and original tests

The authored campaign contains 70 source cases and 21 source edits: 91 executed
cases across 25 families. All 20 policy-stable families are included; Event
Modeling and ZenUML remain conservatively required while their maturity
exclusions are unresolved. Timeline, C4 and Radar remain separate supplements. Feature cases exercise nesting, reciprocal/parallel edges,
Unicode, namespaces, cardinalities, values and ordering. Real configuration,
invalid-source recovery, edits and serializer/readback calls are separate
observations; a feature tag itself earns no credit.

The paint observer inspects the returned SVG in Chromium. It checks actual
visibility, canvas/clip bounds, owned node and group geometry, routes, marker and
relationship-label ownership, every requested font-size run, embedded-image
presence/decoding and supported quantitative chart geometry. SVG scripts cannot
run in the isolated observer. Ambiguous projections remain unavailable. Actual
SVG and PNG evidence supports review; this is not pixel equality or a complete
judgment of typography and aesthetics.

One criterion universe is declared before any engine executes. Failed renders
leave the remaining criteria unavailable in that universe. Reports preserve raw
outcomes, baseline-qualified comparisons and baseline criteria requiring review;
missing evidence cannot become passing credit or a smaller peer denominator.
Admission, native meaning, paint and optional serialization capabilities stay
separate. The wider collector uses exactly the same cases on existing frozen
community SVG artifacts. It does not acquire tools or repeat old speed/memory
experiments. CLI, terminal, parser-only and application boundaries stay explicit
in the complete catalog ledger.

`upstream-original` runs the original pinned Mermaid core Vite/Vitest project,
with genuine prerequisites and read-only snapshots. The 26 October run passed
6,677 expanded callbacks out of 6,695; 16 were pending and two todo. All 99
snapshots matched, with no additions or updates and no unavailable files. Those
are callbacks, not individual assertion invocations. The 3,995 source declaration
census additionally includes declarations outside the core runner's discovery
and declarations whose runtime locations cannot be mapped. The browser/e2e and
docs-site workspaces are not part of that core run.

`upstream-fidelity` runs the original callbacks and expectations against reviewed
public-model adapters across stable families. It does not impersonate private
Mermaid internals. Private helper-only tests, imports, matchers and cumulative DB
state that a public snapshot does not expose remain unprojected. Diagnostic
wording and representation compatibility are not automatically drawing defects.
Neither runner's total workflow time is an equivalent renderer speed score.

For commands, record reuse, interpretation and reproducible evidence, see the
[fidelity guide](fidelity/README.md). The original Dave docs benchmark remains an
independent external workload; its full occurrence denominator and historical
performance protocol are preserved.

## The layers

| Layer | Question | Main suites | Evidence and limits |
| --- | --- | --- | --- |
| Public invocation | Can a real caller use the shipped entry or transport? | `invocation`, browser/editor and distribution contracts | Installed entries, Node/Bun, global/lazy/worker browser paths, Node/native CLI and MCP transports. An entry-point pass is not a witness for every function or feature. |
| Family functionality | Does an operation preserve authored meaning? | `family`, family contracts/functionality, operation witnesses | Independently expected parse, write, rejected-write, source, layout and output behavior. Advertised operations without a witness remain visible. |
| Mermaid reference | How much reviewed Mermaid input and meaning do we preserve? | Dave, pinned-reference score, semantic/grammar/operation corpora, historical imported cases | Original assertions and independently authored criteria retain their pins; the older selected-input harvest retains its Agentic-derived fields and selection limits. SVG acceptance, semantic criteria and parser time are distinct measures. Mermaid geometry is not Agentic Mermaid's pixel specification. |
| Community comparison | How do tools behave at the same public boundary? | Community API/browser/CLI, portable project campaign, peer/release comparisons | Matched workloads, real artifact acquisition, scoped fidelity checks, timings and delivery. Unsupported or failed cases do not become cheap successful renders. |
| Cost and attribution | Where is execution or download cost paid? | Micro, pipeline, render stages, renderer profiles, editor sessions/delivery | First use, warm work, consumed receipts, imports, observed requests, bundles, CPU and scoped memory. Instrumented stage clocks remain separate from public API latency. |
| Own output quality | Is our drawing usable and internally consistent? | Layout, routes, visual rubric, styles, sketch, heuristic tracker and ugly audit | Connectivity, ownership, geometry and contrast at the owning surface. A heuristic score is not independent human or perceptual judgment. |
| Agent workflows | Does a real task succeed, and what did the provider consume? | Replay, MCP, live model and subagent evaluations | Replay and wire conformance can run without a model. Provider quality and dollar costs require actual task transcripts, model identity, usage and dated prices. |
| Campaigns and reports | Which evidence is comparable and current? | Unified controller, PR campaign, retained project records, charts and scorecard | Exact source/artifact identity, measurement dates, controls and admission. A report reducer does not execute a benchmark or create a new measurement. |

The unified controller lists enrolled suites with:

```sh
bun run bench --list --profile full
```

Selection is an execution request. It is not proof that every prerequisite is
installed or every case passed. Missing browsers, toolchains, artifacts, models
or transcripts must remain blocked evidence. Standalone evaluations and callable
judges are listed separately in the inventory so that “all” has an inspectable
scope.

## How a result reaches a comparison

```mermaid
flowchart LR
  A[Catalog and authored cases] --> B[Resolve and admit actual artifacts]
  B --> C{Matching retained identity?}
  C -->|yes| D[Retain original observations and dates]
  C -->|no| E[Qualify and measure selected project]
  E --> F[Immutable attempt and raw evidence]
  D --> G[Current project records]
  F --> G
  G --> H[Comparable cohorts and scoped reports]
```

Preparation resolves the selected package or source pin, public entry and runtime
before clocks start. Acquisition errors stay in the record. The worker consumes
the public result; validation and report construction stay outside API timing.
The report distinguishes a returned SVG from the stronger assertions that were
actually checked against it.

Performance and fidelity failures are both retained. A parser-only tool cannot
enter an SVG speed rank. A project that loses one required case cannot enter a
complete fixed-core rank using just its successful subset. Forks with verified artifact and protocol equivalence may share explicitly
attributed evidence; they are not independent votes.

If collection completed but record publication failed, the
controller can recover that exact attempt with
`--benchmark-resume-attempt /absolute/project-output/attempts/ID`, one selected
project and one retained suite. Recovery checks the original identity against
current artifacts and settings, validates distinct measured sample coordinates,
and preserves the original sampler response. New attempts retain it in their
canonical compressed record; legacy recovery leaves its existing raw files intact.
New recovery receipts bind the original compressed output bytes as well as its
identity. Recovery adds record ownership and observation IDs without launching
measurement workers. Cancelled,
partial or changed-identity attempts cannot use this recovery path. Normal
updates use the retained record automatically; they do not need this flag.

## Keep the comparison lanes distinct

| Lane | What stays stable | What it can support |
| --- | --- | --- |
| Dave | The original same-input browser comparison and its pinned source cases | External acceptance pressure and shared-success timing against Mermaid and peers. Acceptance alone does not prove the drawing is faithful. |
| Pinned Mermaid | Current reviewed syntax/meaning criteria and the recorded public reference pin | Same-case semantic score and separately measured parser time. Historical imported tests retain their original pins. |
| Fixed community core | Six inputs across five families; terminal comparison uses its declared subset | Historical public-boundary comparisons. It is too narrow for an all-family performance claim. |
| Balanced family and scaling cohorts | Independently authored family representatives, graph sizes and interacting feature cases | Family-specific coverage, per-case distributions and growth behavior. These are additive lanes; they do not rewrite Dave or the fixed core. |
| Paired release/PR experiments | The exact candidate, baseline, controls, dependency policy and noise rules | A measured change against its controls. Insufficient rounds, fresh samples or semantic admission remain uncalibrated. |
| Rolling project records | Each retained attempt's actual artifact, protocol, environment and date | Updating one project economically. Small cross-project differences need a matched comparison window before they can support a performance-win claim. |

Changing an implementation, workload, qualifier, runtime or sampling protocol can
invalidate reuse. Changing a prose report cannot turn old observations into a
new simultaneous campaign. Report dates and identities are part of the result.

## Updating a project

The maintained catalog is `docs/mermaid-community.json`. The project ID, rather
than a role or implementation language, selects a comparison participant.

```sh
bun run bench:community:update -- \
  --projects obsidianmd/pele --profile full --rounds 3 \
  --records bench-report/project-records \
  --out bench-report/community-updates \
  --markdown docs/community-benchmark-ranking.md
```

Matching records skip timing for that project. `--force` creates another attempt;
`--plan` performs preparation and shows the decisions without starting clocks.
The Markdown update replaces only its marked rolling-record section. Keep both
the record store and referenced evidence directories. Missing evidence prevents
reuse and removes the affected row from qualified ranks.

The legacy paired Dave, release and PR experiments deliberately execute their
own controls when explicitly selected. Reusing an old peer observation in a
new paired experiment would change the experiment's meaning.

## Pele as the extraction and measurement case

Pele is a useful case because it exposes a fast public SVG API and also exposes
how narrow speed claims can be. The historical fixed-core browser rank placed
Bezel and Ondine ahead of Pele; another boundary or workload can change that
order. “Fastest” therefore always needs a named cohort, boundary and version.

The portable project campaign accepts a frozen installed artifact directly:

```sh
bun run eval/benchmark/portable/run.ts \
  --project obsidianmd/pele --artifact-root /path/to/installed/pele \
  --records bench-report/project-records --out bench-report/pele \
  --rounds 5 --samples 31 --cold-samples 20 --allow-partial
```

`--allow-partial` allows the diagnostic run to finish with a report when paint
coverage or timing calibration is incomplete. It does not turn that evidence
into a complete pass; declared check failures still fail execution.

Its extraction contract is to run the neutral package in an empty workspace with
the supplied project artifact, without importing Agentic Mermaid production
source. The same cases, qualifiers and evidence rules must remain available
after extraction. Agentic-specific source-stage diagnostics remain optional
repository adapters.

The authored portable corpus contains 49 cases: 23 family representatives, 15
scaling cases, eight interacting feature cases and three invalid inputs. Scaling
uses flowchart, sequence, class, state and ER inputs at sizes 8, 32 and 128.
Nesting, parallel/reciprocal edges, quoted and Unicode labels, invalid-source
recovery, configuration reset and an independently checked font-size edit give
the timing lanes functional conditions to preserve.

The campaign writes its report and raw evidence separately from product files.
Its case matrix distinguishes rejected input, accepted output, checked semantic
facts, unavailable evidence and measured timings. Fresh-use, warm, scaling and
resource observations retain their own scopes. A failed or unmeasured topology
check must not be described as semantic equivalence just because labels survive.

The Pele calibration uses three replicas of the same admitted artifact: two
controls and a third measurement. That checks the measurement method; it does
not establish an Agentic Mermaid improvement. Warm workers and first-use workers
remain separate. First-use samples use fresh processes/modules; imports may be
prepared in a bounded batch, then a barrier permits one timed API call at a time.
Those import times are diagnostic and unranked. A case with a recovery or reset
prelude is explicitly post-prelude, rather than a first-ever call. Whole-child
resource passes run separately after the latency jobs.

Reviewed paint projections cover flowchart, class, state, ER and simple sequence
cases in Pele’s SVG format. Other adapters need equivalent qualifiers before
their painted fidelity can be compared; unavailable projection evidence is not a
renderer failure. They check visible owned identities, actual connecting geometry and
directed endpoint multiplicity. Flowcharts bind public edge IDs to owned ink;
class/state/ER paths bind geometrically to unique node bounds without guessing
generated relation IDs. Sequence messages bind to owned actor lifelines and
authored row order, with message text tied to its corresponding painted owner.
Legitimate actor footer duplicates stay distinct from unique headers.

The projections check ordinary directed arrowheads or ER endpoint marker ink,
declared label ownership and optional containment. Their 12-pixel endpoint
tolerance is an explicit approximation. They do not certify curve interiors,
crossings, exact shape boundaries, unasserted class/ER relationship details or
perceptual quality. Complex sequence lifecycle, self, bidirectional, activation
and control-block paint remains outside the reviewed projection. Other families
can pass public-model assertions while painted correspondence stays unmeasured.
The report's semantic-completion flag means all declared scoped criteria passed;
it is not a certificate of complete Mermaid meaning or visual fidelity.

The dated [Pele case study](PELE-CASE-STUDY.md) records the run, reuse proof and
lessons. Its retained report gives the exact artifact and protocol. The overview describes the suite's contracts rather than
copying volatile performance numbers from a single machine into an architecture
document.

## Reading costs and confidence

API `maxRSS` inherited from a parent process is excluded from comparative ranks.
An end-of-loop RSS snapshot includes its runtime, harness and adaptive workload;
it is not attributable peak memory per render. Browser V8 heap excludes native,
WASM and GPU memory. Fresh child resource measurements and baseline differences
must name what they include, their sampling policy and measurement resolution.

Per-case samples, repetition counts, uncertainty and noise controls belong beside
aggregates. A p95 requires enough independent fresh observations for that scope.
Calibration is a result of completed evidence, never a label inferred from a
successful process exit.

CPU, elapsed time, bytes and dollar cost remain separate units. Missing model
usage or prices means unavailable dollar cost. A counter below its resolution
is censored evidence, not free execution. No current score proves complete
perceptual quality, every API combination or production behavior on every
device.

## Required-family gaps and upstream assertions

The pinned policy currently labels 20 families stable. The benchmark does not
quietly remove a family because its header has a legacy `-beta` spelling. It
also retains Event Modeling and ZenUML until their exclusions have been reviewed.
Those two pending requirements do not mean 22 independently certified stable
families. [Event Modeling #501](https://github.com/adewale/agentic-mermaid/issues/501)
and [ZenUML #502](https://github.com/adewale/agentic-mermaid/issues/502) contain
public reproductions, actual peer observations and related open/closed community
work. They track product work separately from the benchmark.

A successful preservation parse is not native support: both missing types can
retain exact source while rendering remains unsupported. Beta/experimental
probes stay visible as supplements. Unresolved maturity or a missing required
positive blocks a complete-comparison admission claim. The declared gate checks
representative SVG format and authored labels; it is not a certificate of all
features or painted topology.

The new original-assertion lane uses the current pinned Mindmap/GitGraph spec
callbacks without replacing their expectations. A public-model facade cannot
project every private Mermaid DB/config/logger assertion; those callbacks remain
unavailable. The wider monorepo census and literal-source replay retain their
own units and cannot add assertion-pass credit. Exact error wording, rejected
input, typed semantics and visible drawing quality are reported separately.

## One tool version per comparison set

The active version manifest is [`tool-versions.json`](tool-versions.json). Pele
is pinned to **1.9.0** across Dave, Node peers, community acquisition, portable
runs, startup/resources and original-assertion comparisons. Registry `latest`
cannot override its set pin. Actual installed identities are checked before
measurement/cache admission; report readers reject mixed versions for any tool
before replacing reports or charts. Explicit baseline/version experiments are
named separately, rather than assigning different releases to different suites.

Historical receipts keep their measured versions and dates. To review an older
uniform set, the chart reader accepts an explicit historical version manifest.
It cannot combine Pele 1.6 and 1.9 into one set. Changing a pin requires new
measurements only for affected tool/artifact lanes; already matching records
retain their clocks and original dates.
