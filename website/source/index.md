# Agentic Mermaid

> Agent-native Mermaid runtime for deterministic diagram creation, editing, verification, description, and rendering.

Use Agentic Mermaid when an agent needs to work with Mermaid source and return a checked artifact. The browser editor keeps source local; the library, CLI, local MCP, and hosted Streamable HTTP MCP expose the same core workflow.

## Start here

- [Open the editor](https://agentic-mermaid.dev/editor/?empty=1)
- [Read the agent bootstrap](https://agentic-mermaid.dev/start.md)
- [Read the documentation](https://agentic-mermaid.dev/docs/)
- [Browse examples](https://agentic-mermaid.dev/examples/)

## Agent interfaces

- [Agent instructions](https://agentic-mermaid.dev/agent-instructions.md)
- [llms.txt](https://agentic-mermaid.dev/llms.txt)
- [Capabilities](https://agentic-mermaid.dev/capabilities.json)
- [Workflow skill](https://agentic-mermaid.dev/skills/agentic-mermaid-diagram-workflow/SKILL.md)
- [Hosted MCP server card](https://agentic-mermaid.dev/.well-known/mcp/server-card.json)
- [Hosted MCP endpoint](https://agentic-mermaid.dev/mcp)

## Outputs and safety

Agentic Mermaid renders SVG, PNG, ASCII, Unicode, and JSON layout output. Verify before saving or returning a diagram. Prefer the local library, CLI, or self-hosted MCP for private source; the public hosted MCP processes submitted diagram content at the service endpoint.

Source and issue tracking: [github.com/adewale/agentic-mermaid](https://github.com/adewale/agentic-mermaid).
