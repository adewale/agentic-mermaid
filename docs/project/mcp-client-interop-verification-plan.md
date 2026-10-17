# MCP client interop — coverage and verification record

> **Status: TypeScript lane implemented; Python follow-up incomplete (2026-10-17).**
> `TODO.md` **TEST-4** owns the remaining API and request-trace work from
> [#191](https://github.com/adewale/agentic-mermaid/issues/191), despite that
> issue being closed. Correcting this document does not complete the probe changes.
> (`src/__tests__/mcp-client-interop.test.ts`, SDK `1.29.0`
> pinned as a devDependency; see the red→green record below). This document specifies
> a test lane that drives both MCP servers in this repo with the **reference MCP client
> SDK** (`@modelcontextprotocol/sdk`), so compatibility is *observed against a real
> client* rather than *asserted from our own reading of the spec*. It supplies
> motivation, design, decisions, and acceptance detail; `TODO.md` remains the
> authoritative backlog. The original lane supported the now-landed #186
> migration; the historical design below is not a second implementation queue.

## Original problem (before this lane landed)

We ship two MCP servers:

- **Hosted** — stateless Streamable HTTP at `agentic-mermaid.dev/mcp`. Transport in
  `website/src/mcp-handler.ts` (factory `createMcpHandler`), tool core in
  `src/mcp/hosted-server.ts` (tools: <!-- BEGIN GENERATED: hosted-mcp-tools -->`execute`, `describe_sdk`, `render_svg`, `render_ascii`, `render_png`, `verify`, `describe`, `mutate`, and `build`<!-- END GENERATED: hosted-mcp-tools -->).
  Accepts protocol versions <!-- BEGIN GENERATED: hosted-protocol-versions -->`2025-03-26`, `2025-06-18`, `2025-11-25`, and `2026-07-28`<!-- END GENERATED: hosted-protocol-versions -->.
- **Local** — stdio (and node HTTP/SSE) server in `src/mcp/server.ts`, shipped as the
  `agentic-mermaid-mcp` bin (`src/mcp/mcp-bin.ts` → `runMcpCli`, default transport
  stdio). Accepts <!-- BEGIN GENERATED: stdio-protocol-versions -->`2024-11-05`, `2025-06-18`, `2025-11-25`, and `2026-07-28`<!-- END GENERATED: stdio-protocol-versions --> over stdio and
  <!-- BEGIN GENERATED: http-sse-protocol-versions -->`2024-11-05`<!-- END GENERATED: http-sse-protocol-versions --> over HTTP+SSE. 4 tools.

The original verification of these servers shared one weakness: **the tests and the
server embody the same interpretation of the MCP spec.**

| Layer | File | What it does | Why it is not a real client |
|---|---|---|---|
| Conformance unit tests | `src/__tests__/hosted-mcp-http.test.ts` (~50 tests) | Hand-built `Request` objects assert 405/415/413/`-32700`/202, initialize round-trip, version-header 400, batch rules, CORS, caching | Request bodies are written by us to match our reading |
| Protocol codec props | `src/__tests__/mcp-protocol.test.ts` | fast-check round-trip of unsafe 64-bit / non-canonical JSON-RPC ids | Interop-motivated, but still our framing |
| Surface fuzz | `src/__tests__/property-mcp-surface-fuzz.test.ts` | fast-check drives the router + execute sandbox for crash-freedom | Generator is ours; explores hostile input, not real-client sequences |
| Consumer e2e | `e2e/tarball-consumer-fuzz.e2e.test.ts` | Spawns the installed `agentic-mermaid-mcp` bin over stdio with generated JSON-RPC | Still our hand-rolled JSON-RPC, not an SDK handshake |
| Live probe | `website/e2e-mcp.sh` | ~30 curl checks against a running server | Hand-written bodies, substring assertions |

If we misread a normative clause, both the server and its tests agree with each other and
everything passes; a real client built from the *correct* reading is what trips over it.
`docs/testing-strategy.md` §"Honest gaps" already names this as the deepest structural
gap: *"every quality signal here is self-generated… it cannot substitute for a real
external consumer."* The MCP transport is the one boundary where a canonical external
consumer exists off the shelf — the reference SDK. This motivated the implemented
TypeScript lane and manual Python/Go probes below; the SDK is now a devDependency.

## Original implementation goals

1. Drive the **hosted** handler with the SDK's `StreamableHTTPClientTransport` through the
   real lifecycle: `initialize` → `tools/list` → `tools/call` → notification, over a real
   socket.
2. Drive the **local** stdio server with the SDK's `StdioClientTransport` through the same
   lifecycle, against the shipped bin.
3. Assert the things a real client actually depends on: the handshake completes, a
   supported protocol version is negotiated, the advertised tool list matches the surface,
   and tool results deserialize into the SDK's typed result shapes.
4. Convert "compatible as far as we can tell" into "compatible, observed against the
   reference client" — and give #186 (2026-07-28 adoption) a harness that will exercise the
   new revision's no-`initialize` flow the moment SDKs ship it.

## Non-goals

- **Not** a replacement for the hand-rolled conformance suite. The SDK cannot easily be
  told to *offer an arbitrary old protocol version* or *send a malformed frame*, so the
  per-clause matrix (force `2024-11-05`, prove the `2025-06-18` no-batch rule, 413/415/CORS
  edges) stays in `hosted-mcp-http.test.ts`. The two suites are complementary: hand-rolled
  proves we implement each clause; SDK proves a real client is happy with the default path.
- **Not exhaustive** client/language coverage. TypeScript runs in the automated
  lane; Python and Go have manual probes with different request paths and
  therefore different evidence. See the coverage table below.
- **No** new runtime dependency. The SDK is dev-only and must never enter the shipped
  `dependencies` — the MCP servers keep their zero-runtime-dep posture.

## Implemented lane design (original plan)

The design and red/green predictions below preserve the implementation rationale.
Use the current owning tests for exact behavior and the multi-client coverage
section for evidence limits; imperative wording here is not unfinished work.

### Dependency

Add `@modelcontextprotocol/sdk` to `devDependencies` (pinned). It pulls transitive dev
deps (e.g. `zod`); confirm they resolve under Bun's test runner and stay out of `dist/`
(the `files[]` allowlist and tsup `external` config already exclude devDeps — add an
assertion to the existing dist-surface check if cheap).

### A. Hosted — Streamable HTTP interop

`createMcpHandler` returns a `(Request) => Promise<Response>` function, not a listening
server; the SDK transport needs a URL. Bind the handler to an ephemeral localhost port for
the duration of the test:

```ts
// src/__tests__/mcp-client-interop.test.ts
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { createMcpHandler } from '../../website/src/mcp-handler.ts'
import { SUPPORTED_PROTOCOL_VERSIONS } from '../mcp/hosted-server.ts'

const handler = createMcpHandler({ context: fakeContext, cacheVersion: 'interop', onEvent: () => {} })
const server = Bun.serve({ port: 0, fetch: handler })            // ephemeral port
try {
  const client = new Client({ name: 'interop-test', version: '0' })
  await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${server.port}/mcp`)))
  // connect() performed initialize + the initialized notification against the real server.

  const { tools } = await client.listTools()
  // expect the 9 hosted tool names present, schemas parsed by the SDK.

  const svg = await client.callTool({ name: 'render_svg', arguments: { source: 'flowchart LR\n A --> B' } })
  // expect a well-formed CallToolResult the SDK deserialized (content[0].text contains "<svg").

  await client.close()
} finally { await server.stop(true) }
```

Reuse the existing harness seams from `hosted-mcp-http.test.ts`: the `makeCache()`
Map-backed Cache and the call-recording fake `execute` context (`makeHandler`). Assertions
worth making because they exercise the *stateless* posture against a real client:

- The client completes the handshake even though the server **never returns
  `Mcp-Session-Id`** — proves sessionless operation is accepted, not just spec-legal.
- The transport tolerates our **GET → 405** (the SDK treats 405 as "no server stream" and
  proceeds) — the single most load-bearing consequence of "no SSE".
- The negotiated `protocolVersion` is a member of `SUPPORTED_PROTOCOL_VERSIONS`. Assert
  membership, **not** a hardcoded string, so an SDK bump that offers a newer default does
  not break the test; if the SDK offers a version we do not support, the server echoes
  `2025-03-26` and the client must accept that downgrade — that acceptance is the assertion.
- After negotiation the client sends `MCP-Protocol-Version: <negotiated>` on every
  request; since the negotiated value is always supported, the transport's 400-guard never
  fires for a well-behaved client. The hand-rolled test proves the guard exists; this
  proves it never misfires on the happy path.

### B. Local — stdio interop

Drive the shipped bin with `StdioClientTransport`, which spawns the process and speaks the
handshake:

```ts
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
const transport = new StdioClientTransport({ command: 'bun', args: ['run', 'src/mcp/mcp-bin.ts'] })
```

Two candidate targets, matching the two things we care about:

- **Fast / source:** `command: 'bun', args: ['run', 'src/mcp/mcp-bin.ts']` — runs source
  under Bun. Cheap; good default for the unit lane.
- **Shipped artifact:** `command: 'node', args: ['dist/agentic-mermaid-mcp.js']` — the
  actual `npm` consumer path under Node. Matches the ethos of the existing
  `tarball-consumer-fuzz` e2e and would catch tsup/ESM-interop breakage the source path
  hides, at the cost of a `bun run build` prerequisite.

**Recommendation:** source-under-Bun in the unit lane (default `bun run test`), and add the
shipped-artifact-under-Node variant to the e2e lane where `dist/` is already built.

Assertions: `initialize` negotiates `2024-11-05` (the local pin — assert exactly, and note
that a future SDK dropping `2024-11-05` from its supported window would fail here, which is
the signal that motivates the #186 follow-up to modernize the local server's version);
`tools/list` returns the 4 local tools; a `render_svg`/`describe` call round-trips. Reap
the subprocess in `finally` (`transport.close()` / `client.close()`).

## Key decisions and risks

| # | Decision / risk | Recommendation |
|---|---|---|
| 1 | Handler is a function, not a server | Bind with `Bun.serve({ port: 0 })`; ephemeral port avoids collisions; `server.stop(true)` in `finally` |
| 2 | Assert negotiated version | Membership in `SUPPORTED_PROTOCOL_VERSIONS` (hosted) / `=== '2024-11-05'` (local) — never a hardcoded SDK default, which drifts across SDK releases |
| 3 | stdio target | Source-under-Bun in unit lane; shipped-artifact-under-Node in e2e lane |
| 4 | Flake surface (socket + subprocess) | Ephemeral port; deterministic teardown in `finally`; per-test timeout within the 30 s suite budget; no wall-clock assertions |
| 5 | Dev dependency footprint | Dev-only; assert it never reaches `dist/`/`files[]`; verify transitive deps resolve under Bun |
| 6 | Version-matrix coverage the SDK can't force | Explicitly out of scope here; keep it in `hosted-mcp-http.test.ts`; cross-reference both files' headers so neither is mistaken for total coverage |
| 7 | CI lane placement | HTTP interop → unit lane (`src/__tests__/`, in-process, ~ms). stdio-subprocess → unit lane if within budget, else e2e lane |

## Red → green: proving the test discriminates

A regression guard that never fails when the behavior breaks is theatre (CLAUDE.md
dimension 4/7). Before merge, verify each interop test actually fails when a real-client
dependency is broken, and record the result in the PR:

- Make `initialize` echo an **unsupported** `protocolVersion` → `client.connect()` must
  throw ("server's protocol version is not supported").
- Drop `tools` from the `tools/list` result → `client.listTools()` must throw SDK schema
  validation, not return empty.
- Return `200` with a non-SSE body on `GET` instead of `405` → the transport must surface
  the confusion rather than silently pass.

State the outcome ("N interop assertions fail when X is reverted") in the PR per the repo's
red→green standard.

**Observed results (SDK 1.29.0, at implementation):**

| Lever | Mutation | Result |
|---|---|---|
| 1 | `hostedProtocolVersion` returns `'1999-01-01'` | **2 tests fail** — the SDK's own `client.connect()` throws `Server's protocol version is not supported: 1999-01-01` |
| 2 | `tools/list` replies `{}` (shared dispatch) | **2 tests fail** (hosted + stdio) — SDK zod validation throws `invalid_type: expected array, received undefined` |
| 3 | GET answers `200` + JSON instead of `405` | **1 test fails — but not the way predicted above.** The SDK **silently tolerated** the malformed response: it read the JSON body as an SSE stream, got no events, and surfaced nothing through `onerror`. The failure comes from the test's own wire-log assertion (`served` records no `GET → 405` exchange). Lesson: the prediction "the transport must surface the confusion" was wrong; the explicit server-side wire assertion is load-bearing, and SDK leniency means a real-client test alone under-discriminates transport-shape regressions. |

