# Treemap exact-pin oracle

Mermaid 12.2.0 at `1fb7869866dd619168d840291c9c54b4f129758b`, retrieved
2026-10-19. The unmodified source specs are `packages/parser/tests/treemap.test.ts`
(17 test blocks) and `packages/mermaid/src/diagrams/treemap/utils.test.ts` (4).
The MIT license is retained under upstream/.

The runner executes portable assertions unchanged through native model/AST
projections. Three parser-internal recovery tests are explicitly listed in the
exclusions ledger: these deliberately ignore parse errors and merely assert
that Langium returns a partial AST for malformed syntax. Opaque preservation
is tested for that source instead of advertising it as native syntax.

cases.json contains all 8 pinned documentation fences and all 26 e2e `.mmd`
fixtures. Their hierarchy/value/class/title/accessibility expectations were
captured from the independent Mermaid 12.2.0 reference in Node/jsdom, not from
Agentic output. Mermaid renderer DOM/pixels are not compared. The public native
parse/edit/serialize/SVG/terminal/layout behavior has separate family tests.

inline-row-regressions.json retains seven additional accepted grammar mutations
and independently captured pinned parent/value/class expectations. They cover
entries sharing one physical line, where each grammar row's immediately
preceding whitespace determines its hierarchy level. The native family tests
protect their meaning through public canonical serialization.

Run `bun test src/__tests__/treemap-upstream-bench.test.ts`.
