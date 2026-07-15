# Plan: Twitter/X cards for Agentic Mermaid diagrams

Status: proposal (rev 2, post multi-agent audit) · Branch: `claude/twitter-card-diagrams-4hfvw8`

## Goal

When an Agentic Mermaid page or diagram is shared on X/Twitter (and Facebook,
Slack, Discord, LinkedIn, iMessage), show a rich card — ideally one that displays
the actual diagram — without repeating the RGBA failure documented in
[`adewale/atlas#34`](https://github.com/adewale/atlas/pull/34).

## Non-goals

- Redesigning the generic site card art.
- Server-rendering the editor app (it stays client-side/local-first).
- Indexing shared diagrams in search.

## Background — verified current state

Confirmed against production (`Twitterbot/1.0` fetch) and the source tree:

- Every shipped page already emits a valid `summary_large_image` card
  (`website/build.ts:109`, `:533`; guarded by `src/__tests__/website-build.test.ts:1211`).
- The deployed `og-image.png` is **1200×630, 8-bit RGB (colortype 2), no alpha,
  62 KB** — it already meets the atlas contract (it came from a design tool, not
  our renderer).
- **Diagrams never appear**: editor share links carry the diagram in the URL
  `#fragment` (`editor/js/sharing.js:261`), which crawlers never see.
- **The atlas trap is live for any dynamic render**: resvg-wasm
  (`website/src/png-wasm.ts:85`) emits **RGBA (colortype 6)**; `applyPngColorProfile`
  does not change colour type. A card built the obvious way ships RGBA — exactly
  what X refused for atlas.

---

## 1. Complexity reconsideration (read this first)

The original design (now **Tier 3** below) was a stateless dynamic endpoint that
decodes an attacker-controlled `?s=<encoded diagram>` from the URL and rasters it
in the Worker on demand. A six-lens audit (see §7) showed that **almost every
serious finding is a direct consequence of that one choice**:

- rendering arbitrary URL-borne payloads ⇒ decompression-bomb + unbounded
  layout-CPU DoS, needs a hard decompressed-size/node cap + rate limiting;
- source embedded in a cached, crawler-visible URL ⇒ **unrecallable** (no delete
  path; lands in history, `Referer`, logs, edge + crawler caches for a year);
- per-request rendering of untrusted text ⇒ `<head>` injection, cache poisoning,
  codec-drift, per-colo cache multiplication, and ~6 new test surfaces.

The value we actually want — *our diagrams show up on Twitter* — does **not**
require rendering arbitrary user input at request time. Two simpler designs
deliver it with a fraction of the surface:

| Tier | What it is | Delivers | Surface / risk | Recommendation |
|------|-----------|----------|----------------|----------------|
| **1** | Static hardening + **curated cards pre-rendered at build** for `/examples/*` and showcase diagrams | Rich cards for the site + the diagrams we promote | Low — no endpoint, no untrusted input, build-time render (napi, deterministic, no CPU limit) | **Ship this.** |
| **2** | **Opaque-token** dynamic cards: user explicitly "publishes" a diagram → stored under a random id in KV/R2 → `/d/<id>` + cached card rendered from the *stored* source | Any user can turn their own diagram into a card | Medium — a render endpoint, but the key space is our own ids (not attacker payloads), so abuse is bounded at the create step; gives a real **delete** path | Optional follow-up, only if user-share cards are wanted. |
| **3** | Stateless **source-in-URL** (`?s=`) rendered on demand (original "Approach A") | Same as Tier 2, statelessly | **High** — maximises *both* the abuse surface *and* the privacy liability (unrecallable) | **Not recommended.** Kept in §4 for the record. |

**Key realization:** Tier 2's opaque token is not just better for privacy — it
also *collapses the abuse surface*, because the renderer only ever runs on
sources we chose to store (rate-limited at the create step), never on arbitrary
URL payloads. So the privacy-motivated design is also the security-motivated one.
Tier 3 is worst-of-both and should be dropped.

**The one component all three share** is the RGB card encoder/compositor
(F1/F2). Tier 1 runs it at **build time** (Node `zlib`, deterministic napi
renderer, no Worker limits, no abuse) — which is where it is easiest and safest.
Building that module for Tier 1 also unlocks Tier 2 later at no extra cost.

Recommendation: **do Tier 1 now.** Treat Tier 2 as a separate, later decision
gated on real demand and a retention-policy sign-off. Do not build Tier 3.

---

## 2. Tier 1 — static hardening + curated build-time cards (recommended)

No Worker endpoint. Everything is emitted at build and served as a normal static
asset. Two parts:

**2a. Meta-tag hardening (applies to every page):**

- **F4** `twitter:image` (explicit; never empty — an empty value breaks the
  `og:image` fallback). **F5** `og:image:width=1200`/`height=630`. **F6**
  `og:image:alt`/`twitter:image:alt`.
- **Head position (audit #4):** move the social-meta block to the **top of
  `<head>`**, before the editor's ~72 KB of inlined CSS — Slackbot reads only the
  first 32 KB, so tags emitted before `</head>` (`build.ts:134`) are invisible to
  it today. Emit them right after `<head>` opens.
- **`og:url` correctness (audit #3):** each page's `og:url` must be its own URL
  (already true for static pages via `emitShell`); keep it that way for the
  curated example pages so each diagram card has a distinct social identity.

**2b. Curated diagram cards (build-time render):**

- For `/examples/*` and any showcase diagram, render the diagram to a card PNG at
  build via the **napi** renderer (deterministic, no CPU limit), through the new
  **F1/F2 encoder/compositor** module, and emit it as a static asset
  (`/cards/<slug>.png`). Point that page's `og:image`/`twitter:image` at it.
- **F1** flatten to **opaque RGB colortype 2** (an opaque background alone yields
  colortype-6-with-alpha-255 — still the atlas trap; the alpha channel must be
  *dropped*, audit #2). **F2** fit-inside + centre-blit onto a fixed opaque
  **1200×630** canvas (the render pipeline only does width-XOR-height and forces
  `preserveAspectRatio="none"` = stretch, so the letterbox is net-new compositing,
  audit #2). Build on resvg's `.pixels` (exposed) → composite → encode; at build,
  IDAT deflation is Node `zlib` (deterministic).
- **F3 (corrected):** enforce **< 5 MB**, and target **< 300 KB** so WhatsApp
  renders it (audit #11). Note: `MAX_HOSTED_PNG_BYTES` is **8 MB and gates
  *pixels*, not bytes** (`png-contract.ts:22`) — it is *not* a 5 MB byte guard;
  add an explicit byte check.

**2c. Static-image discipline:**

- **F20** RGB + 1200×630 regression guard on `public/og-image.png` and every
  curated card (add `inspectPngColorType()` next to `inspectPngDimensions()` in
  `output-color-profile.ts`).
- **F21** rename-on-change (content-hash the filename) so editing a card actually
  busts X's cache.

Tier 1 neutralises audit findings #1, #5–#9, #11 entirely (no dynamic endpoint,
no untrusted input, no privacy/retention problem) and reduces #3/#4/#10 to simple
build-time concerns.

---

## 3. Tier 2 — opaque-token dynamic cards (optional follow-up)

Only if there is real demand for "any user turns their own diagram into a card."
Chosen over Tier 3 because it bounds abuse and enables deletion.

**Flow:** an explicit, opt-in **Publish preview** action (distinct from the
private `Copy link` fragment button, never reusing it) POSTs the diagram to a
`/d/create` endpoint → server stores `{source, palette, style, seed, config}` in
KV/R2 under a **random id** with a **bounded TTL** → returns `/d/<id>`. The
`/d/<id>` page (and its `/card/<id>.png`) render from the *stored* source, on
first crawl, then cache.

**Why this is safer than Tier 3:**

- The renderer only runs on ids we minted, so the decompression-bomb / unbounded
  layout-CPU vectors are gone from the read path; rate-limit the **create** step
  instead (audit #1).
- The share URL holds only an opaque id — no source in history/`Referer`/logs;
  logs record the id, not user content (audit #6, security #4).
- A real **delete** path exists (purge KV/R2 record + edge cache) and TTL expiry
  bounds retention (privacy #3/#4).

**Controls (from the audit):**

- **Create-step rate limit:** the in-Worker **`RATE_LIMITER` binding** (GA
  2025-09-19, plan-independent, works on this project's existing Paid plan),
  keyed by a normalized-source hash and/or IP. This is the primary control —
  **do not depend on a zone WAF tier** (per-IP-path rules exist on all tiers, but
  ASN/path/complexity limiting is Enterprise-only; audit answer to Q1).
- **Decompressed-size + node-count cap** at create (deterministic backstop; the
  `RATE_LIMITER` binding is per-colo/eventually-consistent, a soft throttle).
- **Kill switch** (config/secret) to disable create + render without a deploy.
- **Meta injection via HTMLRewriter** must use `setAttribute`, never string
  concatenation (audit #5), and must set **`og:url` = the `/d/<id>` URL**
  (Facebook keys its cache on `og:url`; a wrong value collapses every card onto
  one entry — audit #3). Keep `noindex` as a **meta tag** (not an HTTP header,
  which suppresses iMessage — audit #11).
- **Cache** by the stored id; `cache-control` bounded (not `immutable`, so a
  deleted preview can actually expire — privacy #3); cache **only confirmed
  successful** renders, and serve the fallback `no-store` (audit #8).
- **Codec / render fidelity:** extract the share codec into **one shared module**
  imported by editor + Worker (not a re-port — 6 concrete drift points, audit #9),
  and replay palette/style/seed/config so the card matches what the sharer saw.
- **Consent:** a blocking dialog naming the consequences ("creates a public
  preview; your diagram is sent to our server and cached by social networks; may
  persist after you delete the link"), an affirmative control, and a persistent
  public-state badge (privacy #1/#2).

Storage/retention policy (TTL length, delete UX, whether any PII handling is
implied) needs product sign-off before this tier is built.

---

## 4. Tier 3 — stateless source-in-URL (NOT recommended; original Approach A)

Recorded so the decision is legible. Design: `?s=<encoded>` in the URL, decoded
and rendered in the Worker per request, cached by the encoded source.

Why it is rejected: it maximises the abuse surface (arbitrary URL payloads ⇒
decompression bomb + unbounded layout CPU ⇒ needs hard caps + rate limiting;
concrete cost: a trivial unique-key flood at 20 req/s ≈ **$155/mo** CPU, 200 req/s
≈ **$1,550/mo**, bomb payloads ~10× — unbounded, no default ceiling) **and** the
privacy liability (source embedded in a `cache-control: immutable` URL is
**unrecallable** — no delete path, lands in logs/history/`Referer`/crawler
caches). Tier 2 delivers the same user-facing feature without either problem, so
there is no reason to build Tier 3.

---

## 5. Fix list (by tier)

| ID | Fix | Tier |
|----|-----|------|
| F1 | Flatten resvg RGBA → **opaque RGB colortype 2** (drop alpha; not just an opaque bg) | 1 (build), reused by 2 |
| F2 | Fit-inside + centre-blit onto fixed opaque **1200×630** (net-new compositor on `.pixels`) | 1, reused by 2 |
| F3 | Enforce **< 5 MB** *and* target **< 300 KB** (explicit byte check; `MAX_HOSTED_PNG_BYTES` is 8 MB/pixels, not a byte guard) | 1, 2 |
| F4 | `twitter:image` (never empty) | 1 |
| F5 | `og:image:width`/`height` | 1 |
| F6 | `og:image:alt`/`twitter:image:alt` | 1 |
| F7 | Per-diagram `og:title`/`description`, attribute-escaped via `setAttribute` | 1 (curated, trusted), 2 |
| F8 | Curated cards emitted as static assets; **social meta at top of `<head>`** | 1 |
| F20 | RGB + 1200×630 regression guard (static image + every curated card) | 1 |
| F21 | Rename-on-change (content-hash filename) | 1 |
| F10 | **Shared codec module** (editor + Worker), not a re-port | 2 |
| F11 | Opaque-token create/store/render (`/d/create`, `/d/<id>`, `/card/<id>.png`) | 2 |
| F12 | HTMLRewriter meta injection via `setAttribute`; **`og:url` = the `/d/<id>` URL** | 2 |
| F13 | Absolute HTTPS image URLs from `url.origin` | 2 |
| F14 | Cache by stored id; **bounded** TTL (not immutable); cache successes only; fallback `no-store` | 2 |
| F15 | Graceful fallback to static card on error (200, `no-store`, counted in a metric so it alarms) | 2 |
| F16 | Server-side strict render policy (no external fonts/scripts); route only through `renderMermaidPNGWasm` (never raw SVG) — SSRF verified closed by 3 layers | 2 |
| F17 | Fuzz attribute-escaping of diagram-derived meta | 1, 2 |
| F18 | Create-step `RATE_LIMITER` + decompressed-size/node cap + kill switch + hash-only cost-proxy logs | 2 |
| F19 | `noindex` **meta tag** (not header) + `og:url` = share URL; keep `/d/` out of `sitemap.xml` | 2 |
| F9 | Opt-in **Publish preview** distinct from private `Copy link`; consent dialog + public badge | 2 |

---

## 6. Test & verification plan

**Tier 1 (all in `bun run test`, the deterministic gate):**

1. **Static-image guard (F20):** decode `public/og-image.png` IHDR → colortype 2,
   **no `tRNS`**, 1200×630.
2. **Card encoder guard (F1/F2) — decode PIXELS, not just the IHDR byte:** assert
   (a) colortype 2 + no `tRNS`, (b) the four padding regions equal the opaque
   letterbox colour, (c) the diagram's aspect ratio is preserved (a wide test
   diagram leaves top/bottom bars; a tall one leaves side bars — assert the bar
   geometry), (d) a centre pixel is non-background, (e) < 5 MB. **Red→green:**
   removing the flatten (→ colortype 6) *or* the letterbox (→ stretch) must fail
   this. A header-only check would pass over a garbled/stretched card (audit #2/#10).
3. **Determinism:** same diagram → byte-identical card (Node `zlib`, napi — this
   path *is* deterministic, unlike the wasm disclaimer).
4. **Meta:** every page has non-empty absolute-HTTPS `twitter:image`/`og:image`,
   `width`/`height`/`alt`, and the social block sits within the first 32 KB of the
   response (Slack guard, audit #4).
5. **Escaping fuzz (F17):** hostile diagram titles (`">`, `</head>`, `&`) round-trip
   as inert text in the meta.

**Tier 2 (added only if built):** Worker unit tests with a fake HTMLRewriter for
`og:url`/`setAttribute` injection; kill-switch test (flag set → static card, zero
rasters via a `renderPng` spy); codec-parity fuzz on the shared module;
create-step cap/rate-limit; concurrency/burst raster-count; sanitation
(mirror `editor-security-closures.test.ts`).

**Crawler-fidelity (automatable, both tiers) — promote to a required pre-announce
job:** against a Cloudflare preview deploy, fetch as `Twitterbot` **and**
`facebookexternalhit`, extract the card URL, fetch it with the crawler UA, assert
200 / `image/png` / colortype 2 / 1200×630. This is the automatable core of the
atlas "raw bot response + deployed bytes" gate.

**Manual release gate (not automatable):** post one canary link, confirm the card
in X's Tweet Composer preview (X's validator was retired ~2023), run Facebook's
Sharing Debugger (forces a re-scrape) — as a committed checklist with sign-off
boxes, not ad hoc. Only this proves a card renders on the platform; the automated
tiers are necessary but not sufficient (the atlas lesson).

---

## 7. Multi-agent audit (captured)

Six independent reviewer lenses + reconciliation. Consolidated, de-duplicated,
ranked; "Raised by" = independent lenses that hit it (agreement = confidence).

| # | Sev | Finding | Raised by | Verdict | Addressed by |
|---|-----|---------|-----------|---------|-------------|
| 1 | Critical | Input cap is on *encoded* bytes; real cost is layout+resvg CPU (scales with element count, not pixels); `deflate:` bomb inflates a tiny payload into a huge diagram; fixed canvas bounds memory, not CPU | Security, Cloudflare, Rendering | CONFIRMED | Gone in Tier 1; Tier 2 caps at create step |
| 2 | High | F1/F2 are net-new (colortype-2 encoder + fit-inside compositor); opaque bg ≠ colortype 2; raster forces `preserveAspectRatio="none"` = stretch; resvg exposes `.pixels` | Rendering, Test | CONFIRMED | F1/F2 scoped as a real module; test #2 decodes pixels |
| 3 | High | `og:url` never rewritten; asset bakes `/editor/`; FB/WhatsApp/LinkedIn key cache on `og:url` → all diagrams collapse onto one generic card; contradicts F19 | Crawler | CONFIRMED | Tier 1 static `og:url` per page; Tier 2 F12 sets `og:url`=`/d/<id>` |
| 4 | High | Slack reads first 32 KB; ~72 KB inlined CSS precedes the meta → Slack sees no card | Crawler | CONFIRMED | F8: social meta at top of `<head>` |
| 5 | High | `<head>` markup injection via diagram-derived `og:title` (raw interpolation, `build.ts:111`); `<meta refresh>` open-redirect bypasses CSP | Security, Test | CONFIRMED | `setAttribute` (F12); trusted content in Tier 1; F17 fuzz |
| 6 | High | Source-in-URL is unrecallable (immutable cache, no store to delete from; logs/history/crawler caches) | Privacy, Security | CONFIRMED | Tier 2 opaque token + TTL + delete; Tier 3 rejected |
| 7 | Med | Cache key must be decoded/normalized source, not raw `?s=`; Cache API is **per-colo** → N cold rasters per diagram | Security, Rendering, Cloudflare | CONFIRMED | Tier 2 keys by stored id; consider Tiered Cache |
| 8 | Med | Immutable-caching the error fallback permanently pins the generic card | Security | CONFIRMED | F14/F15: successes only; fallback `no-store` |
| 9 | Med | "Port the codec" → 6 drift points; must replay palette/style/seed/config | Rendering, Security | CONFIRMED | F10 shared module |
| 10 | Med | Untested: F2 composite, F9 default-private, F19, F18 kill switch, F17 escaping; some ride Tier B (off the CI gate) | Test | CONFIRMED | §6 adds each |
| 11 | Med | WhatsApp/iMessage drop images >~300 KB; `noindex` header suppresses iMessage; large `?s=` URLs exceed paste limits | Crawler | PLAUSIBLE | F3 <300 KB target; F19 meta not header; Tier 2 short id not payload |
| 12 | Low | Plan factual errors: `MAX_HOSTED_PNG_BYTES` is 8 MB/pixels (not a 5 MB byte guard); "precomputed cards = free serves" false under `run_worker_first` (saves CPU, not the invocation) | Rendering, Cloudflare | CONFIRMED | Corrected in F3 and below |

**SSRF (Security #9):** *refuted as a live risk* — three layers close it (first-party
SVG serializers, forced `security:'strict'` rejecting external refs/`<image>`,
resvg-wasm has no network). Guardrail: route only through `renderMermaidPNGWasm`,
never raw SVG (F16).

**Cost-model correction:** under `run_worker_first: true` the Worker already runs
on every request, so curated cards are **not** "free static serves" — they save
the *raster CPU*, not the *invocation* (which is unchanged from today's assets).

## 8. Open questions

- **Q1 (rate limiting) — resolved:** use the in-Worker `RATE_LIMITER` binding
  (plan-independent, GA); it only matters for Tier 2's create step. Zone WAF tier
  is a *complementary* edge layer, not a dependency (ASN/complexity limiting is
  Enterprise-only).
- **Q2 (privacy) — resolved into a design:** if user-share cards are wanted, use
  Tier 2 (opaque token), not Tier 3. Still needs a product sign-off on TTL length
  and delete UX before building.
- **Remaining decision:** ship Tier 1 only, or commit to Tier 2 as a follow-up?
  Tier 1 delivers "our diagrams show up on Twitter" for the site + curated
  diagrams at low risk; Tier 2 adds arbitrary user-diagram cards at the cost of a
  storage/retention policy.
