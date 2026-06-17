# Mermaid upstream parser/DB seed bench

Seed BUILD-20 ratchet for portable source-level cases harvested from Mermaid's parser/DB suites across every current Agentic Mermaid renderable family.

## Provenance

- Upstream repo: [`mermaid-js/mermaid`](https://github.com/mermaid-js/mermaid), `develop` branch paths named in each `cases.json` entry.
- Upstream license: MIT.
- Harvest date: 2026-06-03.
- Companion family bench: `eval/mermaid-gantt-bench/` remains the deeper Gantt-specific fixture set. This bench adds one cross-family parser/DB-derived case per current family; it does **not** replace the full upstream parser/DB suite harvest tracked by BUILD-20.

## Files

- `cases.json` — portable source-level parser/DB cases. Each case records upstream files/blocks, source text, and public-surface assertions (`parseMermaid`, `verifyMermaid`, `layoutMermaid`).
- `exclusions.json` — accounted non-portable upstream API/renderer internals. Reason codes are validated by `src/__tests__/mermaid-upstream-suite-bench.test.ts`.

## Case schema

```ts
interface Case {
  id: string
  family: string
  source: string
  upstream: { repo: string; files: string[]; blocks: string[] }
  assertions: {
    minNodes?: number
    minEdges?: number
    minGroups?: number
    labelsContain?: string[]
  }
}
```

## Exclusion reason codes

- `api-internal` — upstream tests exercise DB reset helpers, renderer DOM details, browser integration, or theme/security internals rather than portable Mermaid source semantics.

## Definition of done enforced by the runner

- Every current built-in renderable family has at least one upstream parser/DB-derived seed case here or a dedicated family upstream bench.
- Every case parses, verifies, lays out, and meets its structural assertions through public APIs.
- Every case records upstream provenance.
- Every exclusion uses a documented reason code.

Full upstream parser/DB suite harvesting is intentionally still tracked by BUILD-20.
