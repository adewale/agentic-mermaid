# Remove role styling and replace it with Style + Palette

## Decision

Remove the role-style API and role-style preset examples completely before launch. Do not keep compatibility aliases, silent fallbacks, or docs for `text` / `node` / `edge` / `group` style objects. The newer Style + Palette model is easier to explain, better aligned with user demand, and already maps to the public positioning: beautiful diagrams made with an agent, with appearance controlled outside Mermaid source.

## Phase 1 — remove role styling completely

### 1. Delete the public role-style API

- Remove `DiagramStyleOptions` and role style types from `src/types.ts`.
- Stop making `StyleSpec` extend role options.
- Remove `styleRolesOf`, role-key merging, role-key validators, and role schema entries.
- Make role keys invalid at boundaries:
  - `validateStyleSpec({ node: {} })` returns an error.
  - `validateStyleSpec({ text: {} })` returns an error.
  - `validateStyleSpec({ edge: {} })` returns an error.
  - `validateStyleSpec({ group: {} })` returns an error.
- Do not preserve `renderMermaidSVG(src, { style: { node: ... } })` behavior.

### 2. Keep built-in looks, but move role-like internals private

- Keep named styles, palettes, style stacks, `seed`, stroke/fill/backdrop/font/color fields.
- If built-in looks need typography, spacing, or line-treatment metadata, move it to a private internal style-face structure that is not accepted as user JSON.
- Public custom styles should expose Style + Palette concepts only: colors, font, stroke treatment, fill treatment, backdrop, roughness, hachure/wash fields, and deterministic seed behavior.

### 3. Remove role presets from reused examples

- Delete `EDITOR_SEMANTIC_STYLE` from `editor/examples.ts`.
- Delete every `category: 'Role style presets'` example.
- Remove the editor placeholder chip labelled `Role styled`.
- Remove role-style jump sections and role-style proof copy from `website/build.ts`.
- Ensure `examples/index.json` loses role-style examples by changing the shared source data, not by filtering generated output.

### 4. Make Style + Palette the shared examples surface

Create a shared Style + Palette example data source reused by:

- `/examples/` HTML generation.
- `examples/index.json`.
- editor “Open styled” links.
- website tests.
- visual-evidence scripts.
- docs snippets where practical.

Each shared record should carry:

- `id`
- `family`
- `source`
- `style`
- `palette`
- `seed`
- `agentPrompt`
- `renderOptionsSnippet`
- expected editor/share URL

Prefer using the same Mermaid source as the editor's supported-family examples, so the examples prove the actual claim: same Mermaid source, fixed geometry, different Style + Palette.

### 5. Remove public docs and copy

Purge public/runtime mentions of:

- `role style`
- `semantic style`
- `DiagramStyleOptions`
- `style.node`
- `style.edge`
- `style.group`
- `text/node/edge/group`

Update docs to teach:

- **Style** = renderer treatment, e.g. hand-drawn, watercolor, publication figure, ops schematic.
- **Palette** = colors/brand tokens.
- **Mermaid-native style directives** = per-element emphasis in source, e.g. `classDef`, `class`, `style`, `linkStyle`.

### 6. Regression guards

Add negative guards:

- Style schema rejects role keys.
- `validateStyleSpec` rejects role keys.
- generated site/docs contain no public role-style vocabulary.
- editor examples contain no `Role style presets` category.

Add positive guards:

- Style + Palette examples exist for all supported families.
- `/examples/`, editor links, and `examples/index.json` derive from the same shared data.
- Style + Palette render options round-trip into editor/share links.
- full website generation renders the shared examples at build time.

### Definition of done

- `rg "Role style|role style|semantic style|DiagramStyleOptions|styleRolesOf|style\\.node|style\\.edge|style\\.group|text/node/edge/group"` has no public/runtime hits.
- `am styles` still lists named styles and palettes.
- editor Style and Palette controls still work.
- `/examples/` remains the discovery surface.
- full tests and website checks pass.

## Phase 2 — deliver user-requested styling through Style + Palette

### 1. Consistent appearance across diagram families

User demand: consistent theme/styling behavior across Mermaid diagram types.

Deliver with:

- a 12-family Style + Palette matrix;
- stacks such as `['publication-figure', 'github-light']`, `['ops-schematic', 'nord-light']`, and `['watercolor', 'zinc-light']`;
- copy that says: same source, same geometry, different appearance.

### 2. Brand/design-system integration

User demand: brand colors, CSS-variable palettes, design-system integration.

Deliver with:

- palette-only JSON examples;
- light and dark brand palette examples;
- CSS-variable palette examples where safe;
- docs that tell agents to pass palette/style render options rather than editing Mermaid source for brand changes.

### 3. Readable docs/deck/publication output

User demand: diagrams that look good in docs, decks, reports, and reviews.

Deliver with named styles:

- `publication-figure`
- `accessible-high-contrast`
- `patent-drawing`
- `architectural-plan`

Example prompts:

- “Render this for a design doc.”
- “Make a high-contrast version for review.”
- “Produce a print-safe figure.”

### 4. Sketch and hand-drawn output

User demand: hand-drawn / sketch / Excalidraw-like Mermaid.

Deliver with:

- `hand-drawn`
- `freehand`
- `watercolor`
- `chalkboard`
- deterministic `seed` examples that show ink can re-roll without moving layout.

### 5. Per-element emphasis

User demand: style individual nodes, links, classes, participants, or arrows.

Do not solve this with role styles. Use Mermaid-native directives:

- `classDef`
- `class`
- `style`
- `linkStyle`

Show examples that combine Mermaid-native per-element emphasis with global Style + Palette render options.

### 6. Final examples shape

`/examples/` should prove the replacement surface:

- supported diagram families;
- Style + Palette combinations;
- custom palette/style JSON examples;
- Mermaid-native per-element styling examples.

No role-style preset section remains.
