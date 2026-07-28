# Stateless MCP migration: hosted `/mcp` and the local server

> **Status: phases 0–4 resolved.** Supersedes the analysis in
> [issue #186](https://github.com/adewale/agentic-mermaid/issues/186), which this
> document tracks item-by-item in §9 and corrects in §3. `TODO.md` remains the
> authoritative backlog; this is the design and evidence record.
>
> **The §11 re-verification gate was run early and waived, deliberately.** It
> required re-checking §4 against the published `2026-07-28` pages before merging
> phase 2. Those pages do not exist yet — `/specification/versioning` still names
> `2025-11-25` as current — and the maintainer chose on 2026-07-25 not to hold the
> work for the publication date. The re-verification was therefore run against the
> best available source instead of skipped: every §4 claim was re-read against the
> `/specification/draft/` pages, which is a strictly better evidence basis than the
> RC announcement §4 was originally assembled from. **It found four defects, all
> now fixed** (§4.2.1). §11 records what remains to be re-checked on publication.
>
> **Evidence basis.** Every normative claim below was read from the primary
> source on 2026-07-25 and is cited inline. SEP-2575 and SEP-2567 are marked
> **Final**. The assembled `2026-07-28` revision pages were read in their
> `/specification/draft/` form — the final revision publishes 2026-07-28, three
> days after this was written. §11 records what a reader should re-check once
> those pages exist; it is no longer a merge gate (see the waiver above).

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

## 2. Baseline (as-built before this migration)

This section is the pre-migration record — the state the analysis was done
against, kept intact so the gap analysis stays legible. For what changed, see §6.

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

Four properties verified directly against the code and production rather than
inferred:

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

### 4.2.1 What the re-verification corrected (2026-07-25)

Re-reading §4 against the spec pages rather than the RC announcement found four
defects. Three were in this document; three were live in the implementation.

| # | Claim as written | What the spec says | Effect |
| --- | --- | --- | --- |
| C1 | §4.2 item 6: `protocolVersion`, `clientInfo`, and `clientCapabilities` "are all required" | The per-request field table marks `clientInfo` **Required: No** — "Clients **SHOULD** include … unless specifically configured not to do so" | We answered 400 to conforming clients that withhold it. Fixed; `clientInfo` is now validated only when present. |
| C2 | §4 never mentions `resultType` | "The `result` **MUST** include a `resultType` field to indicate the type of the result" | We emitted none. Fixed on the modern path only — absence stays meaningful for legacy clients, which "**MUST** treat an absent `resultType` as `complete`". |
| C3 | §9 O1 files `ttlMs`/`cacheScope` as **Optional**, deferred because the SEP page 404'd | "Servers **MUST** include caching hints on results with `resultType: 'complete'` returned by … `server/discover`, `tools/list`" | Required for both list operations we implement, not a nicety. Implemented. |
| C4 | §6 phase 2 lists `-32021` among the error codes implemented | The code is real, but conditional: it applies only when "processing a request requires a capability the client did not include" | Nothing emitted it and nothing tested it. Our tools are pure functions needing no client capability, so it is unreachable; the constant is removed and a range test replaces it. |

A fifth finding, C5, was recorded and then **resolved** (F3). `mcp-handler.ts`
answered five transport rejections — origin, method, content-type, and two
body-size paths — with `-32000`, from the legacy half of the range that new
implementations "**SHOULD NOT** use … at all" and whose meaning receivers
"**MUST NOT** assume". §4.2 item 2 had treated the last `-32000` as removed by
the `-32022` work; these five survived it.

Reading them together showed why picking a better code was the wrong fix: **all
five refuse before a JSON-RPC request is ever parsed.** A GET has no body, and
the content-type and size checks refuse precisely because they will not read
one. The envelope claimed to answer a request that did not exist, and having an
envelope forced an error code into existence.

So the envelope goes, and the rule that replaces it is: **a JSON-RPC envelope
iff the spec defines a JSON-RPC error for the condition.** `-32020`, `-32022`,
and `-32601` keep theirs; these five now answer `{"error": "<reason>"}` with the
HTTP status — 403, 405, 413, 415 — as the machine signal. `website/e2e-mcp.sh`
already asserted only the status on every one of these paths, which is
independent evidence that the status was doing the work all along. The
legacy-range test is now an absolute: no production source may use `-32000`
through `-32019` at all.

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

**One genuine audit item — audited, passes.** The local server's `render_png`
with `output: "file" | "url"` mints managed artifacts with TTL and quota — the
one place we hand a caller a durable reference. That is precisely SEP-2567's
handle pattern, and its guidance applies: handles should be opaque, bounded in
lifetime, and for an unauthenticated server "generated from a cryptographically
secure random source with at least 128 bits of entropy… never derived from
predictable inputs".

Result: `src/mcp/artifacts.ts:135` builds the name as
`${createdAt.toString(36)}-${randomUUID()}${ext}`. The entropy comes from
`node:crypto`'s `randomUUID()` — a CSPRNG-backed UUIDv4, which is the SEP's own
worked example of an acceptable handle ("e.g. UUIDv4, or 22+ characters of
URL-safe base64"). Lifetime is bounded by the existing TTL (1h default) and the
quota/manifest machinery. The base36 timestamp prefix *is* derived from a
predictable input, but it is a prefix beside the random component, not a
substitute for it, so it does not narrow the search space; it exists for
lexical ordering during cleanup. No change required.

This is local-server-only — hosted `render_png` is base64-only and mints
nothing, so the hosted endpoint hands out no handles at all.

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

### Phase 0 — make the version list single-source ✅ implemented

Derive `website/build.ts`'s server-card `protocolVersions` from
`SUPPORTED_PROTOCOL_VERSIONS` and pin the equality (§10 item 5). Small, but it
must precede phase 1: every later phase edits that array, and today nothing
propagates the change to the published discovery document.

### Phase 1 — close the live gap (`2025-11-25`) ✅ implemented

- Add `'2025-11-25'` to `SUPPORTED_PROTOCOL_VERSIONS`.
- Gate the SEP-1303 envelope change (§3.2) on negotiated version ≥ `2025-11-25`:
  invalid tool arguments become an `isError: true` tool result; `2025-06-18` and
  earlier keep `-32602` unchanged.
- Corpus regenerated; the diff is the reviewable artifact.

Ships without waiting for the final `2026-07-28` text. This is the phase that
fixes a real, current lockout.

### Phase 2 — dual-era `2026-07-28` ✅ implemented (gate run and waived, §11)

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

### Phase 3 — surfaces, discovery, and the artifact-handle audit ✅ implemented

- `.well-known/mcp/server-card.json` `protocolVersions` (currently the three
  stale entries), `website/source/mcp-registry/server.json`, `server.json`,
  `/docs/mcp/`, `website/README.md`.
- Record the §4.4 artifact-handle audit result.
- Add the §7 probes to `website/e2e-mcp.sh`, which now runs on every deploy.
- Honesty note (issue #186's follow-up): `2024-11-05` in the hosted list is
  protocol-*version* support only. A client using the 2024-11-05-era HTTP+SSE
  *transport* gets 405 from `/mcp` and cannot connect. One sentence in
  `/docs/mcp/`.

### Phase 4 — local server ✅ implemented: per-transport version reporting

The pin was never the real question. `server.ts` reported ONE version list for a
server that answers over two transports with different obligations, and that
single number could not be right for both.

Its HTTP transport is literally the `2024-11-05` one: it writes `event:
endpoint`, hands back a `?sessionId=` URL, and holds a session map
(`MAX_SSE_SESSIONS = 32`). Streamable HTTP replaced that in `2025-03-26`, so no
newer revision can honestly be advertised over it. Its **stdio** transport
carries none of that baggage, and the dispatcher behind both implements
everything through the `2026-07-28` stateless era.

Reporting one list forced a contradiction into a single response: era selection
is a pure function of the request, so a modern `_meta` request was served the
modern envelope — `resultType`, caching hints — while the very same
`server/discover` payload advertised only `2024-11-05`.

`McpDispatchOptions.supportedVersions` now lets a transport NARROW the surface's
list (it intersects, so a transport can never introduce a revision the
dispatcher lacks). stdio reports what the dispatcher implements; the HTTP+SSE
call sites pass `['2024-11-05']`.

Two consequences make the advertisement true rather than decorative:

- **A declared version this transport does not serve is refused** with `-32022`
  and the list to retry from, instead of being silently served a different era.
  The HTTP transport already did this for the `MCP-Protocol-Version` header; a
  stdio client sends no header, so its claim went unchecked entirely.
- **`initialize` negotiates against the transport's list.** Advertising a
  revision and then refusing to negotiate it would rebuild the same mismatch
  inside one server.

That second change fixed a live defect nobody had noticed: the reference MCP SDK
client offers `2025-11-25`, the dispatcher has served it since phase 1, and the
local server answered `2024-11-05` anyway. `mcp-client-interop.test.ts` asserted
that downgrade as expected behaviour — with a note that an SDK dropping
`2024-11-05` would be "the signal to modernize the local server (#186)". It now
asserts the newest revision the two share.

Both transports are pinned in the response corpus as a pair — the same request
served on stdio and refused over HTTP+SSE — so the narrowing is reviewable
rather than asserted in prose.

One honest caveat, pre-existing and unchanged: this server has never implemented
JSON-RPC batching (every transport parses a single object, so an array is
refused with `-32600`). That is what `2025-06-18` and later require, and a
deviation for the two older revisions that permit it. The previous
`2024-11-05`-only pin was, on that axis, the least accurate claim it could have
made.

What remains genuinely open is a question about the transport, not this
migration: whether the local server should grow a Streamable HTTP transport at
all. Nothing in phases 0–3 depends on the answer.

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
| Rate limiting: shared-NAT IP bucketing, 429 without `Retry-After`, Workers `limit()` returning only `{success}` | **Yes** | Directly relevant. The primary `/mcp` route now has an outer WAF limit, while alias-complete WAF evidence remains `DEC-2` and the application-level bindings/concurrency/disable controls remain unimplemented under `SEC-4`. Their shared-NAT point is a good argument against treating IP-keyed limits as a complete agent-traffic control. |
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
| O1 | `ttlMs`/`cacheScope` on `tools/list` | **Misfiled — not optional. Implemented.** The caching page is normative: "Servers **MUST** include caching hints on results with `resultType: 'complete'` returned by … `server/discover`, `tools/list`". Both list operations now return `ttlMs: 300000` and `cacheScope: 'public'`. The earlier "not yet read" note was accurate — reading it is what reclassified the item (§4.2.1 C3). |
| O2 | JSON Schema 2020-12 in tool schemas | Deferred, re-confirmed against the draft: "When a schema does not include a `$schema` field, it defaults to JSON Schema 2020-12". Our closed simple schemas are valid 2020-12 as written, so there is nothing to change until a schema needs composition keywords. |
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
| F1 | Local server protocol version (`server.ts:61` pins `2024-11-05`) | **Closed.** The pin is correct, not stale: that server's HTTP transport *is* the 2024-11-05 one (`event: endpoint`, `?sessionId=`, session map), so advertising newer would be a false claim. See phase 4. |
| F3 | Five `-32000` transport rejections in `mcp-handler.ts` | **Closed.** All five refuse pre-parse, so they now answer without a JSON-RPC envelope at all rather than with a legacy-range code (§4.2.1 C5). |
| F4 | Local server served the modern era while advertising only `2024-11-05` | **Closed** by per-transport version reporting (§6, phase 4). |
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

- **The final text is not published — gate run early and waived (2026-07-25).**
  Everything in §4 was read from `/specification/draft/` and the two Final SEPs.
  The gate required re-verification against the published `2026-07-28` pages
  before merging phase 2; those pages 404 and `/specification/versioning` still
  names `2025-11-25` as current, so the maintainer chose not to hold the work for
  the publication date. The re-verification was run against the draft pages
  anyway and found four defects, all fixed (§4.2.1) — which is the argument for
  having run it rather than skipped it. **What is still owed on publication:**
  re-read §4 and §4.2.1 against the final pages, confirm `resultType`, the
  caching-hint operation list, and the `clientInfo` optionality survived
  assembly unchanged, and diff the response corpus. Nothing in the
  implementation assumes the draft was correct beyond what those pages say.
  Rechecked at `2026-07-28T02:29Z`: the
  [official versioning page](https://modelcontextprotocol.io/docs/learn/versioning)
  still named `2025-11-25` as current and the final `2026-07-28` pages were
  still absent. Issue #186 therefore remains open for this final-text diff,
  rather than being closed merely because the implementation PR merged.
- **Vacuous conformance tests** (§7.2) — the highest-probability way this
  migration ships broken while appearing tested. Mitigation: assert the
  negotiated version inside every conformance test.
- **SEP-1303 envelope change** (§3.2) alters observable behaviour for existing
  clients. Mitigation: gate on negotiated version; the corpus diff makes the
  change reviewable.
- **Dual-era doubles the paths under test.** Mitigation: the era predicate is a
  single function, tested directly, with the matrix in §7.3 driven off it.
- **Partly mitigated:** `/mcp` remains public and keyless, but its primary route
  now has an outer per-IP WAF limit. `DEC-2` remains until the equivalent
  `/.well-known/mcp` compute path is confirmed in the same rule; per-tool
  admission, bounded concurrency, a disable gate, and redacted observability
  remain `SEC-4`.
