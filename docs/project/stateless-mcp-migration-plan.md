# Stateless MCP migration: hosted `/mcp` and the local server

> **Status: plan, not implemented.** Supersedes the analysis in
> [issue #186](https://github.com/adewale/agentic-mermaid/issues/186), which this
> document tracks item-by-item in §9 and corrects in §3. `TODO.md` remains the
> authoritative backlog; this is the design and evidence record.
>
> **Evidence basis.** Every normative claim below was read from the primary
> source on 2026-07-25 and is cited inline. SEP-2575 and SEP-2567 are marked
> **Final**. The assembled `2026-07-28` revision pages were read in their
> `/specification/draft/` form — the final revision publishes 2026-07-28, three
> days after this was written, so §11 makes re-verification against the final
> text a gate on merging any of this.

## 1. Why this document exists

Issue #186 framed 2026-07-28 adoption as a handful of small edits: add a version
string to an array, generalize a batching comparison, update some docs. That
framing was wrong in two directions, and both matter.

**It missed a live defect.** The *current* MCP revision is `2025-11-25`
([versioning](https://modelcontextprotocol.io/specification/versioning): "The
**current** protocol version is **2025-11-25**"). Our hosted endpoint does not
support it and rejects it today:

```console
$ curl -sS -X POST https://agentic-mermaid.dev/mcp \
    -H 'content-type: application/json' \
    -H 'MCP-Protocol-Version: 2025-11-25' \
    -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
{"jsonrpc":"2.0","id":null,"error":{"code":-32000,"message":"unsupported MCP-Protocol-Version: 2025-11-25"}}
# HTTP 400
```

Any client pinning the current revision is already locked out. Issue #186 never
mentions `2025-11-25`; it treats `2025-06-18` as the present and `2026-07-28` as
the only future. That is a one-revision blind spot with a live consequence, and
it is the single most urgent item here.

**It understated the future work.** SEP-2575 does not add a version string to an
existing model — it deletes the model. `initialize` and `ping` are removed,
`server/discover` becomes mandatory, three new protocol error codes are defined,
unknown methods move to HTTP 404, and two new request headers become required
and must be validated against the body. §4 enumerates this.

## 2. Current state (as-built)

| Property | Hosted `/mcp` | Local `agentic-mermaid-mcp` |
| --- | --- | --- |
| Core | `src/mcp/hosted-server.ts` | `src/mcp/server.ts` |
| Transport | `website/src/mcp-handler.ts`, stateless Streamable HTTP | stdio; HTTP+SSE; `POST /rpc` |
| Server name | `agentic-mermaid-hosted` | `agentic-mermaid-mcp` |
| Protocol versions | `['2024-11-05','2025-03-26','2025-06-18']` (`hosted-server.ts:73`) | pinned `2024-11-05` (`server.ts:61`) |
| Default when header absent | `2025-03-26` (`hosted-server.ts:74`) | n/a |
| Tools | 9 | 4 |
| Dispatch | shared `dispatchMcpRequest` (`src/mcp/tool-surface.ts`) | same |
| Dependencies | none — hand-rolled JSON-RPC, no MCP SDK | same |

Behaviour already aligned with the stateless model, by construction rather than
by migration: no session is ever minted, `GET`/`DELETE` return 405, POST is
answered as a single `application/json` object with no SSE, notifications return
202 with no body, `Origin` is validated with 403, and every method in
`dispatchMcpRequest` is self-contained — nothing requires that `initialize`
happened first. SEP-2575's migration checklist (rip out session routing,
handshake state, sticky load balancing) is work we never have to do.

Three properties I verified directly against production rather than inferring:

- **The supported-version list is duplicated, with nothing keeping the copies in
  sync.** `SUPPORTED_PROTOCOL_VERSIONS` (`hosted-server.ts:73`) is the runtime
  authority, but `website/build.ts:2150` hardcodes the same three strings for
  the published `.well-known/mcp/server-card.json`, and does not import the
  constant. A phase-1 or phase-2 edit to the array would therefore ship a server
  card still advertising the stale set — discovery clients would be told we do
  not support a version we in fact serve. Fix by deriving the card from the
  constant, and pin it with a test (§10 item 5); do this *before* touching the
  array, or the first version bump silently breaks discovery.
- **CORS is correct on success paths.** Every return in `mcp-handler.ts` routes
  through `corsHeadersFor()`, including the 500 catch. A successful cross-origin
  `tools/call` carries `access-control-allow-origin: https://agentic-mermaid.dev`
  and `vary: Origin`. The peer-team failure mode in §8 (preflight fine,
  successful responses missing ACAO) does **not** apply to us.
- **`-32002` appears nowhere in the repo.** Already consistent with SEP-2164.
- **`_meta` on the `tools/call` params envelope passes through untouched.**
  `dispatchMcpRequest` reads only `params.name` and `params.arguments`, and
  `validateMcpToolArguments` is applied to `arguments` alone — the closed
  `additionalProperties:false` schemas never see the envelope. This is exactly
  the property SEP-2575 requires, and it holds today by accident. §10 pins it.

## 3. Two defects in the current implementation

### 3.1 `2025-11-25` is rejected (live, user-visible)

Cause: `SUPPORTED_PROTOCOL_VERSIONS` (`hosted-server.ts:73`) has not been
updated since `2025-06-18`. The header gate at `mcp-handler.ts:313-316` then
hard-rejects with 400 — which is *correct* behaviour for an unsupported version,
so the bug is purely the missing entry.

Nothing in `2025-11-25` is incompatible with us. Its changelog is dominated by
authorization, elicitation, and sampling changes we do not implement. Two items
touch us, and we already satisfy one: "servers must respond with HTTP 403
Forbidden for invalid Origin headers" (we do). The other is §3.2.

### 3.2 Input-validation errors are protocol errors, not tool errors

`2025-11-25` minor change 5, [SEP-1303](https://github.com/modelcontextprotocol/modelcontextprotocol/issues/1303):
"Clarify that input validation errors should be returned as Tool Execution
Errors rather than Protocol Errors **to enable model self-correction**."

We return JSON-RPC `-32602` for invalid tool arguments
(`tool-surface.ts:377-381`), which is a protocol error. Recorded in the new
response corpus as, for example:

```json
{"error": {"code": -32602, "message": "Invalid arguments for describe: arguments.nope is not allowed"}}
```

Under `2025-11-25` this should be an `isError: true` tool result so the model
sees it as a correctable tool outcome rather than a transport failure. Our
diagnostics are already prescriptive — the message names the offending field and
lists the valid ones — so this is a change of envelope, not of content. It is a
behaviour change for existing clients, so it must be gated on the negotiated
version (§6, phase 1).

## 4. What `2026-07-28` requires

Sources: [SEP-2575](https://modelcontextprotocol.io/seps/2575-stateless-mcp) (Final),
[SEP-2567](https://modelcontextprotocol.io/seps/2567-sessionless-mcp) (Final),
[draft Streamable HTTP binding](https://modelcontextprotocol.io/specification/draft/basic/transports/streamable-http),
[draft versioning](https://modelcontextprotocol.io/specification/draft/basic/versioning).

### 4.1 Already satisfied

| Requirement | Evidence |
| --- | --- |
| Single POST endpoint | `/mcp` |
| `GET`/`DELETE` → 405 | "respond with `405 Method Not Allowed`" — verified live |
| Never mint or echo `Mcp-Session-Id` | no session code exists |
| Ignore `Last-Event-ID`; no resumable streams | never implemented |
| Notification → 202, no body | `mcp-handler.ts:375,381` |
| `Origin` invalid → 403 | "servers **MUST** respond with HTTP 403 Forbidden" |
| No server-initiated JSON-RPC requests | we never send any |
| Request self-containment | every method is independent |

### 4.2 Must change

1. **`server/discover` becomes mandatory.** "Servers **MUST** implement
   `server/discover`." Returns `{supportedVersions, capabilities, serverInfo,
   instructions}` — every field of which we already produce for `initialize`,
   so this is a re-shaping of existing data, not new data.
2. **`UnsupportedProtocolVersionError` replaces our ad-hoc error.** Code
   `-32022`, with `data: {supported: string[], requested: string}`. We currently
   emit `-32000` and a bare message (`mcp-handler.ts:314`). The structured
   `supported` list is what lets a client retry correctly instead of failing.
3. **Unknown method → HTTP 404.** "If the server does not implement the
   requested RPC method, it **MUST** respond with `404 Not Found` and a JSON-RPC
   error with code `-32601`." We return that code at HTTP 200 today.
4. **`Mcp-Method` and `Mcp-Name` request headers.** "These headers are
   **REQUIRED** for compliance", and a server processing the body **MUST**
   validate them against it, rejecting mismatches with 400 and `-32020`
   (`HeaderMismatch`). `Mcp-Name` may arrive Base64-encoded via the
   `=?base64?…?=` sentinel and **MUST** be decoded before comparison.
5. **`MCP-Protocol-Version` header must match `_meta`.** Mismatch → 400 +
   `-32020`.
6. **Per-request `_meta` is required and must be validated.**
   `io.modelcontextprotocol/protocolVersion`, `…/clientInfo`, and
   `…/clientCapabilities` are all required; "A request missing any required
   field is malformed; the server **MUST** reject it with `INVALID_PARAMS` (and
   `400 Bad Request` for HTTP)." Note this inverts our current posture: `_meta`
   goes from *tolerated* to *mandatory and checked*.
7. **`initialize`, `notifications/initialized`, and `ping` are removed.** Under
   a `2026-07-28` request these are unknown methods (→ 404 + `-32601`). We
   currently answer all three.
8. **Batching is gone entirely.** "The body of the HTTP POST **MUST** be a
   single JSON-RPC *request* or *notification*." Issue #186's proposed fix —
   generalize the gate to *version ≥ 2025-06-18* — is directionally right but
   describes it as a per-version refusal; under `2026-07-28` a batch is simply
   not a legal body.
9. **CORS preflight must admit the new headers.** `CORS_BASE`
   (`mcp-handler.ts:106-111`) allows `content-type, mcp-protocol-version,
   mcp-session-id`. Since `Mcp-Method`/`Mcp-Name` are REQUIRED on every modern
   request, a browser client's preflight fails without them. Add both; drop
   `mcp-session-id` once legacy support ends.

### 4.3 Dual-era operation is explicitly blessed

Issue #186's instinct to keep answering `initialize` is correct and now has
normative backing. From the versioning page: "A server that wishes to support
both legacy clients … and modern clients … **MAY** implement both behaviors",
and "A dual-era **server** selects its behavior from how the client opens: A
request carrying modern per-request `_meta` is served statelessly according to
this revision. An `initialize` request selects legacy semantics."

The compatibility matrix gives Legacy→Dual-era and Modern→Dual-era both as
"Works". Dual-era is therefore the target posture, and the selection rule is
mechanical: **`_meta.io.modelcontextprotocol/protocolVersion` present → modern
path; `initialize` → legacy path.**

### 4.4 SEP-2567: nothing to do, with one audit

SEP-2567 removes sessions and recommends explicit state handles. It is emphatic
that handles are not a protocol feature: "There is no `handles/*` method, no
handle type in the schema, no wire-level concept of a handle at all… The
normative content of this SEP is the removal in (1)."

We hold no cross-call state. Every hosted tool is a pure function of its
arguments; the `execute` isolate is created and destroyed per call. There is
nothing to migrate, and the peer team's "use your existing app ID as the state
handle" lesson (§8) is inapplicable to us — we have no app ID because we have no
app state.

**One genuine audit item.** The local server's `render_png` with
`output: "file" | "url"` mints managed artifacts with TTL and quota — the one
place we hand a caller a durable reference. That is precisely SEP-2567's handle
pattern, and its guidance applies: handles should be opaque, bounded in
lifetime, and for an unauthenticated server "generated from a cryptographically
secure random source with at least 128 bits of entropy… never derived from
predictable inputs". The artifact store already has TTL, quota, and safe-name
generation; §6 phase 3 verifies the entropy and opacity of the generated names
against that bar. Note this is local-server-only — hosted `render_png` is
base64-only and mints nothing.

### 4.5 Deliberately not adopted

- **`subscriptions/listen`** — we send no notifications and declare
  `capabilities: {tools:{}}`. Not implementing it is honest, not a gap.
- **MRTR / `InputRequiredResult`** — we never need client input mid-call.
- **`x-mcp-header` on tool parameters** — optional for servers ("While the use
  of `x-mcp-header` is optional for servers, clients **MUST** support this
  feature"). No routing need; skip.
- **Roots / sampling / logging deprecations** — never implemented.
- **Tasks extension** — not implemented; our longest call is bounded by a 30s
  cpuMs budget.
- **MCP Apps** — a hosted diagram-preview surface is a plausible future, out of
  scope here.

## 5. Design decision: keep the hand-rolled dispatcher

The v2 TypeScript SDK offers `createMcpHandler(factory)` from
`@modelcontextprotocol/server` — ["one factory, one endpoint, both
eras"](https://ts.sdk.modelcontextprotocol.io/v2/migration/support-2026-07-28),
which is exactly the dual-era shape §4.3 describes.

**Recommendation: do not adopt it.** Reasons, in order of weight:

1. Our dispatcher is ~450 lines with zero dependencies, and the hosted worker's
   payload budget is a ratcheted, tested artifact (`website:payload:check`).
   Adding the SDK plus its validator graph is a measurable regression against a
   budget the repo actively defends.
2. The SDK does not decorate CORS — it emits bare protocol responses, so the
   host must apply headers at the route regardless (§8). We would take the
   dependency and still own the part that actually broke for the peer team.
3. Dual-era selection is a one-line predicate for us (§4.3). The SDK's value is
   concentrated in the stateful machinery we do not use.
4. We would inherit the `versionNegotiation` default trap (§7.2) in our own test
   clients without gaining anything on the server side.

**Where we should use the SDK: as a test client.** §7.2. An independent
conformance oracle is worth far more to us than an SDK-shaped server.

## 6. Phased plan

Phases are independently shippable and ordered by user impact.

### Phase 0 — make the version list single-source

Derive `website/build.ts`'s server-card `protocolVersions` from
`SUPPORTED_PROTOCOL_VERSIONS` and pin the equality (§10 item 5). Small, but it
must precede phase 1: every later phase edits that array, and today nothing
propagates the change to the published discovery document.

### Phase 1 — close the live gap (`2025-11-25`)

- Add `'2025-11-25'` to `SUPPORTED_PROTOCOL_VERSIONS`.
- Gate the SEP-1303 envelope change (§3.2) on negotiated version ≥ `2025-11-25`:
  invalid tool arguments become an `isError: true` tool result; `2025-06-18` and
  earlier keep `-32602` unchanged.
- Corpus regenerated; the diff is the reviewable artifact.

Ships without waiting for the final `2026-07-28` text. This is the phase that
fixes a real, current lockout.

### Phase 2 — dual-era `2026-07-28`

- `SUPPORTED_PROTOCOL_VERSIONS` gains `'2026-07-28'`.
- Implement `server/discover`, projecting the existing `initialize` payload.
- New error codes: `-32022` (with `data.supported`/`data.requested`), `-32020`,
  `-32021`.
- Unknown method → HTTP 404 for modern requests (unchanged at 200 for legacy).
- `Mcp-Method`/`Mcp-Name` validation with Base64-sentinel decoding.
- Per-request `_meta` validation on the modern path only.
- Reject batches on the modern path; keep them for ≤ `2025-03-26`.
- `CORS_BASE` gains `mcp-method, mcp-name`.
- Era selection per §4.3; `initialize` keeps working for legacy clients.

### Phase 3 — surfaces, discovery, and the artifact-handle audit

- `.well-known/mcp/server-card.json` `protocolVersions` (currently the three
  stale entries), `website/source/mcp-registry/server.json`, `server.json`,
  `/docs/mcp/`, `website/README.md`.
- Record the §4.4 artifact-handle audit result.
- Add the §7 probes to `website/e2e-mcp.sh`, which now runs on every deploy.
- Honesty note (issue #186's follow-up): `2024-11-05` in the hosted list is
  protocol-*version* support only. A client using the 2024-11-05-era HTTP+SSE
  *transport* gets 405 from `/mcp` and cannot connect. One sentence in
  `/docs/mcp/`.

### Phase 4 — local server (follow-up, non-blocking)

`server.ts:61` pins `2024-11-05`, matching its stateful SSE transport
(`MAX_SSE_SESSIONS = 32`, artifact store). stdio is unaffected by the transport
changes. Decide separately whether the local server advertises newer versions;
nothing in phases 1–3 depends on it.

## 7. Testing and verification

The existing MCP suite is 295 tests plus a 29-check production probe. This
section covers only what the migration adds. Two of these techniques exist
because a peer team lost time to their absence (§8).

### 7.1 Response-corpus characterization (shipped)

`src/__tests__/mcp-response-corpus.test.ts` records both servers' wire output —
handshake, every tool's description/annotations/schema, instructions, and a
fixed set of deterministic call and error payloads — to a baseline under
`src/__tests__/testdata/`, which puts it behind the `[approve-goldens]`
golden-drift gate. Every protocol change in §6 lands as a reviewable diff to
that corpus rather than as an invisible behaviour change. Red-green verified
against three perturbations: reworded description, added schema property,
reworded instructions.

### 7.2 Version-pinned conformance client — the trap that voids test suites

The peer team's most valuable lesson, and it is confirmed independently by the
SDK's own docs:

> **absent / `'legacy'`** — Default; performs 2025 `initialize` handshake only,
> no probe
> — [v2 SDK migration guide](https://ts.sdk.modelcontextprotocol.io/v2/migration/support-2026-07-28)

A test client constructed without an explicit `{ pin: '2026-07-28' }` negotiates
a 2025 revision and never touches the new code path. The suite passes and proves
nothing. This is a test that *cannot fail*, which is worse than no test, because
it is counted as coverage.

Requirements:

- Every conformance client pins explicitly. No test may rely on default
  negotiation.
- The pin is asserted, not assumed: each test verifies the negotiated version in
  the response before asserting anything else.
- Both eras are exercised — a pinned modern client and a legacy `initialize`
  client against the same endpoint, since dual-era is the whole design.
- At least one test asserts that an *unsupported* pin returns `-32022` with a
  `data.supported` list that actually contains our versions. That is the
  discriminating test for §4.2 item 2.

### 7.3 Header/body matching matrix

`Mcp-Method`/`Mcp-Name` validation is new attack surface: it is a place where a
load balancer and the server can disagree about what a request means, which is
precisely why the spec mandates the check. Cover the full matrix — header
matches body, header contradicts body, header missing, `Mcp-Name` Base64
sentinel (matching and non-matching after decode), and a plain-ASCII value that
itself looks like the sentinel (the spec requires clients to encode that case;
the server must not be confused by it either).

### 7.4 Browser CORS test

CORS cannot be verified by curl: a no-Origin request is not a browser request,
and every probe in `e2e-mcp.sh` today sends no Origin. The one honest test is a
real browser making a real cross-origin request. Per the peer team, that means a
Playwright page importing the client SDK against a `wrangler dev` server on a
different port — the port difference is what makes it genuinely cross-origin.

Two traps to encode:

- **Diagnose from the network log, never from the thrown error.** The SDK cannot
  distinguish a CORS block from a network failure and reports both as
  negotiation failure. A test that asserts on the exception message will
  misattribute the cause.
- **The MCP Inspector is not this test.** Its default mode proxies through a
  local Node process and exercises none of our headers. Its Direct mode does go
  cross-origin but (per the peer team, unverified by us) sends an internal
  `x-custom-auth-headers` request header that fails preflight against any server
  not allowlisting it. We should not allowlist a header we ignore.

Our CORS is currently correct (§2), so this test is a regression guard, not a
bug-discriminating test — and it should be described that way when it lands.

### 7.5 Production probe

`website/e2e-mcp.sh` now runs on every deploy, ordered after the retrying smoke
test so propagation has settled. Add: a `2026-07-28`-pinned `tools/list` with no
prior `initialize`; a `server/discover` call; an unsupported-version probe
asserting `-32022` *and* the `supported` array; a header-mismatch probe asserting
`-32020`; and an unknown-method probe asserting HTTP 404.

### 7.6 What we are not doing

No eval harness. The peer team's eval lessons — one-to-one expectation/track
matching, penalising unclaimed additions, rewarding preservation — are sound for
grading an agent's *edits to shared mutable state*. Our tools are pure
functions with deterministic output already covered by goldens; there is no
collaborator's work to preserve and no scoring ambiguity to game. Adopting an
eval harness here would be cargo-culting.

## 8. Peer-spec lessons: transferability assessment

From `adewale/keyboardia:specs/STATELESS-MCP.md`. That team has **not shipped**,
so this is untested advice; each row is judged against our implementation rather
than adopted wholesale.

| Lesson | Applies? | Assessment |
| --- | --- | --- |
| `versionNegotiation` defaults to `'legacy'`; unpinned test clients prove nothing | **Yes — critical** | Independently confirmed in the SDK docs. Adopted as §7.2. The single most valuable item they passed on. |
| SDK reports CORS failure as negotiation failure; diagnose from the network log | **Yes** | Adopted as §7.4. |
| Inspector normal mode proxies and tests no CORS; Direct mode sends `x-custom-auth-headers` | **Yes** | Adopted as §7.4. Their choice not to allowlist an ignored header is right. |
| Playwright + real browser is the only honest CORS test | **Yes** | Adopted as §7.4. |
| CORS must be applied at the route; SDK emits bare responses | **No — already correct** | Verified: every path routes through `corsHeadersFor()`, including the 500 catch, and a live cross-origin success carries ACAO. Their bug was shipping preflight-only CORS. Also reinforces §5: adopting the SDK would hand us this footgun. |
| Expose `MCP-Protocol-Version` via `Access-Control-Expose-Headers` | **Partly** | We set `expose-headers: x-agentic-mermaid-compute-cache` but send no `MCP-Protocol-Version` *response* header, so there is nothing to expose today. Revisit if we start echoing it. |
| Never forward raw error text to an agent | **Yes — verify** | We already return `INTERNAL_ERROR` with a fixed message and log the real one, and the wide event records a bounded error class with no message or stack. Worth a standing test rather than a change. |
| Import the SDK dynamically to avoid cold-start cost | **No** | We have no SDK import. The equivalent concern — the generated execute harness — is already lazy behind the Worker Loader. |
| ID grammar colliding with an existing wire protocol | **No, but instructive** | We mint no caller-chosen IDs. The nearest analogue is artifact names (§4.4), where the risk is entropy, not grammar collision. |
| Agent-only traffic breaks flush-on-disconnect persistence | **No** | We have no persistence lifecycle. |
| Rate limiting: shared-NAT IP bucketing, 429 without `Retry-After`, Workers `limit()` returning only `{success}` | **Yes** | Directly relevant and *still unimplemented for us* — `docs/project/mcp-abuse-controls-plan.md` is "planned, not implemented" and the endpoint is public and keyless. Their shared-NAT point is a good argument against IP-keyed limits for agent traffic. Tracked under SEC-4, out of scope here. |
| "Assign, never replace" mutation safety | **No** | Their rule protects concurrent writers to shared state. Our `mutate` takes a source string and returns a new one; there is no shared document to clobber. |
| Use the app's own ID as the state handle | **No** | We have no app state (§4.4). |
| Tiny deliberate tool surface; enum-in-schema over a resource | **Already done** | `describe_sdk` progressively discloses per-family op schemas rather than shipping a separate catalog. |
| Eval scoring design | **No** | §7.6. |

## 9. Issue #186 traceability matrix

Every item from the issue. Line references re-verified against current `main`
(`221f6ae`); the issue was filed 2026-07-17.

### Must

| # | Item | Verified | Status / disposition |
| --- | --- | --- | --- |
| M1 | Add `'2026-07-28'` to `SUPPORTED_PROTOCOL_VERSIONS` (`hosted-server.ts:73`), keep older versions | line accurate | Phase 2. **Amended:** `'2025-11-25'` must be added too and ships first (§3.1) — the issue omits it. |
| M2 | Generalize batching gate from `=== '2025-06-18'` to version ≥ (`mcp-handler.ts:352`) | line accurate | Phase 2. **Amended:** under 2026-07-28 a batch is not a legal body at all (§4.2 item 8), not merely refused. |
| M3 | Decide `initialize` behaviour; confirm a server may still answer it | — | **Resolved.** Dual-era is explicitly permitted; selection rule in §4.3. Answer `initialize` for legacy; treat it as unknown for modern. |
| M4 | Test: `2026-07-28` header, no prior `initialize`, succeeds on `tools/list`/`tools/call` | — | Phase 2, §7.2 — with the added requirement that the client pins explicitly, or the test is vacuous. |

### Should

| # | Item | Verified | Status / disposition |
| --- | --- | --- | --- |
| S1 | `_meta` tolerance test; keep closed schemas validating `arguments` not the envelope | **confirmed** — `dispatchMcpRequest` reads only `name`/`arguments` | Holds today. §10 pins it. **Amended:** `_meta` becomes *required and validated* on the modern path, not merely tolerated. |
| S2 | Error-code audit; regression test asserting no `-32002` | **confirmed** — zero occurrences repo-wide | Already conformant. Corpus records every error shape. **Amended:** three *new* codes arrive (`-32020/-32021/-32022`). |
| S3 | Add `Mcp-Method`/`Mcp-Name` to `access-control-allow-headers` (`mcp-handler.ts:106-111`) | line accurate | Phase 2. **Upgraded to required:** these headers are REQUIRED on modern requests, so browser preflight fails without them. |
| S4 | Update `/docs/mcp/`, `website/README.md`, `.well-known/mcp/server-card.json`, `website/source/mcp-registry/server.json` | all exist; server card serves the three stale versions | Phase 3. |
| S5 | Add a `2026-07-28`-pinned probe to `website/e2e-mcp.sh` | script exists; no pinned probe | Phase 3. Script now runs on every deploy (commit `a438bd2`). |

### Optional

| # | Item | Status |
| --- | --- | --- |
| O1 | `ttlMs`/`cacheScope` on `tools/list` | Deferred. Confirmed to exist (SEP-2549, via the RC announcement); the SEP page 404s at the URL tried, so the schema is **not yet read**. Genuinely attractive — our tool list is static per deploy and the compute cache already keys on deploy version. Re-verify against final text, then decide. |
| O2 | JSON Schema 2020-12 in tool schemas | Deferred. `2025-11-25` already establishes 2020-12 as the default dialect (minor change 10). Our closed simple schemas remain valid; no concrete need. |
| O3 | MCP Apps | Out of scope. |

### Explicit non-actions — all four re-confirmed

| # | Item | Confirmation |
| --- | --- | --- |
| N1 | Roots/sampling/logging deprecations | Not implemented; capabilities honestly declare `{tools:{}}`. 12-month window regardless. |
| N2 | Tasks extension | Not implemented. |
| N3 | OAuth `iss` validation (RFC 9207) | Hosted `/mcp` is unauthenticated; local HTTP uses a bearer token, not OAuth. |
| N4 | Session teardown / sticky-routing removal | No sessions exist. SEP-2567 requires nothing of us (§4.4). |

### Follow-ups

| # | Item | Status |
| --- | --- | --- |
| F1 | Local server protocol version (`server.ts:61` pins `2024-11-05`) | Phase 4, non-blocking. |
| F2 | Honesty note: `2024-11-05` is protocol-version support, not HTTP+SSE transport support | Phase 3. Confirmed accurate — a 2024-11-05-era transport client GETs `/mcp` and receives 405. |

### Issue claims now stale or wrong

1. **The `2025-11-25` omission** (§3.1) — the issue's premise that `2025-06-18`
   is our present is one revision out of date, and the gap is live.
2. **"The one must-do"** — the issue names the version-list edit as the sole
   compatibility cliff. It is the sole *cliff*, but not the sole *requirement*:
   `server/discover` is a MUST, and `-32022`, `-32020`, `-32021`, HTTP 404 for
   unknown methods, and header/body validation are all new obligations.
3. **The compliance table's framing** — accurate for `2025-06-18` and still
   useful, but it describes our GET-405 and JSON-only-POST choices as permitted
   options. Under `2026-07-28` they are the only legal behaviours, which is
   better news than the table implies.

## 10. Invariants to pin before changing anything

Regression guards, not bug-discriminating tests — state them as such:

1. `_meta` on the `tools/call` params envelope is ignored by argument
   validation (S1). Closed `additionalProperties:false` schemas must never be
   extended to the envelope.
2. No response path escapes CORS decoration, including the 500 catch (§2).
3. Raw error text never reaches a caller; `INTERNAL_ERROR` carries a fixed
   message and the wide event records a bounded class with no message or stack.
4. The corpus covers every registered tool on both surfaces — already asserted
   by `mcp-response-corpus.test.ts`.
5. The published server card's `protocolVersions` equals
   `SUPPORTED_PROTOCOL_VERSIONS`. This one is a genuine bug-discriminating test,
   not a regression guard: the two are duplicated today (§2) and would diverge
   on the very first version bump. Land it before phase 1.

## 11. Risks and gates

- **The final text is not published.** Everything in §4 was read from
  `/specification/draft/` and the two Final SEPs. **Gate: re-verify every §4
  claim against the published `2026-07-28` pages before merging phase 2.**
  Phase 1 does not depend on it and should not wait.
- **Vacuous conformance tests** (§7.2) — the highest-probability way this
  migration ships broken while appearing tested. Mitigation: assert the
  negotiated version inside every conformance test.
- **SEP-1303 envelope change** (§3.2) alters observable behaviour for existing
  clients. Mitigation: gate on negotiated version; the corpus diff makes the
  change reviewable.
- **Dual-era doubles the paths under test.** Mitigation: the era predicate is a
  single function, tested directly, with the matrix in §7.3 driven off it.
- **Unmitigated:** `/mcp` remains public, keyless, and unrate-limited (SEC-4).
  Removing `initialize` as a required first request marginally lowers the cost
  of an unauthenticated `tools/call`, which is an argument for landing rate
  limiting before advertising modern support widely — not a blocker for the
  work itself.
