# Palette rollout evaluation

This corpus measures the controlled `{1,2,3}` categorical-palette rollout on
eight-category XY chart, journey, mindmap, and gitgraph fixtures in light and
dark themes.

The committed baseline SVGs are deliberately frozen before the rollout. The
generator extracts the colors actually serialized by each renderer, checks
uniqueness, pairwise ΔE_OK, WCAG contrast, and APCA lightness contrast, then
generates a side-by-side contact sheet and a machine-readable comparison.

```sh
bun run gallery:palette-rollout
bun run gallery:palette-rollout:check
```

`gallery:palette-rollout:baseline` is a characterization command, not a normal
update command. Re-record the baseline only when intentionally starting a new
experiment; doing so during implementation would erase the before state.
