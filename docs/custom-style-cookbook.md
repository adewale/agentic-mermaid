# Custom style cookbook

Custom styles are JSON files. Put the file under version control, pass it to
`--style`, and add a `seed` when you want reproducible sketch variation.

```bash
am render diagram.mmd --format svg --style examples/styles/transit-route-map.style.json --seed 11 > diagram.svg
am render diagram.mmd --format png --style examples/styles/transit-route-map.style.json --seed 11 --output diagram.png
```

The schema is published in this repo as
[`docs/schemas/style-spec.schema.json`](./schemas/style-spec.schema.json) and
from the package as `agentic-mermaid/style-spec.schema.json`. Example files use
`$schema` so editors can offer field completion. The renderer ignores that
field.

Runtime validation still matters. A schema catches the file shape; the renderer
uses `validateStyleSpec` before accepting untrusted records.

```ts
import { readFileSync } from 'node:fs'
import { validateStyleSpec } from 'agentic-mermaid'

const style = JSON.parse(readFileSync('examples/styles/transit-route-map.style.json', 'utf8'))
const problems = validateStyleSpec(style)
if (problems.length) throw new Error(problems.join('\n'))
```

## Transit route map

Complete file:
[`examples/styles/transit-route-map.style.json`](../examples/styles/transit-route-map.style.json).

![Transit route map custom style](./assets/style-cookbook/transit-route-map.png)

This style is a good route-map example because it stresses edge width,
rounded bends, compact station labels, and group labels. It also shows the
current limit: JSON styles can make every connector look like a route, but
they cannot yet assign stable route colors or station-dot glyphs per path.

Use it when you want to test whether a style keeps connectors readable:

```json
{
  "$schema": "https://agentic-mermaid.dev/schemas/style-spec.schema.json",
  "name": "transit-route-map",
  "colors": {
    "bg": "#fbfbf8",
    "fg": "#171923",
    "line": "#d22630",
    "accent": "#0067a8",
    "surface": "#ffffff"
  },
  "font": "DejaVu Sans",
  "stroke": "crisp",
  "strokeWidth": 4,
  "fill": "none",
  "node": {
    "cornerRadius": 18,
    "lineWidth": 3,
    "fillColor": "var(--bg)",
    "borderColor": "var(--fg)"
  },
  "edge": {
    "lineWidth": 4,
    "bendRadius": 16,
    "strokeColor": "var(--line)"
  }
}
```

## Mid-century report

Complete file:
[`examples/styles/mid-century-report.style.json`](../examples/styles/mid-century-report.style.json).

![Mid-century report custom style](./assets/style-cookbook/mid-century-report.png)

This is the easiest uncovered cluster to teach with today's StyleSpec. It is
mostly palette, fill, typography, and role hierarchy. No new backend capability
is needed.

Use it when you want a report figure with visible section bands and square
technical connectors:

```json
{
  "$schema": "https://agentic-mermaid.dev/schemas/style-spec.schema.json",
  "name": "mid-century-report",
  "colors": {
    "bg": "#f4ead8",
    "fg": "#24211d",
    "line": "#2f4858",
    "accent": "#d49a2a",
    "surface": "#78a69b"
  },
  "font": "DejaVu Sans",
  "stroke": "crisp",
  "fill": "solid",
  "node": {
    "cornerRadius": 3,
    "fillColor": "#d9c27e",
    "borderColor": "var(--fg)"
  },
  "group": {
    "textTransform": "uppercase",
    "headerFillColor": "#e0b653",
    "fillColor": "#efe0c5"
  }
}
```

## Star chart atlas

Complete file:
[`examples/styles/star-chart-atlas.style.json`](../examples/styles/star-chart-atlas.style.json).

![Star chart atlas custom style](./assets/style-cookbook/star-chart-atlas.png)

This example exercises the page axis: dark host, grid backdrop, pale strokes,
serif labels, and lightly rough geometry. It is useful because it reveals
hard-coded light fills quickly.

Use it when you need a dark page style that still keeps labels readable:

```json
{
  "$schema": "https://agentic-mermaid.dev/schemas/style-spec.schema.json",
  "name": "star-chart-atlas",
  "colors": {
    "bg": "#0b1026",
    "fg": "#ece4c4",
    "line": "#8a96c0",
    "accent": "#f0d98a",
    "surface": "#101733"
  },
  "font": "EB Garamond",
  "stroke": "jittered",
  "roughness": 0.35,
  "fill": "none",
  "backdrop": "grid",
  "node": {
    "fillColor": "var(--bg)",
    "borderColor": "var(--accent)",
    "textColor": "var(--fg)"
  }
}
```

## Which uncovered clusters belong in guides

Three clusters make good cookbook examples now:

- **Transit/route-map semantics.** It teaches thick edges, bend radius, and the
  difference between a styleable connector and a true route identity system.
- **Retro editorial palettes.** Bauhaus, mid-century, and report figures fit
  the current fields well: color tokens, solid fills, typography, corners, and
  section bands.
- **Star-chart/page treatments.** Dark pages and grid backdrops test whether
  every family routes text and strokes through style tokens.

Three clusters should wait for new capabilities:

- **Stained glass, ukiyo-e, and codex.** They need material backdrops, spot
  palettes, and stronger fill texture rules than the public JSON fields expose.
- **Glass, CRT amber, and neon arcade.** They need compositor/filter fields:
  glow, blur, translucent panels, and static-export fallbacks.
- **Graffiti or spray paint.** They need spray, overspray, layered text
  outlines, and drip/splatter operators before the result is more than a bright
  marker style.

## Regenerate the screenshots

```bash
bun run scripts/docs/custom-style-cookbook.ts
bun run scripts/docs/custom-style-cookbook.ts --check
```

The generator renders the same flowchart through each JSON file. If a
screenshot changes, inspect it before committing the new PNG.
