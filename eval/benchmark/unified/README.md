# Unified benchmark runner

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
invocation result. Dave retains its existing build/pack comparison entry, and
`bench:dave` continues to work independently. Its warm-up, case denominator and
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

- `report.json` and `report.md`: suite selection, prerequisites, execution status,
  exact commands, wall times, test scores, declared policies and remaining gaps.
- `coverage.json` and `coverage.csv`: observed surface/family/operation/format/mode cells. Missing
  cells are unmeasured; fixture enrollment does not prove feature completeness.
- `observations.csv`: per-observation runtime, implementation, status, samples and metrics.
- One directory per suite, with complete process logs and native suite artifacts.

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
Playwright Chromium plus its headless shell. They accept no benchmark `--site`
or `--executable` override. Install them with `playwright install chromium`,
optionally setting `PLAYWRIGHT_BROWSERS_PATH` consistently for preparation and
execution. Missing executables are blocked prerequisites. Screenshot baseline
updates are disabled. Counts sum the separate fresh test-process summaries.
The lazy-browser delivery gate separately checks actual built closures and
gzip/Brotli budgets without rebuilding during its evaluation.
Profiles and `--suites` make expensive work explicit. The default per-suite
outer budget is 30 minutes (`--timeout-ms` changes it); timeout terminates the
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
rounds. Broader family feature attempts have one warm call and three single-call
samples, rather than calibrated repetition. Node and external JSONL workers
preserve completed cases, enforce progress deadlines and restart untouched
inputs after crashes, with bounded retries recorded in raw evidence. Browser
realm failures retain earlier rows and explicitly block the remaining cases.
Declared catalog outputs without adapter bindings remain unmeasured capability
rows. Catalog-only nodes and unavailable runtime capabilities are not multiplied
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
