# Hosted MCP on Cloudflare: plan

Plan for turning the website's `/mcp` 501 placeholder into a real hosted MCP
endpoint at `https://agenticmermaid.dev/mcp`, at $0/month on the Workers Free
plan, with one explicit, measured trigger for upgrading to Workers Paid ($5/mo).

## Where we start

- The website is already a Cloudflare Worker with Static Assets
  (`website/wrangler.jsonc`, `website/src/worker.js`). The worker currently
  returns an honest 501 at `/mcp`.
- A full MCP server already exists in `src/mcp/server.ts` with a
  transport-agnostic JSON-RPC core: `handleRequest(req, context)` takes a
  parsed JSON-RPC request and returns a response, independent of stdio/HTTP.
  That function is the reuse seam for the Worker.
- Current tools: `execute` (Code Mode), `render_png`, `describe`.

## What cannot move to Workers as-is

Two of the three existing tools depend on capabilities Workers does not have:

| Tool | Blocker | Hosted decision |
|---|---|---|
| `execute` | `node:vm` is unavailable in workerd. Cloudflare's Worker Loaders ("Code Mode") could host it but is closed-beta with unsettled pricing. | **Excluded from the hosted server.** Code Mode stays local via stdio (`npx -y agentic-mermaid-mcp`). The hosted server's instructions point agents there. |
| `render_png` | `@resvg/resvg-js` is a native napi addon. | **Phase 2, optional.** Swap to `@resvg/resvg-wasm` + a bundled font for the Worker build. PNG rasterization will likely exceed the free plan's 10ms CPU budget, so this ships only if/when we move to Workers Paid — or never, since agents can rasterize locally. |
| `describe` | none (pure JS) | Hosted in phase 1. |

Everything else in the rendering pipeline — parser, elkjs layout, SVG/ASCII
generation, verify — is pure JS/TS with no Node-native dependencies, so it runs
in workerd directly.

## Hosted tool surface (phase 1)

The hosted server is a *narrower sibling* of the local server, not a mirror:
stateless, pure-compute tools only.

- `render_svg` — Mermaid source → themed SVG string.
- `render_ascii` — Mermaid source → ASCII or Unicode text (`useAscii` flag).
- `verify` — Mermaid source → `{ ok, warnings, layout }` structured result.
- `describe` — existing tool, unchanged.

