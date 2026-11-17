# Graph placement

ELK.ts is the sole general graph-placement engine. Family adapters retain their
specialized measurement, route, marker and container rules; sequence, chart and
terminal-cell layouts remain specialized. The former Native/Agentic graph
backend and automatic forest producers have been removed.

The prior two-backend design and measurements are preserved in Git history at
[57529f20](https://github.com/adewale/agentic-mermaid/blob/57529f206eb9e2484c703b7b2ceebc61bce68737/docs/design/system/layout-backends.md).
They describe the retired implementation, not the current runtime contract.

## Public preferences and migration

Omitting `graphLayout` uses ELK.ts wherever a general graph placement is needed.
The optional `backend: 'elk'` and `fallback: 'none'` spellings remain accepted for
existing ELK callers. There is no alternate backend or graph-backend fallback.
`backend: 'agentic'` and `fallback: 'elk'` fail option admission rather than
silently choosing a different implementation.

```ts
import { renderMermaidSVGWithReceipt } from 'agentic-mermaid'

const { svg, receipt } = renderMermaidSVGWithReceipt(
  'flowchart LR; Idea --> Ship',
  { graphLayout: { quality: 'balanced' } },
)
console.log(receipt.layoutDecisions)
```

Native's different coordinates, private capacity limits and optional port-aware
search are not promises of the surviving engine. Flowchart forests, eligible
Usecase/Agentflow forests and Swimlane lane placement now use ELK. Their default
geometry and execution/download costs can change. Raw ELK output remains
qualified against elkjs 0.11.1 at `src/elk-instance.ts`.

Explicit producer evidence reports `elk-layered@1`, selected ELK and no fallback.
An omitted policy retains implicit evidence instead of inventing an explicit
selection. Primary graphical and optional terminal-companion roles remain
separate. Historical receipts remain readable as historical data.

## Production path

1. Public render admission captures source, styles, options and ownership once.
2. Family adapters measure their actual text, frames, markers and labels.
3. `layout/graph-measurement.ts` owns shared graph text and box measurement.
4. `layout-engine.ts` converts a Mermaid graph to the existing ELK JSON boundary.
5. `elk-instance.ts` applies the existing work admission and weighted LRU, then
   invokes ELK.ts. elkjs is a development-only differential oracle.
6. The result is converted into positioned geometry. The shared finishing
   context requires its ELK result; no Native-owned-edge alternative remains.
7. Existing ordered geometry passes and independent final certification run.
8. Scene lowering, painted ownership, SVG/PNG and terminal projection retain
   their own contracts. The built-in native Scene paint producer is distinct
   from the retired Native graph-placement algorithm.

No new measured-graph conversion, result cache or phase-wrapper allocation is
introduced solely to name these stages. Private physical route checks use the
small solver-independent `MeasuredRouteGraph` and `ChannelWork` types.

## Recovery and quality

Removing a backend does not remove ELK's established recovery policy. The four
candidate combinations preserve hierarchy/corank choices. Each retains the
bounded option-degradation ladder; deferred loading and hard work-limit errors
escape to their owning boundary. Existing workload policies can use a smaller
subset, but the exceptional upper bound remains sixteen ELK attempts.

A failed attempt can mutate its ELK input. Recovery therefore rebuilds its
private graph instead of reusing potentially corrupted input. Existing route
alternatives, singleton handling, labels, bundling and certification order remain.

`quality: 'balanced'` enables the existing bounded non-regressing ELK ordering
proposal. Explicit adjacency remains authoritative. Flowchart viewport wrapping
also retains its existing bounded search and explicit wrapping precedence.
These are opt-in preferences, not another graph engine or a proof waiver.

Class may reserve more header bypass space after a typed, actually measured
header-route capacity failure. That recovery uses its existing maximum three
layout passes and the same nonrefunded work ledger. Unrelated failures do not
qualify; authored diagnostic text cannot select recovery. Already successful
Class layouts keep the original path.

## Safety and limits

Authored identities, endpoint references, mutable/getter isolation, Unicode,
CSS, definitions, producer ownership and final ink certification remain shared
requirements. No Native deletion makes a geometry pass or defensive copy
redundant by itself. Custom measurement callbacks and recovery ownership must
still be respected.

`layoutSafety: 'strict'` requires complete passed evidence. Report mode can
return drawable output with explicit failed or unverified evidence. An unknown
proof is not a pass, and successful rendering is not full visual fidelity.

<!-- BEGIN GENERATED: graph-layout-limits -->
| Scope | Limit |
| --- | --- |
| Host nodes, including group frames | 5,000 |
| Host edges | 5,000 |
<!-- END GENERATED: graph-layout-limits -->

The host limits and independent routing/paint budgets remain unchanged.
Unreachable ELK strategies outside this port's supported configuration fail
explicitly. This is not a complete replacement for every arbitrary ELK option.

## Qualification

Use the existing differential boundary test and `eval/elk-layered` corpus
capture/comparison to check strict graph values and array order against the
pinned dev oracle. Rendering tests separately check authored meaning, final
contacts, markers, dimensions and proof availability. Shared parser/terminal
results are not independent solver wins.

After material source or base changes, run the required local CI on the exact
combined head, inspect actual package bytes and compressed request closures,
and compare fully consumed cold/import/cache/edit runtime and RSS/heap. Retain
failed, unsupported, unverified and adverse measurements. Trident completion,
label fidelity and paint certification describe different evidence.
