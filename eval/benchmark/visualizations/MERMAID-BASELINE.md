# Compare with the pinned Mermaid

Collect the current public browser and Node parser baselines with the unified
controller. Supply installed, frozen package roots; the reference prefix must
contain the pinned Mermaid package and its dependencies.

```sh
bun run bench --profile full \
  --suites mermaid-baseline-browser,mermaid-baseline-compatibility \
  --projects adewale/agentic-mermaid,obsidianmd/pele,mermaid-js/mermaid \
  --package-root /artifacts/agentic-mermaid \
  --portable-project obsidianmd/pele --portable-artifact-root /artifacts/pele \
  --mermaid-dir /sources/mermaid --reference-dir /artifacts/mermaid-reference \
  --node-executable /tools/node --startup-observer /tools/time \
  --executable /tools/chromium --rounds 5 \
  --benchmark-records /evidence/records --out /evidence/current --allow-incomplete
```

Repeat with the same inputs to reuse the original project records. Select a
single project with `--projects` to update only its measurements. A mixed
collection window retains descriptive ratios but cannot qualify a new paired
renderer win. Unsupported cases and strict-negative disagreements remain in the
results; `--allow-incomplete` does not suppress failures.

`mermaid_baseline.py` reads retained reports. It never imports a renderer,
starts a browser, fetches dependencies, or reruns a benchmark. Its outputs are
`summary.json`, `report.md`, and standalone SVG charts made with Python's standard
library. Keep generated outputs outside the repository.

```sh
python -B eval/benchmark/visualizations/mermaid_baseline.py \
  --dave /evidence/current/dave/browser-report.json \
  --upstream /evidence/agentic/upstream-test-assertions-report.json \
  --upstream /evidence/pele/upstream-test-assertions-report.json \
  --upstream /evidence/mermaid/upstream-test-assertions-report.json \
  --browser /evidence/current/browser/result.json \
  --parser /evidence/current/parser/parser-baseline.json \
  --tool-versions /evidence/current/tool-versions.json \
  --out /evidence/current/normalized
```

Each lane retains its own dates, settings, actual artifact versions, receipts,
input IDs, and qualification scope. `tool_versions.py` rejects conflicting tool
versions and missing executed versions before any output is written. The default
pins are in `../tool-versions.json`; an explicit manifest can select a uniform
historical set. Original evidence is never rewritten.

Cost is **tool / Mermaid**, with Mermaid=1 and lower values costing less. A
ratio belongs to one public boundary and one cohort. Node parsing, Node SVG,
browser rendering, fresh startup, requested delivery, and memory scopes cannot
be exchanged. There is no weighted overall score.

The Dave lane computes one direct intersection from the per-input JSONL samples:
every displayed engine must succeed in every round on every selected occurrence.
It does not divide existing candidate-relative ratios whose input sets differ.
The complete docs population and each tool's absolute admission count remain
beside that cost cohort. A returned SVG is not proof of Mermaid fidelity.

Fresh browser results use the sampling policy declared before measurement:

- Five renderer rounds, 25 fresh browser first-result samples, and five separate
  document resource passes per role. Mermaid A1 repeats the exact A0 artifact.
- Require at least five complete paired A0/A1 observations, and a median A1/A0
  ratio between 0.9 and 1.1. A rolling mix of retained windows is unqualified.
- Widen the observed tool/A0 ratio range to
  `[minimum / 1.1, maximum / 0.9]`. Classify lower cost only when the upper bound
  is below 1, higher cost only when the lower bound exceeds 1, otherwise unresolved.

This is a repeatability envelope, **not a confidence interval** or evidence that
a code change caused the difference. Missing/noisy controls cannot produce a
qualified win. Correct negative rejection contributes to its quality count; it
does not enter a successful SVG render-cost cohort. Common-success cohorts keep
excluded case IDs visible. Full authored-meaning, layout quality, CSS, glyphs,
clipping and perceptual paint require other evidence.

The Node parser lane has separate, unpaired startup and resource samples. Its
first-result clock includes process spawn, setup, imports and consumed public
results. It is not warm API latency. Ratios remain descriptive and decisions
remain unresolved. Whole-child peak RSS is distinct from the browser document's
V8 heap; neither is an allocation-per-API measurement.

Original Mermaid assertions are compared as absolute passed/declared callback
counts and deltas. Mermaid's own unavailable and skipped callbacks remain in its
denominator. Two reviewed files are not the complete upstream suite. Whole-worker
facade/preparation/assertion time does not become an engine speed ranking.

Historical community evidence is a separate invocation:

```sh
python -B eval/benchmark/visualizations/mermaid_baseline.py \
  --community /evidence/historical/community \
  --out /evidence/historical/normalized
```

The historical lane requires the same declared six core inputs in every round
and runtime. It retains all current catalog tools, including tools added after
the original campaign as unmeasured. Verified artifact aliases remain in tables
and are omitted from independent timing bars. Historical three-round costs have
no A/A qualification. The larger corpus mostly supplied functional qualification,
not repeated speed measurements. Parser-only inputs remain explicitly marked;
their absence of SVG output is not a renderer defect. Mermaid's own fixture
admission is measured, not assumed 100%, and higher admission on this corpus does
not establish higher semantic fidelity.

Run the reducer's owning controls without running any tools:

```sh
python -B -m unittest discover -s eval/benchmark/visualizations \
  -p mermaid_baseline_test.py
```

These manual analysis tools add no CI benchmark job and do not change measurement
producers or their retained identities. The reducer depends only on explicit
report contracts, the shared version guard and its chart module, so it can move
with the benchmark directory when the suite becomes a separate project.
