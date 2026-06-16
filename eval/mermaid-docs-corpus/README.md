# mermaid-docs corpus

`corpus.json` is a curated set of `(family, source)` example diagrams mined
from the mermaid-js documentation. It feeds the layout-compare harness
(`eval/layout-compare/run.ts`) and round-trip/verify checks. `divergences.json`
is the executable ledger for docs examples that intentionally parse and
round-trip while producing known verification warnings.

## Regenerating

Regen is **networked** — it reads markdown from a local mermaid clone:

```sh
git clone https://github.com/mermaid-js/mermaid /tmp/mermaid
bun run eval/mermaid-docs-corpus/build-corpus.ts /tmp/mermaid
```

The family map lives in `FILE_TO_FAMILY` in `build-corpus.ts`.

## Refresh note

The committed `corpus.json` was regenerated from `mermaid-js/mermaid` on
2026-06-16 and now includes all currently registered renderable families,
including pie and quadrant. Corpus entries are **never fabricated** — they only
come from a real regen against upstream docs.
