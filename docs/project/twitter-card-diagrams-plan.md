# Plan: per-diagram Twitter/X cards (Approach A) + social-card hardening

Status: proposal · Branch: `claude/twitter-card-diagrams-4hfvw8` · Owner: TBD

## Goal

Make an individually-shared Agentic Mermaid diagram render as its **own** Twitter/X
(and Open Graph) card, and close the gaps that make our current cards fragile —
without repeating the RGBA failure documented in
[`adewale/atlas#34`](https://github.com/adewale/atlas/pull/34).

## Non-goals

- Redesigning the generic site card art.
- Server-rendering the editor itself (the app stays client-side/local-first).
- Indexing shared diagrams in search (explicitly kept out of the sitemap — see F19).

## Background — verified current state

Confirmed against production (`Twitterbot/1.0` fetch) and the source tree:

- Every shipped page emits a valid `summary_large_image` card. `socialMetaTags()`
  (`website/build.ts:109`) always emits `og:title/description/type` +
  `twitter:card`; `emitShell` (`website/build.ts:533`) derives each page's route
  from its path, so `og:image` + `og:url` + canonical ship **site-wide** (guarded
  by `src/__tests__/website-build.test.ts:1211`).
- The deployed `og-image.png` is **1200×630, 8-bit RGB (colortype 2), no alpha,
  62 KB, HTTP 200 to Twitterbot, `content-type: image/png`** — it already meets
  the full atlas contract. (It is RGB only because it came from a design tool, not
  our renderer — see the trap below.)

Two real problems remain:

1. **Diagrams never appear.** Editor share links carry the diagram in the URL
   **`#fragment`** (`editor/js/sharing.js:261`, `history.replaceState(... '#' + encoded)`).
   Fragments are never sent to servers, so a crawler fetching
   `…/editor/#deflate:xyz` sees only `…/editor/` → the generic card. Every shared
   diagram shows the same site image.
2. **The atlas trap is live for any dynamic path.** The hosted renderer is
   resvg-wasm (`website/src/png-wasm.ts:76-85`): `resvg.render().asPng()` emits
   **RGBA (colortype 6)**, and `applyPngColorProfile` only rewrites colour-profile
   chunks — it does not change colour type. A card built the obvious way
   (`renderMermaidPNGWasm`) would ship **RGBA — exactly what X parsed but refused
   to process for atlas.**

## Architecture (Approach A)

Three parts:

1. **Crawlable payload.** Add an opt-in "preview link" that puts the encoded
   diagram in a **query param** (`?s=<encoded>`) or a `/d/<encoded>` permalink,
   instead of the fragment. Query params reach the Worker; fragments do not.
2. **Dynamic card route.** A Cloudflare Worker route `/card.png` decodes `?s=`,
   sanitizes it, renders the diagram, forces **opaque RGB 1200×630**, and returns
   `image/png`. `renderPng` is already wired into the Worker runtime
   (`website/src/worker-core.ts:20`); the `/mcp` special-case at
   `worker-core.ts:147` is the pattern to mirror.
3. **Per-request meta.** For `/editor/?s=` (or `/d/<encoded>`) the Worker injects
   per-diagram `og:image`/`twitter:image` = the `/card.png?s=…` URL via
   HTMLRewriter (the page is a static asset, so meta is rewritten per request).

## Fix list

Grouped; each item names the file/mechanism. Grouping F* IDs carry across PRs.

### Group 1 — Image encoding (the atlas core; bites the new endpoint)

| ID | Fix | Grounding |
|----|-----|-----------|
| F1 | Flatten resvg **RGBA → opaque RGB (colortype 2)** before serving the card | `png-wasm.ts:85` emits RGBA; `applyPngColorProfile` does not change colour type. **The** fix that prevents repeating atlas. |
| F2 | Composite the render centred on a **fixed opaque 1200×630** canvas (1.91:1) | `png-contract.ts` accepts width **XOR** height (aspect-preserving); diagrams are arbitrary ratios, so we letterbox on an opaque background (padding must be opaque, feeding F1). |
| F3 | Enforce **< 5 MB** output | Reuse `MAX_HOSTED_PNG_BYTES` / `assertHostedPngRasterBudget` (`png-contract.ts`). |

### Group 2 — Meta-tag completeness

| ID | Fix |
|----|-----|
| F4 | Add `twitter:image` (card URL on `?s=` pages; explicit elsewhere). **Never emit an empty `twitter:image=""`** — that breaks the og:image fallback. |
| F5 | Add `og:image:width=1200` / `og:image:height=630`. |
| F6 | Add `og:image:alt` / `twitter:image:alt`. |
| F7 | Per-diagram `og:title` / `og:description` (diagram family / first label), attribute-escaped. |

F4–F7 extend `socialMetaTags()` for static pages and the Worker HTMLRewriter for `?s=` pages.

### Group 3 — Payload & privacy

| ID | Fix |
|----|-----|
| F8 | Move/duplicate the share payload to a **crawlable** location (`?s=` or `/d/<encoded>`). Fragments cannot ever work as a card. |
| F9 | **Opt-in preview sharing.** The fragment link is deliberately private ("diagrams never leave the browser"). A preview link sends source to the Worker — it must be a distinct, explicit action; the default stays private. |
| F10 | **Server-side decoder parity** — port `sharing.js`'s `deflate:`/base64url/base64 decode (`editor/js/sharing.js:128`) to the Worker, byte-compatible with the client encoder. |

### Group 4 — Worker plumbing (`website/src/worker-core.ts`)

| ID | Fix |
|----|-----|
| F11 | Route `/card.png` (decode → sanitize → render → F1/F2 → `content-type: image/png`). |
| F12 | HTMLRewriter injects F4–F7 into `/editor/?s=` (or `/d/`) responses. |
| F13 | **Absolute HTTPS** image URLs from `url.origin`. |
| F14 | **Cache** the rendered PNG keyed by the normalized encoded source (see audit finding H2 for the primitive choice); `cache-control: public, max-age=31536000, immutable`. Same source → same URL → same bytes; different source → different URL (natural path versioning = atlas's "new URL to bust cache"). |
| F15 | **Graceful fallback** — malformed/oversize `?s=` or render error → serve the static `og-image.png` at 200, never 500. |

### Group 5 — Security (the `?s=` payload is attacker-controlled)

| ID | Fix |
|----|-----|
| F16 | Apply the editor's untrusted-input policy server-side (`sanitizeEditorConfig`, `--security strict`, no external fonts/scripts). resvg-wasm has no network + strict policy ⇒ no SVG-external-ref SSRF. |
| F17 | Escape any diagram-derived text before it lands in a meta attribute (og:title injection). |
| F18 | Abuse/DoS controls — see audit finding H1 (input cap, WAF rate-limit, kill switch, cost-proxy logging). |

### Group 6 — SEO hygiene

| ID | Fix |
|----|-----|
| F19 | Keep infinite `?s=` variants out of the index: `noindex` and/or `rel=canonical → /editor/` on the per-diagram page; do not add them to `sitemap.xml`. Twitterbot still reads og tags; Google won't index the thin variants. |

### Group 7 — Static-image discipline (independent of A)

| ID | Fix |
|----|-----|
| F20 | **RGB + 1200×630 regression guard** on `public/og-image.png` (the atlas failure-mode guard we lack; today's test only checks the tag string). Add `inspectPngColorType()` next to `inspectPngDimensions()` in `output-color-profile.ts`. |
| F21 | **Rename-on-change** discipline for the static image (content-hash the filename, or document) so a future edit actually busts X's cache. |

## Testing & verification

Five tiers, cheapest/most-deterministic first. **Only Tier D proves a card renders
on X**; every automated tier is necessary but not sufficient — that gap is the
atlas lesson (their build's SEO checks were green while the card was blank).

### Tier A — deterministic unit/build tests (`bun run test`, the CI gate)
1. **Static-image guard (F20):** decode `public/og-image.png` IHDR → assert colortype 2, no `tRNS`, 1200×630.
2. **Card-render RGB guard (F1/F2):** render a known diagram through the card pipeline → decode → assert **colortype 2, opaque, exactly 1200×630, < 5 MB**. **Red→green:** remove the flatten step and this test must fail (CLAUDE.md rubric #4). This is the test that would have caught atlas.
3. **Determinism:** same source rendered twice → byte-identical (cache-key stability). Scope to same-runtime reproducibility (`png-wasm.ts:4-6` disclaims cross-runtime byte-identity).
4. **Codec-parity fuzz:** fast-check over random sources — client `encodeSourceCompressed` → server decode → equals original; malformed `deflate:`/base64 → graceful empty. Mirror `src/__tests__/property-editor-codec-fuzz.test.ts`.
5. **Meta presence:** extend `website-build.test.ts:1211` to assert `twitter:image`, `og:image:width/height`, `og:image:alt`, and that a `?s=` page's injected `og:image` is the absolute card URL.
6. **Sanitation (F16/F17):** crafted `?s=` with disallowed config/external font/inline script → strict policy holds (no external request, nothing injected into SVG or meta). Mirror `src/__tests__/editor-security-closures.test.ts`.
7. **Fallback (F15):** malformed/oversize `?s=` → static card at 200, never 500.

### Tier B — Worker integration tests (wrangler / `website/e2e-mcp.sh` style)
8. `GET /card.png?s=<enc>` → 200, `content-type: image/png`, RGB bytes, `cache-control` immutable, under cap.
9. `GET /editor/?s=<enc>` (or `/d/<enc>`) as `User-Agent: Twitterbot/1.0` → head carries the per-diagram card tags (absolute HTTPS) + width/height/alt.
10. Garbage `?s=` → graceful static-card fallback.
11. Repeat request → cache HIT (raster skipped); different source → different URL/bytes.

### Tier C — crawler-fidelity check (automatable — atlas's "raw bot response + deployed bytes")
12. Against a **Cloudflare preview deployment**, a script (the automated version of the `Twitterbot/1.0` curl + IHDR decode used in review) fetches the page as `Twitterbot` **and** `facebookexternalhit`, extracts the card URL from the head, fetches **that** with the crawler UA, and asserts 200 / `image/png` / colortype 2 / 1200×630. Catches deploy-time drift unit tests cannot (CDN transforms, wrong content-type, stray redirects).
13. Assert **deployed bytes == intended bytes** (etag/hash) for the static image.

### Tier D — manual release gate (the atlas lesson; not fully automatable)
14. Post **one canary** diagram link on X; confirm the large image renders (Tweet Composer preview shows the card pre-post). X's public validator was retired ~2023.
15. Run the URL through **Facebook's Sharing Debugger** (forces a re-scrape; shows exactly what the OG parser extracted) and a third-party X validator.
16. Do the canary for **both** a static page and one `?s=` card before trusting the feature; keep it as a documented manual gate for any future card change (rename-on-change from F21 applies).

### Tier E — visual evidence (good-pr dimension 2)
17. Captioned before/after: today's generic card vs. the new per-diagram card as X renders it (Tweet Composer screenshot), plus a saved `/card.png?s=…` artifact.

## Rollout / sequencing

- **PR 1 — static hardening (low risk, independently shippable):** F4–F7, F20, F21 + Tier A tests 1 & 5. No new endpoint; no billing-surface change.
- **PR 2 — dynamic card endpoint:** F1–F3, F8–F19 + Tier A tests 2–4,6,7, Tier B, Tier C. Ship behind the F18 kill switch; run the Tier D canary before announcing.

## Risks & open questions

- **Cost/abuse of an unauthenticated CPU-bound endpoint** — see audit H1. Primary risk.
- **Caching primitive** (Cache API vs Workers Cache) — see audit H2.
- **Privacy posture change** for preview links (F9) — needs explicit UX sign-off.
- Fonts: the card inherits the hosted render's bundled fonts (`png-wasm.ts:43-54`); custom/system fonts are unavailable server-side (acceptable — matches hosted `render_png`).

---

## Cloudflare Doctor audit

Audited with [`adewale/cfdoctor`](https://github.com/adewale/cfdoctor) v0.3.0
(scanner v0.3.5), 60 checks. Scanner run against `website/` + repo root; findings
below combine scanner leads with the skill's cost/product-fit/reliability rubrics
and current Cloudflare docs.

Scope inspected: `website/wrangler.jsonc`, `website/src/worker-core.ts`,
`website/src/png-wasm.ts`, `src/png-contract.ts`, `src/output-color-profile.ts`,
`editor/js/sharing.js`, this plan's proposed `/card.png` architecture; scanner over
`website/` and repo root.
Scope not inspected: Cloudflare **dashboard/account state** — zone WAF/rate-limit
rules, Cache Rules, Bot Management, billing plan, and Logpush are not in the repo
and were **not inspected**. No deployed-Worker snapshot was taken.
Docs refreshed: [Workers limits](https://developers.cloudflare.com/workers/platform/limits/),
[Static Assets billing](https://developers.cloudflare.com/workers/static-assets/billing-and-limitations/);
Workers pricing page did not load this pass (rates below taken from the skill's
cost rubric, not re-verified against the live pricing page).
Detected products: Workers, Workers Static Assets, Dynamic Workers (Worker Loader).
Cost proxy summary: today the Worker already runs on **every** request
(`run_worker_first: true`, `wrangler.jsonc:22`) → every request is a billed Worker
request incl. static assets. The plan adds **CPU-bound resvg raster per unique
`/card.png?s=` render**; cache hits should skip the raster, not the invocation.
Overall risk: **medium** — the feature is viable on Workers, but the new endpoint
is an unauthenticated CPU meter and needs explicit abuse/cache controls before launch.

### Severity: high — Unauthenticated CPU-bound `/card.png` endpoint is a cost/DoS amplifier
- Category: cost footgun / security
- Evidence: plan's `/card.png?s=<encoded>` rasters via resvg-wasm (`website/src/png-wasm.ts:61-85`) on attacker-controlled input; `website/src/worker-core.ts` has no rate limit; `website/wrangler.jsonc` declares no WAF/rate-limit and `run_worker_first: true` (line 22) routes every request through the Worker.
- Why it matters: Workers bill **requests + CPU time** (CPU is a direct meter; duration is not). Each distinct `?s=` is a fresh raster — the "unbounded transformation variants exposed to arbitrary user input" footgun — and varying `?s=` busts any URL-keyed cache, forcing fresh CPU per hit with no included-usage ceiling.
- Fix: cap input size (reuse the 64 KB MCP cap); add a **WAF rate-limiting rule** per IP/ASN on `/card.png`; a config/secret **kill switch** to disable the route without a deploy; cache by normalized encoded-source key (F14); emit per-render **cost-proxy logs** (CPU-ish, cache hit/miss). Do **not** gate with Turnstile/interactive challenges — crawlers cannot solve them and the card would break; protect with WAF + caps + cache instead.
- Cost / trade-off: bounds the CPU meter and blocks trivial amplification; adds a WAF rule + cache lookup + ~1 config flag; small latency on miss; fully reversible (flip the kill switch). Assumes a WAF/rate-limit plan is available on the zone (not inspected).
- Verify: load-test `/card.png` with many unique `?s=` and confirm the WAF rule throttles; confirm repeat requests return cache HIT with no raster; confirm the kill switch 404s/falls back.
- Source basis: [Workers limits](https://developers.cloudflare.com/workers/platform/limits/) (CPU 30 s default / 5 min max, 128 MB isolate), [Static Assets billing](https://developers.cloudflare.com/workers/static-assets/billing-and-limitations/); cfdoctor cost-footguns (Workers, spend-amplification, Images unbounded-variants).
- Confidence: high

### Severity: high — Caching primitive: Cache API won't collapse bursts; declarative Workers Cache would bypass the gateway
- Category: missed optimization / misconfiguration
- Evidence: plan F14 proposes `caches.default` (Cache API) keyed by `?s=`.
- Why it matters: the Cache API runs the Worker on every request and does **not** collapse concurrent requests — a burst to a cold `?s=` rasters once per request (thundering herd). Cloudflare recommends **Workers Cache** (`cache.enabled`) for new Workers (tiered, collapses bursts, skips the Worker on hit). But blanket-enabling declarative `cache.enabled` on the **default** entrypoint would let a cache hit skip the Worker's canonical redirects/security headers and the `/mcp` gate (auth/gateway bypass), and — with `run_worker_first` — shift the billing surface.
- Fix: keep the expensive raster behind an explicit **cache-first early-return** on the Cache API (the Worker still runs but skips resvg on hit — that is where our cost is), **or** move only the card render to a **dedicated inner entrypoint** with `cache.enabled` and keep `exports.default.cache.enabled = false`. Do not enable declarative cache on the default entrypoint.
- Cost / trade-off: Cache API early-return is simplest and avoids gateway-bypass, but does not collapse a burst to a fresh key; the inner-entrypoint Workers Cache collapses bursts and skips the Worker on hit at the cost of an extra entrypoint and cache-key discipline. Reversible either way.
- Verify: fire a concurrent burst at one cold `?s=` and count raster executions (log a per-render counter); confirm hits skip resvg.
- Source basis: cfdoctor cost-footguns / product-fit ("Workers Cache, Cache API"); confirm against [Cache API docs](https://developers.cloudflare.com/workers/runtime-apis/cache/) and current Workers Cache guidance before implementing.
- Confidence: medium

### Severity: medium — Product-fit: synchronous image rendering in the request path (accepted, with bounds)
- Category: wrong primitive (smell) / reliability
- Evidence: plan rasters SVG→PNG inline in the crawler request (`/card.png`).
- Why it matters: the product-fit rubric flags inline image processing (prefer Queues/Workflows) — but an OG card **must** be synchronous for the crawler, and the alternatives are worse fits: Cloudflare Images optimizes/resizes existing images (not SVG-of-arbitrary-text→PNG), and Browser Rendering bills browser-hours for what resvg-wasm does in-isolate. So Worker+resvg is the defensible primitive **if** bounded and cached.
- Fix: keep resvg; render directly to the fixed **1200×630** canvas (0.756 MP → ~3 MB RGBA, far under the 128 MB isolate and 30 s CPU limits); cache aggressively (H2); and **precompute example-page cards at build** so only genuinely-arbitrary shares reach the dynamic path (curated cards become free static-asset serves).
- Cost / trade-off: accepts bounded inline CPU for correctness; build-time example cards trade a little build time + repo bytes for zero runtime cost on the common case; reversible.
- Verify: measure p50/p99 CPU-ms per render; confirm well under the CPU limit with headroom; confirm example pages serve static (no Worker raster).
- Source basis: cfdoctor product-fit-rubric ("Workers and Pages" smells, "AI/media/browser" fit), [Workers limits](https://developers.cloudflare.com/workers/platform/limits/).
- Confidence: medium

### Severity: medium — Memory/CPU headroom depends on rendering at the target size, not native-then-downscale
- Category: reliability
- Evidence: plan letterboxes onto 1200×630; `src/png-contract.ts` caps raster at ~16.7 MP (`assertHostedPngRasterBudget`, "~64 MiB of raw RGBA").
- Why it matters: 128 MB isolate. Rendering a large diagram at **native** size and then downscaling could approach the raster budget and inflate CPU under concurrency; fitting directly to the fixed canvas keeps each render ~3 MB and tens of ms.
- Fix: fit the render to the 1200×630 target (fitTo width, then pad on an opaque canvas), never native-then-shrink; keep the existing raster-budget assertion as the backstop.
- Cost / trade-off: negligible; preserves determinism.
- Verify: Tier A test with a pathologically large diagram → assert the budget assertion holds and output is exactly 1200×630 opaque RGB.
- Source basis: [Workers limits](https://developers.cloudflare.com/workers/platform/limits/) (128 MB), `src/png-contract.ts:15`.
- Confidence: medium

### Severity: low — Full head sampling on a soon-to-be-hotter Worker
- Category: cost review / observability (scanner `CFDOC-COST-LOG-VOLUME`)
- Evidence: `website/wrangler.jsonc:14` `head_sampling_rate: 1` (already annotated as an explicit launch policy).
- Why it matters: a hot public image route + full sampling multiplies retained log/trace volume; repo config alone doesn't establish traffic/retention/plan materiality.
- Fix: keep at launch; measure `/card.png` log volume post-launch; sample down only if evidence supports it.
- Cost / trade-off: lower observability if reduced; keep full sampling until the route's volume is known.
- Verify: check Workers Logs volume/retention after the card route ships.
- Source basis: cfdoctor cost-footguns (CDN/observability); scanner lead.
- Confidence: low

### Suppressed scanner leads (precision notes)
- `CFDOC-COST-UNBOUNDED-FANOUT` @ `website/src/png-wasm.ts:57` — **false positive**: `Promise.all(FONT_INPUTS.map(...))` iterates a fixed 10-element constant (`FONT_INPUTS`, `png-wasm.ts:43-54`); bounded by construction.
- `CFDOC-CONFIG-PROCESS-ENV` @ `website/build.ts:107` — **build-time only**: `process.env.SITE_ORIGIN` is read during `bun run website`, not in the Worker runtime. (Same for the `src/**/__tests__` and `src/cli` hits.)

### Affirmative precision (non-findings)
- `compatibility_date: 2026-06-27` is valid ISO and **not** in the future (today 2026-07-15) — no `COMPAT-DATE-*` finding.
- `observability.enabled: true`, `workers_dev: false`, `preview_urls: false`, and the `run_worker_first` + `not_found_handling: 404-page` choices are intentional and documented in `wrangler.jsonc` comments.
- No D1/KV/Durable Object/Queue misuse — none are bound.

## Run summary with cost proxies
- Hot paths: `/card.png` (new, CPU-bound raster), `/editor/?s=` (new, HTMLRewriter), plus all existing static/`/mcp` routes (already Worker-first).
- Expensive primitives per user action: 1 resvg raster per **cache-miss** card render; 0 on hit (with H2 fix); 0 for precomputed example cards.
- Retry/fanout/circuit-breaker posture: **needs work** — no rate limit / kill switch yet (H1).
- Cache map: browser + CDN via `cache-control: immutable`; Worker-side cache keyed by encoded source (primitive TBD per H2); invalidation owner = the source itself (new source ⇒ new URL).

## Recommended next actions
1. Land PR 1 (static hardening F4–F7, F20, F21) — low risk, no endpoint.
2. For PR 2, resolve H1 (input cap + WAF rate-limit + kill switch + cost-proxy logs) and H2 (cache primitive) **before** exposing `/card.png`.
3. Confirm the zone has a WAF/rate-limiting plan available (dashboard evidence — not inspected).
4. Run the Tier D canary on one static page and one `?s=` card before announcing.

## Questions / evidence needed
- Is a **WAF rate-limiting rule** available on the `agentic-mermaid.dev` zone/plan? (Determines the H1 fix shape.)
- Is the **privacy trade-off** of opt-in preview links (source leaves the browser) acceptable to sign off (F9)?
- Expected share volume / peak RPS for `/card.png`? (Sets cache TTL and whether request-collapsing via Workers Cache is worth the extra entrypoint.)
