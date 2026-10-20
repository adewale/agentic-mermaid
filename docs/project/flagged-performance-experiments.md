# Flagged performance experiments

These experiments implement the data-structure candidates raised during the
Mermaid Dart comparison. They are internal, opt-in paths. An ordinary import
keeps every experiment disabled. Configure the environment before importing:

```sh
AGENTIC_MERMAID_EXPERIMENTS=text-spans,indexed-layout bun your-program.ts
```

For the browser, set `globalThis.AGENTIC_MERMAID_EXPERIMENTS` to the same comma
list before loading the library. This is startup configuration, not a render
option. Changing it after the module loads has no effect. Internal tests use a
synchronous scoped override; applications should use independent processes or
documents to compare configurations.

## What the flags actually implement

| Flag | Implemented mechanism | Where it can help | Limits and costs |
|---|---|---|---|
| `graph-index` | Pass-owned node/adjacency maps and a packed bounding-volume broad phase | Flowchart, state and architecture routing and final proofs | Mutable geometry uses live data; exact predicates and author order remain authoritative. Small inputs can pay construction overhead. |
| `scene-arena` | Bounded exact-recount key interning, interned inspection ancestry and retained inspection for internal immutable Scenes | Native SVG families | This prototype does **not** replace the public Scene with a contiguous geometry arena. Main already supplies the path-stack admission walk; external snapshots keep their admission boundary. |
| `svg-passes` | Retained lexical tokens across structure-preserving rewrites and one-pass disjoint style replacement | SVG post-processing | Quote/markup changes force a fresh scan. Final-byte security checks still run. |
| `text-spans` | Bounded immutable prepared-text caches and typed source/advance lanes for plain ASCII wrapping | Native pixel text | Custom measurement bypasses caches; styled, tracked, monospace and irregular source clusters keep exact general wrapping. Cache residency consumes memory. |
| `indexed-layout` | Linear variable-size ordered forest layout with depth bands and subtree spans | Flat rectangular flowchart forests | Groups, labels on edges, cycles, fan-in, nonrectangles and long-rank edges fall back to ELK. Final route/geometry certification still runs. Geometry can differ. |
| `position-cache` | Private positioned-artifact snapshots, fresh copies on reuse and final projection certification | Exact repeated native requests except Gantt | One global 16 MiB estimated-weight / 128-entry budget, isolated descriptor identities. Key includes source, complete appearance/options, relevant environment and other flags. Custom measurement and artifacts that cannot be privately cloned (including C4 identity callbacks) bypass it. `AGENTIC_MERMAID_ELK_CACHE=0` disables it. This prototype does not reuse across different paint themes. |
| `paint-bvh` | Typed-array BVH, bounded quickselect, exact node allocation and eight-item leaves | Native SVG paint proof | Retains median/tie traversal and proof-budget behavior. Small scenes may not repay construction. |
| `incremental-order` | Insertion-only DAG ranks with bounded-interval searches and a stable minimum-heap Kahn order | Graph constraint construction | Backward insertions still rewrite the retained order. Reverse-authored sparse chains can be quadratic; this is not a worst-case optimal dynamic ordering algorithm. |
| `terminal-tiles` | Dense 32-cell row tiles with sparse Map fallback and insertion-order history | Terminal output | Wide grapheme ownership stays exact. This prototype does not replace owner records with numeric IDs. Tiles and history add overhead on some sparse workloads. |
| `persistent-mutations` | Ephemeral copy-on-write Map overlays and touched-record cloning | Supported builtin flowchart edits | Serialization and reparsing still run; draft objects never escape. Unsupported operations use full cloning. No incremental parser or multi-operation transaction is introduced. |
| `gantt-intervals` | Open-interval union queries for dependency routing and full-week calendar skipping | Gantt dependency arrows and long recurring exclusion calendars | Touching interval endpoints retain their meaning. Explicit date exceptions use the original walk; every skipped day counts toward the existing 10,000-day safety limit. |
| `sankey-csr` | Two-pass typed CSR adjacency, indegrees and queues for layer counting | Sankey | The subsequent d3 layout/relaxation is unchanged. Most other families cannot benefit. |

## Reproduce the selection

The feature matrix uses sequential fresh processes, counterbalanced order,
public render return plus an output byte-length check inside its timer
(receipt cases include JSON serialization), and complete-output hashing and
validation outside timing. This does not promise UTF-8 encoding or physical
traversal of every output byte. `--baseline-ref` builds production source from
that revision with the current harness. The reserved `baseline` configuration
has no flags; an additional empty `off` configuration measures current code
with every experiment disabled. Failed or incomplete configurations receive
no aggregate speed score.

```sh
bun run bench:experiments --baseline-ref origin/main --phase singles --rounds 3 --samples 3 --out bench-report/experiments/singles
bun run bench:experiments --baseline-ref origin/main --phase ablation --rounds 3 --samples 3 --out bench-report/experiments/ablation
```

