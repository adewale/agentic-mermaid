# Ishikawa exact-pin oracle

Mermaid 12.2.0 at `1fb7869866dd619168d840291c9c54b4f129758b`, retrieved
2026-10-19. The unmodified source spec is
`packages/mermaid/src/diagrams/ishikawa/ishikawa.spec.ts` (3 test blocks), with
its MIT license retained under upstream/.

All original hierarchy assertions execute through a thin projection of the
native flat model to its causal tree; no input or expectation is rewritten.
There are no exclusions. cases.json also retains the primary documentation
fence and all 13 pinned e2e `.mmd` inputs, including deep nesting, indentation,
theme and padding cases. Expected causal trees were captured independently
from Mermaid 12.2.0 in Node/jsdom. The reference worker's snapshot depth
limit was raised locally from 14 to 100 to capture the entire deepest causal
tree; neither Mermaid's parser nor these expected trees were transformed. Layout and pixels remain Agentic's own.

Run `bun test src/__tests__/ishikawa-upstream-bench.test.ts`.
