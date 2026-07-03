# Hosted MCP on Cloudflare: plan

> **Status: shipped (PR #94).** This began as a design plan and is now the
> as-built record of the hosted MCP endpoint live at
> `https://agenticmermaid.dev/mcp`. The "Where we start" section below is
> preserved as the pre-build starting point; the "Post-review hardening"
> sections (rounds 1–5) track the audit findings applied after the initial
> build.

Plan for turning the website's `/mcp` 501 placeholder into a real hosted MCP
endpoint at `https://agenticmermaid.dev/mcp`. The account is on the **Workers
Paid plan with Dynamic Workers** (<https://developers.cloudflare.com/dynamic-workers/>),
which changes the earlier free-tier plan in one fundamental way: hosted Code
Mode (`execute`) is now viable — agent-supplied JavaScript runs in an isolated
dynamic Worker instead of being local-only.

## Where we start

- The website is a Cloudflare Worker with Static Assets
  (`website/wrangler.jsonc`, `website/src/worker.js` at the time — now
  `worker.ts`); `/mcp` returned an honest 501 before this work.
- The MCP server (`src/mcp/server.ts`) has a transport-agnostic JSON-RPC core,
  `handleRequest(req, context)`, plus stdio and node HTTP/SSE transports.
- Tools today: `execute` (Code Mode in a hardened `node:vm` sandbox),
  `render_png` (native `@resvg/resvg-js`), `describe`.
- **Viability probe (done):** the pure SDK surface — parse, mutate, verify,
  analyze, serialize, describe, `renderMermaidSVG`, `renderMermaidASCII`, the
  Code Mode facade — bundles for the workerd target at 2.2 MB raw / 657 KB
  gzip with zero Node dependencies, and renders correctly from that bundle.
  The only native/VM dependencies in the whole graph are `png.ts` (napi resvg)
  and `sandbox.ts` (`node:vm`), both replaced per the table below. elkjs is
  the bundled pure-JS build driven synchronously (`src/elk-instance.ts`) and
  needs nothing from Node.

## Hosted tool surface

| Tool | Local implementation | Hosted implementation |
|---|---|---|
| `execute` | `node:vm` hardened sandbox | **Dynamic Worker** per code hash: harness module (SDK bundle + the same hardened facade) + agent code as a module, `globalOutbound: null`, `limits: { cpuMs, subRequests: 0 }` |
| `render_png` | native `@resvg/resvg-js` | `@resvg/resvg-wasm` + bundled DejaVu Sans (convenience surface; wasm output is not covered by the byte-determinism contract) |
| `describe` | pure | same code, unchanged |
| `render_svg` | — (use execute) | pure, hosted-only |
| `render_ascii` | — (use execute) | pure, hosted-only |
| `verify` | — (use execute) | pure, hosted-only |

The three hosted-only pure tools exist for cost, not philosophy: locally,
`execute` is free, so Code Mode stays the single entry point
(`docs/mcp-code-mode-rationale.md` still holds). Hosted, every `execute`
spins/bills a dynamic Worker, so the common render/verify paths get direct
tools that cost one ordinary Worker invocation and are edge-cacheable. The
implementations live in the shared hosted core (`src/mcp/hosted-server.ts`),
not the website, so there is exactly one implementation of each.

## Hosted `execute` via Dynamic Workers

Design (API per <https://developers.cloudflare.com/dynamic-workers/api-reference/>):

- The parent Worker holds a `worker_loaders` binding (`LOADER`). On
  `execute`, it calls `env.LOADER.get(id, async () => workerCode)` where:
  - `id` = `am-exec-<pkg.version>-<sha256(code)>` — identical code reuses a
    warm isolate; the callback only runs on cold load.
  - `workerCode.modules` = the prebuilt **harness** (SDK bundle + Code Mode
    facade + result plumbing, built by `website/build.ts` and imported into
    the parent as a text module) plus the agent code wrapped as ONE module
    per isolate. workerd compiles every registry module eagerly at isolate
    startup (discovered in the wrangler e2e — a lazy `import()` fallback
    inside one isolate is impossible), so the expression-first choice
    `sandbox.ts` makes is decided by the loader itself: the parent starts the
    expression-form isolate first and falls back to a statement-form isolate
    when startup fails with a SyntaxError. Statement-form code costs one
    failed isolate attempt; identical repeats never reach the loader thanks
    to the response cache.
  - `globalOutbound: null` — the isolate cannot `fetch()` or `connect()`
    at all; `env` is empty, so there is nothing to reach or leak.
  - `getEntrypoint(null, { limits: { cpuMs: min(timeoutMs, 30_000),
    subRequests: 0 } })` enforces the compute budget; hitting it throws,
    which maps to the same `{ ok: false, error }` shape as a local timeout.
- The harness passes the user function the **same hardened `mermaid` facade**
  the vm sandbox uses (`createTracingMermaid`, extracted to a runtime-neutral
  `src/mcp/facade.ts`), so read-only results, trusted-diagram checks, and
  error messages match local behavior. Sync-only enforcement
  (`unsupportedCodeReason`) runs parent-side before any isolate is created —
  rejected code costs nothing.
- Result contract is byte-identical in shape to local: `{ ok, value, logs,
  error }`, with the same undefined→null promotion and Map/Set JSON
  normalization.

Known, documented divergences from local `execute`:

1. `timeoutMs` is enforced as **CPU** milliseconds (`cpuMs`), not wall-clock;
   for pure synchronous compute these are close but not identical.
2. A warm isolate can serve repeated identical code, so module-level global
   mutation (`globalThis.x = ...`) may be visible across calls with the same
   code — locally every call gets a fresh vm context. Response caching (below)
   makes identical requests return the first result anyway; the divergence is
   only reachable when the edge cache misses but the isolate is warm.
3. Isolation authority differs: locally the proxy facade is the security
   boundary; hosted, the isolate + `globalOutbound: null` is, and the facade
   is kept for behavioral parity.
4. Hosted output is bounded at the source: console logs cap at 1,000
   entries / 256 KB (a truncation marker is appended) and serialized results
   at 2 MB, with the parent's capped stream-read of the isolate response as
   the backstop. The vm sandbox has no output caps.

Post-review hardening (external audit, round 1): Worker Loader isolate IDs
carry a `deployTag` — package version **plus a hash of the harness bundle** —
because the Worker Loader contract is that one ID always maps to the same
WorkerCode; without the hash, a harness/SDK change that ships without a
version bump could keep serving stale warm isolates. Request bodies and
isolate responses are stream-read with hard byte caps (no buffering past the
limit), `render_png` clamps `scale` to 0.1–8 and enforces a ~16.7 MP
output-pixel budget, and the e2e probe pins workerd's codegen bans (`eval`,
`Function` constructor) plus the log cap against a live isolate.

Post-review hardening (external audit, round 2):

- **Full-deploy cache version.** The harness hash covers Code Mode isolate
  IDs, but the /mcp *response* cache also stores `render_svg` / `verify` /
  `describe` / `render_png` results, whose implementations live in
  `hosted-server.ts`, `mcp-handler.ts`, `png-wasm.ts`, and the wasm/fonts —
  none of which are in the harness bundle. `cacheVersion` is now a
  `DEPLOY_VERSION` computed at build time (`website/src/deploy-hash.ts`,
  emitted to `generated/deploy-version.ts`): a length-prefixed SHA-256 over
  the **bundled worker JS closure + harness + wasm + fonts + the main
  worker's `compatibility_date`**. Any change to any hosted tool, the
  transport, the PNG path, an asset, or the worker's runtime semantics moves
  it and invalidates cached results, version bump or not. Isolate IDs keep the
  narrower harness hash (they *are* just harness + user module).
- **Cache keys from normalized effective arguments.** The key was a hash of
  raw `req.params`; handlers drop unknown args and clamp `scale`/`timeoutMs`,
  so a caller could add `{ nonce }` or vary an out-of-range `scale` to force
  recompute and defeat the cost control. `cacheKeyFor` (in `hosted-server.ts`,
  the single source of truth the handlers also use for clamping) now derives
  the key from only the output-affecting arguments, normalized: unknown keys
  dropped, `scale` clamped and defaulted to its resolved value (omitted and
  explicit `scale: 2` share one entry), `timeoutMs` excluded from `execute`
  (it is a budget, not an input). Calls it deems uncacheable (unknown tool,
  missing required arg, non-base64 `render_png` output) bypass the cache and
  run directly — they error, and errors were never cached.

**Scope of the cost-control guarantee (external audit, round 3 — adversarial
multi-agent verification found no correctness/poisoning bug; these are the
low-severity refinements it surfaced):**

- The normalization covers **arguments**, not the `source`/`code` payload,
  which is keyed **verbatim by design**. Keying on the raw payload is what
  makes a cached response provably correspond to what that exact input
  renders; canonicalizing the payload (e.g. stripping Mermaid comments) is
  deliberately avoided because two payloads that canonicalize alike are not
  guaranteed to render byte-identically — a wrong cached result is far worse
  than a missed dedup. A caller can therefore still force recompute by varying
  insignificant payload bytes (comments/trailing whitespace). That residual is
  bounded by the **WAF rate limit** (the actual abuse backstop; see
  `website/README.md`), not by the cache.
- `execute` is cached on `code` alone. Code Mode is intended for deterministic
  SDK workflows; a non-deterministic body (`Date`/`Math.random`) has its first
  result frozen for the cache TTL. This is pre-existing — `execute` results
  were always cached — and inherent to caching arbitrary code; it is not a
  cross-caller integrity issue (identical `code` → identical key by definition).
- The response cache is a **cost optimization for legitimate repeat traffic**,
  not the abuse control. The WAF rate-limiting rule on `POST /mcp` is the
  primary defense against a determined attacker and remains a launch
  requirement.

**Post-review hardening (external audit, round 4 — full-PR multi-agent audit,
5 lenses):** one P1 (wrapper-breakout containment) and a set of low-severity
test-coverage and transport refinements. The verified fixes:

- **Wrapper-breakout containment, stated honestly.** Agent code is concatenated
  into an ES module, so code that closes the harness function early with `}`
  reaches module scope. Two layers close what the isolate boundary already
  bounds: (1) the harness wraps the user function in **parentheses** (an
  expression position), which makes an injected top-level `import`/`export`/`;`
  a **SyntaxError** — so a `import ... from 'cloudflare:sockets'` breakout fails
  the isolate start rather than running; and (2) `hardenIsolateGlobals()` runs
  at isolate startup, **before** `user.js` is dynamically imported, and strips
  capability globals (`fetch`, `caches`, `crypto`, `connect`, …) plus
  `Error.prepareStackTrace`. A comma+IIFE tail can still *run* at eval time, but
  only against stripped capabilities. These are **defense in depth** — the
  guaranteed boundary remains the isolate config (`globalOutbound: null`, empty
  env, no bindings, `cpuMs`). `NEUTRALIZED_ISOLATE_GLOBALS` is restricted to
  globals provably unused by the harness and the pure SDK at run time (verified
  by the wrangler e2e, which still renders after hardening).
- **Test-coverage gaps closed.** The Promise.race wall-clock backstop, the
  empty/non-JSON isolate-body malformed guard, `readCapped`'s byte-exact cap
  (boundary + cross-chunk + UTF-8 straddle), multi-chunk base64 encoding, and
  CORS headers on HTTP-level error responses now have discriminating tests
  (each fails when its mechanism is removed).
- **Transport nits.** The Promise.race timer is cleared in a `finally` so a
  winning fetch leaves no dangling timer, and an empty/non-JSON isolate body
  degrades to `sandbox returned a malformed result` instead of leaking a raw
  `JSON.parse` error.

Residual honesty: `website/e2e-mcp.sh` is a **manual** probe run against a live
`wrangler dev` (it needs the Worker Loader), **not** a CI gate; the CI gate is
`bun test src/__tests__/`. The isolate-level containment (globals stripped on
the real `globalThis`, breakout rejected) is what the e2e pins; the unit suite
pins the pure, runtime-neutral pieces (`neutralizeGlobalsOn` on a throwaway
target, `userModuleSources` rejection, the log cap).

**Post-review hardening (external audit, round 5 — transport abuse/conformance):**

- **Batch fan-out cap.** A JSON-RPC array ran every item under `Promise.all`,
  so one 128 KB body could pack many `tools/call` items that each spin a
  billable isolate/render — a single request amplifying past the per-IP WAF
  limit. `MAX_BATCH_ITEMS` (20) now bounds a batch, refused with 400 before any
  item runs.
- **`MCP-Protocol-Version` validation + 2025-06-18 batch rule.** The transport
  now rejects an explicit unsupported version header with 400, and — because
  MCP 2025-06-18 *removed* JSON-RPC batching — refuses an array body when the
  header pins that revision. Older negotiated versions (2024-11-05 / 2025-03-26,
  or no header) may still batch, so existing clients are unaffected.
- **CORS Origin validation.** Wildcard `Access-Control-Allow-Origin: *` on a
  public, credential-less endpoint is not itself an access-control hole — CORS
  gates only browser reads and never the agent/server clients that ignore it —
  but `*` does let an arbitrary site silently drive a *visitor's* browser
  against the endpoint (distributed across visitor IPs, diluting the per-IP WAF
  limit). CORS is now **reflective with Origin validation**: a no-Origin client
  (agent/server) still gets `*`; a browser Origin is echoed only when it is
  same-origin / localhost / allowlisted (`agenticmermaid.dev`); a disallowed
  browser Origin gets no `Access-Control-Allow-Origin` and a 403. This follows
  the MCP Streamable HTTP Origin-validation guidance without breaking any
  non-browser client (the website itself does not call `/mcp` from the browser).

## Transport: stateless Streamable HTTP

Unchanged from the original plan and still the cheapest correct choice — the
tools are pure functions of their inputs:

- Single `POST /mcp` accepting JSON-RPC, responding `application/json`.
  No sessions, no SSE stream, `GET /mcp` → 405, notifications → 202.
- No Durable Objects, agents SDK, KV, R2, or Queues.
- Protocol version negotiated from a known-good list (the core currently pins
  `2024-11-05`; Streamable HTTP clients offer `2025-03-26`+).
- **Response caching:** layout is deterministic, so `tools/call` responses
  (except nothing — all six tools are deterministic) are cached in the Workers
  Cache API keyed on SHA-256 of `(tool, canonicalized arguments)`. Repeat
  requests skip compute entirely; for `execute` they also skip the dynamic
  Worker, which is the biggest cost lever.
- Hygiene: 128 KB body cap, 64 KB Mermaid-source/code caps with structured
  errors pointing at the local CLI, `content-type` enforcement, CORS `*`
  (public, credential-less, read-only compute), one WAF rate-limiting rule
  (e.g. 60 req/min/IP on `POST /mcp`, configured in the dashboard and
  recorded in `website/README.md`).

## Cost model (Workers Paid)

| Meter | Included | Overage | Our exposure |
|---|---|---|---|
| Worker requests | 10 M/month | $0.30/M | every `/mcp` call + one internal request per uncached `execute` |
| CPU time | 30 M ms/month | $0.02/M ms | renders are ms-scale; `execute` capped at 30 s by `cpuMs` |
| Unique dynamic Workers | 1,000/month | $0.002/Worker/day | one per **unique** `execute` code string per day (hash-keyed + edge-cached; retries and repeats dedupe) |

Levers that keep this near the plan's $5/month floor: edge caching of
deterministic responses, code-hash isolate reuse, parent-side rejection of
unsupported code, `subRequests: 0`, size caps, and the WAF rate limit as the
abuse backstop. The pure tools keep the high-volume paths (render/verify) off
the dynamic-Worker meter entirely. No other billable primitives are used.

## Verification strategy

Two external toolkits gate this work, per the repo owner's direction:

- **testing-best-practices** (<https://github.com/adewale/testing-best-practices>):
  - Red-green for new behavior: hosted-core tests written to fail without the
    implementation; red/green evidence stated in the PR.
  - **Differential testing** (`references/differential-testing.md`): the local
    `node:vm` sandbox is the reference implementation; a corpus of Code Mode
    snippets (happy paths, SDK misuse, mutation attempts, sync violations,
    serialization edges) runs through both `executeInSandbox` and the harness
    execution semantics, asserting matching `{ ok, value, logs, error }`.
  - Error-path tests, not just invalid input: loader failures, cpu-limit
    exceptions, oversized bodies, wrong content types, malformed JSON-RPC.
  - Real objects over mocks: transport tests drive the actual `fetch` handler
    with real `Request`/`Response`; the only faked seam is the Worker Loader
    binding (a purpose-built fake implementing `get/getEntrypoint`, since
    workerd is not available inside `bun test`), and a `wrangler dev` e2e
    covers the real binding.
- **cfdoctor** (<https://github.com/adewale/cfdoctor>): static scan
  (`cfdoctor_static_scan.py`) plus the skill's audit playbook run against
  `website/` before shipping; findings triaged with evidence and fixed or
  explicitly accepted in the audit output.

Plus the repo's own gates: `bun test src/__tests__/` (existing MCP tests must
stay green through the refactor), `bunx tsc --noEmit`, `bun run
website:check`, and a `wrangler dev` end-to-end pass (`website/e2e-mcp.sh`:
initialize → tools/list → each tool, including a real dynamic-Worker
`execute`). Known local-dev limitation found in that pass: wrangler dev does
not enforce dynamic-worker `cpuMs`, so an unbounded sync loop wedges local
workerd; production enforces `cpuMs` at the runtime and the parent races a
wall-clock backstop so `/mcp` always answers. The e2e also flushed out an
ELK instantiation failure under workerd (fixed in `src/elk-instance.ts` by
flipping elk-worker's environment sniff with a temporary `document` global
instead of deleting the undeletable `self`).

## Implementation steps

1. **Extract runtime-neutral modules.** `src/mcp/protocol.ts` (JSON-RPC
   types + reply/error helpers), `src/mcp/facade.ts` (`createTracingMermaid`,
   `unsupportedCodeReason`, wrapping helpers) importing the pure agent
   surface, not the barrel (the barrel exports `png.ts`, which drags native
   resvg into every graph). `server.ts`/`sandbox.ts` keep their exports and
   behavior; existing tests untouched.
2. **Hosted core** `src/mcp/hosted-server.ts`: `handleHostedRequest(req,
   context)` with the six-tool surface; `execute` and `render_png` accept
   injected implementations so the core stays runtime-neutral and testable in
   `bun test`.
3. **Harness** `src/mcp/dynamic-harness.ts` (entry compiled to a single text
   asset by `website/build.ts`): fetch handler that builds the facade, imports
   the user module (expression-first with `SyntaxError` fallback), executes,
   serializes to the `ExecuteResult` contract.
4. **Website worker** `website/src/worker.ts`: existing static/redirect logic
   unchanged; `/mcp` branch implements the streamable-HTTP handler, cache
   layer, loader-backed `execute`, wasm `render_png`. `wrangler.jsonc` gains
   `worker_loaders`, text/data module rules for the harness and font, and
   keeps Static Assets.
5. **Tests** as described under verification; `src/__tests__/website-build.test.ts`
   now asserts the live hosted endpoint (the 501 assertion it carried is gone).
6. **cfdoctor audit + wrangler dev e2e**, fix findings.
7. **Docs**: `website/README.md`, `docs/mcp-http-transport.md` cross-link, a
   hosted-MCP section documenting the endpoint, tool surface, limits,
   divergences, and the dashboard-side rate-limit rule.

## Explicit non-goals

- No REST render API — MCP only.
- No accounts or tokens; abuse control is caps + rate limiting.
- No hosted artifact storage; `render_png` returns base64 only (`output:
  "file"/"url"` stay local-server features).
- Durable Object facets, dynamic Workflows, and egress-controlled outbound
  fetch (Dynamic Workers features) are all unused — the isolates need no
  state and no network.