`--configs FILE` accepts an array of `{ "id": "name", "features": [...] }`
records for candidate combinations. Add `--broad 1`, `--allocation 1`,
`--png 1`, `--runtime bun` or `--cache on` for the relevant diagnostic.
Use `--paired 1` for confirmation: each candidate receives an adjacent fresh
baseline, with the pair order reversed on alternating rounds. An empty-flag
configuration with `"source": "baseline"` supplies a genuine baseline A/A
control; other configurations use current source by default.
`--cache off` is the default and disables both ELK-result and positioned-result
reuse. Cold scores therefore cannot be improved by silently serving a previous
positioned result.

For timing confirmation, use `--gc natural --warmup 5 --warmup-ms 1000
--samples 12` on both sides. Natural mode runs no forced collection or
allocation probes and labels raw heap checkpoints uncollected; it omits
retained-heap summaries. Run `--gc checkpoint --allocation 1` separately for
settled heap and V8 allocation diagnostics. RSS always covers the whole worker.
Samples within a process are correlated; three process rounds describe
repeatability, not a 95% confidence interval. Baseline A/A calibration informs
interpretation of each case and aggregate; do not divide scores by its ratio.

The screen is one input to the decision. Confirm finalists with `bench:micro`,
`bench:peers`, `bench:release`, `bench:samples`, the full 1,095-occurrence Dave
corpus and packed-artifact delivery measurements. The micro suite includes
forward/reverse constraint chains and repeated/churning text preparation. The
broad matrix includes Gantt dependency arrows with recurring exclusions.

```sh
AGENTIC_MERMAID_EXPERIMENTS=text-spans,indexed-layout bun run bench:micro --baseline BASE_SHA --runtime node --rounds 3
bun run bench:dave --features text-spans,indexed-layout --rounds 3 --executable /usr/bin/chromium
AGENTIC_MERMAID_EXPERIMENTS=text-spans,indexed-layout bun run bench:pipeline --cache off --out bench-report/experiments/pipeline
```

The exact-artifact browser harness also accepts `--baseline-tarball` with its
`--baseline-sha256`, `--features`, and an optional pinned Dart SVG wrapper via
`--dart-bundle`, `--dart-sha256`, `--dart-revision`. `--memory-passes 1` runs
separate fresh-Chromium heap diagnostics after timing. Its memory population is
the distinct-source intersection successful in every engine and timed round;
the report preserves occurrence IDs. Forced-GC JS heap checkpoints and sampled
allocation are not native memory, process RSS or exact intra-render peaks.

Runtime flags retain their code in downloaded bundles. Compare the complete
IIFE, identically bundled SVG consumers, lazy initial requests and requests
through the first flowchart separately. Runtime activation alone cannot shrink
any of these artifacts.

## Audit and interpretation

Feature authors first ran owning-boundary tests. Independent algorithm and
semantic auditors then attacked the combined implementation. Their findings
included a typography cache-key collision for prototype-backed options and
over-allocation in the typed paint BVH; both were corrected and covered by
adversarial regressions. Text span follow-up tests cover exact wrap boundaries,
source provenance through transforms/entities and custom metrics. Calendar
tests compare every weekly exclusion mask against an independent day walk,
including fractional durations and the overflow boundary.

A separate methodology review corrected baseline selection, incomplete-run
ranking, PNG identity comparison, retained benchmark output strings and empty
child-process failure reasons before selection. Raw reports, profiles and
audit logs belong under `bench-report/experiments/`; they are generated evidence
and are not committed.

Selection must describe the best **measured** configurations and their
tradeoffs. Singles and leave-one-out ablations are not an exhaustive search of
all 4,096 subsets. Keep acceptance, geometry/label fidelity, cold throughput,
repeated-request latency, allocation, retained heap, RSS and download bytes as
separate quantities. Rejections do not count as fast successful rendering.

The branch was rebased onto `c517a1611290c7aa463512dc8b8d5156a3424a98`,
including PR #437's SVG/terminal allocation and deferred receipts and PR #432's
grammar, normalization and authored-meaning changes. The `07ab`/`318` and
`31c24a06`/`1b1ba848` studies remain historical; their measurements were not
relabeled after either rebase. Earlier review also exposed two correctness gaps:
C4 identity callbacks require positioned-cache bypass, and inline connector
labels must inherit enclosing group opacity in both inspection paths. Both
have behavioral red-to-green regressions.

## Measured selection

The [current results and ranked opportunities](flagged-performance-results-2026-10-20.md)
describe the rebased study. The conditional `text-spans,indexed-layout` profile
has repeatable cold forest gains, including fully consumed SVG/receipt calls.
Broader gains depend on runtime and consumption boundary. Adding
`position-cache` is a separate exact-repeat profile with lower allocation,
higher settled heap and adverse cases. Runtime flags retain optional code in
the download. Shared dispatch and wrapper work also remains when flags are off;
the current off control has repeated tree regressions. Disabled experiments do
not imply zero runtime cost. All flags stay off by default. The
[prior-baseline report](flagged-performance-results-2026-10-19.md) is historical.
