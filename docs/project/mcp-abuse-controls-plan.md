# Hosted MCP abuse controls: plan

> **Status: planned, not implemented.** Design captured 2026-07-10 from an
> audit session (cfdoctor rubric + live Cloudflare docs + local benchmarks).
> Every Cloudflare behavior claim below is grounded in an official doc fetched
> that day (URL cited per control); anything not doc-verified is flagged.
> Companion to `hosted-mcp-cloudflare-plan.md` (the as-built record this plan
> hardens).

## Threat model

`/mcp` is public, keyless, unauthenticated compute. The billing meter is
Dynamic Worker CPU time plus ordinary Workers requests. The controls already
shipped bound a single request — 64KB per input field, 128KB body, 20-item
batch fan-out, **at most one `execute` item per batch**
(`MAX_EXECUTE_ITEMS_PER_BATCH`, `website/src/mcp-handler.ts`), 30s isolate
`cpuMs`, `subRequests: 0`, `globalOutbound: null`, payload-hash response cache
keyed by deploy version — but nothing yet bounds *sustained* or *distributed*
traffic, and the WAF rate-limit rule is dashboard-side and still unprovisioned
(promotion checklist).

Measured ground truth (local `node:vm` sandbox, semantic twin of the hosted
isolate; `scratchpad` benchmarks, 2026-07-10):

| Workload | Input size | Time |
|---|---|---|
| parse + verify + serialize, 875-node flowchart | 62.6KB (≈ the 64KB cap) | **~18.0s** |
| parse + watercolor render, same source | 62.6KB | ~8.3s |
| parse + verify, 800-node flowchart | 57.1KB | ~12.9s |
| parse + verify + serialize, 300-node flowchart | 21.0KB | ~3.1s |
| 1,200-message sequence diagram | 54.6KB | ~0.07s |
| 200 sequential `mutate` calls on a 300-node base | — | >120s (any budget correctly kills it) |

Consequences: the 30s per-item budget is **correctly sized** (worst legitimate
single item needs ~18s; edge CPUs may be slower than the bench box) — controls
must cut *multiplicity, rate, and totals*, not the per-item budget.

## The six controls

### 1. Manual kill switch (config flag, no build) + drill

**Design.** A flag that makes `execute` return
`{ code: 'EXECUTE_DISABLED', message: <LOCAL_FALLBACK_HINT wording> }` while
the seven cheap tools keep serving. Checked at the top of `handleExecute`
(`src/mcp/hosted-server.ts`), wired through `website/src/worker-core.ts`.

**Mechanics.** Two storages, both consulted (`disabled = env flag || KV flag`):

- *Human path:* an env var flipped with `wrangler secret put EXECUTE_DISABLED`
  or a dashboard var edit — pushes a new version of the same code in seconds,
  no build/CI.
- *Machine path:* a KV flag, because a Worker cannot set its own env vars and
  the automated breaker (control 4) must be able to actuate the switch. Read
  through a ~30s in-isolate memo so the hot path pays no per-request KV read.