All four are thin wrappers over the existing `src/agent/` API (they already
exist inside `execute`'s SDK today). Responses are inline text/JSON only — no
artifact files, no storage bindings.

The hosted `tools/list` description and the `initialize` instructions field
state explicitly: for Code Mode (`execute`) and deterministic napi PNG, install
`agentic-mermaid-mcp` locally over stdio.

## Architecture: stateless Streamable HTTP, no paid primitives

The whole design goal is to need nothing beyond the Worker we already deploy.

- **Transport:** Streamable HTTP in stateless mode. A single `POST /mcp`
  endpoint accepts JSON-RPC and returns `application/json` responses. No SSE
  stream, no sessions (`initialize` succeeds without issuing a session id),
  `GET /mcp` → 405, notifications → 202. This is spec-conformant for a
  stateless server and is what Claude Code, Cursor, etc. speak
  (`claude mcp add --transport http agentic-mermaid https://agenticmermaid.dev/mcp`).
- **No Durable Objects / agents SDK:** Cloudflare's `McpAgent` class exists for
  stateful servers and needs Durable Objects. Our tools are pure functions of
  their input; statelessness is free, so we take it.
- **No KV / R2 / Queues:** base64/inline responses only. The local server's
  artifact store (tmpdir + TTL) simply isn't instantiated in the Worker.
- **Reuse `handleRequest`:** the Worker entry parses the HTTP body, enforces
  caps, and delegates to the same JSON-RPC core the stdio server uses, with the
  hosted toolset injected.
- **Response caching:** layout is deterministic — identical input produces
  identical geometry. So `tools/call` responses are cached in the Workers Cache
  API keyed on SHA-256 of `(tool name, canonicalized arguments)`. Repeat
  renders of the same diagram cost ~0 CPU. This is the single biggest lever for
  staying inside the free plan's CPU budget.

### Request hygiene / abuse control (all free)

- Body cap: 128 KB for `POST /mcp` (the local server already caps at 1 MB;
  hosted is tighter).
- Source cap inside tools (e.g. 64 KB of Mermaid source) with a structured
  error pointing at the local CLI for huge diagrams.
- `content-type: application/json` required, mirroring the local HTTP
  transport's rule.
- One Cloudflare WAF rate-limiting rule (free plan includes one): e.g.
  60 requests/min per IP on `POST /mcp`. Configured in the dashboard, recorded
  in `website/README.md`.
- CORS: `Access-Control-Allow-Origin: *` on `/mcp` (public read-only compute,
  no credentials, nothing to CSRF).
- No auth. There is no user data, no mutation, and no per-user cost beyond the
  rate limit.

## Cost model

| Item | Plan | Cost |
|---|---|---|
| Worker requests | Free: 100k/day | $0 |
| CPU | Free: 10 ms/invocation | $0 |
| Bundle | Free: 3 MB gzipped (elkjs + our code fits; verify in CI) | $0 |
| Cache API, WAF rate-limit rule, analytics | Free plan | $0 |
| Durable Objects, KV, R2, Queues, Workers for Platforms, Worker Loaders | not used | $0 |

**Upgrade trigger (the only one):** move to Workers Paid ($5/mo — 10M
requests, 30 s CPU, 10 MB bundle) when observability shows either
(a) recurring CPU-limit terminations (error 1102) on real diagrams, or
(b) sustained traffic near 100k req/day, or (c) we decide to ship hosted
`render_png`. Until one of those is true, the bill is $0.

**Known risk on free tier:** a large diagram's elkjs layout may exceed 10 ms
CPU. Mitigations, in order: cache hit path (repeat requests are free),
source-size cap, and a structured `error` response advising the local CLI.
We measure real CPU time via Workers observability before deciding anything.

## Implementation steps

1. **Refactor `src/mcp/server.ts` for toolset injection.** Extract the tool
   registry so a transport chooses `FULL_TOOLS` (stdio/HTTP: execute,
   render_png, describe) or `HOSTED_TOOLS`. Zero behavior change for existing
   transports; `agent-mcp.test.ts`, `agent-mcp-http.test.ts`,
   `agent-mcp-png.test.ts` must stay green untouched.
2. **Add the pure tools** (`render_svg`, `render_ascii`, `verify`) as thin
   wrappers over `src/agent/`, available to both toolsets (they're useful
   locally too, and keeping one implementation avoids drift).
3. **Worker entry `website/src/worker.ts`.** Wrangler bundles TypeScript with
   esbuild natively, so the entry can import `handleRequest` from
   `../../src/mcp/` directly — no separate build step. The existing static
   asset/redirect/header logic is preserved; the `/mcp` branch replaces the
   501 with: OPTIONS/CORS handling → method/content-type/body-cap validation →
   cache lookup → `handleRequest` with `HOSTED_TOOLS` → cache store → JSON
   response.
4. **Protocol version.** The core pins `2024-11-05`; Streamable HTTP requires
   negotiating `2025-03-26`+ and echoing the `MCP-Protocol-Version` header.
   Make the core accept the client's offered version from a known-good list.
5. **Tests.**
   - Unit: drive the Worker's `fetch` handler with `Request` objects in
     `bun test` (Request/Response are global in Bun) — handshake, tools/list,
     each tool, cap violations, cache-key stability, CORS preflight.
   - Update `src/__tests__/website-build.test.ts` wherever it asserts the 501.
   - E2E smoke: `wrangler dev` + a curl script mirroring
     `docs/mcp-http-transport.md`'s examples; verify with MCP Inspector and a
     real `claude mcp add --transport http` session against the preview URL.
   - CI bundle-size check: `wrangler deploy --dry-run --outdir` and assert
     gzipped size < 3 MB.
6. **Docs & agent surfaces.** Update `/docs/mcp` page, `capabilities.json`,
   `llms.txt`, `agent-instructions.md`, and `website/README.md` (which
   currently documents the 501 as intentional): hosted endpoint, tool surface,
   limits, and the local-stdio recommendation for Code Mode/PNG.
7. **Rollout.** Deploy as a Wrangler preview version first, smoke it, then
   promote. Watch `wrangler tail` / Workers analytics for 1102s over the first
   week; that data drives the free-vs-paid decision.

## Phase 2 (only if justified)

- **Hosted PNG:** `@resvg/resvg-wasm` + bundled DejaVu Sans subset. Requires
  Workers Paid for CPU headroom and possibly bundle size. Caveat to document:
  wasm resvg output is not guaranteed byte-identical to the local napi build,
  so hosted PNG is a *convenience* surface, not part of the determinism
  contract.
- **Hosted Code Mode:** revisit if/when Cloudflare Worker Loaders reaches GA
  with published pricing. Until then, `execute` is local-only by design.

## Explicit non-goals

- No hosted arbitrary code execution (the current 501's promise holds:
  local-first for Code Mode).
- No REST render API — MCP only. (A `GET /render?src=` API invites hotlinking
  and cost exposure; MCP clients are the audience.)
- No accounts, tokens, or billing-adjacent infrastructure.
