# Changelog

This changelog tracks user-facing changes in the `adewale/beautiful-mermaid` fork. Upstream-focused PR branches keep their own minimal histories.

## Unreleased

### Added
- Live editor deployment on GitHub Pages at <https://adewale.github.io/beautiful-mermaid/editor>.
- Editor examples palette with presets for every supported diagram family: flowchart, state, architecture, sequence, class, ER, timeline, journey, and xychart.
- Semantic role-based SVG styling via `options.style.text`, `options.style.node`, `options.style.edge`, and `options.style.group`.
- Role-style showcase samples in the live gallery under **Contents → Role Styles**.
- Fork documentation describing differences from upstream in [`FORK_DIFFERENCES.md`](./FORK_DIFFERENCES.md).

### Changed
- SVG style customization is now role-based and diagram-family aware; removed flat render style aliases are intentionally ignored.
- Showcase and editor docs now point users to live examples and presets.
- Fork docs and deploy script now treat GitHub Pages as the fork-owned site and avoid the upstream-owned Craft/Cloudflare deployment target.
- Live editor now starts blank by default, uses salmon as the default theme, uses a larger grouped Examples palette, and includes Copy SVG alongside Save SVG/PNG export.
- Homepage deployment now builds the full sample gallery, defaults to salmon, and removes text that implied Craft affiliation.
- Editor example presets now preserve the currently selected theme instead of forcing Default or Solarized Light.
- Live editor now offers a persistent Examples sidebar and a blank-state “Load an example” CTA.

### Fixed
- TypeScript CI failures in journey style padding and optional node corner-radius resolution.

## Fork baseline before this changelog

This fork already included broader rendering parity work, additional diagram families, GitHub Pages publishing, fork audit notes, and lessons learned. See [`LESSONS_LEARNED.md`](./LESSONS_LEARNED.md) and git history for pre-changelog detail.
