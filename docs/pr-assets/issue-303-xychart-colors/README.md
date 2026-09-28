# XY Chart authored-color evidence (#303/#248)

The same `invalid-palette.mmd` source was rendered on parent commit
`5a9d37f31780a9918ed87ae47bcfbd526bd744d3` and on this stack layer.
The parent succeeds with `--xychart-color-0: notacolor` in its SVG and paints
both bars black in its PNG. That is a genuine misleading output, not a
constructed mock-up. The changed renderer refuses the source before any
SVG/PNG/ASCII/Unicode output and the public batch route returns
`after-error.json`.

Before artifacts from the parent renderer:

- `before.svg` SHA-256: `0d534499048e397b37bcbefa8b0dff45a7cff2ae8df5f30e4df5e6d0af12e749`
- `before.png` SHA-256: `c4e79159a2339bd719584951e0f70dd5b1225eda46ee923dcfb679f5978ba896`

To reproduce, check out the pinned parent into a separate worktree, install
its locked dependencies, and run this from that worktree with `XY_FIXTURE`
set to the absolute path of this directory's `invalid-palette.mmd`:

```sh
bun -e 'import { readFileSync, writeFileSync } from "node:fs"; import { renderMermaidSVG } from "./src/index.ts"; import { renderMermaidPNG } from "./src/agent/png.ts"; const source = readFileSync(process.env.XY_FIXTURE!, "utf8"); writeFileSync("before.svg", renderMermaidSVG(source, { embedFontImport: false })); writeFileSync("before.png", renderMermaidPNG(source));'
```

From this head, pass the same source to the public `am batch --jsonl`
render route for SVG; its JSON result is `after-error.json`. There is no
fabricated successful after image.
