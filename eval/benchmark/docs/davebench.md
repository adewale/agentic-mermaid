# Davebench: official Mermaid documentation

[Results policy](https://github.com/adewale/trident/blob/main/results/README.md) · [All benchmark guides](../BENCHMARKS.md) · [Owning runner](../release-browser-bench.ts)

Davebench asks how often an implementation returns SVG for Mermaid's official syntax examples, and how much public render-call time it spends on the same successfully rendered occurrences as a comparator. It is an independent docs workload, separate from the six-input community speed core, native-model assertions and painted-output fidelity.

## Inputs and scoring

The historical pinned inventory has **1,095 fence occurrences**, **546 distinct examples** across **34 pages**. Repeated occurrences remain distinct. New runs write their actual inventory into `corpus.json`; its counts, source pin and occurrence IDs define that run. Selecting `--case` is a diagnostic subset, never a full Dave score.

An engine accepts an occurrence only if it returns SVG successfully in every measured round. The scorecard verifies a unique receipt for every input/round cell; duplicate receipts cannot replace missing cells. All unsupported inputs, render exceptions and asset/environment failures remain in the full acceptance denominator. This is SVG-return acceptance, not label, topology, native-model or painted-fidelity certification.

Timing uses public render invocation through SVG return, excluding inspection, cleanup, validation and browser paint. Each candidate/comparator pair has its own fixed intersection of inputs accepted by both engines in every round. Sum calls for that same intersection within each round, calculate candidate/comparator cost, then take the median ratio. Lower than 1 means the candidate costs less time. Different pairwise intersections do not support a transitive overall speed ranking. Full-attempt times include failures and must not be used as a speed score.

## Prerequisites

Install this Agentic Mermaid checkout and prepare its [pinned Trident library](../../trident/README.md) with `bun eval/trident/prepare.ts`. Bun, Node, npm, Git, tar and Chromium are required. Install the exact Mermaid oracle and first-party addon with `bun node_modules/trident/commands.ts mermaid:install`. If using nondefault locations, set `MERMAID_UPSTREAM_DIR` and `MERMAID_REFERENCE_DIR` to the pinned source checkout and independent installed oracle. Keep package acquisition and artifact preparation outside timing.

Run Dave from the selected Agentic Mermaid checkout. Its convenience wrapper builds and packs that source. For a different or prebuilt candidate, use the exact-archive command below; a source path alone does not identify the bytes measured.

## Run a complete docs comparison

From the Agentic Mermaid root, with the environment above configured:

```sh
bun run bench:dave \
  --out /evidence/dave --rounds 3 --executable /path/to/chromium
```

This wrapper builds the selected checkout, packs one npm archive, verifies its SHA-256, and delegates to the owning browser scorecard. It requests **30 selected-corpus warm-up attempts** per engine/round. Current comparators are Pele **1.9.0** and Mermaid **12.2.0**; a verified `--bezel-dir` adds Bezel. The wrapper accepts `--features` for an explicitly named experimental configuration and `--case ID,...` for diagnostics. Both change the experiment and must be disclosed.

To measure a frozen candidate archive without building another renderer:

```sh
bun run bench:release:browser \
  --candidate-tarball /artifacts/agentic-mermaid.tgz \
  --candidate-sha256 VERIFIED_64_CHARACTER_LOWERCASE_HEX \
  --out /evidence/dave-exact --rounds 3 --warmup 30 --elk-cache off \
  --executable /path/to/chromium
```

The direct runner accepts an optional verified baseline tarball/digest or baseline lock; it does not need a baseline merely to compare the candidate with Pele/Mermaid. The controller's `release:browser` entry adds a baseline prerequisite because that entry represents a release comparison. The controller's `dave` entry can instead receive the candidate tarball/digest with its normal 30-attempt warm-up protocol:

```sh
bun run bench --profile full --suites dave \
  --candidate-tarball /artifacts/agentic-mermaid.tgz \
  --candidate-sha256 VERIFIED_64_CHARACTER_LOWERCASE_HEX \
  --out /evidence/dave-campaign --rounds 3 --executable /path/to/chromium
```

Engine order reverses on alternate rounds, with one tab and a fresh document per engine pass. Default viewport is 1440 × 1000. ELK cache is disabled by default; enabling it changes repeated-source behavior. Remote assets are blocked; resulting failures are retained as environment outcomes. The report records browser/harness versions, environment, artifact identities, actual packages, dependency policy and feature settings. Do not relabel a historical Pele 1.6.0 campaign as 1.9.0.

## Read and retain the outputs

| File | Contents |
|---|---|
| `browser-report.md` | Acceptance per engine, full-attempt time, pairwise shared-success ratios, failure categories and delivery scopes |
| `browser-report.json` | Completion/advisory status, identities, policies, complete sample-derived scorecard and delivery evidence |
| `browser-samples.jsonl` | Every per-engine, per-round occurrence receipt, including failures |
| `corpus.json` | Complete inventory, source text, occurrence IDs, pages and distinct count |
| `browser-runtime-comparison.json` | Actual runtime/dependency comparison receipt |
| Other output files | Focused consumer builds and optional resource diagnostics; keep their owning directory |

The unified controller additionally retains `report.json`, `report.json.gz` and the suite log. Preserve all files with the exact candidate artifact when independently reviewing or reducing a score. A completed process can retain many failed inputs; completion is not 100% acceptance. A historical Markdown summary without the raw samples cannot be independently re-reduced.

Complete monolithic bundle gzip, focused consumer builds, lazy initial entry and delivered closure through first render have different scopes. Optional memory diagnostics require the direct runner's `--memory-passes N`; they execute separately after timing and cover V8 JS heap/sampled allocation, not total process/native/WASM/GPU memory. Three timing rounds are advisory and do not establish calibrated regression thresholds, tail latency or a causal PR improvement.

## Results and scope

Old result bundles have been removed. A fresh run must retain its own corpus, exact artifact identities, samples and failures. This inherited runner currently uses an Agentic candidate and fixed comparators. It is not a catalog-wide docs benchmark, and a community admission percentage cannot substitute for a Dave score. Use Trident's public `docs` suite for every prepared catalog SVG binding. That suite inventories the raw pinned upstream syntax fences; it has a separate protocol and occurrence count from this historical vendored Davebench corpus. Keep both inventories explicit.
