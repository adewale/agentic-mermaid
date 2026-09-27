# Quadrant authored color admission

The same [`invalid-point-color.mmd`](invalid-point-color.mmd) is rendered on
parent `9ff4d391d6da2ed270aa5ff8fcb7b44b564cf642` and this PR. The parent
exits successfully and emits [`before.svg`](before.svg), whose point carries
`fill:notacolor`, and [`before.png`](before.png), where the rasterized point is
black. A browser cannot paint that token, so the authored point color is not
shown. The changed renderer returns
[`after-error.json`](after-error.json), a named `INVALID_STYLE_COLOR` refusal.
There is intentionally no fabricated successful after image.

Reproduce from each checkout with the public CLI:

```sh
bun run bin/am.ts render docs/pr-assets/issue-303-quadrant-authored-colors/invalid-point-color.mmd --format svg --json
```

The focused tests additionally cover direct and `classDef` point fill/stroke
across SVG, PNG, ASCII, Unicode, verify, CLI, and MCP; valid colors, `none`, and
`var(--name)` remain accepted. This PR is one #303/#248 color-admission slice,
not closure of either tracking issue.
