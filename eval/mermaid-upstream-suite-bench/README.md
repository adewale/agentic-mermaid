# Mermaid upstream parser/DB bench

BUILD-20 ratchet for source-level cases and accounted exclusions harvested
from Mermaid's parser/DB suites across every current Agentic Mermaid renderable
family.

## Reconciliation contract

Registration definitions, recovered source witnesses, distinct executable cases
and companion cases are different units. Reconciliation must retain the old
source fixtures and their independent assertions, resolve source arguments
through syntax-owned call paths, and report extraction limits without inferring
missing product features. No generated fixture refresh or floor reduction is
authorized by a lower extractor count. The proposed outputs and receipts remain
local until their provenance and changed denominators have been reviewed.

## Accounting correction

The checked-in ledger is a historical capture, not a freshly regenerated count.
Its claimed 27 unextracted dynamic blocks included 21 regex matches inside test
text and six actual omitted registrations. Those numbers do not describe 27
missing native features. The audited public controls already parse, render and
export; unused unknown Flowchart metadata still makes a whole body source-only.

The harvester now uses TypeScript syntax nodes for registrations, callback
boundaries and actual source arguments. The compiler binder resolves lexical
scope; only direct constants and immutable local constant bindings (including
closed concatenation/templates) are admitted. Mutable, external and tagged
expressions remain extraction limits. It counts actual
registration definitions (including skipped/todo definitions), not runtime
expansions of table rows. Gantt registrations are counted from the same source;
its separate deeper case corpus remains a companion, rather than supplying a
case count disguised as registration blocks. Mindmap/GitGraph retain their
separately declared historical provenance.

An unrecovered constant source is an extraction limit. It is excluded with
`source-extraction-limit`, without an inferred `WONTFIX` or private-API claim.
The existing local-gap ratchet still refuses an unreviewed refresh. Inspect
proposed outputs without overwriting this ledger:

```sh
# MERMAID_UPSTREAM_DIR must be at the historical revision below.
bun eval/mermaid-upstream-suite-bench/harvest.ts --inventory-only
MERMAID_HARVEST_OUTPUT_DIR=/tmp/mermaid-harvest-review \
  bun eval/mermaid-upstream-suite-bench/harvest.ts
```

The second command writes proposed cases/exclusions/manifest to that directory
before applying the existing ratchet. Directory identity checks and atomic
file replacement protect the default ledger from symlink/alias preview paths. It can exit unsuccessfully while leaving
those findings available for review. No ratchet ceiling is widened by this
correction, and no new feature pass is credited to it.

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
- `cases.json` — portable source-level parser/DB cases. Each case records upstream files/blocks, source text, and public-surface assertions (`parseRegisteredMermaid`, family narrower where structured, `verifyMermaid`, `serializeMermaid`, `layoutMermaid`).
- `exclusions.json` — accounted non-portable or local-gap upstream behavior. Reason codes are validated by `src/__tests__/mermaid-upstream-suite-bench.test.ts`; entries with an `ours` expectation are executable.
- `mindmap-gitgraph-f3dea583.json` — verbatim source cases, normalized upstream expectations, exact 26/69 block inventory, five source-inexpressible config-accessor exclusions, plus executable duplicate-id and already-reachable-cherry-pick divergences. The two source spec SHA-256 values bind the inventory to the pinned commit.
- `ratchet.json` — imported coverage floors plus local-gap budgets. The harvester may tighten these budgets when gaps shrink, but the test runner fails if local gaps grow or imported coverage falls.

## Case schema

```ts
interface Case {
  id: string
  family: string
  source: string
  upstream: { repo: string; files: string[]; blocks: string[] }
  assertions: {
    expectStructured?: boolean // default true; false means lossless opaque source
    renderError?: string // an explicit failure that preserves the source instead of drawing part of it
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
- `local-parse-gap` — upstream positive parser coverage is rejected by `parseRegisteredMermaid`.
- `local-verify-gap` — upstream positive parser coverage parses locally, but `verifyMermaid` returns warnings or throws.
- `local-layout-gap` — upstream positive parser coverage parses/verifies locally, but `layoutMermaid` throws.
- `local-roundtrip-gap` — upstream positive parser coverage parses/verifies/lays out locally, but `serialize`/`parse`/`serialize` is not stable.
- `unsupported-header` — upstream uses a header alias or neighboring-family syntax not routed to the expected Agentic Mermaid family.
- `unsupported-syntax` — upstream syntax is real, but deliberately tracked by another implementation issue rather than BUILD-20.
- `unsupported-structured-syntax` — the source parses/verifies/renders through the structured-or-opaque contract, but the family narrower does not yet expose that construct as structured data.
- `unextracted-dynamic-source` — historical aggregate from the old regex counter; it is not emitted by the syntax-based harvester.
- `source-extraction-limit` — an actual registration has no recoverable constant Mermaid source; its public/private behavior remains unclassified.
- `upstream-skipped` — an actual skipped/todo registration, kept distinct from passing executable cases.

## Definition of done enforced by the runner

- Every current built-in renderable family has a manifest row and at least one upstream parser/DB-derived case here or a dedicated family upstream bench.
- Every considered upstream block is imported or excluded: `importedBlocks + excludedBlocks + deferredBlocks === consideredBlocks`, with `deferredBlocks === 0`.
- Positive cases parse, verify, lay out, round-trip stably, and meet their exact structural assertions through public APIs. Cases carrying `renderError` preserve their exact source, fail verification with `RENDER_FAILED`, and reject layout with the named reason.
- Every structured case succeeds through its advertised family narrower; explicitly opaque-compatible cases set `assertions.expectStructured: false`.
- Every case records upstream provenance.
- Every exclusion uses a documented reason code.
- Every non-local exclusion is marked `disposition: 'WONTFIX'`, carries Mermaid.js file/block provenance, and omits local executable expectations.
- Every local compatibility exclusion records a BUILD-20 tracking owner, issue lane, priority, and `convert-to-case` target.
- Imported coverage must stay above the ratchet floor, and local-gap budgets may only hold steady or decrease.
- Upstream refreshes are explicit: the harvester checks the pinned checkout revision, and the refresh check fails when newer upstream commits change the harvested diagram spec files.

Current BUILD-20 accounting: **1,292** considered upstream parser/DB blocks,
**752** imported blocks, **540** excluded/accounted blocks, and **0** deferred
blocks. The imported executable case count is **742**, including the 68-case
Gantt bench and 88 imported Mindmap/GitGraph companion cases.
