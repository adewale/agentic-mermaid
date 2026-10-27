# Entry startup visualizations

These readers consume explicit source-adapter evidence; see [setup](../adapters/agentic/README.md). They collect no benchmark scores by themselves.

`entry-startup.py` reads completed JSON and exports a local HTML gallery, CSV
tables, a JSON summary, Markdown methods, and PNG/SVG/PDF figures. It uses no
renderer APIs, benchmark execution, Git queries, or external web assets.

```sh
python3 eval/benchmark/visualizations/entry-startup.py \
  --startup adewale/agentic-mermaid=/path/to/agentic/raw-result.json \
  --startup obsidianmd/pele=/path/to/pele/result.json \
  --required-family /path/to/stable-support/result.json \
  --upstream /path/to/agentic/upstream-test-assertions-report.json \
  --upstream /path/to/pele/upstream-test-assertions-report.json \
  --upstream /path/to/mermaid/upstream-test-assertions-report.json \
  --dave /path/to/dave/browser-report.json \
  --out /path/to/visualizations
```

Python 3 and matplotlib are required to render. `--summary-only` uses the standard
library and skips all plotting imports. Optional inputs can be omitted. Keep the
owning attempt directory and its resource/payload artifacts: relative and absolute
artifact references are resolved from the declared result. The retained
`identity.json` supplies the actual package version for startup figure labels.
Run retained-record ownership checks before reporting; this exporter reads those
inputs without replacing their admission checks.

Before writing any report, the shared `../tool_versions.py` guard checks actual
artifact versions across every supplied lane against `../tool-versions.json`.
Startup versions come from owning identities, upstream versions from
`evidence.results[].artifact`, family versions from declared support files and
their parent identities, and Dave versions from its actual engine identities.
Missing executed-artifact receipts, conflicting versions of any canonical tool,
or a mismatch with a maintained pin fail without replacing existing output.
Package/engine aliases normalize to canonical project IDs; labels do not select
a release. The summary retains admitted versions and every receipt source.

An explicitly historical **uniform** comparison can select its own version
manifest with `--tool-versions /path/to/historical-tool-versions.json`. Keep its
raw evidence unchanged. There is no mixed-version override; a manifest does not
permit multiple releases of the same primary tool within a comparison. The Dave
candidate shares the default variant with startup, family and upstream receipts;
only an explicitly separate Dave baseline gets the `baseline` variant. A
baseline cannot bypass a manifest pin. Copy the shared helper and
manifest alongside the reader when extracting this reporting package.

The output includes:

- `index.html`: standalone gallery and a filterable, sortable interface table.
- `summary.json`: original latency samples, status counts, resource ranges,
  scopes, source paths, and per-observation unique fetched paths.
- `latencies.csv`, `resources.csv`, and `browser-delivery.csv`.
- SVG startup, CLI/MCP/browser workflows, direct phase clocks, whole-process RSS
  and CPU, live/released consumer memory, browser document heap, and delivery
  figures. Optional family-witness, upstream-callback, and Dave figures follow
  the supplied inputs.

Each interface keeps its runtime, output, invocation surface, operation, and
clock boundary. Discovery and editor eight-edit completion have explicit roles.
The generator rejects duplicate actual timed-sample coordinates, independently
of record-owner row IDs. It also rejects duplicate upstream callbacks and browser
delivery observations. Repeated metadata is never summed as network transfer.

Latency p95 uses nearest rank with at least 20 independent observations.
Resource diagnostics use median and observed range with their actual sample
count; they have no p95. GNU time CPU fields have 10 ms resolution each, and zero
is censored. No CPU-to-dollar or model-token cost is inferred.

Process peak RSS includes the whole observed child lifetime. Library JS heap,
external memory, and array buffers overlap with RSS. Consumer-release checkpoints
also follow result storage and GC; module and renderer caches remain. Browser
document heap excludes worker, native, GPU, and browser-process memory. Editor
preview DOM remains held. Empty-runtime differences are descriptive and may be
negative. The figures do not attribute allocations or add overlapping components.

Browser payload charts count unique fetched file bodies per actual operation,
round, and fresh sample. Per-file gzip totals are estimates; HTTP overhead and
compressed wire transfer remain unmeasured. Dave's matched cohorts and rendering
clocks stay separate from entry startup clocks; a combined set must use the same
tool versions in both lanes.

Family cells certify the authored format/label witness only. Original upstream
callbacks retain failed, unavailable, and skipped outcomes; executed assertion
counts do not supply a fixed score denominator. The charts award no weighted
winner, radar score, or calibrated causal speedup.
