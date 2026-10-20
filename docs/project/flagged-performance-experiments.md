# Selected performance paths

PR #436 retains `text-spans,indexed-layout,position-cache` and enables that
combination by default. The other nine prototypes were removed from production
and their owning experiment tests; the reports below preserve their historical
measurements. Main already supplied the qualified forest solver. This PR adds
prepared-text and positioned-result reuse and selects all three at startup.

## Selection

The [original final-source study](flagged-performance-final-2026-10-20.md) measured
source `65e65bd452985937563b3b2f76d4f0ff86c75276` against
`d709c7291ca6591dc9af060b2c7c7ec3349d3fc4`. Its separate 27-case natural-GC,
cache-on confirmation gave the selected profile SVG/all-output latency scores
of **0.718879/0.712570**, versus **0.764038/0.795986** for all twelve flags.
Lower is better; each profile has its own adjacent empty-flag references.
These are observed aggregate ratios, not an exhaustive subset optimum or an
estimate of production traffic. They do not measure the later combined source.

The selected profile's separate allocation estimate was 0.684995 of its
reference, with **4,355,968 bytes more final settled worker heap**. All twelve
retained more heap and included 4.6–8.6× reverse-order helper regressions.
Cold TF and browser evidence is mixed. Exact repeats benefit most; unrelated
requests can pay lookup, copying and residency costs. This is a latency choice
with bounded cache retention, not a universal latency/memory/payload win.

The [earlier comprehensive study](flagged-performance-results-2026-10-20.md),
[integration study](flagged-performance-integration-2026-10-20.md) and
[prior-baseline report](flagged-performance-results-2026-10-19.md) are historical.
Their references to twelve flags and default-off behavior describe those
revisions. Fresh combined-source checks and CI are recorded in PR #436.

## Mechanisms and limits

| Path | Benefit | Guard and cost |
|---|---|---|
| `text-spans` | Immutable display/pixel preparation caches and ASCII advance prefixes avoid repeated parsing and quadratic wrapping work. | Display cache: 512 entries / 4 MiB estimated weight; pixel cache: 256 entries / 8 MiB. Custom measurement bypasses pixel reuse. Styled, tracked, monospace and irregular clusters retain exact wrapping; near-boundary comparisons use the exact predicate. |
| `indexed-layout` | Linear variable-size ordered forest layout avoids ELK for eligible flat rectangular flowcharts. | Groups, edge labels, cycles, fan-in, nonrectangles, nonpositive spacing and long-rank edges fall back. Architecture is excluded. Final route/geometry certification remains. Eligible forest geometry can differ from ELK. |
| `position-cache` | Exact repeated requests reuse private positioned snapshots. | One 128-entry / 16 MiB estimated-weight LRU across isolated descriptor identities. Fresh clones restore prepared-text provenance; final projection certification still runs. Keys include source, appearance, options, family config, relevant environment and selected flags. Gantt, extensions, custom measurement and uncloneable artifacts (including C4 callbacks) bypass reuse. |

Weights are conservative estimates, not strict JS heap caps. Cache activation
retains code in downloaded bundles. Delivery must be measured separately; this
selection removes unused prototype code. Flow/State Brotli ceilings increase
from 570,000 to 571,000 bytes for the retained paths; other budgets and the
relative payload gate remain unchanged.

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

## Reproduce

The existing matrix uses sequential fresh processes, counterbalanced pairs,
complete output fingerprints outside timing and casewise median latency ratios.
`--baseline-ref` uses that revision's production source with the current harness.
Use explicit feature lists to compare defaults with isolated subsets, and an
empty-flag baseline-source configuration for A/A calibration. Failed or
incomplete cases do not receive a speed score. Natural timing and forced-GC
allocation/heap diagnostics must run separately.

```sh
bun run bench:experiments --baseline-ref origin/main --phase ablation --paired 1 --cache on --gc natural --warmup 5 --warmup-ms 1000 --samples 12 --rounds 3 --out bench-report/experiments/selection
bun test --timeout 30000 src/__tests__/performance-startup.test.ts src/__tests__/performance-graph-experiments.test.ts src/__tests__/performance-other-experiments.test.ts src/__tests__/performance-adversarial-semantics.test.ts src/__tests__/performance-scene-experiments.test.ts
```

The ablation roster now covers the three retained paths only. Startup tests
exercise unset defaults, empty and subset process values, and browser globals.
Owning contracts cover exact wrap ties, Unicode provenance, custom metrics,
mutable returned geometry, bounded cross-family residency, cache opt-out,
C4 callback bypass, forest fallback and final security admission. The small
inline-label opacity fix remains independent of the removed Scene prototypes.
