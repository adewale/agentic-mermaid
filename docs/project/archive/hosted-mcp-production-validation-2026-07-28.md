# Hosted MCP production validation — 2026-07-28

> **Status:** production version `0.3.2` is deployed and passes the guarded
> deployment plus an independent reference-client smoke. One owner-configured
> WAF rate-limit rule covers both compute-capable POST routes. The account
> owner's 2026-07-28 dashboard confirmation closes the route-scope promotion
> gate formerly tracked as `DEC-2`.

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

The Cloudflare account owner configured the production control as:

| Property | Owner record |
| --- | --- |
| Host | `agentic-mermaid.dev` |
| Method and paths | `POST /mcp`; `POST /.well-known/mcp` |
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

### Route-scope closure

`website/src/worker-core.ts` routes both `/mcp` and `/.well-known/mcp` to the
same hosted handler. A production `POST /.well-known/mcp` returned HTTP 200 at
`2026-07-28T02:29Z`, proving that the alias can invoke compute. On 2026-07-28,
the Cloudflare account owner then confirmed in the dashboard that the same
rate-limit rule includes both exact paths, with effective scope equivalent to:

```text
http.host eq "agentic-mermaid.dev" and
http.request.method eq "POST" and
http.request.uri.path in {"/mcp" "/.well-known/mcp"}
```

The rule's block action was already observed as Cloudflare error 1015 through
`/mcp`. A second public over-budget burst through the alias was deliberately not
generated: the single rule's path predicate provides the route-coverage proof,
while bounded enforcement/recovery and rule-order drills remain part of the
`SEC-4` production game day. Routine CI must stay below the shared WAF budget.

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
