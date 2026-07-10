# Hosted MCP abuse controls: plan

> **Status: planned, not implemented.** Revised 2026-07-10 after a
> Cloudflare Doctor audit of this plan, the hosted MCP implementation, and live
> Cloudflare documentation. `hosted-mcp-cloudflare-plan.md` remains the
> as-built record; this document specifies the next hardening change.
>
> **Scope boundary.** This plan deliberately has no automated daily-budget
> breaker, Analytics Engine dataset, KV control flag, cron, or Durable Object
> ledger. Those controls add their own meters and coordination failure modes;
> they are not justified without observed production demand. The remaining
> controls bound individual requests and bursts, and provide a deploy-time
> operator disable switch.

## Threat model and current baseline

`POST /mcp` is public, keyless, and unauthenticated. It accepts up to 128 KiB
per HTTP body and 64 KiB for each source/code field, allows batches of up to
20 items, and currently permits at most one `execute` per batch
(`website/src/mcp-handler.ts`). `execute` invokes a Dynamic Worker with a
caller-controlled `timeoutMs` capped at 30s, no subrequests, no bindings, and
no outbound network. Direct tools run in the website Worker; `render_svg`,
`render_png`, `mutate`, and `build` are still meaningful CPU/memory work and
must not be treated as free.

Dynamic Workers are billed on three relevant dimensions: requests, CPU time
(including startup time), and unique Dynamic Workers created per day. The
loader derives a Dynamic Worker ID from the exact code hash and wrapper
variant (`website/src/execute-loader.ts`), so semantically irrelevant source
changes can create new IDs. A configured `cpuMs` limit is an admission-cost
proxy, **not** measured CPU usage or the complete bill.

The existing response Cache API key includes `execute` code. That is not a
correct determinism boundary: Code Mode can use `Date` or `Math.random`, and
current source comments acknowledge that such a result is frozen for the
cache TTL. This change removes `execute` from response-cache eligibility. The cheaper
pure tools retain their existing cache path, subject to the gates below. There
is intentionally no in-flight coalescer: its per-isolate/per-PoP benefit is
not worth its memory and complexity for the expected traffic shape.

### Measured ground truth

Local `node:vm` sandbox benchmarks (semantic twin of the hosted isolate,
2026-07-10) establish the initial CPU shape:

| Workload | Input size | Time |
|---|---:|---:|
| parse + verify + serialize, 875-node flowchart | 62.6 KiB | ~18.0s |
| parse + watercolor render, same source | 62.6 KiB | ~8.3s |
| parse + verify, 800-node flowchart | 57.1 KiB | ~12.9s |
| parse + verify + serialize, 300-node flowchart | 21.0 KiB | ~3.1s |
| 1,200-message sequence diagram | 54.6 KiB | ~0.07s |
| 200 sequential `mutate` calls on a 300-node base | — | >120s |

These measurements justify a 30s maximum for legitimate large `execute`
work. They do not establish production Dynamic Worker startup cost, edge CPU
performance, unique-worker creation rate, or a safe daily spend limit; those
need production usage data before promotion.

## Request-admission order (non-negotiable)

For each parsed tool item, use this order:

1. Validate request/body/tool arguments and classify the tool.
2. For `execute`, check the operational disable gate **before** a Cache API
   lookup. A disabled execute must return `EXECUTE_DISABLED` and must not
   return a prior cached result or contact the loader.
3. Admit the item through the appropriate in-worker rate bucket. For a batch,
   admit every item sequentially; if any item is refused, return one 429 for
   the batch and dispatch none of its items.
4. Consult the response cache only for its eligible pure tools.
5. Run the tool. The dispatcher has bounded concurrency rather than an
   unbounded `Promise.all`; `execute` and `render_png` each remain limited to
   one item per batch.

This order makes the safety state authoritative over convenience caches, makes
rate-limit consumption match batch work, and limits cold-cache direct-render
bursts without relying on locality-sensitive request coalescing.

## Controls

### 1. Deploy-time execute disable gate and required drill

**Design.** Add an `executeAllowed()` gate used by the transport before cache
access. It returns the standard `EXECUTE_DISABLED` envelope and
`LOCAL_FALLBACK_HINT`; the seven non-execute tools remain available.

