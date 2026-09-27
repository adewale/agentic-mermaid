# Radar theme-color admission evidence

The same `invalid-axis-color.mmd` is rendered at base `b303db02` and at this PR head. Before this change, the malformed nested `radar.axisColor` was emitted into axis stroke and label CSS. After this change, the shared render waist returns a named `INVALID_THEME_COLOR` error before SVG, PNG, ASCII, CLI or MCP output can be produced.

Regenerate with:

```sh
bun run scripts/pr-assets/issue-303-radar-theme-colors.ts /path/to/b303db02-checkout
```

`before.svg` and `after-error.json` are generated from the source above. They are checked into the PR so the regression is reviewable without running the app.
