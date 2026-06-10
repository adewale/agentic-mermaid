# Mermaid family-usage counter (BUILD-5 evidence)

This directory answers one question for BUILD-5: **which of the not-yet-supported
Mermaid families (pie / gantt / mindmap / gitgraph) should we build first?**

The premise is "build the family people actually use." To rank families by real
usage we need a corpus of real Mermaid usage and a reproducible way to count
which family each ```mermaid fenced block belongs to.

## What's here

- `count.ts` — the counter. Input: one or more directories of markdown files.
  Output: a ranked count of ```mermaid fenced-block header families.
- `count.test.ts` — golden-input tests. A fixed fixture corpus
  (`__fixtures__/corpus/`) with a known family distribution that the counter
  must reproduce exactly.
- `RESULTS.md` — recorded results + the honest caveat about the corpus.

## How it counts

For every `.md` / `.markdown` / `.mdx` / `.mdown` / `.mkd` file under the given
directories:

1. Extract every ```mermaid (or `~~~mermaid`) fenced block.
2. Find the block's header — the first non-empty, non-`%%`-comment line, after
   skipping an optional leading `--- ... ---` YAML frontmatter block.
3. Normalize that header to a canonical family with `familyFromHeader()`, which
   mirrors the renderer's `detectDiagramTypeFromFirstLine` first-line signal.
4. Tally family → count.

Unknown headers are **never dropped**. They are bucketed as `other:<token>` (or
`unknown` for an empty header) so an unfamiliar family is visible in the output
rather than silently lost. (This follows the ER-cardinality lesson in
`docs/project/lessons-learned.md`: surface what you don't model, don't drop it.)

## Running it

```bash
# Human-readable ranked table:
bun run eval/family-usage/count.ts <dir> [<dir> ...]

# JSON (for further processing):
bun run eval/family-usage/count.ts --json <dir>

# The local smoke corpus that ships in this repo:
bun run eval/family-usage/count.ts docs skills
```

## The real corpus (needs network)

The decision-grade corpus is **READMEs from popular GitHub repositories**, which
is what a typical Mermaid consumer writes. Producing that corpus requires network
access this environment does not have, so the committed `RESULTS.md` records a
**smoke run over the in-repo docs/skills only** and is explicit that it is NOT the
decision corpus.

To produce the real ranking when network is available, build a corpus directory
and point the counter at it. Two practical options:

1. **GitHub code-search export.** Use the GitHub code-search API (or the `gh` CLI)
   to find files containing ```mermaid across high-star repositories, download the
   matching READMEs/markdown into a directory, then:

   ```bash
   bun run eval/family-usage/count.ts /path/to/github-readme-corpus
   ```

2. **Cloned awesome-list / docs set.** Clone a set of well-known repositories
   (e.g. an `awesome-*` list's members, or the mermaid-js docs themselves) into a
   directory and run the counter over their checkouts:

   ```bash
   bun run eval/family-usage/count.ts /path/to/cloned-repos
   ```

Either way the counter itself is unchanged and fully deterministic; only the
input corpus differs. Record the corpus provenance (source, date, file count)
alongside any results so the ranking is auditable.
