# MCP directory listings

This file is the canonical, copy-ready registration record for Agentic
Mermaid's hosted MCP server. Update it whenever the endpoint, tool surface,
version, support contact, or directory status changes.

The root [`server.json`](../server.json) is the single official MCP Registry
authority. It covers both the npm package and hosted endpoint; do not publish a
second domain-namespaced record for the same server.

## Canonical listing

| Field | Value |
|---|---|
| Name | Agentic Mermaid |
| Registry name | `io.github.adewale/agentic-mermaid` |
| Tagline | Render and safely edit Mermaid diagrams |
| Short description | Render, verify, describe, and safely edit Mermaid diagrams through MCP. |
| Endpoint | `https://agentic-mermaid.dev/mcp` |
| Transport | Streamable HTTP |
| Authentication | None |
| Website | `https://agentic-mermaid.dev/` |
| Repository | `https://github.com/adewale/agentic-mermaid` |
| Documentation | `https://agentic-mermaid.dev/docs/mcp/` |
| Privacy notice | `https://github.com/adewale/agentic-mermaid/blob/main/docs/MCP-PRIVACY.md` |
| Support | `adewale+mcp@gmail.com` |
| Icon | `https://agentic-mermaid.dev/favicon.svg` |
| Suggested categories | Design, Developer Tools, Productivity |

Long description:

> Agentic Mermaid gives agents a safe, structured way to create and work with
> Mermaid diagrams. Its hosted MCP server renders SVG, PNG, ASCII, and Unicode;
> verifies and describes diagrams; builds new diagrams; and applies typed,
> all-or-nothing edits that are verified before source is returned. Layout is
> deterministic, the public endpoint is stateless and unauthenticated, and a
> local CLI, library, and stdio MCP are available for sensitive or larger work.

## Review prompts

1. `Verify this diagram and report its detected family and warnings: flowchart TD\n  API --> DB`
2. `Render flowchart TD\n  Start --> Done as SVG.`
3. `Add a Failed node and an error edge from API to Failed, then return verified Mermaid source: flowchart TD\n  Client --> API\n  API --> DB`

Expected behavior: the first prompt uses `verify`, the second uses
`render_svg`, and the third uses `mutate` after discovering the flowchart
operation schema when necessary. The server must not claim semantic correctness
from `verify.ok` alone.

## Directory record

| Directory | Registration input | Recorded status on 2026-07-30 |
|---|---|---|
| Official MCP Registry | Root [`server.json`](../server.json) | Active at version `0.4.0` |
| OpenAI Plugins | Endpoint plus canonical fields above | Account-gated submission; tool titles and privacy notice captured in this repository |
| Claude Connectors Directory | Endpoint plus canonical fields above | Account-gated Team/Enterprise submission; tool titles and privacy notice captured in this repository |
| Cursor Directory | Repository and endpoint | Not found in directory; account-gated submission remains |
| MCPServers.org | Name, short description, repository, category `Design`, support email | Submitted on 2026-07-30; review pending |
| PulseMCP | Official Registry ingestion | Listed as Agentic Mermaid |
| Smithery | Endpoint | Not found; account-gated submission remains |
| Glama | Repository or Official Registry entry | Listed and healthy; ownership claim remains optional |

## Publication checks

- `tools/list` exposes a non-empty human-readable `title` and accurate safety
  annotations for every tool.
- The hosted endpoint returns a successful MCP initialization and tool list.
- The privacy and support links are public.
- The root Registry manifest version matches the released package and hosted
  server.
- Any directory-specific test prompts are run against the production endpoint
  before publication.
