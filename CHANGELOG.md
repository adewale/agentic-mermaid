# Changelog

This changelog tracks user-facing changes in the `adewale/beautiful-mermaid` fork. Upstream-focused PR branches keep their own minimal histories.

## Unreleased

### Added
- Live editor deployment on GitHub Pages at <https://adewale.github.io/beautiful-mermaid/editor>.
- Editor examples menu with styled presets for flowchart, architecture, sequence, class, ER, timeline, journey, and xychart diagrams.
- Semantic role-based SVG styling via `options.style.text`, `options.style.node`, `options.style.edge`, and `options.style.group`.
- Role-style showcase samples in the live gallery under **Contents → Role Styles**.
- Fork documentation describing differences from upstream in [`FORK_DIFFERENCES.md`](./FORK_DIFFERENCES.md).

### Changed
- SVG style customization is now role-based and diagram-family aware; removed flat render style aliases are intentionally ignored.
- Showcase and editor docs now point users to live examples and presets.

### Fixed
- TypeScript CI failures in journey style padding and optional node corner-radius resolution.

## Fork baseline before this changelog

This fork already included broader rendering parity work, additional diagram families, GitHub Pages publishing, fork audit notes, and lessons learned. See [`LESSONS_LEARNED.md`](./LESSONS_LEARNED.md) and git history for pre-changelog detail.