## Multi-client verification: Python and Go reference SDKs

The unit lane covers the TypeScript reference SDK. The other two official reference
clients are covered by repeatable probe scripts under `scripts/interop/` — run manually
(they need `uv`/`go` toolchains and network installs, so they stay out of the CI gate):

```bash
bun run scripts/interop/serve-hosted.ts              # prints the local hosted URL
uv run --with 'mcp==1.28.1' scripts/interop/probe-python.py <url>
cd scripts/interop/probe-go && go run . <url>
```

The Python command above is the reproducible baseline used for the recorded result.
To detect compatibility drift in the newest published Python client, run the same probe
as an explicitly unpinned canary with
`uv run --with mcp scripts/interop/probe-python.py <url>`. The Python and Go probes
both bound the combined hosted-plus-stdio lifecycle to 120 seconds.

Each probe drives the hosted endpoint (initialize → downgrade negotiation →
`tools/list` → real `render_svg`) and the stdio bin (spawn → `2024-11-05` negotiation →
exact 4-tool surface → real vm-sandbox `execute`), printing PASS/FAIL per check and
exiting nonzero on failure. Both tool-list checks compare the exact sorted names, not
only the expected cardinality.

**Historical observed results (2026-07-17; not a fresh canary run):**

| Client | Version | Hosted | stdio | Notes |
|---|---|---|---|---|
| TypeScript `@modelcontextprotocol/sdk` | 1.29.0 | ✅ | ✅ | Unit lane (`mcp-client-interop.test.ts`); offered `2025-11-25`, accepted `2025-03-26` |
| Python `mcp` | 1.28.1 | ✅ 6/6 | ✅ 4/4 | Sessionless accepted; `get_session_id()` stays `None`, so this transport path does not start an SSE GET |
| Go `go-sdk` | v1.6.1 | ✅ 6/6 | ✅ 4/4 | **Default config with the standalone SSE GET stream enabled** — its retry machinery treats the stateless 405 as benign; supports back to `2024-11-05` |

