# Agentic Mermaid documentation

This directory holds the long-form documentation. The root README is intentionally short and routes readers here.

## User docs

| Doc | Purpose |
|---|---|
| [`getting-started.md`](./getting-started.md) | Plain library use: render a Mermaid string to SVG/PNG/ASCII in 5 minutes. |
| [`api.md`](./api.md) | Library, agent API, output functions, options, CLI/MCP pointers. |
| [`diagram-families.md`](./diagram-families.md) | Supported Mermaid families, examples, and edit policy. |
| [`theming.md`](./theming.md) | Two-color themes, built-in themes, custom themes, Shiki import. |
| [`react.md`](./react.md) | Zero-flash React rendering with CSS variables. |
| [`ascii.md`](./ascii.md) | Terminal output, ASCII vs Unicode, color modes, XY charts. |
| [`config.md`](./config.md) | `mermaidConfig`, YAML frontmatter, and init directives. |
| [`features.md`](./features.md) | Capability inventory. |
| [`quality.md`](./quality.md) | Determinism, quality metrics, and visual-review guidance. |
| [`testing-strategy.md`](./testing-strategy.md) | What we test, how, and why: oracle types, the proof-gate map, and honest gaps. |
| [`fork-differences.md`](./fork-differences.md) | How Agentic Mermaid differs from upstream Beautiful Mermaid. |
| [`comparison.md`](./comparison.md) | Functionality differences between Mermaid, Beautiful Mermaid, and Agentic Mermaid — and when to use each. |

## Agent docs

| Doc | Purpose |
|---|---|
| [`../Instructions_for_agents.md`](../Instructions_for_agents.md) | Canonical short guide; byte-identical to `am --agent-instructions`. |
| [`../AGENT_NATIVE.md`](../AGENT_NATIVE.md) | Architecture/spec rationale for the agent-native surface. |
| [`agent-api-cookbook.md`](./agent-api-cookbook.md) | Copy-pasteable library/CLI/MCP recipes. |
| [`agent-mutation-policy.md`](./agent-mutation-policy.md) | Structured-vs-source-level edit policy. |
| [`mcp-code-mode-rationale.md`](./mcp-code-mode-rationale.md) | Why MCP is Code Mode first. |
| [`mcp-http-transport.md`](./mcp-http-transport.md) | HTTP/SSE MCP quickstart, artifact outputs, options, and security defaults. |
| [`agent-workflow-examples.md`](./agent-workflow-examples.md) | Runnable MCP/CLI and improvement-loop examples. |
| [`../skills/`](../skills/) | Agent-agnostic skill bundles. |
| [`../evals/`](../evals/) | Skill eval manifest, fixtures, and benchmark instructions. |

## Contributor / project docs

The design docs split into two tiers — **system** (how the engine works, cross-cutting) and
**per-family** (how one diagram type works). See
[`project/doc-reorg-plan.md`](./project/doc-reorg-plan.md) for the migration that physically
co-locates them.

### System design — how the engine works

