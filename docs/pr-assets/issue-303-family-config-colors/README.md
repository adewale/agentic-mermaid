# Timeline/Journey config-color evidence

The single source in `invalid-section-fill.mmd` sets Timeline's first
`sectionFills` entry to `notacolor`. Reproduce with:

```sh
bun run scripts/pr-assets/issue-303-family-config-colors.ts /path/to/base-checkout
```

Use a checkout of merged PR #329, `8337ef1863b76d78fb54edce077eff5256f20896`,
as the base argument. The script imports the production renderers from that
checkout and this changed checkout. It proves the base emits an invalid fill
and derived `color-mix()` CSS, while the changed renderer returns
`INVALID_CONFIG_COLOR` for `timeline.sectionFills[0]`. There is no after SVG
because the correct behavior is refusal.

The SVG proves the authored invalid paint entered CSS, not the precise browser
rasterization. The list/scalar matrix and public-route tests in
`src/__tests__/family-config-color-admission.test.ts` establish the wider rule.
