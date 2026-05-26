# Changelog

This changelog tracks user-facing changes in the `adewale/beautiful-mermaid` fork. Upstream-focused PR branches keep their own minimal histories.

## Unreleased

### Added
- Live editor deployment on GitHub Pages at <https://adewale.github.io/beautiful-mermaid/editor>.
- Editor examples palette with presets for every supported diagram family: flowchart, state, architecture, sequence, class, ER, timeline, journey, and xychart.
- Semantic role-based SVG styling via `options.style.text`, `options.style.node`, `options.style.edge`, and `options.style.group`.
- Role-style showcase samples in the live gallery under **Contents → Role Styles**.
- Fork documentation describing differences from upstream in [`FORK_DIFFERENCES.md`](./FORK_DIFFERENCES.md).
- Product/design context documents (`PRODUCT.md`, `DESIGN.md`) for future design-system aligned work.
- Homepage sample search and category filters for browsing the full showcase.
- Mobile editor pane switching for Code, Config, Preview, and Examples.

### Changed
- SVG style customization is now role-based and diagram-family aware; removed flat render style aliases are intentionally ignored.
- Showcase and editor docs now point users to live examples and presets.
- Fork docs and deploy script now treat GitHub Pages as the fork-owned site and avoid the upstream-owned Craft/Cloudflare deployment target.
- Live editor now starts blank by default, uses salmon as the default theme, uses a larger grouped Examples palette, and includes Copy SVG alongside Save SVG/PNG export.
- Homepage deployment now builds the full sample gallery, defaults to salmon, and removes text that implied Craft affiliation.
- Editor example presets now preserve the currently selected theme instead of forcing Default or Solarized Light.
- Live editor now offers a persistent Examples sidebar and a blank-state “Load an example” CTA.
- Editor controls, empty state, sidebar, and dropdowns received polish for concentric radii, tactile press states, smoother icon transitions, tabular numbers, and cleaner text wrapping.
- Homepage and editor typography now use Atkinson Hyperlegible for a more distinctive, readable UI face.
- Homepage rendering yields between sample batches to keep the page responsive while the full gallery renders.
- Editor empty state now includes quick starter chips for Flowchart, Sequence, and Role styled examples.
- Example rows now include compact diagram-family glyphs for faster scanning.

### Fixed
- TypeScript CI failures in journey style padding and optional node corner-radius resolution.
- Editor export actions are disabled until a diagram exists and parser errors now include recovery-oriented copy.
- Editor menus, sidebar, and theme controls now close with Escape and expose stronger ARIA/focus states.
- Removed layout-property sidebar animation in favor of opacity/transform-based motion.

## Fork baseline before this changelog

This fork already included broader rendering parity work, additional diagram families, GitHub Pages publishing, fork audit notes, and lessons learned. See [`LESSONS_LEARNED.md`](./LESSONS_LEARNED.md) and git history for pre-changelog detail.
