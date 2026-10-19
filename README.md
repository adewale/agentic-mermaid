# Evidence for the 0.5 follow-up fixes PR (not for merge)

Rendered with `renderMermaidPNG(input, { scale: 2 })` (resvg). Before = `main` at 1b1ba848; after = the PR head.

- `parsed-wrapper-before-after.png`: `titled.mmd` rendered from its *parsed* diagram, before (top) and after (bottom). Before, the parsed render dropped the frontmatter title, the dark theme and the `rankSpacing`; after, it is byte-identical to rendering the source string.
- `reopened-after.png`: `reopened.mmd`, a state diagram with two `state Review { … }` blocks. Before, rendering threw `LayoutCertificationError: … Referenced shape does not exist: rp_Draft_1_s`; after, one Review state holds Draft → Submitted → Approved.
