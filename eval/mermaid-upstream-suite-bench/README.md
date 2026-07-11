# Mermaid upstream parser/DB bench

BUILD-20 ratchet for source-level cases and accounted exclusions harvested
from Mermaid's parser/DB suites across every current Agentic Mermaid renderable
family.

## Provenance

- Upstream repo: [`mermaid-js/mermaid`](https://github.com/mermaid-js/mermaid). The cross-family harvest is pinned to `a2d9686451df7c4644a3eeca20535bbd4c5776b0`; Mindmap/GitGraph compatibility is separately pinned to `f3dea58385fd5c7dd1f4e9c9c1876751ae6943cc`.
- Upstream license: MIT.
- Harvest dates: seed pass 2026-06-03; full cross-family harvest 2026-06-18; Mindmap/GitGraph block accounting 2026-07-10.
- Companion benches: `eval/mermaid-gantt-bench/` holds the deeper Gantt fixtures. `mindmap-gitgraph-f3dea583.json` accounts for all 26 Mindmap and 69 GitGraph spec blocks, including executable negative/divergence cases, and `src/__tests__/mindmap-gitgraph-upstream-oracle.test.ts` runs the 89 portable/error cases. The manifest summarizes both companions so BUILD-20 has one table.
- Repeatable command: `MERMAID_UPSTREAM_DIR=../upstream-mermaid bun run harvest:upstream`.
- Refresh check: `MERMAID_UPSTREAM_DIR=../upstream-mermaid bun run harvest:upstream:refresh-check` fetches `origin/develop` and fails if newer upstream commits touch the harvested diagram spec scope.
- Pinned companion verification: the exact upstream specs and MIT license are vendored under `upstream-f3dea583/`. The oracle test hashes them, extracts every direct `it(...)` title/source in order with the TypeScript AST, and compares all one-to-one classifications. Independently, clone Mermaid at `f3dea58385fd5c7dd1f4e9c9c1876751ae6943cc` and hash the same two paths; expected SHA-256 values remain `98f31bd…269494` and `15284d1a…a0834`.

## Files

- `harvest.ts` — regenerates the main-revision manifest, cases, exclusions, and ratchet from the pinned upstream checkout and current public behavior, while incorporating the separately pinned Mindmap/GitGraph companion accounting. It refuses to run if the main upstream checkout is not at its pinned revision.
- `refresh-check.ts` — fetches upstream `develop` and reports whether any newer commits changed the harvested diagram spec files.
- `manifest.json` — pinned upstream revision plus family-by-family parser/DB files considered, upstream block counts, imported case counts, imported block counts, excluded block counts, and deferred block counts.
- `cases.json` — portable source-level parser/DB cases. Each case records upstream files/blocks, source text, and public-surface assertions (`parseMermaid`, family narrower where structured, `verifyMermaid`, `serializeMermaid`, `layoutMermaid`).
- `exclusions.json` — accounted non-portable or local-gap upstream behavior. Reason codes are validated by `src/__tests__/mermaid-upstream-suite-bench.test.ts`; entries with an `ours` expectation are executable.
- `mindmap-gitgraph-f3dea583.json` — verbatim source cases, normalized upstream expectations, exact 26/69 block inventory, five source-inexpressible config-accessor exclusions, and one executable duplicate-id divergence. The two source spec SHA-256 values bind the inventory to the pinned commit.
- `ratchet.json` — imported coverage floors plus local-gap budgets. The harvester may tighten these budgets when gaps shrink, but the test runner fails if local gaps grow or imported coverage falls.

## Case schema

```ts
interface Case {
  id: string
  family: string
  source: string
  upstream: { repo: string; files: string[]; blocks: string[] }
  assertions: {
    expectStructured?: boolean // default true; false means public parse/layout works through opaque fallback
    nodeCount?: number
    edgeCount?: number
    groupCount?: number
    minNodes?: number
    minEdges?: number
    minGroups?: number
    labelsContain?: string[]
  }
}
```

Local compatibility exclusions carry BUILD-20 ownership so they cannot become
anonymous backlog:

```ts
interface GapTracking {
  issue: string
  owner: 'BUILD-20'
  lane: string
  priority: 'P0' | 'P1' | 'P2' | 'P3'
  target: 'convert-to-case'
}
```

Non-local exclusions are explicit WONTFIX entries. They are not imported into
the public source ratchet and do not carry local executable `source`/`ours`
expectations; their `upstream.repo`, `upstream.files`, and `upstream.blocks`
fields are the Mermaid.js pointers for audit/revisit work.

`manifest.json` records the broader BUILD-20 accounting:

```ts
interface ManifestFamily {
  family: string
  status: 'full-harvest-accounted' | 'dedicated-full-family-bench-existing'
  consideredBlocks: number
  importedCases: number
  importedBlocks: number
  excludedBlocks: number
  deferredBlocks: number
  files: Array<{ path: string; testBlocks: number }>
  companionBench?: string
  compatibilityRevision?: string
}
```

## Exclusion reason codes

- `api-internal` — upstream tests exercise DB reset helpers, renderer DOM details, browser integration, or theme/security internals rather than portable Mermaid source semantics.
- `upstream-negative` — upstream intentionally asserts that an input throws or is rejected; these are accounted in the ledger instead of imported as positive cases.
- `local-parse-gap` — upstream positive parser coverage is rejected by `parseMermaid`.
- `local-verify-gap` — upstream positive parser coverage parses locally, but `verifyMermaid` returns warnings or throws.
- `local-layout-gap` — upstream positive parser coverage parses/verifies locally, but `layoutMermaid` throws.
- `local-roundtrip-gap` — upstream positive parser coverage parses/verifies/lays out locally, but `serialize`/`parse`/`serialize` is not stable.
- `unsupported-header` — upstream uses a header alias or neighboring-family syntax not routed to the expected Agentic Mermaid family.
- `unsupported-syntax` — upstream syntax is real, but deliberately tracked by another implementation issue rather than BUILD-20.
- `unsupported-structured-syntax` — the source parses/verifies/renders through the structured-or-opaque contract, but the family narrower does not yet expose that construct as structured data.
- `unextracted-dynamic-source` — the pinned upstream count includes table-driven or dynamically built blocks that do not expose one portable source literal to the harvester.

## Definition of done enforced by the runner

- Every current built-in renderable family has a manifest row and at least one upstream parser/DB-derived case here or a dedicated family upstream bench.
- Every considered upstream block is imported or excluded: `importedBlocks + excludedBlocks + deferredBlocks === consideredBlocks`, with `deferredBlocks === 0`.
- Every case parses, verifies, lays out, round-trips stably, and meets its exact structural assertions through public APIs.
- Every structured case succeeds through its advertised family narrower; explicitly opaque-compatible cases set `assertions.expectStructured: false`.
- Every case records upstream provenance.
- Every exclusion uses a documented reason code.
- Every non-local exclusion is marked `disposition: 'WONTFIX'`, carries Mermaid.js file/block provenance, and omits local executable expectations.
- Every local compatibility exclusion records a BUILD-20 tracking owner, issue lane, priority, and `convert-to-case` target.
- Imported coverage must stay above the ratchet floor, and local-gap budgets may only hold steady or decrease.
- Upstream refreshes are explicit: the harvester checks the pinned checkout revision, and the refresh check fails when newer upstream commits change the harvested diagram spec files.

Current BUILD-20 accounting: **1,265** considered upstream parser/DB blocks,
**747** imported blocks, **518** excluded/accounted blocks, and **0** deferred
blocks. The executable case count is **737**, including the 68-case Gantt and
89-case Mindmap/GitGraph companion benches.
