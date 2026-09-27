# GitGraph theme-color evidence

The single source in `invalid-branch-color.mmd` configures GitGraph's first
branch stroke as `notacolor`. Run

```sh
bun run scripts/pr-assets/issue-303-gitgraph-theme.ts /path/to/base-checkout
```

with a checkout of PR #327's final head, `619b4564bc8a7a8158f126c33150d54a270fc34e`,
as the argument. The script imports the production renderer from that checkout
and the changed checkout, checks that the base emits `stroke="notacolor"`,
checks that the changed renderer instead throws `INVALID_THEME_COLOR` for
`git0`, and writes the two checked-in artifacts. There is no after SVG because
the intended result is a refusal to render an invalid color.

The SVG proves the unsafe-looking CSS token entered the output, not how every
browser rasterizes that token. The broader invalid-key matrix and route tests
in `src/__tests__/theme-color-admission.test.ts` prove the admission behavior.
