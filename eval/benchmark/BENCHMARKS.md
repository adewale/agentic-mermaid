# Agentic Mermaid product diagnostics: questions, value and limits

A benchmark is useful when it answers a decision you actually face. The diagnostics keep capability, correctness, latency, resources and delivery separate. There is no overall score and no current published result set: the old snapshots have been removed.

**Start here:** use community admission to find unsupported or broken inputs; use authored meaning/paint checks to investigate fidelity; use first-result/scaling experiments for performance decisions. The six-input community speed core is a narrow repeat workload, not evidence of general rendering speed.

The [27–28 October historical campaign](../../docs/benchmarks/campaign-2026-10-28.md) retains AM PR comparisons and backend/source-suite findings separately from Trident’s ecosystem scores. It is not a current release qualification.

## Run product diagnostics

Run `bun run bench --list --profile full` to inspect prerequisites, then
`bun run bench --profile full --suites ID --rounds 5 --out /evidence/ID`.
These source, editor and release protocols belong to Agentic Mermaid. Shared
artifact comparisons run in [Trident](https://github.com/adewale/trident/blob/main/BENCHMARKS.md).
The pinned library is prepared by `eval/trident/prepare.ts`; no synthetic product
workspace is created. Missing prerequisites remain blocked, and owning test counts
are not competitive scores.

A full product ledger can retain both the selected source candidate and catalog
releases. Catalog observations carry the explicit `catalog-release` variant for
every project, preserving the actual published versions and original records.
They cannot be pooled with the source candidate as one artifact comparison;
conflicting versions within the same catalog comparison still fail admission.

For a frozen release comparison, supply `--candidate-tarball` and its
`--candidate-sha256`, plus `--baseline-tarball` and its `--baseline-sha256`.
Both the Node and browser release suites use those selected archives. An explicit baseline tarball takes precedence over a baseline directory supplied for another diagnostic. Endpoint-marker source checks instead accept `--baseline-checkout` and `--candidate-checkout`; they require clean built Git roots, not installed package directories. The Node
suite blocks a baseline archive without its digest instead of substituting npm
`latest`; npm selection is used only when no directory or archive baseline was
selected.

## Community output admission

**Question:** which of my Mermaid inputs can this tool return in the requested format, retaining expected labels? **Value: high for compatibility triage; limited for fidelity.**

From a Trident checkout, run `bun commands.ts community:update --projects OWNER/TOOL --profile full --rounds 5 --records /evidence/records --out /evidence/run`. SVG, terminal, PNG and parser lanes stay separate. Inspect the per-case record, family grid and failure pages produced by `results:publish`.

The score is passed/failed/blocked/unsupported input evidence, with family coverage and the actual denominator. XML and label existence do not establish identities, relationships, visibility or good layout. PNG checks only its binary envelope. A parser-only fixture must not be called a render defect. Different supported subsets cannot be read as equivalent fidelity percentages.

## Community API and CLI costs

**Question:** what does a named public call or CLI process cost on the same inputs? **Value: useful as a narrow diagnostic; weak as a general performance ranking.**

The community update also measures a fixed six-input API core, browser loading/delivery/heap scopes and admitted CLI processes. `community-cli` is the source controller ID for its separate CLI supplement. An npm CLI must be declared in the catalog; no project gets an automatic local binary. Resources are collected separately from latency.

Read first-call versus repeated-source costs by surface. Only a complete qualified core can receive a portfolio time. Those six inputs are development-exposed and too narrow to represent all families or production. A cached identical source answers a real cache workload; it is not evidence of uncached layout speed. The report's admission ordering is not an overall winner. See [shared methodology](https://github.com/adewale/trident/blob/main/METHODOLOGY.md).

## Portable family and scaling

**Question:** does performance remain acceptable across families, increasing sizes and interacting features while preserving declared correctness? **Value: high for controlled regression work; still not a production forecast.**

From a Trident checkout, build the kit with `node commands.ts build --out /artifacts/trident-kit`; run `node /artifacts/trident-kit/run.mjs --project OWNER/TOOL --artifact-root /artifacts/package --adapter ADAPTER --out /evidence/portable --records /evidence/records --rounds 5 --samples 31 --cold-samples 20 --allow-partial`. See `run --help` for supported artifact bindings. It needs the real artifact and independent oracle, not product source. Browser/observer capabilities depend on the adapter and platform.

The authored cohorts include family representatives, scaling, interacting features and invalid inputs. Reports separate correctness, warm sample means, fresh processes, resources and calibration. Inspect `report.md`, its full JSON/records and owning samples. A partial run or failed A/A control is not performance-qualified. A p95 of batch means is not a single-call tail. More input shapes and independently chosen real workloads are needed before generalizing.

## Davebench: official documentation

**Question:** how often does the tool return SVG for Mermaid's official docs, and how much render-call time does it use on shared successful examples? **Value: high as an external compatibility workload; moderate as a performance workload.**

Use source ID `dave` or `bun run bench:dave`. Exact archives can be supplied through the controller's candidate tarball/digest options. The current runner is still a fixed-engine comparison around an Agentic candidate, Pele and pinned Mermaid, with optional verified peers. This product protocol retains its own inventory and warm-up policy. Trident’s separate `docs` suite supplies catalog-wide public SVG bindings; neither inventory substitutes for the other.

Every official fence occurrence remains in the acceptance denominator, including repeats and failures. Time only the same shared-success occurrences within each candidate/comparator pair; that subset cannot erase missing docs examples. SVG return is weaker than faithful rendering, and docs are public development inputs. See [Dave methods, prerequisites and outputs](docs/davebench.md).

## Authored meaning and painted fidelity

**Question:** did identities, endpoints, values and operations survive, and does the actual output draw the required things? **Value: high; stronger evidence of correctness than format/label admission.**

Source IDs `mermaid-fidelity` and `community-fidelity` execute an independently declared criterion universe. The latter uses an actual frozen browser preparation manifest (`--community-browser-prepared FILE`); it does not acquire missing tools. Core model adapters remain fixed to reviewed engines. See [the shared fidelity guide](https://github.com/adewale/trident/blob/main/fidelity/README.md).

Scores separate public operations, native meaning, paint, unavailable projections and baseline-qualified criteria. Failed renders cannot shrink a peer's denominator. A reference-qualified percentage must retain the reference's own failures. Paint ownership is useful structural evidence, not complete typography, aesthetics, accessibility or perceptual judgment. Keep the actual SVG/PNG witnesses.

## Original upstream tests

**Question:** does the implementation satisfy specific unchanged Mermaid expectations? **Value: medium for cross-project compatibility; high for validating the reference setup.**

`upstream-original` executes genuine pinned Mermaid core Vitest with its real dependencies and read-only snapshots. `upstream-fidelity` projects original callbacks through reviewed peer public models. `upstream-test-assertions` is the narrower original Mindmap/GitGraph callback lane. They require the pinned source and appropriate adapters; they are not interchangeable.

Report discovered declarations, expanded callbacks, passes, failures, pending/todo and unavailable tests separately. Private database representation and diagnostic wording can fail even when drawings are correct. These are compatibility findings, not automatically missing features. Callback workflow time includes setup and assertions; it is not renderer latency. See [original-test methods](https://github.com/adewale/trident/blob/main/fidelity/README.md).

## Selected pinned-reference inputs

**Question:** what does a fixed selected historical corpus preserve through parsing? **Value: low as independent conformance evidence; useful for legacy regression diagnosis.**

Source ID `pinned-reference-score` scores selected portable criteria and measures parser calls separately. The input harvest includes Agentic-derived fields and selection effects. Keep its eligible, diagnostic and reference-failing cases distinct. Do not present it as “all Mermaid tests” or favor its score over stronger authored/original evidence.

The `pinned-semantic-*`, `pinned-operation-tests`, `pinned-grammar-*` and `upstream-imported` suites are additional owning correctness checks/corpora. They help find specific regressions; their test totals and process wall times are not competitive benchmark scores.

## Required-family admission

**Question:** can each required family pass a real representative public-render/label probe? **Value: high as a capability gate; low as exhaustive feature coverage.**

Source ID `stable-support` uses actual built artifacts and the pinned family policy. Required families, unresolved maturity exclusions and supplements remain separate. Count actual probe outcomes, not registry declarations. One representative cannot certify every nested feature, option, edit or painted relationship.

## Family functionality and operations

**Question:** do parse, edit, serialize, layout and output operations satisfy their declared contracts? **Value: high for the project's own regressions; limited as a peer comparison.**

Source ID `family` records executable lifecycle/operation witnesses. `family-contracts` and `family-functionality` run project-owned tests. Advertised operation kinds without a direct witness remain unmeasured. An owning-test pass is not automatically credited to every export, transport or operation. These source-coupled Agentic checks cannot be presented as neutral scores for other tools.

## Invocation coverage

**Question:** can a real caller obtain the expected result through the shipped interface? **Value: high for distribution reliability; not a language-fidelity or speed ranking.**

Source ID `invocation` exercises installed library entries/runtimes, browser/worker/editor paths, CLI and MCP transports. Build the actual artifacts; an independent Node 22 run requires its real executable. Inspect per-attempt output consumption, failures and blocked interfaces. Complete attempted coverage does not mean every function, feature or option was tested. Current transport orchestration is project-specific.

## Entry startup and resources

**Question:** how long until a fresh caller can consume its first result, and what resources are used? **Value: high for CLI, cold library and interactive use.**

Source ID `entry-startup`, with `--rounds 5 --startup-samples 5`, uses fresh processes and separate resource passes. `mermaid-baseline-browser` and `mermaid-baseline-compatibility` provide paired reference/browser and Node parser comparisons. Supply the built entries, browser and any actual native/hosted artifacts.

The product browser-baseline protocol has reviewed bindings for Mermaid, Agentic
Mermaid and Pele. An all-project selection runs those bindings and retains
explicit unsupported rows for the others; selecting only unreviewed projects
does not launch a reference worker. The separate Trident catalog browser suites
cover all prepared SVG bindings.

Read import, readiness, API call, first consumed result, CPU, whole-child RSS, document heap and delivered bytes in their own units. Different return models or DOM hosts are different stacks. Twenty-five samples do not establish a robust extreme tail, and these memory domains cannot be added. See [startup methods](visualizations/README.md) and [baseline methods](visualizations/MERMAID-BASELINE.md).

## Release and peer comparisons

**Question:** did this exact candidate improve or regress relative to a real baseline under the same conditions? **Value: high only with equivalent work, correctness admission and calibrated controls.**

Source IDs `release`, `release:browser`, `peers` and `peers:qualify` use their own maintained protocols. Supply exact candidate/baseline tarballs with digests, or the explicitly supported lock/directory. Current release/semantic peer runners are source-coupled and contain project-specific assumptions. For other projects, the public candidate/release comparison is available, but it is descriptive rather than that full paired qualification.

Read correctness and coverage first, then per-case timing, memory/delivery and A/A calibration. Missing rounds or a noisy baseline do not become a pass. Changes in dependencies/configuration or public interfaces are compound comparisons, not isolated PR gains. A frozen-head PR campaign (`prs`) orchestrates these experiments; it is not a separate benchmark.

## Microbenchmarks and experimental configurations

**Question:** which small operation or source/configuration change deserves investigation? **Value: medium for local optimization; low for public product claims.**

Source IDs `micro`, `samples` and `experiments` run fixed small/large API cases or paired experimental configurations. Inspect per-case distributions and correct consumed output. These workloads are easy to overfit by size, shape or cache behavior even without hard-coding input IDs. Verify a proposed improvement with other shapes and an actual workflow before publishing it.

## Pipeline, render stages and renderer profiles

**Question:** where does execution time go? **Value: medium to high for diagnosis; low as a comparison of user-visible latency.**

Source IDs `pipeline`, `render-stages` and `renderer-profile` instrument stages or collect profiles. The profile runner additionally needs its verified external wrapper. Instrumentation, receipts, initialization and cleanup alter the measured boundary; stage times must not be relabelled or summed into a public API result. Use the profile to choose a change, then remeasure the real public operation. `performance-profile` is a correctness qualifier for an experimental configuration, not a speed benchmark.

## Editor workflows

**Question:** what does a user wait for and download when opening or editing a diagram? **Value: high when the completion boundary matches the user task.**

Source IDs `editor-preview`, `editor-session`, `editor-delivery` and `editor-ownership` require an actual built site (`--site DIR`). Ownership also requires real reviewed `original.html` and `candidate.html` variants via `--ownership-site DIR`. These currently exercise Agentic's editor, not an arbitrary project UI.

Inspect verified preview/DOM completion, request closures, export behavior and failures. An eight-edit burst completing its latest preview is not eight completed renders or a single-keystroke latency measurement. Localhost delivery is not deployed network performance. See [measurement boundaries](MEASUREMENT.md).

## Modern Mermaid application comparison

**Question:** how does a particular external application and its dependency engines behave on examples, themes, editing and exports? **Value: medium for that application; low as a general renderer league.**

Source ID `modern-editor` needs the explicit external checkout (`--modern-editor-root DIR`) and output outside the source checkout. Freeze real variants/dependencies and retain its resume identity. Application setup, engine rendering, theme state and exports are separate results. `source bench:modern-summary DIR` only validates and summarizes completed evidence; it is not another benchmark or current score.

## Palette generation

**Question:** does a palette change create a local hotspot or deterministic-work regression? **Value: low as a public benchmark; useful while changing that subsystem.**

Source ID `palette-performance` requires a clean committed source checkout and writes its own report. Compare equivalent themes/category counts; do not generalize warm palette timings to rendering or editor performance. See [palette diagnostic](PALETTE-PERFORMANCE.md).

## Geometry and layout-quality diagnostics

**Question:** did a change break routes, marker attachment, spacing, visibility or an internal visual rule? **Value: high for narrow regression checks; limited for human-perceived quality.**

`endpoint-marker` compares two immutable built checkouts (`--baseline DIR --package-root DIR`) and writes geometry metrics. `layout-compare`, `route-enumeration`, `visual-rubric`, `heuristic-tracker` and `ugly-audit` test their own structural or heuristic criteria. `output-identity` instead checks bytes across `--baseline-ref`; unchanged bytes do not establish correctness.

Revision-based source tools extract production source and bundled fonts from the
selected Git revision, then copy the current product evaluation drivers, frozen
inputs and protocol policy into an explicit scratch tree. Dependencies are
reused from the current checkout. This isolates production source and verified
resources under one protocol; shipped-artifact and dependency comparisons stay
at their release boundaries. Extraction never writes product files into Trident.

Inspect representative actual drawings, including interacting failures. A heuristic score is not an independent human preference or complete aesthetic judgment. Style/sketch tests and distribution/browser contracts are owning product checks; they protect behavior but do not add independent comparison votes.

## Agent evaluations, preparation and reports

Agent replay, live-model/subagent tasks and MCP conformance have value for their **own workflow correctness**, not general renderer performance. Replay is not a new provider run. Live quality/token/cost claims need actual named models, transcripts and observed usage; a blocked provider earns no score. Callable judges need independent real judgments.

Corpus building (`family-portfolio`, corpus import), artifact acquisition, report reducers, chart generators and campaign controllers prepare or explain experiments. They are necessary infrastructure, not additional benchmark outcomes. The command inventory lists their executable boundaries.

## Historical product campaign reports

The AM-specific retained-report writer and chart generator live in `eval/benchmark/unified/update-scorecard.ts` and `eval/benchmark/unified/charts.py`. Their overlay-admission and invocation-census tests move with them. They read existing evidence and never collect new timings. Prepare the pinned Trident dependency first; shared record decoding and artifact-version validation stay in that library.

```sh
bun eval/benchmark/unified/update-scorecard.ts --run /evidence/am-campaign --output /evidence/am-scorecard.md
python3 eval/benchmark/unified/charts.py --run /evidence/am-campaign --prs /evidence/am-prs --out /evidence/am-charts
```

These commands serve AM’s historical source/invocation protocols. Use Trident’s `results:snapshot` and `results:publish` for current ecosystem reporting.
