# Architecture theme-color admission evidence

The same `invalid-group-fill.mmd` is rendered at this PR's base `219982b0` and this PR head. The evidence was captured from the pre-squash Radar head `78f04ae5`, whose Git tree is identical to `219982b0`. Before this change, an invalid `clusterBkg` was emitted into Architecture CSS. After this change, the shared render boundary returns a named `INVALID_THEME_COLOR` diagnostic before output is produced.

Regenerate with:

```sh
bun run scripts/pr-assets/issue-303-architecture-theme-colors.ts /path/to/219982b0-checkout
```

`before.svg` and `after-error.json` are generated from the same checked-in source. The fixture proves this group-fill failure mode; the test suite covers the remaining Architecture keys and API routes.
