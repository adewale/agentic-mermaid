# Architecture derived-paint `none` evidence

`mainbkg-none.mmd` is rendered on the exact parent head and this PR head.
Before the change, the shared theme gate admits `none` and Architecture emits
`--bg:none`, `--arch-group-fill:none`, and `--arch-service-fill:none` into SVG,
despite using those values as derived `color-mix()` operands. After the change,
the same source produces a named `INVALID_THEME_COLOR` diagnostic before output.

Regenerate with:

```sh
bun run scripts/pr-assets/issue-303-architecture-mixed-none.ts /path/to/parent-checkout
```

The focused tests cover the other shared Architecture color-mix inputs and
public route propagation. This one fixture is not a claim about all CSS paint
behavior in other families.
