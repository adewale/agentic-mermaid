# System architecture — start here

How the Agentic Mermaid engine fits together. This is the entry point the
[abstraction audit](./abstraction-audit.md) identified as missing: a single top-down
view of the whole system, distinct from the per-diagram-type design notes.

![Agentic Mermaid abstraction architecture: one normalized source fans out to three stacks (SVG, ASCII, agent IR) that dispatch over the same 12 diagram families three different ways and bottom out on shared core types](./architecture.svg)

One Mermaid source is normalized once, then processed by **three parallel stacks** —
SVG (`renderMermaidSVG`), ASCII (`renderMermaidASCII`), and the agent IR
(`parseMermaid` / `mutate` / `verify`) — each dispatching over the same 12 diagram
families by a different mechanism (two `switch` statements and the `FamilyPlugin`
registry), over a shared core vocabulary in `src/types.ts`.

## This figure is dogfooded and drift-proof

The diagram is authored as Mermaid ([`architecture.mmd`](./architecture.mmd)) and
rendered to [`architecture.svg`](./architecture.svg) **by our own renderer**. A
determinism snapshot test
([`src/__tests__/docs-architecture-diagram.test.ts`](../../../src/__tests__/docs-architecture-diagram.test.ts))
re-renders the source and asserts (a) the render is deterministic across calls and
(b) it matches the committed SVG — so the picture can never silently drift from the
code it describes. Regenerate after an intentional source change:

```
UPDATE_GOLDEN=1 bun test src/__tests__/docs-architecture-diagram.test.ts
```

This is the documentation half of the abstraction work: docs *about* the system are
produced *by* the system, and pinned the same way we pin layout determinism.

## Read next

- [`abstraction-audit.md`](./abstraction-audit.md) — the three-stacks model in full + the ranked issue list **I1–I9**.
- [`abstraction-recommendations.md`](./abstraction-recommendations.md) — literature-grounded fixes for I1–I9 + the prioritized roadmap.
- [`route-contracts.md`](./route-contracts.md) — the flowchart routing engine (edge classification, direct-lane proofs, certifying straightener).
- [`layout-rubric.md`](./layout-rubric.md) — the deterministic layout-quality rubric.
- [`source-preservation-ladder.md`](./source-preservation-ladder.md) — the structured\|opaque family-adoption contract (L0–L4).

> These design docs are co-located here in `design/system/` — the
> [documentation reorganization plan](../../project/doc-reorg-plan.md) moved them in Phase 1.
