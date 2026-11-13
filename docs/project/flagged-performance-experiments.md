# Selected performance paths

Ordinary imports select `text-spans,indexed-layout,position-cache` at startup.
These paths reuse prepared text and positioned results, and choose the forest
solver for eligible graphs. Exact repeats benefit most; unrelated requests can
pay lookup, copying and residency costs.

The superseded prototype studies remain in
[Git history](https://github.com/adewale/agentic-mermaid/tree/9136b07efb8944a1058de9834b18fe5916884174/docs/project/).
For current measurements, use [Trident](https://github.com/adewale/trident/blob/main/RESULTS.md).

## Mechanisms and limits

| Path | Benefit | Guard and cost |
|---|---|---|
| `text-spans` | Immutable display/pixel preparation caches and ASCII advance prefixes avoid repeated parsing and quadratic wrapping work. | Display cache: 512 entries / 4 MiB estimated weight; pixel cache: 256 entries / 8 MiB. Custom measurement bypasses pixel reuse. Styled, tracked, monospace and irregular clusters retain exact wrapping; near-boundary comparisons use the exact predicate. |
| `indexed-layout` | Linear variable-size ordered forest layout avoids ELK for eligible flat rectangular flowcharts. | Groups, edge labels, cycles, fan-in, nonrectangles, nonpositive spacing and long-rank edges fall back. Architecture is excluded. Final route/geometry certification remains. Eligible forest geometry can differ from ELK. |
| `position-cache` | Exact repeated requests reuse private positioned snapshots. | One 128-entry / 16 MiB estimated-weight LRU across isolated descriptor identities. Fresh clones restore prepared-text provenance; final projection certification still runs. Keys include source, appearance, options, family config, relevant environment and selected flags. Gantt, extensions, custom measurement and uncloneable artifacts (including C4 callbacks) bypass reuse. |

Weights are conservative estimates, not strict JS heap caps. Cache activation
retains code in downloaded bundles, so delivery cost must be measured separately.

## Startup configuration

With no setting, ordinary Node/Bun and browser imports select all three paths.
An explicit comma-separated list **replaces** the defaults. An empty string
selects the established paths:

```sh
# Defaults: all three selected paths.
bun your-program.ts
# Full opt-out.
AGENTIC_MERMAID_EXPERIMENTS= bun your-program.ts
# Prepared text only; forest and positioned reuse off.
AGENTIC_MERMAID_EXPERIMENTS=text-spans bun your-program.ts
# Disable both positioned and ELK result caching, retaining text and forest.
AGENTIC_MERMAID_ELK_CACHE=0 bun your-program.ts
```

In browsers set `globalThis.AGENTIC_MERMAID_EXPERIMENTS` before importing the
library; `''` disables the selection. A process environment value takes
precedence. Changing the experiment setting after import has no effect.
Internal tests can synchronously scope a selection with
`withPerformanceExperiments`; this is not a public render option.

## Owning checks

Startup tests in `src/__tests__/performance-startup.test.ts`
exercise unset defaults, empty and subset process values, and browser globals.
Owning contracts cover exact wrap ties, Unicode provenance, custom metrics,
mutable returned geometry, bounded cross-family residency, cache opt-out,
C4 callback bypass, forest fallback and final security admission.

For targeted profiling and ablation commands, see the
[benchmark guide](../../eval/benchmark/BENCHMARKS.md).
