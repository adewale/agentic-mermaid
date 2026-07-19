# Mindmap/GitGraph real-content corpus

This corpus supplements the exact Mermaid parser/spec oracle. The oracle asks whether pinned upstream semantics match; this corpus asks whether the implementation survives the kinds of content users actually try to communicate.

## Selection method

1. Read the Mermaid 11.16 Mindmap and GitGraph syntax pages and pinned parser/DB specs.
2. Review linked Mermaid issues/PRs about layout, labels, Unicode, icons, branch order, cherry-picks, orientations, and config.
3. Review Beautiful Mermaid issue #85 and Mermaid ASCII issue #74’s measured 593-diagram RFC corpus.
4. Snapshot the popularity-weighted fork graphs with GitHub’s `forks?sort=stargazers&per_page=100&page=1` API. Selection takes the first three Mermaid, first two Beautiful Mermaid, and first Mermaid ASCII non-archived forks in API order; equal-star ties preserve API order. There is no activity cutoff. `adewale/agentic-mermaid` is excluded from the Beautiful Mermaid sample because it is the evaluation target and would make the signal self-referential. The resulting weights are 234, 32, and 1.
5. Convert distinct demand classes into authored fixtures. Forks did not introduce a competing family language, so popularity affects robustness, terminal, packaging, and layout priorities—not syntax authority. Do not copy private RFC content or treat a proposed feature as accepted syntax.

[`fork-snapshot.json`](./fork-snapshot.json) retains the fetch timestamp, exact API URLs, response hashes, repository IDs, ordering inputs, stars, push dates, sample sizes, and exclusions. Refresh it with `bun run scripts/research/refresh-mindmap-gitgraph-forks.ts`; a refresh is a new point-in-time research observation, not a routine golden update. The scenario sources and expected semantic signatures live in [`manifest.json`](./manifest.json).

## Coverage

### Mindmap

- official shapes, Markdown, classes, local icons, accessibility, and Unicode;
- thirteen first-level branches / forty total nodes (the >11-child regression class);
- deep uneven work-breakdown and repository hierarchies;
- long multilingual labels, CJK, Arabic, emoji graphemes, `&`, `<`, and `>`;
- explicit `tidy-tree` kept distinct from the central bilateral default;
- organization/folder content repeatedly requested in Mermaid and Beautiful Mermaid.

### GitGraph

- Gitflow release/hotfix topology;
- long commit messages/tags, large typography, and TB layout;
- twelve lanes and double-digit branch ordering;
- merge-commit cherry-pick with immediate-parent ancestry;
- Unicode custom main branch, unusual branch names, and BT layout;
- the official transit-map domain transfer;
- CI/CD build, staging, canary, and production promotion.

## Contract

`src/__tests__/mindmap-gitgraph-content-corpus.test.ts` requires every fixture to:

- parse through the public agent surface into the expected family;
- preserve exact structural counts and scenario-specific signatures;
- verify without render-blocking or `empty_layout` findings;
- serialize/reparse idempotently;
- render deterministic, external-reference-safe SVG;
- render bounded terminal output using display-cell width;
- satisfy central-vs-tidy Mindmap geometry and GitGraph direction, exact lane order, and authored parent/cherry-pick invariants.

Warnings are pinned per case, including count and order; only deliberately long-content cases expect `LABEL_OVERFLOW`.

## Visual receipt

`bun run gallery:mindmap-gitgraph` runs the same parse/round-trip/determinism/terminal checks while generating the two gallery PNGs. It writes [`gallery-receipt.json`](./gallery-receipt.json), which hashes every fixture, the manifest and fork snapshot, the generator's fail-closed transitive local import graph, and both outputs. `bun run gallery:mindmap-gitgraph:check` and the unit suite reject source or image drift. The corpus, receipt, and fixtures are included in the npm package so links from the packaged family documentation remain reproducible.
