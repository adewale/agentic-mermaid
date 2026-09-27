# Architecture theme-color admission evidence

The same `invalid-group-fill.mmd` is rendered at base `78f04ae5` and this PR head. Before this change, an invalid `clusterBkg` was emitted into Architecture CSS. After this change, the shared render boundary returns a named `INVALID_THEME_COLOR` diagnostic before output is produced.

Regenerate with:

```sh
bun run scripts/pr-assets/issue-303-architecture-theme-colors.ts /path/to/78f04ae5-checkout
```

`before.svg` and `after-error.json` are generated from the same checked-in source. The fixture proves this group-fill failure mode; the test suite covers the remaining Architecture keys and API routes.
