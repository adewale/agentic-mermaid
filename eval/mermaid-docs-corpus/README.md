# mermaid-docs corpus

`corpus.json` is the original 12-family set of `(family, source)` examples
mined from Mermaid's syntax documentation. It feeds the layout-compare harness
(`eval/layout-compare/run.ts`) and round-trip/verify checks. `divergences.json`
is the executable ledger for docs examples that intentionally parse and
round-trip while producing known verification warnings. `provenance.json`
pins the exact upstream revision and records the family distribution.

This corpus is not the complete registered-family inventory. Mindmap,
GitGraph, and radar were enrolled later and are covered by the pinned upstream
suite, their dedicated companion corpora/benches, and the one-per-family docs
showcase. Keeping that boundary explicit prevents an old 12-family snapshot
from being mistaken for exhaustive coverage.

## Regenerating

Regen is **networked** — it reads markdown from a local mermaid clone:

```sh
git clone https://github.com/mermaid-js/mermaid /tmp/mermaid
git -C /tmp/mermaid checkout a2d9686451df7c4644a3eeca20535bbd4c5776b0
bun run eval/mermaid-docs-corpus/build-corpus.ts /tmp/mermaid
```

The builder refuses an unpinned checkout. The family map lives in
`FILE_TO_FAMILY` in `build-corpus.ts`; changing its scope requires an explicit
corpus and provenance review.

## Refresh note

The committed corpus contains 271 examples at the pinned revision:

| Family | Examples |
|---|---:|
| flowchart | 111 |
| class / sequence | 36 each |
| er | 23 |
| state | 20 |
| timeline | 14 |
| gantt | 11 |
| xychart | 8 |
| architecture | 6 |
| quadrant | 3 |
| pie | 2 |
| journey | 1 |

That imbalance mirrors upstream documentation volume. Reports derived from it
must show per-family or macro-averaged outcomes alongside raw sample totals;
otherwise flowcharts can drown out a total regression in journey or pie.
Corpus entries are **never fabricated**—they come from the pinned upstream
documents.