**Drill (required, not optional).** A scripted game day against production
while the user count is zero: flip the flag, assert `execute` →
`EXECUTE_DISABLED` + hint, assert `verify`/`render_svg` still 200, flip back,
assert recovery, record flip-to-effect latency in the README runbook. Re-run
whenever flag plumbing changes. (cfdoctor: "load/chaos tests or scripted
drills prove circuit breakers, kill switches … work before production
incidents"; playbook check #28, denial-of-wallet game day.)

**Trade-offs.** Near zero; env path causes harmless version churn; KV path
adds a binding and a ≤30s propagation window. **Effort:** ~1–2h + drill script.

**Source basis:** Workers env/secrets and KV are standard platform behavior
(developers.cloudflare.com/workers/, fetched 2026-07-10 via
workers/platform/limits and best-practices pages); drill doctrine from the
cfdoctor skill (adewale/cfdoctor, `config-and-security-checks.md`,
`audit-playbook.md`).

### 2. Payload-proportional CPU budgets

**Design.** Scale the default isolate budget with input size:

```
default_budget_ms = clamp(3000 + 450 × payload_KB, 3000, 30000)
```

Against the measured curve this keeps ≥1.7× headroom at the worst point
(62.6KB → grants 30s vs 18s measured; 57KB → 28.6s vs 12.9s; 21KB → 12.5s vs
3.1s) while a sub-1KB attack payload (`for(;;){}`) drops from 30s to ~3.5s —
an ~8× cut in per-request attack value.

**Escape hatch (required for honesty).** Legitimate small-payload/heavy-compute
exists: 300 bytes of code that programmatically builds an 800-node diagram.
Callers may already pass an explicit `timeout` argument (honored up to
`MAX_EXECUTE_TIMEOUT_MS`); keep that, but route requests with `timeout > 10s`
into the stricter rate bucket of control 3. Proportional *default*, explicit
*escalation*, scarce escalation budget.

**Where.** `src/mcp/hosted-server.ts` effective-timeout computation (~line
436); `website/src/execute-loader.ts` already passes
`limits: { cpuMs, subRequests: 0 }` per `getEntrypoint()` call.

**Trade-offs.** Reshapes default economics only — an attacker can still
request 30s explicitly (that is what controls 3 and 4 bound). **Effort:** ~1h
+ cases in `hosted-execute-differential.test.ts`.

**Source basis:** Dynamic Workers custom limits —
developers.cloudflare.com/dynamic-workers/usage/limits/ (fetched 2026-07-10;
doc dateModified 2026-05-05): limits settable per `getEntrypoint()` call, and
when set in both worker code and the entrypoint call, **the lower of the two
wins**, so this composes safely with any future in-code limits. Formula
constants from the local benchmarks above.

### 3. In-worker rate limiting binding, per-tool

**Design.** Cloudflare's Rate Limiting API binding checked in code after
JSON-RPC parse (tool name known) and before dispatch — "rate-limit before
expensive Worker/storage work". Three buckets, keyed by client IP:

| Bucket | Applies to | Suggested start |
|---|---|---|
| `RL_EXECUTE` | `execute`, default budget | 10 / 60s |
| `RL_EXECUTE_LONG` | `execute` with explicit `timeout > 10s` (control 2's escape hatch) | 3 / 60s |
| `RL_TOOLS` | everything else | 120 / 60s |

On refusal: 429 + `Retry-After` + the local-fallback hint; wide event records
`outcome: 'rate_limited'`.

**Config shape (doc-verified).** `wrangler.jsonc` `ratelimits` entries with
`{ name, namespace_id, simple: { limit, period } }`; `period` must be **10 or
60 seconds**; the binding exposes `limit({ key }) → { success }` and is backed
by the same infrastructure as WAF rate limiting rules.

**Trade-offs (doc-verified, quoted).** The API is "permissive, eventually
consistent, and intentionally designed to not be used as an accurate
accounting system" — a distributed attacker gets slack (control 4 backstops
totals). The doc recommends against IP keys because of shared NAT; a keyless
server has nothing better, so accept occasional NAT-shared 429s (the hint
offers the local path) and revisit if an identity tier ever lands. Tests need
a fake binding injected the way tests already fake `LOADER`. Keep a coarse
dashboard WAF rule as defense in depth (fires before the Worker runs at all).
**Effort:** ~2h.

**Source basis:**
developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/ and
developers.cloudflare.com/waf/rate-limiting-rules/best-practices/ (both
fetched 2026-07-10).

### 4. Automated budget breaker (actuates control 1's flag)

**Design.** A self-imposed daily execute budget; exhaustion flips the KV kill
flag automatically. Rate limits bound *rates*; this bounds the *integral* —
the only hard spend guarantee in the stack.

**Recommended architecture: Analytics Engine + cron sweeper.** Each execute
writes a data point (doubles: granted `cpu_budget_ms`, wall duration; blobs:
outcome) — `writeDataPoint()` returns immediately and needs no `await`
(doc-verified), so the request path pays nothing. A scheduled Worker (cron,
~5 min) queries the AE SQL API for today's sum: over budget → write the KV
flag; over an 80% threshold → alert webhook. Detection lags by cron interval
+ AE ingest, so size the budget as "target + a few minutes of worst-case
burn."

**Alternative (tighter, heavier): DO singleton.** `ctx.waitUntil` increments;
breaker state read via the same ~30s memo as control 1; a DO alarm
(at-least-once execution guaranteed, single alarm per object — doc-verified)
resets daily and alerts. Rejected for now: it is exactly the low-cardinality
hot-object pattern the cost rubric warns about, and it couples `/mcp` to one
object.

**Manual override is inherent:** the breaker's actuator *is* control 1's flag.
**Effort:** ~half a day incl. the cron Worker and a synthetic-budget drill.

**Source basis:**
developers.cloudflare.com/analytics/analytics-engine/get-started/ and
developers.cloudflare.com/durable-objects/api/alarms/ (fetched 2026-07-10).
**Not doc-verified:** AE pricing/quotas and Dynamic Workers pricing (the
pricing page 404'd at audit time) — verify both before wiring, per the
provenance rule that billing claims need current official pricing docs.

### 5. Cost-proxy fields in the wide events

**Design.** Add to each per-item entry of the existing wide event
(`website/src/mcp-handler.ts`, `McpItemEvent`): `isolate_spawned` (false on
cache hit / coalesced / killed), `cpu_budget_ms` (what control 2 granted —
the worst-case liability of that call), `coalesced` (from control 6); plus a
request-level `isolates_spawned` rollup. Write the identical doubles to AE so
control 4's sweeper and the logs cannot disagree.

**Why.** "Run summaries log success/failure but not cost proxies, making it
impossible to notice spend amplification until billing arrives" (cfdoctor
cost rubric). Workers Logs auto-indexes structured JSON fields with unlimited
cardinality (doc-verified), so "sum `cpu_budget_ms` by hour" and "isolate
count by outcome" become dashboard queries with zero extra infrastructure.
Keep `head_sampling_rate: 1` while traffic is small; it is the future knob,
not a launch decision. **Effort:** ~1h; the `onEvent` test hook already
exists.

**Source basis:**
developers.cloudflare.com/workers/observability/logs/workers-logs/ (fetched
2026-07-10): observability setting, structured-JSON field indexing,
`head_sampling_rate`.

### 6. In-flight request coalescing

**Design.** A module-scope `Map<cacheKey, Promise<result>>` in
`website/src/mcp-handler.ts`, keyed by the exact key the response cache
already computes (payload hash + deploy version). First identical request
inserts its promise; concurrent identical requests await it; `finally`
deletes the entry (memory bounded by definition: entries exist only while in
flight). Followers record `coalesced: true` — not `cache_hit: true` — so
control 5's numbers stay truthful.

**Why the cache does not cover this.** The imperative Cache API performs no
request collapsing: a burst of concurrent identical requests to a cold key
executes once per request until the first write lands (cfdoctor Workers-Cache
rubric; consistent with
developers.cloudflare.com/workers/ cache guidance fetched 2026-07-10). That is
the launch-day shape — one blog-post demo payload, N readers' agents at once.

**Scope honesty.** A Workers isolate serves many concurrent requests within a
PoP, so coalescing is per-isolate — where the herd concentrates — not global.
Cross-PoP duplicates still compute once each until the cache write lands;
global coalescing would need a DO lock costing more than it saves at this
scale. Test requirements: a failed leader must not poison followers (delete on
rejection so retries recompute), and only deterministic `tools/call` payloads
are eligible (same rule as the response cache). **Effort:** ~1–2h incl. a
concurrency test through the existing handler fakes.

## Composition and build order

Control 2 reshapes the default cost of a request; 3 bounds the rate (and
prices 2's escape hatch); 6 deletes duplicate work 3 would otherwise charge to
innocent users; 4 bounds the total when everything else leaks; 1 is both the
floor under 4 and the human override; 5 makes all of it visible.

Build order: **1 → 2 → 3 → 5 → 6 → 4** — the switch first because it is the
breaker's actuator; cost proxies before the breaker because the sweeper
consumes them. Estimated total: ~2 days including drills.

## Dashboard-side complements (not in repo; promotion checklist)

- Coarse WAF rate-limit rule on `POST /mcp` (defense in depth before the
  Worker runs).
- Cloudflare billing/usage notifications and Workers error-rate notification.
- Both remain **not inspected** from the repo — dashboard evidence needed
  (per cfdoctor `sharing-cloudflare-state.md`).

## Open verification items

- AE pricing/quotas and Dynamic Workers pricing: fetch current pricing docs
  before implementing control 4 (billing-meter claims require official
  current sources).
- Whether `execute`'s returned `logs`/output are size-bounded ("outputs/logs
  are bounded and redacted" — cfdoctor Dynamic Workers checklist): audit
  `src/mcp/facade.ts` / `harness-runtime.ts` and add a cap if absent.
- Miniflare/test support for the `ratelimits` binding: if absent, inject a
  fake binding in tests as done for `LOADER`.
