# mermaid-docs corpus

`corpus.json` is a curated set of `(family, source)` example diagrams mined
from the mermaid-js documentation. It feeds the layout-compare harness
(`eval/layout-compare/run.ts`) and round-trip/verify checks.

## Regenerating

Regen is **networked** — it reads markdown from a local mermaid clone:

```sh
git clone https://github.com/mermaid-js/mermaid /tmp/mermaid
bun run eval/mermaid-docs-corpus/build-corpus.ts /tmp/mermaid
```

The family map lives in `FILE_TO_FAMILY` in `build-corpus.ts`.

## Note on pie + quadrant (QUAL-1)

The committed `corpus.json` **predates the pie and quadrant families** — it was
built before those families gained `RenderedLayout` adapters, so it contains no
`pie` / `quadrant` entries. `FILE_TO_FAMILY` now maps `pie.md → pie` and
`quadrantChart.md → quadrant`, so the next regen (which needs a mermaid clone,
hence the unchecked sub-gap in TODO.md) will include them. Corpus entries are
**never fabricated** — they only come from a real regen against upstream docs.
Meanwhile, the harness already exercises pie/quadrant (and every other family)
via the fixtures in `eval/layout-compare/fixtures/`.
