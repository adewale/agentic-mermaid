# PR #581 visual evidence

Evidence-only attachment branch, following PR #578. Not intended to merge.

Baseline SHA: `0a2dc30b6220c04182f8ccd45550689422606a22`
Current renderer SHA: `7c1fc3c0612ae39d5d604f0cc2da2e878f1462fb`

The same three corpus inputs use `publication-figure`. The baseline throws; its exact errors are retained. Head SVGs come from production renderMermaidSVG. PNGs are rasterized from those SVGs using resvg and Inter fonts. See receipt.json for capture details and output hashes.

Inspect the rounded bypasses around namespace headers and arrowheads where the relationships meet their cards. Class/17 and class/18 are nested; class/19 uses flattened full-path labels. These examples do not establish clearance for all shapes, directions, or styles.

Regenerate the production SVG at either renderer revision, with each retained .mmd input:

```sh
bun run bin/am.ts render class-17.mmd --options '{"style":"publication-figure"}' --format svg --output out.svg
```

Substitute class-18.mmd or class-19.mmd for the other inputs. The baseline produces an error instead of SVG.
