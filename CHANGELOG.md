# Changelog

This changelog tracks user-facing changes for **Agentic Mermaid**, a fork of `lukilabs/beautiful-mermaid` maintained in the `adewale/beautiful-mermaid` repo and published as the `agentic-mermaid` npm package. Upstream-focused PR branches keep their own minimal histories.

## Unreleased

### Added
- **XY chart structured mutation** (BUILD-16, following the BUILD-15 journey and BUILD-17 architecture pilots): the modeled subset of `xychart-beta` (bare title, named/categorical/range x-axis, named/range y-axis, and `bar`/`line` series with optional names and finite values) now parses to a typed `XyChartBody`, narrows via `asXyChart`, and exposes 8 mutation ops (`set_title`, `set_x_axis`, `set_y_axis`, `add_series`, `remove_series`, `set_series_values`, `set_series_name`, `reorder_series`) across the library, CLI (`am mutate`), and MCP Code Mode SDK. Canonical number format is `String(n)` (finite values only), proven to re-parse identically under the legacy renderer's `parseXYChart`. Unmodeled syntax (quoted text, multi-statement `;` lines, accTitle/accDescr, the `horizontal`-only/other header suffixes beyond orientation, `curve basis`) still falls back to a lossless opaque body. Adds the `SERIES_NOT_FOUND` mutation-error code.
- **Architecture structured mutation** (BUILD-17, following the BUILD-15 journey pilot): the modeled subset of `architecture-beta` (groups/services/junctions and anchored `id:SIDE arrow SIDE:id` edges) now parses to a typed `ArchitectureBody`, narrows via `asArchitecture`, and exposes 10 mutation ops (`add_service`, `remove_service`, `rename_service`, `set_service_label`, `set_service_icon`, `move_service`, `add_group`, `remove_group`, `add_edge`, `remove_edge`) across the library, CLI (`am mutate`), and MCP Code Mode SDK. `remove_service` cascades its edges; `rename_service` keeps edges anchored; `remove_group` refuses a non-empty group. Unmodeled syntax (the `{group}` boundary modifier, accTitle/accDescr, header suffixes) still falls back to a lossless opaque body.
- **Journey structured mutation** (BUILD-15, the pilot promotion of a source-level family): simple journeys (title/sections/`task: score: actors`) now parse to a typed `JourneyBody`, narrow via `asJourney`, and expose 10 mutation ops (`set_title`, `add_section`, `remove_section`, `set_section_label`, `add_task`, `remove_task`, `set_task_text`, `set_task_score`, `set_task_actors`, `rename_actor`) across the library, CLI (`am mutate`), and MCP Code Mode SDK. Unmodeled journey syntax (accTitle/accDescr, out-of-range scores, header suffixes) still falls back to a lossless opaque body.
- Family-plugin dispatch consolidation (BUILD-3): parse, serialize, and mutate for ALL families — including flowchart/state — now route through the `FamilyPlugin` registry; adding a structured family is one body module plus one registration. Flowchart and state register as two plugins sharing one implementation over the legacy graph body, with the serialized header bound per kind; dispatch is by diagram kind, the plugin contract gained `canonicalSource`/multi-error parse and an optional `buildSourceMap` hook. Mutation now rebuilds `canonicalSource` uniformly, so mutated sequence/flowchart/state diagrams no longer carry stale source.
- **Pie chart family** (`pie`): renders Mermaid pie charts to SVG/PNG/ASCII. Supports the `pie` header with optional `showData` and `title`, plus `"label" : value` entries (positive numbers). SVG draws clockwise slices with a theme-derived palette and a percentage legend; ASCII draws a proportional bar list. Pie is source-level (parse/render/verify/round-trip; no typed mutation). Malformed entries error loudly rather than being silently dropped. Adds the first slice of BUILD-5; see `eval/family-usage/` for the family-usage evidence step.
- Layout before/after comparison harness (`eval/layout-compare/run.ts`): snapshots the docs corpus + targeted fixtures (SVG, ASCII, perceptual metrics) per git state and emits a side-by-side HTML report with metric deltas and a regression exit code. Geometry tests now also pin subgraph `direction` support — honored even when an inner node links outward, which Mermaid itself does not solve (mermaid-js#2509).
- **Breaking package identity**: first Agentic Mermaid release is prepared as `agentic-mermaid@0.1.0`; package imports are now `agentic-mermaid` and `agentic-mermaid/agent` while the GitHub repo remains `adewale/beautiful-mermaid`.
- **Agent-native surface** (`agentic-mermaid/agent` subpath export): a typed editing API for agents and tools.
  - `parseMermaid` → sealed `ValidDiagram` IR carrying frontmatter, init directives, comments, accessibility, and the canonical source.
  - `verifyMermaid` → structured `LayoutWarning` codes in three tiers (Tier 1 structural/reliable, Tier 2 geometric/advisory, Tier 3 lint/advisory). No vision/PNG needed.
  - `mutate` → typed, family-narrowed structural edits for flowchart/state, simple sequence, timeline, class, ER, journey, and architecture diagrams. Xychart and diagrams with unmodeled constructs use a lossless source-level/opaque body with no structured mutation exposed.
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
- Agent-usage evals now include a committed failure corpus of captured bad-agent paths and curated executable regressions for markdown-only answers, regenerated Mermaid, CLI advice, serialize-without-verify, ignored verify results, and opaque mutation attempts.
- `agentic-mermaid-mcp` now supports HTTP/SSE transport (`--transport http`) in addition to stdio, with managed PNG file/URL artifacts for clients that should not receive large base64 payloads.

### Fixed
- ASCII renderer: an edge whose endpoint is a subgraph id (e.g. `Start --> Pipeline` where `Pipeline` is a subgraph) no longer renders a phantom duplicate node box. The edge now attaches to the subgraph container — the visible terminal is clipped to the container's border with the arrowhead drawn on the border — matching the SVG/ELK hierarchical-port behavior and Mermaid's handling of the #2509 case. Edge semantics are preserved (no rerouting to an arbitrary inner member node).
- ASCII box-start connectors (`├ ┤ ┬ ┴`) now sit flush on the source node's border instead of floating in whitespace when a sibling edge's label widens the grid column (upstream lukilabs#112 class); the gap is filled with style-matching line characters.
- ASCII fan-in layouts: roots feeding the same target are grouped contiguously and each fan-in target aligns under its own root group (upstream lukilabs#69), so trunk rows of different groups no longer collide into ambiguous `┼` crossings. Self-loops and 2-cycle toggles are excluded so state-machine layouts are unaffected.
- ER cardinality tokens now match Mermaid's lexer on both sides (`||`, `|o`, `o|`, `}o`, `o{`, `}|`, `|{`): left-side `}o` (used by the mermaid-docs corpus as `}o..o{`) previously failed the sort-based normalization and the whole relationship — including its entities — was silently dropped, rendering an empty diagram. Non-Mermaid forms (`{o`, `o}`, `|}`, `{|`) now raise a clear parse error instead of rendering. The render-path parser and the agent ER body parser now agree.
- Showcase and editor theme switching no longer flashes the previous theme's diagram background (white, when leaving a light theme): existing SVG CSS variables are patched instantly, switching back to Default restores each sample's captured original style, and rapid theme switches can no longer interleave stale re-renders.
- TypeScript CI failures in journey style padding and optional node corner-radius resolution.
- Editor export actions are disabled until a diagram exists and parser errors now include recovery-oriented copy.
- Editor menus, sidebar, and theme controls now close with Escape and expose stronger ARIA/focus states.
- Removed layout-property sidebar animation in favor of opacity/transform-based motion.
- CLI/docs drift for `am describe`: the command now emits prose or AX-tree JSON and is covered by e2e tests.
- Feedback-loop flowcharts now preserve the primary source order more reliably instead of ranking decision nodes before their predecessors.
- Acyclic fan-in/fan-out flowcharts now use source-aware model ordering so declared-direction edges do not accidentally route backward; layout-quality heuristics cover direction progress, edge-vs-node collisions, self-loop clearance, and feedback-process cleanliness.
- Tier 3 lint warnings now flag `DUPLICATE_EDGE` and `UNREACHABLE_NODE` in flowchart/state verification without changing `verify.ok`.

## Fork baseline before this changelog

This fork already included broader rendering parity work, additional diagram families, GitHub Pages publishing, fork audit notes, and lessons learned. See [`docs/project/lessons-learned.md`](./docs/project/lessons-learned.md) and git history for pre-changelog detail.
