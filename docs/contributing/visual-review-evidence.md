# Visual review evidence

Agentic Mermaid layout changes need evidence that is reproducible from source,
not hand-edited screenshots. Use the smallest artifact that matches the change.

## Required evidence by change type

| Change type | Required evidence |
|---|---|
| Route contracts, ports, shape anchors, or contact geometry | `bun test src/__tests__/route-contracts.test.ts src/__tests__/contact-sheet.test.ts`; regenerate the contact sheet (`eval/visual-rubric/contact-sheet.ts`) and attach it to the PR when scenarios or geometry intentionally change. |
| Duplicate / parallel edges (a multigraph — the same directed pair written more than once) | `bun test src/__tests__/route-contracts.test.ts`; review the duplicate/parallel cases on the contact sheet (`AP`–`AR`) and the crossing ratchet in `layout-rubric.test.ts`. A duplicate-specific before/after lives at `docs/pr-assets/issue-62-duplicate-edge-lanes-before-after.png` (regenerate with `bun run scripts/pr-assets/issue-62-evidence.ts`). |
| ASCII/Unicode routing or region metadata | Exact goldens/tests: `bun test src/__tests__/ascii.test.ts` plus relevant `src/__tests__/ascii*.test.ts` / `agent-ascii-meta.test.ts`. |
| Family renderer/layout changes | Family parser/layout/renderer tests, SVG snapshot where available, and `agent-family-layouts.test.ts`. |
| Broad layout heuristics | `bun run rubric:visual` and/or `eval/layout-compare` before/after output attached to the PR. Commit only small canonical assets; attach large HTML reports as artifacts. |
| Website/editor visual changes | `bun test e2e/browser.test.ts`; inspect captured screenshots when baselines or UI structure change. |
| Region/action metadata only | Prefer JSON/SVG metadata assertions over raster screenshots; include one representative fixture proving stable `data-region`/sidecar IDs. |

## Artifact meanings

- `docs/pr-assets/contact-sheet.png` is a dated reviewer snapshot of the route/port contact sheet, not a golden: `contact-sheet.test.ts` pins each scenario's geometry in the readable golden `src/__tests__/testdata/contact-sheet-geometry.json` (one node, edge, or group per line; regenerate with `UPDATE_CONTACT_SHEET_GEOMETRY=1`, review the diff, and list the changed golden and why in the PR description) and `contact-sheet-png.test.ts` checks the generator still draws one cell per scenario. Scenarios `AP`–`AR` cover duplicate/parallel edges: duplicates must render as evenly-separated, nested (non-crossing) parallel lanes — never a collapsed single line or a crossed pair.
- The duplicate-edge crossing ratchet (`layout-rubric.test.ts`) counts duplicate-pair crossings over the random-flowchart generator and holds the count at or below its pinned baseline. Duplicate edges share both endpoints, so a crossing between them is never logically required; the baseline is a regression ceiling whose target is zero — lower it when the count drops.
- `eval/visual-rubric` produces deterministic scored galleries. Its scores are a gate for obvious regressions, not a replacement for human review.
- `eval/layout-compare` compares before/after layout faithfulness and quality over a corpus. “0 regressions” means no configured metric/faithfulness regression, not a claim of pixel parity with Mermaid.js.
- Browser screenshots prove the shipped site/editor still renders and remains usable. Pixel-diff is only active when dependencies are available, so reviewer inspection still matters.

## Golden-snapshot review

Committed goldens under `src/__tests__/testdata/` are reviewed through the PR.
When an intentional renderer or protocol change moves a golden, regenerate it,
review the diff, and commit the result. The PR description must list **each
changed golden and why it changed**, with the relevant visual or structural
evidence. The PR template restates this requirement as a checklist item.

The snapshot tests still fail when current output differs from the committed
goldens. A passing comparison establishes consistency with the baseline;
reviewers decide whether an intentional baseline change is justified.

## Reviewer checklist

1. Does the PR say which visual command was run?
2. Are generated artifacts reproducible from committed source/fixtures?
3. If a committed PNG/snapshot changed, is the change explained in the PR body?
4. If a visual check is skipped, is there a reason and an alternate structural test?
5. Are before/after renders and large generated reports attached to the PR rather than committed? New files under `docs/pr-assets/` are not needed, and no test may read PR evidence.
6. For peer fan-in/fan-out screenshots, is the hub centered over the peer group?
7. Does the review wrapper match the rendered diagram background, or use a neutral surface, so it does not create false label/background contrast?