`EXECUTE_DISABLED` is a Worker secret/variable. Changing it creates a new
Worker version but needs no source build or CI run. It is a simple, reliable
operator override once that version is active; there is intentionally no KV
fast path or automated actuator.

**Drill.** In a zero-user production window: warm an `execute` cache candidate,
set the deploy-time disable flag, verify cached and uncached `execute` both
return `EXECUTE_DISABLED` without a loader call, verify every non-execute tool
stays 200, re-enable execute, measure recovery, and add the measured latency to
the runbook. Re-run after gate/cache plumbing changes.

**Trade-offs.** The switch causes version churn and is not an instantaneous
in-place global flag. In exchange it has no additional storage, cron,
telemetry, or cross-region consistency dependency.

**Source basis:** [Workers secrets](https://developers.cloudflare.com/workers/configuration/secrets/)
and [Workers rollbacks](https://developers.cloudflare.com/workers/configuration/versions-and-deployments/rollbacks/)
(fetched 2026-07-10).

### 2. Payload-proportional default CPU limits; explicit long-run admission

**Design.** Use the UTF-8 byte length of the `code` argument, not request-body
size, to derive the default:

```text
payload_kib = utf8Bytes(code) / 1024
default_cpu_ms = clamp(3000 + 450 * payload_kib, 3000, 30000)
```

At 62.6 KiB this clamps at 30s against the measured ~18s case; at 57 KiB it
allows ~28.6s; at 21 KiB it allows ~12.5s. The computed value is supplied via
`getEntrypoint(..., { limits: { cpuMs, subRequests: 0 } })`.

The exact public argument is **`timeoutMs`**, matching
`src/mcp/tool-surface.ts` and `src/mcp/hosted-server.ts`; `timeout` is not a
valid escape hatch. A finite explicit `timeoutMs` is clamped to 1–30,000ms.
An explicit value above 10,000ms is a scarce long-run request and consumes the
long-run rate bucket in addition to the ordinary execute admission. Defaults
remain payload-proportional so small hostile code has materially less CPU
allowance.

**Cost model.** Emit `configured_cpu_limit_ms`, never label it actual CPU or
worst-case invoice liability. Dynamic Worker startup time, request charges,
and unique-worker creation remain separate meters.

**Tests.** Cover UTF-8 byte boundaries, omitted/invalid/negative/infinite
`timeoutMs`, the 30s clamp, long-run bucket selection, and preservation of the
existing `subRequests: 0` limit.

**Source basis:** [Dynamic Worker custom limits](https://developers.cloudflare.com/dynamic-workers/usage/limits/)
and [Dynamic Worker pricing](https://developers.cloudflare.com/dynamic-workers/pricing/)
(fetched 2026-07-10).

### 3. Per-item rate limits, bounded batch dispatch, and edge defense in depth

**Design.** Add three Rate Limiting bindings in `website/wrangler.jsonc` with
unique account namespace IDs:

| Bucket | Applies to | Initial policy |
|---|---|---:|
| `RL_EXECUTE` | every `execute` | 10 / 60s |
| `RL_EXECUTE_LONG` | explicit `timeoutMs > 10_000` | 3 / 60s |
| `RL_RENDER` | `render_svg`, `render_png` | 20 / 60s |
| `RL_TOOLS` | all remaining direct tools | 120 / 60s |

The caller key is `CF-Connecting-IP` only, never a client-provided
`X-Forwarded-For`. If that trusted Cloudflare header is absent, use one shared
fail-closed key rather than accepting a spoofable fallback. This deployment is
custom-domain-only (`workers_dev: false`); preserve that ingress assumption in
route review.

The binding consumes one token per parsed item, including every applicable
item in an old-protocol batch. Admission is sequential and happens before
Cache API access and dispatch. Do not use the binding as a global accounting
or distributed-attack guarantee: its counters are local to a Cloudflare
location and eventually consistent. A dashboard-side WAF rate-limit rule on
`POST /mcp` is still required because it runs before the Worker and provides
an independent outer control. Its exact rule, deployment scope, and false
positive review remain dashboard evidence, not a repo claim.

`MAX_EXECUTE_ITEMS_PER_BATCH` stays 1. Add `MAX_RENDER_PNG_ITEMS_PER_BATCH =
1`, and dispatch the remaining admitted work through a small explicit
concurrency limit (initially 2). This replaces the current unbounded batch
`Promise.all` while preserving response order.

**Failure response and telemetry.** Return 429 with `Retry-After` and the
local fallback hint; record `outcome: "rate_limited"`, bucket name, and item
count, but never an IP address or payload.

**Trade-offs.** Shared NAT/proxy users can receive 429s; a distributed attacker
can still get per-location slack. The outer WAF is the separate edge control;
there is intentionally no in-application total-spend breaker. Rate values are
launch hypotheses to tune from false-positive and CPU data, not universal
limits.

**Tests.** Use injected fake bindings to prove per-item consumption, all-or-no
batch dispatch, `timeoutMs` long admission, render admission, 429 shape, and
the bounded-concurrency ceiling. Exercise a missing client-IP header.

**Source basis:** [Rate Limiting binding](https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/)
and [WAF rate-limit best practices](https://developers.cloudflare.com/waf/rate-limiting-rules/best-practices/)
(fetched 2026-07-10).

### 4. Bounded, honest request logging

**Event schema.** This PR adds the facts the Worker can know now:

- `cache_hit`;
- `loader_attempts` (0, 1, or 2 for expression→statement fallback);
- `configured_cpu_limit_ms` (or `null`).

`admission` and `rate_limit_bucket` arrive with their corresponding disable and
rate-limit controls; do not emit misleading placeholder values before those
controls exist. Add request rollups for loader attempts when rate admission is
implemented. Do **not** call a field `isolate_spawned`: the Worker cannot know
whether Cloudflare created a new billable Dynamic Worker versus reused one. Use
Cloudflare's Dynamic Workers usage view for that provider-side meter rather
than creating a new application telemetry store.

**Logging economics and privacy.** The present Worker emits one custom wide
log and Cloudflare emits one invocation log per sampled request. Make
`observability.head_sampling_rate` explicit rather than relying on its default
of 1. Keep 100% sampling only while measured MCP log-event volume stays within
the approved Workers Logs budget; promotion must name the threshold and
sample/alert policy. Do not add Analytics Engine, cron, KV, or Durable Object
telemetry for this plan. Replace raw caught-exception text in the wide event
with a bounded allowlisted error code/type so user-controlled strings cannot
enter logs.

**Existing output cap, now verified.** The prior open question about hosted
`execute` output/logs is closed: `src/mcp/harness-runtime.ts` caps the result
at 2 MiB, logs at 1,000 entries/256 KiB, and `website/src/execute-loader.ts`
performs a capped response read. Keep regression tests for those caps.

**Source basis:** [Workers Logs](https://developers.cloudflare.com/workers/observability/logs/workers-logs/),
[Workers limits](https://developers.cloudflare.com/workers/platform/limits/),
and [Dynamic Worker pricing](https://developers.cloudflare.com/dynamic-workers/pricing/)
(fetched 2026-07-10).

## Composition and build order

1. Establish production inputs: traffic/RPS, acceptable false-positive rate,
   Workers/Dynamic Workers/Logs usage, and dashboard WAF evidence.
2. Implement and drill the upstream execute gate; remove `execute` cache
   eligibility before relying on it.
3. Implement payload-proportional limits, per-item rate admission, per-batch
   render limits, and bounded dispatch concurrency.
4. Add the small request-event fields, explicit log-sampling policy, and
   redacted error telemetry. Do not add Analytics Engine, KV, cron, a Durable
   Object, or request coalescing.

## Promotion checklist and evidence still required

The following cannot be inferred from this repository:

- Dashboard WAF rule for `POST /mcp`, including rule order, rate, action,
  false-positive events, and rollback owner.
- Cloudflare account plan; current Workers, Dynamic Workers, and Workers Logs
  usage/overage data; and the current official pricing pages used to choose
  rate and logging thresholds.
- Exact Rate Limiting namespace IDs and deploy-time disable-secret name (not
  its value).
- Production game-day evidence for cache-warmed disable, rate limits, WAF,
  alert delivery, and recovery.