The recorded runs establish sessionless initialization, version negotiation, tool
discovery and real tool calls for all three SDKs. They do **not** establish the
same HTTP behavior:

| Behavior | TypeScript | Python 1.28.1 | Go 1.6.1 |
|---|---|---|---|
| Sessionless hosted lifecycle and tool call | Observed | Observed | Observed |
| Optional SSE GET receives 405 and client continues | Observed, asserted in served-request log | **Not exercised** | Observed in the recorded default-config probe |
| Automated repeat coverage | Unit lane | Manual probe | Manual probe |

HTTP 405 here means the server declines the optional server-to-client SSE
stream; POST tool requests still work. Python's `handle_get_stream()` returns
without issuing GET when no session ID exists. A successful Python connection
therefore says nothing about how it handles a 405 response. The deprecated
`streamablehttp_client` name remains in the probe; replacing it with
`streamable_http_client` and adding inspectable request tracing are still TEST-4.
Both the early return and deprecated wrapper are visible in the
[pinned Python SDK source](https://github.com/modelcontextprotocol/python-sdk/blob/v1.28.1/src/mcp/client/streamable_http.py).

The July runs recorded hosted `2025-03-26` and stdio `2024-11-05` negotiation.
Those are historical observations, not the current server ceiling or a promise
about every client's offered version. Capture the actual SDK, offered and
negotiated versions when re-running the pinned baseline and latest canary.
The Python probe still hardcodes `2024-11-05`, `2025-03-26`, and `2025-06-18`
as its hosted accepted set. That is not the current hosted set shown above:
it can misreport a valid newer negotiation as a failure. Refresh that assertion
as part of TEST-4; do not diagnose a server/SDK incompatibility from it alone.

## Promotion check (dashboard-side, manual)

The hosted promotion checklist in `website/README.md` includes the real-client
smoke alongside the live `execute` check of the `LOADER` binding:

- Before promoting, run the reference client against the live URL — either
  `npx @modelcontextprotocol/inspector` or
  `claude mcp add --transport http agentic-mermaid https://agentic-mermaid.dev/mcp` followed
  by a list + call — and confirm the handshake, tool list, and one render succeed against
  production (where real isolates, real Cache API, and the CDN edge differ from the
  in-process test seams).

## Original relationship to #186 (2026-07-28 adoption)

The server-side migration has landed; its [design record](archive/stateless-mcp-migration-plan.md)
is archived. The original rationale was to exercise the new no-`initialize`
flow with an external SDK, not only hand-written protocol frames. The recorded
SDK runs above exercise the legacy handshake. They are not evidence that an
SDK's modern per-request `_meta` path has been exercised. Verify the actual
SDK revision and request trace before making that additional claim; do not
treat the already-landed server version-list change as unfinished work.

## Acceptance criteria

- [x] `@modelcontextprotocol/sdk` added to `devDependencies` (pinned `1.29.0`); confirmed
      out of `dist/` (no SDK code or import specifiers bundled — the one string match is
      the devDependencies line of the pre-existing inlined `package.json` metadata) and out
      of `files[]` (tests are excluded by `!src/**/__tests__/**`).
- [x] `src/__tests__/mcp-client-interop.test.ts`: reference `Client` +
      `StreamableHTTPClientTransport` completes initialize → list → call → notification
      against `createMcpHandler` bound to an ephemeral port; asserts sessionless operation,
      GET-405 tolerance (positively, via a served-request wire log), negotiated-version
      membership, and a well-formed `render_svg` result.
- [x] stdio interop: reference `Client` + `StdioClientTransport` completes the lifecycle
      against the bin (source-under-Bun); asserts `2024-11-05` negotiation via a
      `setProtocolVersion` spy and the 4-tool surface; subprocess reaped in `finally`.
- [x] Red→green recorded for each lever (table above).
- [x] `bun run test` and `bunx tsc --noEmit` green; full suite run.
- [x] `website/README.md` promotion checklist gains the real-client smoke step.
- [x] Headers of both interop and hand-rolled suites cross-reference each other so neither
      is read as total coverage.

## Trust / honest limitations

- Recorded reference-SDK interop covers **three official reference implementations**
  (TypeScript in the CI lane; Python and Go via the manual `scripts/interop/` probes).
  This is not proof about clients that merely share an SDK, nor "every MCP
  client" — hand-rolled clients and other-language SDKs remain untested, and the Python/Go
  probes are manual, so they can rot between runs.
- In-process `Bun.serve` + fake `execute`/Cache seams are not the production edge; the
  promotion-checklist smoke against the live URL covers the gap the unit lane cannot.
- This does not close `testing-strategy.md`'s structural gap in general — it closes it for
  the *one* boundary (MCP transport) where a canonical external consumer exists off the
  shelf. That framing should be stated plainly, not oversold.

## File layout

- `docs/project/mcp-client-interop-verification-plan.md` — this spec.
- `src/__tests__/mcp-client-interop.test.ts` — the interop tests.
- `package.json` — `@modelcontextprotocol/sdk` pinned in `devDependencies`.
- `website/README.md` — promotion-checklist real-client smoke step.
- `docs/testing-strategy.md` — "Honest gaps" updated: the MCP transport boundary is now
  exercised by an external consumer; everything else remains self-generated.
