# Invalid shared and Pie theme colors: before and after

The two checked-in Mermaid sources use `notacolor` for
`themeVariables.primaryColor` and `themeVariables.pie1`. They were rendered
against exact base `1cde6faa8001febe58b6836bb558cc7582cec218` with:

```sh
bun run bin/am.ts render invalid-primary-color.mmd --format png --output before-primary.png
bun run bin/am.ts render invalid-pie-color.mmd --format png --output before-pie.png
```

Both commands exited 0. [`before-primary.png`](before-primary.png) shows black
nodes with unreadable dark labels; [`before-pie.png`](before-pie.png) shows a
black slice and dark percentage label. These are real baseline rasterizations,
not fabricated post-fix images.

On the changed tree, `bun run bin/am.ts render <source> --format svg --json`
exits 2 with the checked-in [`primaryColor`](after-primary-error.json) and
[`pie1`](after-pie-error.json) nominal diagnostics. There is intentionally no
“after” picture: a named refusal replaces a misleading drawing. PNG, terminal,
`verify`, CLI/MCP, and lazy-browser routes use the same admission rule.

This layer covers shared `DiagramColors` theme keys and the Pie color keys.
Private family theme keys and other #303/#248 seams remain separate stacked
work; this layer does not close either issue.
