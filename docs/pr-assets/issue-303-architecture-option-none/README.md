# Architecture render-option `none` evidence

The same `bg-none.mmd` with `options.json` is rendered on the parent and this
PR head. The parent emits `--bg:none` even though Architecture uses that value
in derived `color-mix()` paints. The head instead returns a named
`INVALID_RENDER_COLOR` diagnostic before output.

Regenerate with:

```sh
bun run scripts/pr-assets/issue-303-architecture-option-none.ts /path/to/parent-checkout
```

This fixture proves one failure mode. Focused tests cover the other mixed
render-option channels and output routes; it is not a claim about all family
style/configuration colors.
