# Graph layout backends

This is the current selection and execution contract. Agentic is opt-in; ELK
remains supported. The [October design and experiments](../../project/archive/layout-backends-2026-10.md)
retain their original revisions and adverse results. Further quality and cost
qualification belongs to [0.6 qualification](layout-0.6-qualification.md) and
the existing Native-layout section of [TODO.md](../../../TODO.md).

## Selection

`graphLayout` selects graph geometry. Scene drawing backends and terminal-cell
placement have their own contracts.

| Request | Behavior |
| --- | --- |
| Omitted | Existing automatic policy, including eligible forest placement and caching |
| `{ backend: 'elk' }` | ELK placement followed by the family's route repairs and certification |
| `{ backend: 'agentic' }` | Strict Agentic placement; an unsupported input declines explicitly |
| `{ backend: 'agentic', fallback: 'elk' }` | Agentic first, with an attributed ELK fallback for supported refusal classes |

An omitted fallback means `none`. Empty selectors, unknown fields and redundant
`{ backend: 'elk', fallback: 'elk' }` are rejected during option admission.
Mermaid `config.layout` and family `defaultRenderer` fields are not aliases
for this option.

```ts
import { renderMermaidSVGWithReceipt } from 'agentic-mermaid'

const { svg, receipt } = renderMermaidSVGWithReceipt('flowchart LR; A --> B', {
  graphLayout: { backend: 'agentic', fallback: 'elk' },
})
console.log(receipt.layoutDecisions)
```

The CLI exposes `--graph-layout` and `--graph-layout-fallback`; library,
browser and MCP options use the same checked render contract.

## Supported geometry and limits

The owned kernel serves Flowchart, State, Architecture, Class, ER and
Requirement adapters. It supports bounded cyclic and compound inputs, loops,
labels and authored endpoint identities. Family adapters retain their card,
header, port and routing rules. Hints, ambiguous identities and exhausted
searches can still decline. Selection support does not establish universal
ELK parity or a performance advantage.

<!-- BEGIN GENERATED: graph-layout-limits -->
| Scope | Limit |
| --- | --- |
| Host nodes, including group frames | 5,000 |
| Host edges | 5,000 |
| Agentic measured nodes, including group frames | 4,096 |
| Agentic internal edges | 16,384 |
| Agentic internal ranks | 4,096 |
| Agentic expanded workspace vertices | 32,768 |
<!-- END GENERATED: graph-layout-limits -->

Self-loops and compound routing introduce internal helpers. Those consume
workspace and can make a diagram below the authored-node ceiling decline.
Separate rank, route-search, geometry and paint allowances also apply; fitting
the table is not a guarantee of successful rendering. Source, frontmatter and
Style cannot raise these limits.

## Failure and evidence

An unsupported strict Agentic input throws `GraphLayoutUnsupportedError`
(`GRAPH_LAYOUT_UNSUPPORTED`). With explicit ELK fallback, the family selector
records the refusal and actual selection in `receipt.layoutDecisions`.
Known final-geometry candidate rejections may also permit fallback at the
owning family boundary. Unexpected engine defects and global admission limits
remain errors.

Receipts preserve requested backend, fallback policy, attempts, selected
backend and implementation identity. A render completed by ELK is an ELK
completion. Cached geometry retains that decision and replays request-specific
diagnostics without exposing mutable shared arrays.

Both producers preserve authored nodes, groups, relationship occurrences and
directed endpoints. They share final geometry/paint certification and output
security. Rejected candidates cannot alter source or the later ELK workspace.

## Outputs and browser delivery

SVG, PNG, verification and layout JSON consume the resolved graph selection.
Terminal cells retain family placement rules; pixel companions and
Architecture's pixel-to-cell dependency honor the selector.

`agentic-mermaid/browser/lazy` loads the selected solver on demand. A successful
strict Agentic render does not fetch ELK; explicit ELK and actual fallback do.
The synchronous browser entry remains an all-in-one bundle. Evaluate actual
request graphs and compressed transfer bytes separately from execution time.

## Owners and validation

| Boundary | Owner |
| --- | --- |
| Options and applicability | `src/render-contract.ts` |
| Selection, typed refusal and decisions | `src/layout/backend.ts` |
| Measured solver and bounds | `src/layout/agentic-layered-core.ts`, `src/layout/agentic-limits.ts` |
| Family geometry | `src/layout-engine.ts`, `src/class/layout.ts`, `src/er/layout.ts`, `src/architecture/layout.ts`, `src/requirement/` |
| Final artifact checks | `src/route-contracts.ts`, `src/scene/paint-certification.ts` |

Use the existing Agentic and family backend tests for identities, endpoints,
fallback and bounded-work behavior. Compare final artifacts on the same inputs
and requested policies; retain refusals, fallback and adverse measurements.
The [release guide](../../contributing/releasing.md#local-release-benchmarks)
owns local measurement commands. Historical campaigns are evidence for their
recorded revisions, while the [0.6 contract](layout-0.6-qualification.md) owns
future qualification. ELK remains the default.
