# Style + Palette compatibility receipt

Agentic Mermaid currently registers **15 Looks**, **20 Palettes**, and **14 diagram families**. Compatibility is checked exhaustively for one Look plus one Palette:

> 15 × 20 × 14 = **4,200 rendered combinations**

`src/__tests__/mermaid-doc-showcase.test.ts` discovers Looks and Palettes from the public style registry rather than maintaining a second list. For every combination it renders the family’s pinned official Mermaid 11.16 documentation example with a fixed seed and strict security, then asserts:

- the selected Palette wins the `--bg` and `--fg` channels;
- SVG geometry is finite with a positive viewBox;
- no `NaN`, `Infinity`, or `undefined` reaches output;
- no external reference survives strict mode;
- rendering completes without family/backend exceptions.

The existing styled-output suite separately hash-pins every registered Look over the layout fixture corpus, verifies deterministic seed behavior, exercises default/rough/hybrid backends, and tests user-color precedence. The real-content Mindmap/GitGraph corpus additionally renders three representative Look + Palette stacks twice and checks semantic text survives. Together these tests distinguish exhaustive compatibility from representative deterministic byte checks.

Run:

```bash
bun test src/__tests__/mermaid-doc-showcase.test.ts
bun test src/__tests__/styled-output.test.ts
bun test src/__tests__/mindmap-gitgraph-content-corpus.test.ts
```

Reviewer evidence:

- [`families/mermaid-doc-examples-all-families.png`](./families/mermaid-doc-examples-all-families.png) — one pinned official Mermaid docs example per family, rendered by Agentic Mermaid;
- [`families/style-palette-all-families-after.png`](./families/style-palette-all-families-after.png) — all families under `hand-drawn + dracula`;
- `eval/mermaid-doc-showcase/manifest.json` — exact source, official docs URL, upstream origin/index, and SHA-256 per family;
- `eval/mermaid-doc-showcase/gallery-receipt.json` — generator/source-tree/output freshness.

“Works with every combination” means every built-in single-Look + single-Palette pair. Arbitrary stacks of multiple Looks or user-authored fragments are combinatorially unbounded; stack precedence and custom fragment validation are covered as algebraic/API contracts in `styled-output.test.ts` and `style-options.test.ts`.
