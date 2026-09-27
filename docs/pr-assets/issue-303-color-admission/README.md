# Invalid authored fill: before and after

The single checked-in [`invalid-node-fill.mmd`](invalid-node-fill.mmd) was run
against exact base `bc10ad57122f013b60abc4bac633c9f196a6a5c3` and this
PR's source-style admission code.

On the base, `bun run bin/am.ts render invalid-node-fill.mmd --format png`
exited 0 and produced [`before.png`](before.png): a black `Ready` node with
dark, unreadable text. The accompanying [`before.svg`](before.svg) contains
the authored `fill="notacolor"` attribute. Neither image is a fabricated
post-fix render.

On the changed tree, `bun run bin/am.ts render invalid-node-fill.mmd --format
svg --json` exited 2 and emitted [`after-error.json`](after-error.json). PNG
also refuses the same source before rasterization. There is intentionally no
"after" image: the corrected behavior is a named, typed diagnostic instead
of a misleading drawing.

This slice covers authored `style`, `classDef`, and `linkStyle` colors on
SVG, PNG, ASCII, and Unicode paths, `verify`, typed style mutations, and
CLI/MCP diagnostic projection. Theme variables and remaining #303 route
convergence are separate stacked work; this PR does not close #303 or #248.
