# Architecture Diagrams (`architecture-beta`) Design Notes

## Overview

Architecture support follows the same parse -> layout -> render split used by the other specialized diagram families, while intentionally reusing the shared graph layout engine for node and group placement.

Current scope covers:

- `group`, `service`, and `junction`
- side-anchored edges (`L`, `R`, `T`, `B`)
- `{group}` boundary routing for services inside groups
- multi-line labels via `<br>` / `\n`
- SVG and ASCII output

## Pipeline

### Parse

`src/architecture/parser.ts` builds a typed architecture model from Mermaid source and then converts it into the shared `MermaidGraph` shape for placement. The parser keeps Mermaid-oriented field names (`group`, `service`, `junction`, boundary anchors) and validates boundary edges up front so unsupported forms fail clearly.

### Layout

`src/architecture/layout.ts` delegates node and group placement to `layoutGraphSync()` through `architectureToMermaidGraph()`, then projects the positioned graph back into architecture-specific primitives.

Architecture-specific work happens after shared placement:

- services keep their card bounds from the graph layout
- junctions reuse the graph point-node placement
- group-boundary edges are rerouted against the enclosing group frame
- edge labels use the orthogonal polyline midpoint so labels stay on-path

### Render

`src/architecture/renderer.ts` renders architecture-specific SVG primitives rather than generic flowchart boxes:

- framed groups with header bands
- service cards with accent rails
- junction rings
- architecture-specific arrow markers and semantic `data-*` hooks
- lightweight icon badges with a fallback glyph path

## Compatibility Notes

- Mermaid's current public header for this diagram family is `architecture-beta`, so that is the supported header.
- Leading Mermaid comments (`%% ...`), YAML frontmatter, and Mermaid init directives before the header are stripped by the public SVG and ASCII entrypoints and by `parseArchitectureDiagram()`.
- The public architecture renderers interpret the merged wrapper config for a focused subset of Mermaid semantics:
  `theme`, `themeVariables`, `fontFamily`, `fontSize`, and `architecture.padding` / `architecture.iconSize` / `architecture.fontSize`.
- `parseArchitectureDiagram()` still treats wrapper config as non-structural input and ignores it after preprocessing, which is intentional because the parser returns only the diagram model.
