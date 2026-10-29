# Requirement pin oracle

Unmodified upstream grammar and database specs from Mermaid 12.2.0, commit
`1fb7869866dd619168d840291c9c54b4f129758b`, retrieved 2026-10-19. Sources:
`packages/mermaid/src/diagrams/requirement/parser/requirementDiagram.spec.js`
and `packages/mermaid/src/diagrams/requirement/requirementDb.spec.ts`.
Mermaid is MIT licensed; the upstream license is retained beside the specs.

`src/__tests__/requirement-upstream-bench.test.ts` executes the original
portable assertions with an API adapter over the native parser and database.
The runner changes imports, not inputs or expectations. Generated edge ID
spelling is an implementation detail: the native surface instead tests unique
relationship identities without depending on upstream's chosen prefix.
The executable exclusions ledger names that one case.

Run `bun test src/__tests__/requirement-upstream-bench.test.ts`.
