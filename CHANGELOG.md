# Changelog

This changelog tracks user-facing changes for **Agentic Mermaid**, a fork of `lukilabs/beautiful-mermaid` maintained in the `adewale/beautiful-mermaid` repo and published as the `agentic-mermaid` npm package. Upstream-focused PR branches keep their own minimal histories.

## Unreleased

### Added
- **Breaking package identity**: first Agentic Mermaid release is prepared as `agentic-mermaid@0.1.0`; package imports are now `agentic-mermaid` and `agentic-mermaid/agent` while the GitHub repo remains `adewale/beautiful-mermaid`.
- **Agent-native surface** (`agentic-mermaid/agent` subpath export): a typed editing API for agents and tools.
  - `parseMermaid` → sealed `ValidDiagram` IR carrying frontmatter, init directives, comments, accessibility, and the canonical source.
  - `verifyMermaid` → structured `LayoutWarning` codes in two tiers (Tier 1 structural/reliable, Tier 2 geometric/advisory). No vision/PNG needed.
  - `mutate` → typed, family-narrowed structural edits for flowchart/state, simple sequence, timeline, class, and ER diagrams. Journey, xychart, architecture, and diagrams with unmodeled constructs use a lossless source-level/opaque body with no structured mutation exposed.
  - `serializeMermaid` / `synthesizeFromGraph` → round-trip back to canonical Mermaid source.
  - Deterministic layout JSON, verified byte-identical across processes (ELK is configured for model-order layout; there is no seed).
- **`am` CLI**: `render`, `preview` (strict standalone HTML + optional `--open`), `verify`, `parse`, `serialize`, `mutate` (single `--op` or batched `--ops`, verify-before-emit), `format`, `describe`, `capabilities`, `batch` (including mutate), `render-markdown`, `llms-txt`, `init-agent`, `--json`, per-command `--help`, and `--agent-instructions`.
- **Node-runnable package bins**: `am`, `agentic-mermaid`, and `agentic-mermaid-mcp` point to built `dist/*.js` entrypoints for npm/npx consumers while Bun `bin/*.ts` files remain for local development.
- **Hosted agent manifests**: GitHub Pages publishes `/llms.txt` and `/agent-instructions.md` for zero-install agent onboarding.
- **Publish hardening**: package metadata and release workflow support public npm provenance (`publishConfig.provenance`, GitHub OIDC `id-token`, build-before-publish, and `npm publish --provenance`).
- **`agentic-mermaid-mcp`**: a Code Mode MCP server (one JavaScript `execute` tool, `node:vm` sandbox, typed SDK declaration) so agents compose the whole verify-before-commit loop in one round-trip.
- **`Instructions_for_agents.md`** and agent-agnostic skill bundles under `skills/`.
- See [`AGENT_NATIVE.md`](./AGENT_NATIVE.md) for the design, [`examples/agent-loop.ts`](./examples/agent-loop.ts) for a runnable walkthrough, [`examples/mcp-vs-cli-complex-diagrams.ts`](./examples/mcp-vs-cli-complex-diagrams.ts) for MCP-vs-CLI parity, and [`examples/agent-improve-auth-flow.ts`](./examples/agent-improve-auth-flow.ts) for create → assess → mutate → reassess → render.
- Live editor deployment on GitHub Pages at <https://adewale.github.io/beautiful-mermaid/editor>.
- Editor examples palette with presets for every supported diagram family: flowchart, state, architecture, sequence, class, ER, timeline, journey, and xychart.
- Semantic role-based SVG styling via `options.style.text`, `options.style.node`, `options.style.edge`, and `options.style.group`.
- Role-style showcase samples in the live gallery under **Contents → Role Styles**.
- Fork documentation describing differences from upstream in [`docs/fork-differences.md`](./docs/fork-differences.md).
- Product/design context documents ([`docs/project/product.md`](./docs/project/product.md), [`docs/project/design.md`](./docs/project/design.md)) for future design-system aligned work.
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
- Journey and xychart are kept source-level-only in the agent surface; no structured mutation path is exposed even though parser/render dependencies may exist internally.
- Agent guidance now distinguishes new-diagram source authoring from existing-diagram structured mutation; Code Mode is positioned as a structured-edit channel rather than mandatory diagram creation.
- `am capabilities --json` now reports `families[].editPolicy` (`structured-when-narrowed` or `source-level-only`) in addition to `mutationOps`, so agents can route edits without trial-and-error.
- Quality docs now explicitly state that Agentic Mermaid is not Mermaid visual parity: `verify.ok` is structural, while layout quality needs metrics, geometry assertions, screenshots, or rendered artifacts.

### Fixed
- TypeScript CI failures in journey style padding and optional node corner-radius resolution.
- Editor export actions are disabled until a diagram exists and parser errors now include recovery-oriented copy.
- Editor menus, sidebar, and theme controls now close with Escape and expose stronger ARIA/focus states.
- Removed layout-property sidebar animation in favor of opacity/transform-based motion.
- CLI/docs drift for `am describe`: the command now emits prose or AX-tree JSON and is covered by e2e tests.
- Feedback-loop flowcharts now preserve the primary source order more reliably instead of ranking decision nodes before their predecessors.
- Acyclic fan-in/fan-out flowcharts now use source-aware model ordering so declared-direction edges do not accidentally route backward; layout-quality heuristics cover direction progress, edge-vs-node collisions, self-loop clearance, and feedback-process cleanliness.

## Fork baseline before this changelog

This fork already included broader rendering parity work, additional diagram families, GitHub Pages publishing, fork audit notes, and lessons learned. See [`docs/project/lessons-learned.md`](./docs/project/lessons-learned.md) and git history for pre-changelog detail.
