# Historical Mermaid parser/DB fixtures

The checked-in cases are a dated collection of source regression fixtures. They
are not an execution of Mermaid's original assertions and their count is not a
count of passing upstream tests. Keep their existing regression assertions when fixing
product behavior; do not regenerate expected geometry from our renderer.

## Reconcile provenance

`harvest.ts` now produces a read-only provenance report. It does not parse or
render through Agentic Mermaid, execute upstream code, classify unrecovered
source as private API, or rewrite cases, expectations, exclusions, manifests or
ratchets.

```sh
# Use a clean checkout at a2d9686451df7c4644a3eeca20535bbd4c5776b0.
MERMAID_UPSTREAM_DIR=../upstream-mermaid bun run harvest:upstream

# Registration definitions only, printed to stdout.
MERMAID_UPSTREAM_DIR=../upstream-mermaid \
  bun eval/mermaid-upstream-suite-bench/harvest.ts --inventory-only

# Keep the report in another local directory.
MERMAID_UPSTREAM_DIR=../upstream-mermaid \
  MERMAID_HARVEST_OUTPUT_DIR=/tmp/mermaid-provenance \
  bun run harvest:upstream
```

The default report is `bench-report/historical-harvest/reconciliation.json`, an
ignored build output. It records registration offsets, recovered argument
values, unresolved bindings, historical fixture citations and companion
origins. Output must be outside the historical fixture directory; filesystem
identity checks reject aliases and replacement is atomic.

TypeScript owns registration, callback and lexical binding boundaries,
including JavaScript specs. `it.each` is one registration definition; its
runtime rows are not guessed. Imported test aliases and global test APIs are
distinguished from locally shadowed functions. Values come from actual candidate
source-call arguments, including `Diagram.fromText` and renderer `draw` calls.
Local callee bindings take precedence over those API spellings; reassigned
helpers and bound member implementations which are not modeled stay unknown.
Closed string constants and never-written `let` bindings can be recovered.
Mutable/hoisted `var` bindings and implicit coercions remain unknown. Values are
deduplicated within each registration, not counted as call occurrences. A local
helper substitutes parameters only along a transparent return/call path; other
helper parameters, mutations, tags, external values and transforms remain
unknown. Literal inputs to an unknown transform are recorded separately from
its unknown result. A registration can retain known witnesses while also
reporting an unresolved argument.

Fixture comparison trims boundary whitespace only, as the historical capture
did. Equal titles do not establish equal registrations: each definition has a
file/offset identity. The report separates unique matches, duplicate titles,
changed titles with a same-file source witness, documentation fences,
transformed inputs and unresolved citations. None establishes that an upstream
assertion ran or passed. An extraction limit is not a missing product feature.

## Historical accounting

The old manifest and ratchet retain their original units and values for
archaeology. Their 742-case floor combines 586 main fixtures, 68 dated Gantt
companion fixtures and 88 separately pinned Mindmap/GitGraph positive fixtures.
Their block totals also mixed registration definitions with companion cases.
The old regex additionally counted test-shaped text in comments and string
payloads. Two retained State fixtures cite commented-out tests; they remain
local regression inputs, not passing upstream registrations.

The former generator selected a renderable source per block and manufactured
expected node/edge/group counts and labels from the current implementation.
It could both lose valid fixtures through extraction limits and turn current
behavior into its own oracle. The retained count/label expectations are regression
guards; their existence does not establish independent upstream assertion parity. Reconciliation removes that write path. No floor
is lowered and no new expectation or fixture is generated. Existing fixture
execution remains in `src/__tests__/mermaid-upstream-suite-bench.test.ts`.

Gantt's companion has its own fetch-date provenance, with Mermaid and two
other projects as distinct origins. Its README declares no exact Mermaid
commit; do not assign it the cross-family pin or count non-Mermaid fixtures as
Mermaid registrations. Mindmap/GitGraph retain their separate commit and
accounting. Current syntax authority remains Mermaid 12.2.0; it does not rewrite
these historical origins.

## Sources and retained files

- Main source pin: [`a2d9686451df7c4644a3eeca20535bbd4c5776b0`](https://github.com/mermaid-js/mermaid/tree/a2d9686451df7c4644a3eeca20535bbd4c5776b0), MIT; cross-family capture dated 2026-06-18.
- `cases.json`: retained source inputs and existing public-surface regression assertions.
- `exclusions.json`: historical classifications, not fresh private-API or capability findings.
- `manifest.json` and `ratchet.json`: frozen historical accounting; no longer harvester outputs.
- `mindmap-gitgraph-f3dea583.json`: separately pinned [`f3dea58385fd5c7dd1f4e9c9c1876751ae6943cc`](https://github.com/mermaid-js/mermaid/tree/f3dea58385fd5c7dd1f4e9c9c1876751ae6943cc) source expectations and executable divergences, with vendored source under `upstream-f3dea583/`.
- `eval/mermaid-gantt-bench/`: independent scheduling/semantic fixtures and declared origins.
- `refresh-check.ts`: reports upstream changes to this historical scope; newer commits do not silently change its pin.

New compatibility assertions must come from reviewed upstream assertions and
retain explicit native divergences. A generated provenance report supplies
review pointers; it cannot supply the expected behavior.
