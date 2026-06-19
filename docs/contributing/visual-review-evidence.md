# Visual review evidence

Agentic Mermaid layout changes need evidence that is reproducible from source,
not hand-edited screenshots. Use the smallest artifact that matches the change.

## Required evidence by change type

| Change type | Required evidence |
|---|---|
| Route contracts, ports, shape anchors, or contact geometry | `bun test src/__tests__/route-contracts.test.ts src/__tests__/contact-sheet.test.ts`; regenerate/review `docs/pr-assets/contact-sheet.png` when scenarios or geometry intentionally change. |
| ASCII/Unicode routing or region metadata | Exact goldens/tests: `bun run goldens:ascii:check` plus relevant `src/__tests__/ascii*.test.ts` / `agent-ascii-meta.test.ts`. |
| Family renderer/layout changes | Family parser/layout/renderer tests, SVG snapshot where available, and `agent-family-layouts.test.ts`. |
| Broad layout heuristics | `bun run rubric:visual` and/or `eval/layout-compare` before/after output attached to the PR. Commit only small canonical assets; attach large HTML reports as artifacts. |
| Website/editor visual changes | `bun test e2e/browser.test.ts`; inspect captured screenshots when baselines or UI structure change. |
| Region/action metadata only | Prefer JSON/SVG metadata assertions over raster screenshots; include one representative fixture proving stable `data-region`/sidecar IDs. |

## Artifact meanings

- `docs/pr-assets/contact-sheet.png` is the committed reviewer contact sheet for route/port geometry. The byte-match test ensures it reflects the current renderer.
- `eval/visual-rubric` produces deterministic scored galleries. Its scores are a gate for obvious regressions, not a replacement for human review.
- `eval/layout-compare` compares before/after layout faithfulness and quality over a corpus. “0 regressions” means no configured metric/faithfulness regression, not a claim of pixel parity with Mermaid.js.
- Browser screenshots prove the shipped site/editor still renders and remains usable. Pixel-diff is only active when dependencies are available, so reviewer inspection still matters.

## Reviewer checklist

1. Does the PR say which visual command was run?
2. Are generated artifacts reproducible from committed source/fixtures?
3. If a committed PNG/snapshot changed, is the change explained in the PR body?
4. If a visual check is skipped, is there a reason and an alternate structural test?
5. Are large generated reports linked/attached rather than committed?
6. For peer fan-in/fan-out screenshots, is the hub centered over the peer group?
7. For labeled edges, does the label chrome blend with the diagram background instead of reading as a hard white pill?
8. Does the review wrapper match the rendered diagram background, or use a neutral surface, so it does not create false label/background contrast?
