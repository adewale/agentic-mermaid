# Changelog

This changelog tracks user-facing changes in the `adewale/beautiful-mermaid` fork. Upstream-focused PR branches keep their own minimal histories.

## Unreleased

### Added
- **Agent-native surface** (`beautiful-mermaid/agent` subpath export): a typed editing API for agents and tools.
  - `parseMermaid` → sealed `ValidDiagram` IR carrying frontmatter, init directives, comments, accessibility, and the canonical source.
  - `verifyMermaid` → structured `LayoutWarning` codes in two tiers (Tier 1 structural/reliable, Tier 2 geometric/advisory). No vision/PNG needed.
  - `mutate` → typed, family-narrowed structural edits for flowchart/state, simple sequence, timeline, class, and ER diagrams. Journey, xychart, architecture, and diagrams with unmodeled constructs use a lossless source-level/opaque body with no structured mutation exposed.
  - `serializeMermaid` / `synthesizeFromGraph` → round-trip back to canonical Mermaid source.
  - Deterministic layout JSON, verified byte-identical across processes (ELK is configured for model-order layout; there is no seed).
- **`am` CLI**: `render`, `preview` (strict standalone HTML + optional `--open`), `verify`, `parse`, `serialize`, `mutate` (single `--op` or batched `--ops`, verify-before-emit), `format`, `describe`, `capabilities`, `batch` (including mutate), `render-markdown`, `llms-txt`, `--json`, per-command `--help`, and `--agent-instructions`.
- **`agentic-mermaid-mcp`**: a Code Mode MCP server (one JavaScript `execute` tool, `node:vm` sandbox, typed SDK declaration) so agents compose the whole verify-after-mutate loop in one round-trip.
- **`Instructions_for_agents.md`** and a Claude Code skill bundle at `.claude/skills/agentic-mermaid/`.
- See [`AGENT_NATIVE.md`](./AGENT_NATIVE.md) for the design and [`examples/agent-loop.ts`](./examples/agent-loop.ts) for a runnable walkthrough.
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
- Agent-facing Code Mode examples are executable JavaScript snippets and the stored eval now checks ordered verify inspection before serialization.
- Journey and xychart are kept source-level-only in the agent surface; no `mermaid-ast` dependency or structured mutation path is exposed.
- Agent guidance now distinguishes new-diagram source authoring from existing-diagram structured mutation; Code Mode is positioned as a structured-edit channel rather than mandatory diagram creation.

### Fixed
- TypeScript CI failures in journey style padding and optional node corner-radius resolution.
- Editor export actions are disabled until a diagram exists and parser errors now include recovery-oriented copy.
- Editor menus, sidebar, and theme controls now close with Escape and expose stronger ARIA/focus states.
- Removed layout-property sidebar animation in favor of opacity/transform-based motion.
- CLI/docs drift for `am describe`: the command now emits prose or AX-tree JSON and is covered by e2e tests.
- Feedback-loop flowcharts now preserve the primary source order more reliably instead of ranking decision nodes before their predecessors.

## Fork baseline before this changelog

This fork already included broader rendering parity work, additional diagram families, GitHub Pages publishing, fork audit notes, and lessons learned. See [`LESSONS_LEARNED.md`](./LESSONS_LEARNED.md) and git history for pre-changelog detail.
