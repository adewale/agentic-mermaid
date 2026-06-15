# Agentic Mermaid documentation

This directory holds the long-form documentation. The root README is intentionally short and routes readers here.

## User docs

| Doc | Purpose |
|---|---|
| [`api.md`](./api.md) | Library, agent API, output functions, options, CLI/MCP pointers. |
| [`diagram-families.md`](./diagram-families.md) | Supported Mermaid families, examples, and edit policy. |
| [`theming.md`](./theming.md) | Two-color themes, built-in themes, custom themes, Shiki import. |
| [`react.md`](./react.md) | Zero-flash React rendering with CSS variables. |
| [`ascii.md`](./ascii.md) | Terminal output, ASCII vs Unicode, color modes, XY charts. |
| [`config.md`](./config.md) | `mermaidConfig`, YAML frontmatter, and init directives. |
| [`features.md`](./features.md) | Capability inventory. |
| [`quality.md`](./quality.md) | Determinism, quality metrics, and visual-review guidance. |
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

## Contributor/project docs

| Doc | Purpose |
|---|---|
| [`contributing/adding-diagram-types.md`](./contributing/adding-diagram-types.md) | How to add a Mermaid-supported diagram family. |
| [`design/architecture.md`](./design/architecture.md) | Architecture diagram implementation notes. |
| [`design/journey.md`](./design/journey.md) | Journey diagram implementation notes. |
| [`design/route-contracts.md`](./design/route-contracts.md) | Route contracts: edge classification, direct-lane proofs, certifying straightener (issue #25). |
| [`design/xychart.md`](./design/xychart.md) | XY chart implementation notes. |
| [`project/design.md`](./project/design.md) | Historical/design notes. |
| [`project/divergences.md`](./project/divergences.md) | Deliberate divergences and guardrails. |
| [`project/product.md`](./project/product.md) | Product brief. |
| [`project/lessons-learned.md`](./project/lessons-learned.md) | Implementation lessons. |
| [`issue-derived-test-cases.md`](./issue-derived-test-cases.md) | Issue-derived regression coverage map. |
| [`pr11-reviewer-guide.md`](./pr11-reviewer-guide.md) | Historical PR #11 reviewer map. |

## Root docs kept intentionally

- [`../README.md`](../README.md) — landing page and quick starts.
- [`../CHANGELOG.md`](../CHANGELOG.md) — release notes.
- [`../SECURITY.md`](../SECURITY.md) — conventional security entrypoint.
- [`../TODO.md`](../TODO.md) — only active backlog with unchecked boxes.
- [`../Instructions_for_agents.md`](../Instructions_for_agents.md) — canonical agent guide emitted by CLI.
- [`../AGENT_NATIVE.md`](../AGENT_NATIVE.md) — agent-native architecture/spec entrypoint.
