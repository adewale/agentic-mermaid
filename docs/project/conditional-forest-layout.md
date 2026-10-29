# Conditional forest layout

The `indexed-layout` experiment supplies a measured, ordered forest producer
inside the existing layout certification boundary. Enable it before importing
the library with `AGENTIC_MERMAID_EXPERIMENTS=indexed-layout`. It remains off
by default because eligible geometry may differ from ELK. The browser build
reads the same setting from `globalThis.AGENTIC_MERMAID_EXPERIMENTS` before
library loading.

The producer accepts flat flowchart forests with at least two rectangular
nodes, no edge labels, no fan-in, no cycles and no extended rank spans. Groups,
State visual annotations, projected Architecture graphs, other shapes, duplicate edges and missing endpoints
retain ELK. Requests with zero node or layer spacing also retain ELK because
the forest producer needs positive spacing for its route channels. It supports
all four directions, variable node dimensions and
disconnected components. Measurement, authored identities, terminal markers,
route contracts and final certification remain owned by the existing pipeline.

A failed forest candidate receives one bounded preliminary attempt before all
four established ELK fallbacks. It cannot displace the last fallback. The
selected strategy and total attempts remain in layout certification evidence.
Pass-contract and input work-limit errors still stop execution.

## Qualification

Run the scoped contracts and the complete pinned documentation qualification:

```sh
bun test src/__tests__/indexed-forest.test.ts src/__tests__/layout-certification.test.ts
AGENTIC_MERMAID_SCENE_ASSERTIONS=1 AGENTIC_MERMAID_ELK_CACHE=0 \
  bun run eval/benchmark/qualify-performance-profile.ts \
  --features indexed-layout --out bench-report/forest/qualification.json
```

The qualification accounts for every documentation fence occurrence and
checks each trim-distinct source. It compares rejection behavior, displayed
text, semantic identities/endpoints, determinism, fully serialized receipts and
terminal output. Outside the forest cohort, successful SVG and receipt bytes
must be unchanged. Changed layouts must remain parseable when the baseline
was parseable. Repeated duplicate fences reuse one observation; this is a
correctness study, not a timing measurement or proof of aesthetic quality.

Confirm performance with alternating fresh-process comparisons and separate
allocation diagnostics. For example:

```sh
AGENTIC_MERMAID_EXPERIMENTS=indexed-layout \
  bun run bench:micro --runtime node --baseline origin/main --rounds 3 \
  --filter '^render:svg-consumed-(tree50|mesh50|seq20)$' \
  --json bench-report/forest/consumed.json
bun run bench:dave --features indexed-layout \
  --rounds 3 --executable /usr/bin/chromium --out bench-report/forest/browser
```

Fully consumed receipt cases complement text-only timing. Natural-GC timing
and allocation probes run separately. Generated reports stay under
`bench-report/`; review the final combined revision, runtime, allocation,
payload and geometry evidence before changing defaults.

See the [layered layout proposal](layered-layout-proposal.md) for the separate
decision about broader labelled, cyclic and compound graphs.
