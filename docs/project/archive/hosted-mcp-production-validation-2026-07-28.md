# Hosted MCP production validation — 2026-07-28

> **Status:** production version `0.3.2` is deployed and passes the guarded
> deployment plus an independent reference-client smoke. The primary `/mcp`
> route has an owner-configured WAF rate limit. Promotion remains gated on
> confirming that the same rule also covers the compute-capable
> `/.well-known/mcp` alias.

This is the dated owner/evidence record for the dashboard-side controls that
cannot be derived from the repository. Current application hardening work stays
under `SEC-4` in [`TODO.md`](../../../TODO.md); this record is not a second
backlog.

## Immutable deployment evidence

- Git commit: `bd2fc1d0070ff4bd254f7bd174f9fe5328cc1b2d`
- Hosted version: `0.3.2`
- Canonical CI:
  [`30319105883`](https://github.com/adewale/agentic-mermaid/actions/runs/30319105883)
- Production deployment:
  [`30319630869`](https://github.com/adewale/agentic-mermaid/actions/runs/30319630869)
- Deployment result: candidate upload, zero-traffic smoke, full `/mcp` probe,
  promotion, and promoted-version verification passed; rollback remained armed
  until verification and was then correctly skipped.

## Dashboard WAF control

The Cloudflare account owner configured the primary production control as:

| Property | Owner record |
| --- | --- |
| Host | `agentic-mermaid.dev` |
| Method and path | `POST /mcp` |
| Characteristic | Source IP |
| Rate | 10 requests per 60 seconds |
| Action | Block at the edge |
| Observed enforcement | An unpaced production probe received Cloudflare error 1015 |
| Rollback owner | The `adewale` Cloudflare account owner |
| Rollback action | Disable the rate-limiting rule in **Security → WAF → Rate limiting rules**; no repository or GitHub secret is involved |

The deploy now sends every production MCP request through one pacing helper at
one request per six seconds, keeping the whole job at or below ten requests per
rolling minute. The cadence applies to the initial smoke, the full dual-era
probe, and final promoted-version verification; it is not reset between phases.

### Remaining route-scope gate

`website/src/worker-core.ts` routes both `/mcp` and `/.well-known/mcp` to the
same hosted handler. A production `POST /.well-known/mcp` returned HTTP 200 at
`2026-07-28T02:29Z`, proving that the alias can invoke compute. Repository
evidence cannot see whether the dashboard rule includes that second path.

Before closing `DEC-2`, inspect the Cloudflare rule and make its effective scope
equivalent to:

```text
http.host eq "agentic-mermaid.dev" and
http.request.method eq "POST" and
http.request.uri.path in {"/mcp" "/.well-known/mcp"}
```

Then send the bounded owner test through the alias, confirm an over-budget
request is blocked before the Worker, confirm an ordinary below-budget request
still succeeds after the mitigation window, and record the dashboard event.
Do not generate enough public traffic to test this from routine CI.

## Independent production client

The pinned official TypeScript reference client
`@modelcontextprotocol/sdk@1.29.0` was run against
`https://agentic-mermaid.dev/mcp`, crossing the real Cloudflare edge rather than
the in-process test handler. It completed the SDK's normal connect lifecycle and
proved:

- server identity `agentic-mermaid-hosted` version `0.3.2`;
- negotiated protocol revision `2025-11-25`;
- no `Mcp-Session-Id` was issued;
- the exact nine-tool surface was returned: `build`, `describe`,
  `describe_sdk`, `execute`, `mutate`, `render_ascii`, `render_png`,
  `render_svg`, and `verify`; and
- `render_svg` returned a 9,849-byte SVG containing both expected labels.

This closes the website promotion checklist's real-client smoke for the current
stable SDK generation. It does **not** close `DEC-1`: running an external SDK
from this repository is compatibility evidence, not adoption by a real agent,
editor, TUI, or CI consumer outside the repository.

It also does not close issue
[#186](https://github.com/adewale/agentic-mermaid/issues/186). At
`2026-07-28T02:29Z`, the
[official versioning page](https://modelcontextprotocol.io/docs/learn/versioning)
still named `2025-11-25` as current and the final `2026-07-28` specification
pages were not yet published.
The issue's final-text re-verification gate therefore remains genuinely open.
