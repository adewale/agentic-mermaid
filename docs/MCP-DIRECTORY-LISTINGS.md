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

Last audited **2026-10-16** against the eight destinations in the
[original checklist](https://x.com/soraiadev/status/2082500548134056063).
“Listed” requires a public entry; submission and account ownership are separate
states. Search-index evidence is labelled below because it cannot establish
live endpoint health. A failed lookup does not establish that a listing is absent.

| Directory / evidence | Status and date | Next action |
|---|---|---|
| [Official MCP Registry: immutable `0.4.1` record](https://registry.modelcontextprotocol.io/v0.1/servers/io.github.adewale%2Fagentic-mermaid/versions/0.4.1) | **Active, latest**, confirmed from the live API on 2026-10-16. Published 2026-07-31 by [release run](https://github.com/adewale/agentic-mermaid/actions/runs/30626742621). | Keep root [`server.json`](../server.json) as the only publication authority. |
| [OpenAI Plugins](https://platform.openai.com/plugins) | **Desired; no submission receipt recorded.** Current [submission instructions](https://developers.openai.com/plugins/deploy/submission) checked 2026-10-16. | Prepare the required package and review materials below, then complete the verified developer/account flow. |
| [Claude directory](https://claude.com/resources/articles/build-plugins-for-claude) | **Desired; no submission receipt recorded.** New portal announced 2026-09-25; accepts a single remote connector or a plugin bundle from developers on paid Claude plans. The old Team/Enterprise-only note is obsolete. | Submit the hosted URL through the portal linked from the announcement; optionally bundle the existing diagram-workflow skill. |
| [Cursor Directory](https://cursor.directory/) | **Desired; current listing unconfirmed.** On 2026-10-16 the former `/mcp` route redirects to a plugin directory. The July search found no listing. | Search the current catalog while signed in and use its current plugin submission flow; record its receipt. |
| [MCPServers.org listing](https://mcpservers.org/servers/adewale/agentic-mermaid) | **Listed in the public search index**, checked 2026-10-16. The 2026-07-30 submission is no longer merely “review pending.” Direct retrieval returned 403, so live-page health was not verified. | Inspect the listing in a browser and request an update only if the endpoint/copy is wrong. |
| [PulseMCP](https://www.pulsemcp.com/servers) | **Historical listing, current entry unconfirmed.** July's record said “Listed as Agentic Mermaid,” but retained no entry URL. On 2026-10-16 the directory announces that new submissions and listing changes are paused. | Recover the existing entry URL when lookup is available; do not assume Registry ingestion guarantees a current listing or submit a duplicate. |
| [Smithery publishing](https://smithery.ai/docs/build/publish) | **Desired; no submission receipt or verified entry recorded.** July's search found no listing. | Publish `https://agentic-mermaid.dev/mcp` via [URL publishing](https://smithery.ai/new) after account access; it supports Streamable HTTP and automatically scans public servers. |
| [Glama connector](https://glama.ai/mcp/connectors/io.github.adewale/agentic-mermaid) | **Listed, healthy** on Glama's page checked 2026-10-16; page reports its last test as 2026-10-16. Ownership remains unconfirmed. | Use the listing's ownership flow to verify the domain or GitHub account. Do not equate automatic indexing with an ownership claim. |

### Version and evidence maintenance

On 2026-10-16 both `npm view agentic-mermaid version` and the Registry's
`servers?search=io.github.adewale%2Fagentic-mermaid&version=latest` API reported
`0.4.1`. Root `server.json` and `package.json` carry the **source version `0.4.2`**;
that does not mean it has been published. A source version, npm version,
Registry record, and hosted deployment must each be checked independently.

The July MCPServers.org submission has no retained receipt ID. Its public
listing above is the available evidence. For every future submission, add the
timestamp, resulting listing or receipt URL/ID, submitted version, review status,
ownership status, and exact remaining action here. Keep credentials and private
reviewer data out of public records.

### Remaining OpenAI submission materials

The current [official submission guide](https://developers.openai.com/plugins/deploy/submission)
requires a plugin ZIP containing the remote MCP configuration, developer identity
verification, domain challenge, automated scan, five positive and three negative
review cases, and an accessible video walkthrough. It also requires HTTPS
website, support, privacy-policy, and terms-of-service URLs. The email above is
the support contact, not a substitute for the support-page URL. This document
and the three prompts above are preparation, not a completed review package.
Approved terms, a walkthrough URL, the package, completed review cases, and the
portal's exact challenge token are not recorded here yet. Do not invent a token,
claim approval, or treat the MIT source license as hosted-service terms.

## Additional opportunities checked on 2026-10-16

These are researched candidates, not submitted entries or claims that the
services first launched after July.

| Opportunity / primary source | Fit and remaining work |
|---|---|
| [MCP.Directory](https://mcp.directory/submit) | Accepts a public GitHub URL and optional npm package. It also discovers Official Registry entries: first search for an existing entry, then claim it or submit `adewale/agentic-mermaid` with npm package `agentic-mermaid`. No receipt recorded. |
| [Cline MCP Marketplace](https://github.com/cline/mcp-marketplace) | A separate discovery surface with its own submission repository. Check for an existing listing, follow its current issue template, and provide the published stdio command or verified hosted transport. No submission made. |
| [Docker MCP Registry](https://github.com/docker/mcp-registry) | A potential route for the local stdio distribution. Requires a working Docker deployment and a reviewed catalog contribution; it is not automatic ingestion from our hosted Registry entry. Container packaging/validation remains separate work. |
| [Microsoft MCP Server Registry](https://github.com/microsoft/mcp-server-registry) | **Not currently eligible:** its current README restricts V1 onboarding to Microsoft first-party servers. Watch for community eligibility; do not open an ineligible manifest PR. |

Glama's domain/GitHub claim and Claude's newer portal are the most direct
follow-ups to existing listings and prepared copy. OpenAI's newer ZIP submission
flow can also distribute the existing agent skill with the MCP connection.

### Outreach

The [reply to the original checklist](https://x.com/e_stradella/status/2082502989625872764)
suggests `r/mcp` with the Showcase tag. Record it as **desired outreach, not
registered or posted**. Prepare a small public diagram example and check the
community's current rules before posting; no Reddit post or outreach message
has been sent as part of this refresh.

## Publication checks

- `tools/list` exposes a non-empty human-readable `title` and accurate safety
  annotations for every tool.
- The hosted endpoint returns a successful MCP initialization and tool list.
- The privacy and support links are public.
- The root Registry manifest version matches the released package and hosted
  server.
- Any directory-specific test prompts are run against the production endpoint
  before publication.
