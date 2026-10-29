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

Evidence reviewed **2026-10-29** for the eight destinations in the
[original checklist](https://x.com/soraiadev/status/2082500548134056063).
“Listed” requires a public entry; submission and account ownership are separate
states. Search-index evidence is labelled below because it cannot establish
live endpoint health. Review dates do not replace the source's own test or
publication date. A failed lookup does not establish that a listing is absent.

| Directory / evidence | Status and date | Next action |
|---|---|---|
| [Official MCP Registry: immutable `0.4.1` record](https://registry.modelcontextprotocol.io/v0.1/servers/io.github.adewale%2Fagentic-mermaid/versions/0.4.1) | **Historical publication confirmed; current latest unverified.** The 2026-10-16 audit reported `0.4.1` as latest. The API could not be retrieved on 2026-10-29. Published 2026-07-31 by [release run](https://github.com/adewale/agentic-mermaid/actions/runs/30626742621). | Recheck the live latest record against npm and root [`server.json`](../server.json); keep that manifest as the only publication authority. |
| [OpenAI Plugins](https://platform.openai.com/plugins) | **Desired; no submission receipt recorded.** Current [submission instructions](https://developers.openai.com/plugins/deploy/submission) checked 2026-10-29. | Prepare the required package and review materials below, then complete the verified developer/account flow. |
| [Claude directory](https://claude.com/resources/articles/build-plugins-for-claude) | **Desired; no submission receipt recorded.** New portal announced 2026-09-25; accepts a single remote connector or a plugin bundle from developers on paid Claude plans. The old Team/Enterprise-only note is obsolete. | Submit the hosted URL through the portal linked from the announcement; optionally bundle the existing diagram-workflow skill. |
| [Cursor Directory](https://cursor.directory/) | **Desired; current listing unconfirmed.** The public catalog is a plugin directory, checked 2026-10-29. Neither the catalog view nor search results established an Agentic Mermaid entry. | Search the current catalog while signed in and use its current plugin submission flow; record its receipt. |
| [MCPServers.org listing](https://mcpservers.org/servers/adewale/agentic-mermaid) | **Public search-index evidence**, rechecked 2026-10-29 via the [localized listing](https://mcpservers.org/zh-CN/servers/adewale/agentic-mermaid). The canonical page could not be retrieved. The index supports listing discovery, not current page or endpoint health; the July submission has no retained receipt. | Inspect the listing in a browser and request an update only if the endpoint/copy is wrong. |
| [PulseMCP](https://www.pulsemcp.com/servers) | **Historical listing, current entry unconfirmed.** July's record said “Listed as Agentic Mermaid,” but retained no entry URL. On 2026-10-29 the directory still announces that new submissions and listing changes are paused. | Recover the existing entry URL when lookup is available; do not assume Registry ingestion guarantees a current listing or submit a duplicate. |
| [Smithery service transition](https://smithery.ai/future) | **No verified entry or receipt recorded.** The notice checked 2026-10-29 ends proxy services, accounts, API keys, CLI and SDKs on **2026-10-31**. A curated public directory with direct server URLs remains. | Do not start the retiring account/proxy publishing flow described in older [publishing docs](https://smithery.ai/docs/build/publish). Confirm the continuing directory's intake process; use the canonical hosted URL for any future entry. |
| [Glama connector](https://glama.ai/mcp/connectors/io.github.adewale/agentic-mermaid) | **Public listing found; ownership unconfirmed.** The page retrieved on 2026-10-29 reports “Healthy,” with **Last Tested 2026-10-16**. This is the directory's dated result, not a fresh independent endpoint probe. | Use the listing's ownership flow to verify the domain or GitHub account. Do not equate automatic indexing with an ownership claim. |

### Version and evidence maintenance

On 2026-10-29, `npm view agentic-mermaid version --json` returned `0.5.3`.
Root `server.json`, its npm package entry, `package.json`, and `src/version.ts`
also carry `0.5.3`. These are independent observations of source and npm;
they do not establish Registry publication or the hosted deployment version.
The 2026-10-16 audit reported npm and the Registry latest record as `0.4.1`,
with `0.4.2` in source. Retain those as historical observations.

The Registry latest API could not be retrieved during this review, and the
hosted MCP version was not rechecked. Before publishing or updating a listing,
query the [Registry latest search](https://registry.modelcontextprotocol.io/v0.1/servers?search=io.github.adewale%2Fagentic-mermaid&version=latest)
and initialize the hosted MCP endpoint independently. Do not infer either
version from a source manifest, npm release, or third-party health badge.

The July MCPServers.org submission has no retained receipt ID. Its public
listing above is the available evidence. For every future submission, add the
timestamp, resulting listing or receipt URL/ID, submitted version, review status,
ownership status, and exact remaining action here. Keep credentials and private
reviewer data out of public records.

### Remaining OpenAI submission materials

The [official submission guide](https://developers.openai.com/plugins/deploy/submission),
reviewed on 2026-10-29, separates the package from portal setup. Upload a ZIP
that declares the remote MCP server; complete developer identity verification,
the portal's domain challenge, connection setup and automated scans separately.
Initial MCP review needs five positive and three negative cases plus an
accessible video walkthrough. These review materials can be supplied through
the package or portal; private reviewer credentials stay outside the ZIP.

Review also requires HTTPS website, support-page, privacy-policy and
terms-of-service URLs. The email above is a contact, not a support-page URL.
The three example prompts are not a completed review package. Approved hosted
terms, a support-page URL, a walkthrough, the package, completed review cases
and the portal's exact challenge token are not recorded here. The MIT source
license does not establish hosted-service terms.

## Additional opportunities reviewed on 2026-10-29

These are researched candidates, not submitted entries or claims that the
services first launched after July.

| Opportunity / primary source | Fit and remaining work |
|---|---|
| [MCP.Directory](https://mcp.directory/submit) | Accepts a public GitHub URL and optional npm package. Search for an existing entry before submitting `adewale/agentic-mermaid` with npm package `agentic-mermaid`; use the directory's update process if one exists. No receipt recorded. |
| [Cline MCP Marketplace](https://github.com/cline/mcp-marketplace) | The current submission instructions require a repository URL, 400×400 PNG logo, reason for inclusion, and observed successful installation by Cline from the README or `llms-install.md`. Check for an existing entry before preparing a submission. No submission made. |
| [Docker MCP Registry](https://github.com/docker/mcp-registry) | A potential route for the local stdio distribution. Requires a working Docker deployment and a reviewed catalog contribution; it is not automatic ingestion from our hosted Registry entry. Container packaging/validation remains separate work. |
| [Microsoft MCP Server Registry](https://github.com/microsoft/mcp-server-registry) | **Not currently eligible:** its current README restricts V1 onboarding to Microsoft first-party servers. Watch for community eligibility; do not open an ineligible manifest PR. |

Glama ownership and the Claude portal are follow-ups to existing evidence and
prepared copy. OpenAI can distribute the existing skill with the MCP connection
once the review materials are ready. Smithery needs a new intake check after
its service transition; the old proxy publishing route is not a durable next step.

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
