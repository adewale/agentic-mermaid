# Block pin oracle

Unmodified upstream grammar, database, colour-index and layout specs from
Mermaid 12.2.0, commit `1fb7869866dd619168d840291c9c54b4f129758b`, retrieved
2026-10-19. Source directory: `packages/mermaid/src/diagrams/block/`.
Mermaid is MIT licensed; its license is retained beside the specs.

`src/__tests__/block-upstream-bench.test.ts` executes the original portable
assertions through an API adapter over the native parser/database. Imported
inputs and expectations remain unchanged. The exclusions ledger identifies
Mermaid-owned DOMPurify, singleton-config timing and generated-CSS assertions;
Agentic preserves editable authored text and escapes/lowers it through its own
DOM-free Scene renderer, reads request-local config and has its own aesthetics.
The native tests exercise safe displayed text and per-call layout configuration.

Run `bun test src/__tests__/block-upstream-bench.test.ts`.
