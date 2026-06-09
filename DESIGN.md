# DESIGN

## Design System
Agentic Mermaid uses a restrained product UI system with salmon as the fork's default theme. Surfaces should feel warm, quiet, and tactile while preserving developer-tool density.

## Typography
- UI family: Atkinson Hyperlegible, then system fallbacks.
- Code family: JetBrains Mono, then monospace fallbacks.
- Body/help copy: 14-16px where possible.
- Compact metadata: 12-13px minimum outside SVG/code contexts.
- Use weight, spacing, and proximity before adding decorative color.

## Color
- Prefer theme-derived custom properties: `--t-bg`, `--t-fg`, `--t-accent`, `--bg`, `--bg2`, `--bg3`, `--fg`, `--fg2`, `--fg3`, `--fg4`, `--border`.
- Default light scene: warm salmon paper, dark cocoa text, vivid salmon accent.
- Avoid pure black/white in new UI colors unless preserving existing theme values or external SVG semantics.
- State colors should be semantic and stable: green for success, red for errors.

## Spacing & Shape
- Concentric radii: 8px inner controls, 10-12px buttons/popovers, 18-20px large empty-state surfaces.
- Prefer `gap` over one-off margins.
- Use tighter spacing inside toolbars and generous spacing between unrelated groups.

## Elevation
- Prefer shadow tokens over visible borders for raised controls.
- Use borders only for panel separation, form controls, and explicit state boundaries.

## Interaction
- Every interactive control needs hover, active, disabled, and visible `:focus-visible` states.
- Press feedback should use small transform/scale changes.
- Do not animate layout properties such as width, height, padding, or margin.
- Respect `prefers-reduced-motion`.

## Responsive Rules
- Desktop editor: source/config and preview can sit side by side.
- Mobile editor: use one active pane at a time with Code, Config, Preview, and Examples controls.
- Example discovery should remain available without horizontal clipping.

## Copy
- Be direct and task-oriented.
- Avoid em dashes in new UI copy.
- Empty states should explain what is missing and offer the next useful action.
