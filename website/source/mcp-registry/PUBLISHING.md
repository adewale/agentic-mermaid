# Agentic Mermaid MCP Registry publication

The root [`server.json`](../../../server.json) is the only canonical official
MCP Registry manifest for Agentic Mermaid. Its
`io.github.adewale/agentic-mermaid` identity covers both the npm package and
the hosted `https://agentic-mermaid.dev/mcp` endpoint.

The release workflow validates and publishes that exact manifest after the npm
artifact has passed canonical CI. It also performs an exact name/version
preflight so retries recover only when the Registry already contains identical
immutable metadata.

Do not recreate or publish the retired `dev.agentic-mermaid/mcp` manifest.
That second identity described the same hosted endpoint and would create a
duplicate official listing with an independent version authority.

## Secondary directories

The current registration copy, support contact, review prompts, and directory
status live in
[`docs/MCP-DIRECTORY-LISTINGS.md`](../../../docs/MCP-DIRECTORY-LISTINGS.md).
Keep that record synchronized with the root manifest and production endpoint.

- **PulseMCP** — allow its official Registry ingestion window, then use
  <hello@pulsemcp.com> only for corrections or expedited review.
- **Glama** — submit the GitHub repository through
  <https://glama.ai/mcp/servers/add> and use its ownership-claim flow after the
  listing appears.
- **Smithery** — submit `https://agentic-mermaid.dev/mcp` through
  <https://smithery.ai/new>. Its scanner can use
  `https://agentic-mermaid.dev/.well-known/mcp/server-card.json` as the
  pre-connection metadata source.
