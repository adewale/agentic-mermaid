/** Canonical, ordered inventory for the public AI catalog. Keep this small
 * contract separate from the rich catalog prose so build and tests can compare
 * exact identifier/type/path membership without copying another hand list. */
export const AI_CATALOG_RESOURCES = [
  { identifier: 'urn:air:agentic-mermaid.dev:mcp:agentic-mermaid', type: 'application/mcp-server-card+json', path: '/.well-known/mcp/server-card.json' },
  { identifier: 'urn:air:agentic-mermaid.dev:llms', type: 'text/markdown', path: '/llms.txt' },
  { identifier: 'urn:air:agentic-mermaid.dev:skill:diagram-workflow', type: 'application/ai-skill+md', path: '/skills/agentic-mermaid-diagram-workflow/SKILL.md' },
  { identifier: 'urn:air:agentic-mermaid.dev:capabilities', type: 'application/json', path: '/capabilities.json' },
  { identifier: 'urn:air:agentic-mermaid.dev:examples', type: 'application/json', path: '/examples/index.json' },
  { identifier: 'urn:air:agentic-mermaid.dev:start', type: 'text/markdown', path: '/start.md' },
  { identifier: 'urn:air:agentic-mermaid.dev:instructions', type: 'text/markdown', path: '/agent-instructions.md' },
  { identifier: 'urn:air:agentic-mermaid.dev:mcp:manifest', type: 'application/json', path: '/.well-known/mcp.json' },
  { identifier: 'urn:air:agentic-mermaid.dev:warnings', type: 'text/markdown', path: '/warning-codes.md' },
  { identifier: 'urn:air:agentic-mermaid.dev:style-schema', type: 'application/schema+json', path: '/schemas/style-spec.schema.json' },
] as const
