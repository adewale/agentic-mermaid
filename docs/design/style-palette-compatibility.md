# Style + Palette compatibility receipt

Compatibility is checked exhaustively for the Cartesian product of every
registry-discovered non-default Look, Palette, and diagram family. The
executable registry and showcase manifest—not a copied prose total—define the
current matrix.

`src/__tests__/mermaid-doc-showcase.test.ts` discovers Looks and Palettes from the public style registry rather than maintaining a second list. For every combination it renders the family’s pinned official Mermaid 11.16 documentation example with a fixed seed and strict security, then asserts:

- the selected Palette wins the `--bg` and `--fg` channels;
- SVG geometry is finite with a positive viewBox;
- no `NaN`, `Infinity`, or `undefined` reaches output;
- no external reference survives strict mode;
- rendering completes without family/backend exceptions.

The existing styled-output suite separately hash-pins every registered
non-default Look over the layout fixture corpus, verifies deterministic seed
behavior, exercises default/rough/hybrid backends, and tests user-color
precedence. The real-content Mindmap/GitGraph corpus additionally renders three
representative Look + Palette stacks twice and checks semantic text survives.
Together these tests distinguish exhaustive compatibility from representative
deterministic byte checks.

Run:

```bash
bun test src/__tests__/mermaid-doc-showcase.test.ts
bun test src/__tests__/styled-output.test.ts --timeout 30000
bun test src/__tests__/mindmap-gitgraph-content-corpus.test.ts
```

Reviewer evidence:

- [`families/mermaid-doc-examples-all-families.png`](./families/mermaid-doc-examples-all-families.png) — one pinned official Mermaid docs example per family, rendered by Agentic Mermaid;
- [`families/style-palette-all-families-after.png`](./families/style-palette-all-families-after.png) — all families under `hand-drawn + dracula`;
- `eval/mermaid-doc-showcase/manifest.json` — exact source, official docs URL, upstream origin/index, and SHA-256 per family;
- `eval/mermaid-doc-showcase/gallery-receipt.json` — generator/source-tree/output freshness.

“Works with every combination” means every non-default built-in single-Look +
single-Palette pair. Arbitrary stacks of multiple Looks or user-authored
fragments are combinatorially unbounded; stack precedence and custom fragment
validation are covered as algebraic/API contracts in `styled-output.test.ts`
and `style-options.test.ts`.

This is a render-compatibility receipt, not a role-face fidelity claim.
Mindmap and GitGraph consume registered palette colors and font selection but
do not currently consume built-in `InternalStyleFace` role overrides; the
all-family matrix keeps that residual wiring gap visible.
