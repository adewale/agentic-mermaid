# Benchmark and evaluation inventory

This inventory describes the executable boundaries in the repository after the
October 26, 2026 update. It distinguishes performance measurements from
correctness tests, corpus preparation and external model evaluations. A test
group's process wall time is not renderer latency.

List the currently enrolled commands without executing them:

```sh
bun run bench --list --profile full
```

The controller's list gives the current definition count and default selection.
Explicit campaigns require their own project or checkout inputs; selection does
not imply that prerequisites are available or that a suite passes. The earlier
published campaign enrolled 46 entries; it is evidence for that recorded
revision, not a fresh execution of the current catalog. Exact commands,
arguments, prerequisites and measured-target policies come from
[unified/suites.ts](unified/suites.ts).

## Primary release questions

The [overview](OVERVIEW.md#primary-questions) maps docs rendering, original
upstream assertions, required-family admission, entry startup and resource use.
The following controller entries are additive to the original Dave and selected
pinned-reference input comparisons:

| ID | Entry | Scope |
| --- | --- | --- |
| `mermaid-fidelity` | [fidelity/run.ts](fidelity/run.ts), through a native Node worker | 91 authored cases/edits, native public-model meaning, actual workflows and owned visible/quantitative SVG criteria. Per-project records, isolated observer and raw/reference-qualified ledgers; no performance clocks. |
| `community-fidelity` | [fidelity/community.ts](fidelity/community.ts) | Same authored universe on frozen prepared public SVG artifacts; all catalog boundaries, independent alias attribution, lossless SVG/PNG evidence, explicit missing native projections. |
| `upstream-original` | [upstream-fidelity-original.ts](unified/upstream-fidelity-original.ts) | Genuine pinned Mermaid source core Vitest/Vite execution, unchanged expectations, read-only snapshots, declaration/callback accounting and actual dependency admission. |
| `upstream-fidelity` | [upstream-fidelity.ts](unified/upstream-fidelity.ts) | Expanded original callbacks through actual peer public parser/models; private and helper-only assertions remain unavailable. Distinct from genuine Mermaid's own runner. |
| `stable-support` | [stable-support-run.ts](unified/stable-support-run.ts) | Runtime required-family SVG/label admission, policy maturity review and separate supplements; per-project retained results. |
| `upstream-test-assertions` | [upstream-test-score.ts](unified/upstream-test-score.ts) | Original current-pinned Mindmap/GitGraph assertions, full monorepo declaration census, separate unscored literal replay; per-project retained results. |
| `entry-startup` | [entry-startup.ts](unified/entry-startup.ts) | Manifest-derived public entries and real operations; fresh first-result latency plus separate paired memory/CPU diagnostics; per-project retained results. |
| `mermaid-baseline-browser` | [baseline-browser.ts](unified/baseline-browser.ts) | Pinned Mermaid browser SVG reference, five renderer rounds with A/A controls, 25 fresh startups and five separate document-heap passes; same authored cases across tools. |
| `mermaid-baseline-compatibility` | [mermaid-baseline-compatibility.ts](unified/mermaid-baseline-compatibility.ts) | Public parser admission, explicit required DOM host for Mermaid, 25 first-result processes and five child resource passes; existing original-assertion records retained. |

## Performance and delivery suites

Select one row with `bun run bench --profile full --suites ID --out /tmp/RUN`,
adding its documented prerequisites. The root `bench:*` shortcuts are convenience
commands; each owning protocol controls the meaning of its measurements.

| Suite ID | Owning entry | What it measures |
| --- | --- | --- |
| `invocation` | [unified/invocation.ts](unified/invocation.ts) | Installed library entries across runtimes; browser, worker and editor paths; Node/native CLI; MCP transports. Output/functionality qualification accompanies invocation clocks. |
| `community` | [unified/community.ts](unified/community.ts) | Catalog-driven API/browser comparisons, fixed core timing, broader feature qualification, shipped payloads and scoped memory diagnostics. |
| `community-cli` | [unified/community-cli.ts](unified/community-cli.ts) | Matched fresh CLI latency; a separate GNU time pass measures child CPU and peak RSS. Requires prepared community artifacts. |
| `portable-community` | [portable/run.ts](portable/run.ts) | Explicit project-artifact campaign with authored family/scaling/adversarial cases, scoped semantic/paint checks, repeated controls, fresh-process first-use samples and separate resource probes. Requires `--portable-project` and `--portable-artifact-root`; excluded from automatic nesting. |
| `samples` | [sample-bench.ts](sample-bench.ts) | Small local source-render timing sample; useful for smoke diagnosis, not broad competitive ranking. |
| `dave` | [dave-bench.ts](dave-bench.ts) | Original Dave-style browser comparison on pinned Mermaid source cases. Exact candidate-archive mode uses the release-browser runner. Acceptance and shared-success timing are separate. |
| `micro` | [micro-bench.ts](micro-bench.ts) | Fixed small-to-large graph API microbenchmarks. |
| `experiments` | [experiment-matrix.ts](experiment-matrix.ts) | Paired experimental configuration matrix, including optional broad/PNG workloads. |
| `pipeline` | [pipeline-audit.ts](pipeline-audit.ts) | Instrumented stages and attribution; its clocks are not the uninstrumented community API metric. |
| `peers` | [peer-bench.ts](peer-bench.ts) | Legacy warmed peer comparison or explicit first-use/new-source/repeat/label-edit tracks with consumed SVG and receipt boundaries. |
| `peers:qualify` | [qualify-peer-performance.ts](qualify-peer-performance.ts) | Two A/A controls followed by candidate comparison, semantic completeness, per-case latency/allocation/scaling gates and calibration. Uses the selected target's protocol. |
| `release` | [release-bench.ts](release-bench.ts) | Candidate versus admitted release baseline: correctness, timing, memory and distribution budgets. Dependency policy is part of the comparison. |
| `release:browser` | [release-browser-bench.ts](release-browser-bench.ts) | Exact archived browser candidates/baselines, pinned corpus acceptance and time, delivery and scoped browser diagnostics. |
| `render-stages` | [render-stage-bench.ts](render-stage-bench.ts) | Official-corpus SVG receipt stage costs. |
| `editor-preview` | [editor-preview-bench.ts](editor-preview-bench.ts) | Actual editor preview lifecycle and request/DOM boundaries. |
| `editor-delivery` | [editor-delivery-bench.ts](editor-delivery-bench.ts) | Per-interaction requested graph, worker work, compressed delivered bytes and official-corpus editor behavior. Requires the selected built site. |
| `editor-session` | [editor-session-bench.ts](editor-session-bench.ts) | Cold editor sessions and subsequent interactions. |
| `editor-ownership` | [editor-ownership-bench.ts](editor-ownership-bench.ts) | Frozen original/candidate ownership pages; requires both real variants and their assets. |
| `renderer-profile` | [renderer-profile.ts](renderer-profile.ts) | Packaged/browser attribution and CPU profiles; requires the verified Bezel wrapper. |
| `palette-performance` | `../palette-performance/run.ts --record` | Warm palette-generation timing by built-in theme/category count. Requires a clean committed checkout and retains its own recorded work scope. |

## Functionality and correctness suites

These can expose defects that invalidate a fast result. Their counts and wall
times must remain separate from performance stack ranks. Product-owning tests
can also remain ordinary correctness CI checks; invoking the benchmark
orchestrator is a separate activity.

| Suite ID | Owning boundary | Evidence |
| --- | --- | --- |
| `family` | [unified/family-suite.ts](unified/family-suite.ts) | All-family source lifecycle, rendering, independently declared fixture assertions and direct operation witnesses. |
| `pinned-reference-score` | [unified/reference-score.ts](unified/reference-score.ts) | Same positive fixtures and criteria against pinned public Mermaid, plus separate portable parser timing. Reviewed diagnostics are unscored. |
| `performance-profile` | [qualify-performance-profile.ts](qualify-performance-profile.ts) | Correctness qualification of the experimental performance profile. |
| `output-identity` | [output-identity.ts](output-identity.ts) | Cross-revision output byte identity across styles/formats; equality does not establish independent correctness. |
| `browser-contracts` | `../../e2e/run-browser-contracts.ts` | Canonical managed-browser editor/security contracts. Driver-owned, including website setup. |
| `distribution-cli` | `../../e2e/{cli-smoke,cli,fresh-checkout}.e2e.test.ts` | CLI and offline fresh-checkout behavior. |
| `distribution-native` | `../../e2e/single-binary.e2e.test.ts` | Compiled single-binary contracts. |
| `distribution-dist-fuzz` | `../../e2e/dist-artifact-fuzz.e2e.test.ts` | Plain-Node built artifact differential fuzzing. |
| `distribution-tarball` | `../../e2e/tarball-consumer-fuzz.e2e.test.ts` | Installed archive library, CLI, MCP and getting-started contracts. |
| `distribution-tarball-node22` | Same tarball owner under independent Node 22 | Distinct runtime evidence; requires `NODE22_EXECUTABLE`. |
| `browser-lazy-delivery` | `../../scripts/build/browser-lazy-report.ts` | Actual built module/request closures, compression and delivery budgets. |
| `family-contracts` | Existing descriptor/registration/edit/source-map tests | Family capability and Scene/mutation contracts. |
| `family-functionality` | Existing family/agent/style/property test owners | Scoped owning behavior selected by family IDs and filename conventions. This selection is not a direct operation-coverage map. |
| `upstream-imported` | Imported-corpus test owners | Historical Mermaid parser/DB cases and family companions, retaining their individual pins. |
| `pinned-semantic-tests` | `../mermaid-modern-compat/semantic.test.ts` | Current-reference semantic and label assertions. |
| `pinned-operation-tests` | `../mermaid-modern-compat/native-operations.test.ts` | Current-reference ordered native writes. |
| `pinned-grammar-tests` | `../mermaid-modern-compat/grammar-regressions.test.ts` | Current-reference grammar regressions. |
| `pinned-semantic-corpus` | `../mermaid-modern-compat/run.ts` | Independent reference corpus, authored labels and deterministic fuzz. |
| `pinned-grammar-corpus` | `../mermaid-modern-compat/grammar-run.ts` | Independent current-reference grammar/native observations and deterministic fuzz. |
| `agent-replay` | Existing `agent-usage.test.ts` owner | Stored/scripted safe mutation and agent usage paths. No new model calls. |
| `mcp-conformance` | `../../scripts/ci/mcp-conformance.ts` | Official pinned MCP wire conformance, independent of diagram fidelity. |
| `style-audit` | Existing style option/output tests | Public style behavior. |
| `sketch-check` | Existing sketch tests and contrast audit | Sketch behavior and own contrast criteria. |
| `layout-compare` | `../layout-compare/run.ts` | Own-quality snapshot; comparison requires a separately admitted baseline. |
| `route-enumeration` | `../degenerate-etn/enumerate.ts` | Degenerate-route structure and certificate enumeration. |
| `visual-rubric` | `../visual-rubric/run.ts` | Own layout/rendering invariants, independent of Mermaid pixel equality. |
| `heuristic-tracker` | `../heuristic-tracker/run.ts` | Per-fixture own layout-quality diagnostics; no baseline reset implied. |
| `ugly-audit` | `../ugly-detector/audit.ts` | Own aesthetic/layout diagnostics. |

## Preparation, campaigns and external evaluations

| Suite ID | Entry | Scope |
| --- | --- | --- |
| `family-portfolio` | [unified/portfolio.ts](unified/portfolio.ts) | Builds registry-derived balanced inputs outside the checkout; preparation, not a speed result. |
| `modern-editor` | `../modern-mermaid/run.mjs` | Explicit external application/dependency-engine comparison with its own frozen resume identity; requires its separately supplied checkout. |
| `agent-live` | `../agent-usage/live.ts` | Actual provider/model task behavior and observed token usage. Explicit model and credentials required. |
| `agent-subagent` | `../agent-usage/capture-subagent-prompt-eval.ts` | External prompt dispatch and transcript evaluation. Templates alone are not a completed model evaluation. |
| `prs` | [unified/pr-campaign.ts](unified/pr-campaign.ts) | Explicit frozen-head main/PR campaign, paired controls and optional functionality/invocation evidence. Excluded from automatic nesting to avoid repeating campaigns. |

## Direct entry points, report tools and external evaluations

These entries exist and should be considered when someone says “all benchmarks.”
Some commands invoke enrolled suites directly or overlap owning tests; others
are report tools or evaluations that need external inputs or paid model runs.
Listing a direct command here does not add an automatic controller suite.

| Entry or command | What it adds | Relationship to the controller |
| --- | --- | --- |
| [editor-delivery-bench.ts](editor-delivery-bench.ts) `--site DIR --out DIR [--rounds N] [--corpus official]` | Direct invocation of the enrolled editor-delivery diagnostic. | The `editor-delivery` controller entry supplies the selected built site. |
| `../../scripts/site/website-payload-report.ts` | Built website payload/compression report. | Build-artifact diagnostic; distinct from observed navigation/first-render request closure. |
| `bun run ../palette-performance/run.ts --record` from this directory | Direct invocation of palette-generation timing; deterministic work-count tests remain separate. | Enrolled as `palette-performance`; requires a clean committed checkout. |
| `bun ../modern-mermaid/run.mjs CHECKOUT OUTPUT_DIRECTORY` from this directory | Direct external Modern Mermaid editor, dependency-engine, theme/example/export and request comparison. | Enrolled as explicit `modern-editor`; retains its own resume protocol. |
| `bun ../modern-mermaid/summarize.mjs OUTPUT_DIRECTORY` from this directory | Summarizes that existing evidence. | Reporting only. |
| `bun ../mermaidseqbench/runner.ts` from this directory | IBM MermaidSeqBench parse/verify/structured/roundtrip counts. | Its corpus also has an enrolled imported-test owner; not an independent second performance vote. |
| `bun ../agent-usage/run.ts` from this directory | Stored Code Mode task replay, trace linting and task oracles. | Agent replay owning tests cover related behavior; this is not live model efficiency. |
| `../agent-usage/render-quality.ts` | Render/safety/bounds/label evaluator over actual scripted agent outputs. | Callable evaluator, not its own standalone executable or complete visual oracle. |
| `../llm-judge/judge.ts` | Quality-judge request/oracle helpers and debiased pairwise protocol. | Callable library requiring an external judge; deterministic mocks prove wiring only. |
| Root `eval:skill:*` commands in `../../scripts/eval/` | Private skill corpus hydration, verified runner preparation, Codex evidence execution, trace/output materialization, bundling and latency/token summaries. | Separate model/skill evidence workflow, not currently enrolled; credentials/private data and runner prerequisites apply. Preparation and bundling do not count as completed tasks. |
| `../palette-harmony/README.md` experiment | Offline hue-template experiment over themes/counts. | Exploratory quality evidence, not a production rendering option or general renderer benchmark. |
| `bun ../family-usage/count.ts DIRECTORIES...` from this directory | Counts real Markdown Mermaid family usage. | Corpus research; repository docs alone are not a representative user population. |

Other files support the above owners: dataset harvesters, corpus builders,
worker adapters, baseline installers, browser hosts, structural helpers,
metamorphic relations, contact sheets and report reducers. They are not separate
benchmarks simply because their filenames contain “bench” or “eval.”

## Report maintenance

[unified/charts.py](unified/charts.py) and
[unified/update-scorecard.ts](unified/update-scorecard.ts) generate charts and the
requested maintained Markdown from admitted completed evidence. They do not run
performance clocks. Preparation, qualification repairs and reconciliation tools
preserve the original results and explicitly identify any scoped replacement.

Use the project-update workflow in [unified/README.md](unified/README.md) to retain
unchanged project records. Retained results keep their actual dates and versions;
updating one project does not make the whole community a fresh same-host run.
