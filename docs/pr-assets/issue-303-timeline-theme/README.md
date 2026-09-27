# Timeline theme-color evidence

The single source in `invalid-scale-color.mmd` configures Timeline's first
palette fill as `notacolor`. Reproduce with:

```sh
bun run scripts/pr-assets/issue-303-timeline-theme.ts /path/to/base-checkout
```

Use a checkout of PR #328's final candidate, `2af0d404946d2e534c22991aca11961f8ff80588`,
as the base argument. The script imports the production renderers from that
checkout and the changed checkout. It proves the base emits
`--tl-fill:notacolor` and the changed renderer throws `INVALID_THEME_COLOR`
for `cScale0`. There is no after SVG because correct behavior is refusal.

The SVG proves an invalid authored paint entered generated CSS, not how every
browser rasterizes that token. The full key matrix and route tests in
`src/__tests__/theme-color-admission.test.ts` prove the wider admission rule.
