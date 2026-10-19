# Evidence for the typed SVG writer PR

Before = main at 30f0af5d63e460c8bd3de88358414f2c7857a2c6; after = 6ba2e9e8f4408caa6a78b5952f991a5300dbd384.
Each image is before (left, or top) and after (right, or bottom), rendered to PNG by
`renderMermaidPNG` (resvg) from the same input at both revisions.

- radar-hand-drawn-before-after.png, radar-watercolor-before-after.png:
  `eval/layout-compare/fixtures/radar-basic.mmd` with `style: 'hand-drawn'` /
  `'watercolor'`. Sketched areas now keep the default style's opaque outline
  over a translucent fill.
- pie-sentinel-before-after.png: the Pie Sentinel cell of
  `src/__tests__/testdata/section-b-brand-evidence.png` (`bun run gallery:section-b`).
  The highlighted slice draws the 5px emphasis its typed paint certified.
- class-member-ink-before-after.png: class-member.mmd below, default style.
  Abstract and non-ASCII members paint in the member ink instead of black.

- c4-api-db-before-after.png: `eval/layout-compare/fixtures/c4-basic.mmd`,
  default style, cropped to the API → Store relationships (top before, bottom
  after). Facing ports now sit level, so the routes run straight.
- c4-context-uses-before-after.png: the official C4Context fence whose "Uses"
  relationship had a dogleg under its label (top before, bottom after).

class-member.mmd:

```
classDiagram
  class Shape {
    <<abstract>>
    +area()* double
    +count$ int
    +näme String
    +draw() void
  }
```