| Doc | Purpose |
|---|---|
| [`design/system/`](./design/system/README.md) | **Start here.** Rendered three-stacks architecture overview (dogfooded, drift-proof) routing to the audit and design docs. |
| [`design/system/abstraction-audit.md`](./design/system/abstraction-audit.md) | Whole-system abstraction audit: the three-stacks model and ranked issue list I1–I9. |
| [`design/system/abstraction-recommendations.md`](./design/system/abstraction-recommendations.md) | Literature-grounded recommendations for I1–I9, with a prioritized roadmap. |
| [`design/system/route-contracts.md`](./design/system/route-contracts.md) | Route contracts: edge classification, direct-lane proofs, certifying straightener (issue #25). |
| [`design/system/layout-rubric.md`](./design/system/layout-rubric.md) | Deterministic layout-quality rubric: metrics, CI gates, and property oracles. |
| [`design/system/source-preservation-ladder.md`](./design/system/source-preservation-ladder.md) | The structured\|opaque family-adoption contract (levels L0–L4). |
| [`design/system/ugly-layouts.md`](./design/system/ugly-layouts.md) | Ugly-layout detector: catalogued failure shapes and heuristics. |
| [`design/system/issue-26-audit.md`](./design/system/issue-26-audit.md) | Flowchart principled-layout heuristics inventory and conformance review (issue #26). |
| [`design/system/issue-26-38-closure.md`](./design/system/issue-26-38-closure.md) | Principled-layout closure-decision ledger (issues #26/#38). |

### Per-family design notes

| Doc | Purpose |
|---|---|
| [`design/families/`](./design/families/README.md) | Per-family hub: which families have a design note, and where each family's other surfaces live. |
| [`design/families/architecture-beta.md`](./design/families/architecture-beta.md) | `architecture-beta` diagram-type implementation notes. |
| [`design/families/gantt.md`](./design/families/gantt.md) | Gantt support specification and compatibility boundaries. |
| [`design/families/gantt-research.md`](./design/families/gantt-research.md) | Gantt literature review and commercial UX survey. |
| [`design/families/journey.md`](./design/families/journey.md) | Journey diagram implementation notes. |
| [`design/families/xychart.md`](./design/families/xychart.md) | XY chart implementation notes. |
| [`design/families/flowchart-parser-conformance.md`](./design/families/flowchart-parser-conformance.md) | Flowchart syntax conformance catalogue and unsupported-syntax warning policy (issue #36). |

> All per-family notes now live in `design/families/` and all cross-cutting notes in `design/system/`
> (the [doc-reorg plan](./project/doc-reorg-plan.md) Phase 1 migration is complete).

### Project & process

| Doc | Purpose |
|---|---|
| [`contributing/adding-diagram-types.md`](./contributing/adding-diagram-types.md) | How to add a Mermaid-supported diagram family. |
| [`contributing/visual-review-evidence.md`](./contributing/visual-review-evidence.md) | Which reproducible visual artifacts are required for layout/rendering changes. |
| [`contributing/diagram-family-citizenship.md`](./contributing/diagram-family-citizenship.md) | Enforced good-citizen checklist and matrix for family/surface drift (issue #41). |
| [`contributing/harvesting-upstream-tests.md`](./contributing/harvesting-upstream-tests.md) | How to vendor upstream/fork test suites into an executable compatibility bench. |
| [`layout-characterization/README.md`](./layout-characterization/README.md) | Layout and visual testing approach: properties, contact sheets, raster contracts, and approval artifacts. |
| [`project/design.md`](./project/design.md) | Historical/design notes (editor UI design system). |
| [`project/divergences.md`](./project/divergences.md) | Deliberate divergences and guardrails. |
| [`project/product.md`](./project/product.md) | Product brief. |
| [`project/lessons-learned.md`](./project/lessons-learned.md) | Implementation lessons. |
| [`project/doc-reorg-plan.md`](./project/doc-reorg-plan.md) | Plan to separate per-family from system docs (this reorg). |
| [`project/dogfooding-docs-strategy.md`](./project/dogfooding-docs-strategy.md) | How we render and pin our own docs with our own tools. |
| [`issue-derived-test-cases.md`](./issue-derived-test-cases.md) | Issue-derived regression coverage map. |
| [`mermaid-layout-complaints.md`](./mermaid-layout-complaints.md) | Mermaid layout complaint catalog, root causes, and coverage scorecard. |
| [`pr11-reviewer-guide.md`](./pr11-reviewer-guide.md) | Historical PR #11 reviewer map. |

## Root docs kept intentionally

- [`../README.md`](../README.md) — landing page and quick starts.
- [`../CHANGELOG.md`](../CHANGELOG.md) — release notes.
- [`../SECURITY.md`](../SECURITY.md) — conventional security entrypoint.
- [`../TODO.md`](../TODO.md) — only active backlog with unchecked boxes.
- [`../Instructions_for_agents.md`](../Instructions_for_agents.md) — canonical agent guide emitted by CLI.
- [`../AGENT_NATIVE.md`](../AGENT_NATIVE.md) — agent-native architecture/spec entrypoint.
