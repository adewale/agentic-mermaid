# Mindmap

## Contract

Mindmap is a first-class, indentation-sensitive family. The parser consumes the untrimmed normalized body, produces a recursive `MindmapNode` tree, and preserves Mermaid shapes, `::icon(...)`, `:::class`, `accTitle`, and `accDescr`. Duplicate semantic node identities fail with `MINDMAP_DUPLICATE_ID`; they never overwrite an earlier node.

Compatibility is pinned to Mermaid commit `f3dea58385fd5c7dd1f4e9c9c1876751ae6943cc`. The checked oracle accounts for all 26 direct blocks in upstream `mindmap.spec.ts`; every block is executable, and the source-file hash, normalized expectations, and intentional divergences live in `eval/mermaid-upstream-suite-bench/mindmap-gitgraph-f3dea583.json`. The harvest added trailing-inline-comment compatibility (`%%` outside quoted labels).

## Visual evidence

**Why:** at baseline commit `c7e33247`, `mindmap` was not a registered family,
so the reproducible render command below failed instead of producing an
artifact. The after image is generated from [`mindmap-demo.mmd`](./mindmap-demo.mmd):

```bash
bun run bin/am.ts render docs/design/families/mindmap-demo.mmd \
  --format png --output docs/design/families/mindmap-after.png
```

![Mindmap rendered as a measured hierarchy](./mindmap-after.png)

**What to inspect:** one semantic root, ordered Research/Delivery branches,
nested child connectors, and labels contained by their measured node shapes.
There is intentionally no fabricated “before” picture: the causal before state
was a named unsupported-family failure. Reproduce it in an isolated baseline
worktree (do not run this over the feature checkout):

```bash
git worktree add --detach /tmp/am-before c7e33247b7f152ada47000db3cd514c04cbcc00e
(cd /tmp/am-before && bun install --frozen-lockfile && \
  printf 'mindmap\n  root((Product))\n' | bun run bin/am.ts render - \
    --format png --output /tmp/mindmap-before.png)
git worktree remove --force /tmp/am-before
```

Expected result: exit 2 with `PARSE_FAILED` / `UNKNOWN_HEADER: Unrecognized
header: "mindmap"`; no PNG is produced.

## Rendering and layout

`src/mindmap/layout.ts` deterministically measures and wraps labels, assigns one horizontal layer per depth, centers parents over descendant leaves, and routes one orthogonal connector per non-root node. `src/mindmap/renderer.ts` lowers the result through Scene IR and emits source-semantic `data-id` values only on node groups. `src/ascii/mindmap.ts` renders the same hierarchy with Unicode or ASCII branches, grapheme-aware wrapping, and the hard `targetWidth` contract.

The only wired family config fields are:

- `mindmap.padding`
- `mindmap.maxNodeWidth`

Unknown fields and invalid documented values produce named `INEFFECTIVE_CONFIG`
diagnostics and cannot change geometry.

## Typed editing

Use `asMindmap` before mutation. Operations cover add/remove/rename/move, label and shape changes, icon/class decoration, and accessibility title/description. Moves reject cycles; removal of a non-empty subtree requires `recursive: true`; default-shape nodes retain Mermaid's label-as-identity rule.

## Verification

`verifyMermaid` checks label overflow and projects real node/edge geometry into `RenderedLayout`. The focused citizenship suite proves parser/serializer stability, duplicate rejection, tree and route invariants, typed edits, Unicode/display-cell behavior, external-reference hygiene, deterministic SVG/layout, and property-generated sibling trees.

See `src/__tests__/mindmap-gitgraph-citizenship.test.ts` and the exhaustive
operation contract in `src/__tests__/mindmap-agent-ops.test.ts`. The focused
Stryker lane (`bun run mutation-test:mindmap`) killed 400/405 mutants
(**98.77%**) in the latest 2026-07-10 local run; the gitignored report is not an
immutable PR artifact and the committed break floor is 60%. The three survivors
are equivalent correlated tuple guards plus an empty `catch` whose implicit
`undefined` is the same falsy result as explicit `false`.
