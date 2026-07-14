# Agentic Mermaid documentation

This directory holds the long-form documentation. The root README is intentionally short and routes readers here.

## User docs

| Doc | Purpose |
|---|---|
| [`getting-started.md`](./getting-started.md) | Plain library use: render a Mermaid string to SVG/PNG/ASCII in 5 minutes. |
| [`api.md`](./api.md) | Library, agent API, output functions, options, CLI/MCP pointers. |
| [`diagram-families.md`](./diagram-families.md) | Supported Mermaid families, examples, and edit policy. |
| [`theming.md`](./theming.md) | Two-color themes, built-in themes, custom themes, Shiki import. |
| [`style-authoring.md`](./style-authoring.md) | Style model, stack semantics, field reference, rubric, and validation commands. |
| [`custom-style-cookbook.md`](./custom-style-cookbook.md) | Complete custom style JSON files, screenshots, schema usage, CLI commands, and the documentation-only Cupertino prototype. |
| [`custom-fonts.md`](./custom-fonts.md) | How custom Styles select and resolve fonts across SVG, PNG, browser, and MCP surfaces. |
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
| [`code-mode-impact.md`](./code-mode-impact.md) | Measured client/server impact, comparison with Cloudflare and Anthropic, and operational costs. |
| [`mcp-http-transport.md`](./mcp-http-transport.md) | Local HTTP/SSE MCP quickstart plus hosted `/mcp` call-shape notes. |
| [`agent-workflow-examples.md`](./agent-workflow-examples.md) | Runnable MCP/CLI and improvement-loop examples. |
| [`../skills/`](../skills/) | Agent-agnostic skill bundles. |
| [`../skill-evals/`](../skill-evals/) | Skill eval manifest, fixtures, and benchmark instructions. |

## Contributor / project docs

The design docs split into two tiers — **system** (how the engine works, cross-cutting) and
**per-family** (how one diagram type works).

### System design — how the engine works

| Doc | Purpose |
|---|---|
| [`project/brand-primitives-plan.md`](./project/brand-primitives-plan.md) | Normative appearance/family-contract decision and A/B dependency/acceptance plan; live status is owned by root `TODO.md`. |
| [`design/system/`](./design/system/README.md) | **Start here.** Current resolved-request, family-descriptor, positioned-artifact, and output-security architecture overview (dogfooded, drift-proof). |
| [`design/system/route-contracts.md`](./design/system/route-contracts.md) | Route contracts: edge classification, direct-lane proofs, certifying straightener (issue #25). |
| [`design/system/layout-rubric.md`](./design/system/layout-rubric.md) | Deterministic layout-quality rubric: metrics, CI gates, and property oracles. |
| [`design/system/source-preservation-ladder.md`](./design/system/source-preservation-ladder.md) | The structured\|opaque family-adoption contract (levels L0–L4). |
| [`design/mermaid-family-fidelity-audit.md`](./design/mermaid-family-fidelity-audit.md) | Mermaid 11.16 syntax accounting and Mermaid/Wikipedia visual-metaphor audit for every registered family. |
| [`design/style-palette-compatibility.md`](./design/style-palette-compatibility.md) | Registry-derived exhaustive Look × Palette × family compatibility receipt. |
| [`design/system/ugly-layouts.md`](./design/system/ugly-layouts.md) | Ugly-layout detector: catalogued failure shapes and heuristics. |

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

> All per-family notes live in `design/families/` and all cross-cutting notes in `design/system/`.

### Project & process

| Doc | Purpose |
|---|---|
| [`contributing/adding-diagram-types.md`](./contributing/adding-diagram-types.md) | How to add a Mermaid-supported diagram family. |
| [`contributing/visual-review-evidence.md`](./contributing/visual-review-evidence.md) | Which reproducible visual artifacts are required for layout/rendering changes. |
| [`contributing/diagram-family-citizenship.md`](./contributing/diagram-family-citizenship.md) | Enforced good-citizen checklist and matrix for family/surface drift (issue #41). |
| [`contributing/harvesting-upstream-tests.md`](./contributing/harvesting-upstream-tests.md) | How to vendor upstream/fork test suites into an executable compatibility bench. |
| [`contributing/releasing.md`](./contributing/releasing.md) | How to cut an npm release (GitHub Release → provenance publish) and flip the "published" copy. |
| [`layout-characterization/README.md`](./layout-characterization/README.md) | Layout and visual testing approach: properties, contact sheets, raster contracts, and approval artifacts. |
| [`svg-semantic-contract.md`](./svg-semantic-contract.md) | Typed Scene identity, geometry, references, and accessibility contract. |
| [`mutation-testing.md`](./mutation-testing.md) | Mutation lanes, survivor handling, and adequacy evidence. |
| [`project/divergences.md`](./project/divergences.md) | Deliberate divergences and guardrails. |
| [`project/lessons-learned.md`](./project/lessons-learned.md) | Evergreen engineering lessons distilled from the archived fork narrative. |
| [`project/agent-interface-contract-audit-2026-07.md`](./project/agent-interface-contract-audit-2026-07.md) | PR #162 defect provenance, review of PRs #157/#160, testing root causes, and recurrence controls. |
| [`contributing/lessons-learned.md`](./contributing/lessons-learned.md) | Dated contributor process lessons (newest first). |
| [`project/dogfooding-docs-strategy.md`](./project/dogfooding-docs-strategy.md) | How we render and pin our own docs with our own tools. |
| [`project/archive/`](./project/archive/) | Status-marked landing/completion evidence and frozen historical records; never live backlog authority. |
| [`issue-derived-test-cases.md`](./issue-derived-test-cases.md) | Issue-derived regression coverage map. |
| [`mermaid-layout-complaints.md`](./mermaid-layout-complaints.md) | Mermaid layout complaint catalog, root causes, and coverage scorecard. |

## Root docs kept intentionally

- [`../README.md`](../README.md) — landing page and quick starts.
- [`../CHANGELOG.md`](../CHANGELOG.md) — release notes.
- [`../SECURITY.md`](../SECURITY.md) — conventional security entrypoint.
- [`../TODO.md`](../TODO.md) — only active backlog with unchecked boxes.
- [`../Instructions_for_agents.md`](../Instructions_for_agents.md) — canonical agent guide emitted by CLI.
- [`../AGENT_NATIVE.md`](../AGENT_NATIVE.md) — agent-native architecture/spec entrypoint.
- [`../PRODUCT.md`](../PRODUCT.md) — canonical product brief (brand register).
- [`../DESIGN.md`](../DESIGN.md) — canonical website design system.
