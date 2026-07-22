# Project Backlog

`TODO.md` is the canonical owner-facing inventory of unfinished work, owner
decisions, blocked observations, and evidence-triggered watch items. Explicitly
status-marked landing/completion evidence lives under `docs/project/archive/`;
current capabilities live in `docs/features.md` and generated registry
surfaces. IDs are stable names, not ordering. Standing contribution policies
are recorded without checkboxes below because they are not finishable backlog.

Status legend: `todo` | `blocked` | `owner-decision` | `parked`.

## Release / owner decisions

- [ ] **DEC-1 — Get one real external consumer** (`todo`). Validate
  `agentic-mermaid/agent`, `am`, or `agentic-mermaid-mcp` in a real agent,
  TUI, CI gate, or editor integration outside this repo.
- [ ] **DEC-2 — Add the WAF rate-limit rule on `POST /mcp` before broadly
  promoting the hosted endpoint** (`owner-decision`). The hosted MCP (PR #94,
  `https://agentic-mermaid.dev/mcp`) is public, unauthenticated compute. Body /
  input / output caps, the batch fan-out cap, edge caching, isolate CPU
  budgets, and CORS Origin validation bound each request in code, but the abuse
  backstop is a **dashboard** WAF rate-limit rule (e.g. 60 req/min per IP) that
  cannot live in the repo. Don't market or broadly promote the endpoint until it
  is live. See the promotion checklist in `website/README.md`.
- [ ] **DEC-3 — Decide the hosted Code Mode boundary** (`owner-decision`,
  [#204](https://github.com/adewale/agentic-mermaid/issues/204)). Measure hosted
  `execute` demand, task success, calls/tokens/latency, isolate cost, generated
  payload, compatibility commitments, and abuse-control burden. Then explicitly
  remove hosted `execute`, gate it, or retain it. Local stdio Code Mode and the
  direct hosted render/verify/describe/mutate/build tools are out of scope.
- [ ] **DEC-4 — Establish Google and Bing search visibility**
  (`owner-decision`). In ownership-verified Google Search Console and Bing
  Webmaster Tools, submit `https://agentic-mermaid.dev/sitemap.xml`, request
  indexing for the homepage and core docs, and monitor coverage plus exact-name
  queries for "Agentic Mermaid" and "agentic-mermaid". Fix crawl/canonical
  findings before pursuing relevant external references and backlinks; do not
  manufacture low-quality links. These consoles require a signed-in owner and
  the anonymous sitemap ping endpoints are retired, so this cannot be automated
  in the repo.
- [ ] **DEC-5 — Finish Cloudflare's managed `robots.txt` policy**
  (`owner-decision`). Production serves Cloudflare's managed content-signals
  file in preference to a repository asset. In **Manage robots.txt**, choose the
  intended crawler/content-signals policy, preserve access for the public pages
  meant to be indexed, and add
  `Sitemap: https://agentic-mermaid.dev/sitemap.xml`. Then verify the live body
  and status with `curl` and both search consoles. The repo deliberately ships
  no competing `robots.txt`, so the dashboard remains the single source.
- [ ] **REL-1 — Release the current product as 0.2.0** (`todo`,
  [#198](https://github.com/adewale/agentic-mermaid/issues/198)). The latest
  published package and repository manifests now agree on `0.1.2`; the stale
  `0.1.1` premise is resolved, but the breaking Unreleased changes still need a
  minor release. Align package/registry/site compatibility metadata, roll the
  changelog, require a green release commit and independent contact-sheet
  approval, publish npm with provenance plus MCP Registry metadata, verify a
  clean 15-family consumer, and deploy the exact release commit.
- [ ] **WEB-2 — Ratchet public-site payloads after measured reductions** (`todo`).
  Follow [`docs/project/website-payload-plan.md`](docs/project/website-payload-plan.md):
  reproducible Inter delivery and retryable standalone/deferred Examples are
  complete. Next, produce the editor composition report and split only if
  optional cold-feature boundaries clear the documented 20% checkpoint. The initial
  request graphs and raw/gzip/Brotli ceilings are executable authorities; ratchet
  the affected route after each reduction and retain cold/warm Chromium transfer
  evidence without promoting network timing to a source gate.
## Security backlog

- [ ] **SEC-4 — Implement and drill hosted MCP abuse controls** (`todo`; the
  dashboard WAF prerequisite remains `DEC-2`). Execute the bounded admission,
  payload-proportional CPU, per-item rate/fan-out, concurrency, disable-gate,
  and redacted-observability contract in
  `docs/project/mcp-abuse-controls-plan.md`. That document provides threat-model
  and acceptance detail; this ID is the sole backlog owner. Do not add durable
  coordination or metering infrastructure without observed demand.


## Ready build backlog

- [ ] **BUILD-27 — MCP Apps support** (`todo`). Expose an interactive
  in-agent diagram UI through MCP Apps: `ui://` resources, correct
  `text/html;profile=mcp-app` resource MIME type, tool `_meta.ui.resourceUri`
  wiring, resource CSP/domain metadata, and tests that the resources are
  reachable without leaking secrets. Start with a portable, read-only
  preview/verify view before adding an editable surface; keep tool results useful
  in MCP hosts that ignore the UI extension. Negotiate the MCP Apps capability
  and use the standard `ui/*` bridge first; reserve host-specific APIs for
  optional enhancement.
- [ ] **BUILD-28 — Experimental page-local WebMCP support** (`todo`). The
  current Web Machine Learning Community Group report is not a W3C Standard or
  Standards Track document. In the browser editor, feature-detect
  `document.modelContext` and register a narrow active-document surface with
  `document.modelContext.registerTool()` using exact JSON Schemas, truthful
  `readOnlyHint` / `untrustedContentHint` annotations, and an `AbortSignal` for
  lifecycle cleanup. Start with read source, verify, describe, and render; add
  structured mutation only after explicit user-action and state-consistency
  tests. Gate it behind supported-browser detection and test with both a shim
  and a compatible browser trial. This is not `/.well-known/mcp`, CORS, or
  Streamable HTTP parity: the draft is an in-page browser API and does not
  prescribe MCP as the browser agent's transport.
- [ ] **BUILD-29 — Submit a ChatGPT app as a plugin** (`todo`, after
  BUILD-27; WebMCP is not a dependency). Validate the public MCP + MCP Apps
  experience in ChatGPT Developer Mode on web and mobile, define an exact CSP,
  and audit tool schemas, `_meta`, instructions, and annotations before scanning
  the endpoint. Complete organization verification and `api.apps.write` plus
  `api.apps.read`
  access, then prepare the plugin submission's name, logo, description, company
  and privacy-policy URLs, screenshots, test prompts/responses, localization,
  and review notes. Confirm the organization is eligible for the required data
  residency, submit through the plugin portal only when the live endpoint and UI
  are stable enough to preserve the reviewed metadata contract, and explicitly
  publish after approval.
- [ ] **BUILD-24 — Layout hints: rank/group pinning and edge-length
  preferences** (`todo`). Direct agent feedback (2026-07): an agent deleted a
  real edge because the auto-layout drew its feedback loop as a long,
  confusing route — the only lever it had was removing information. Give
  agents structural levers instead: per-node rank/layer pinning, "keep these
  nodes adjacent" grouping hints, and a "keep this edge short" preference,
  carried as typed metadata (not source hacks) and honored by the ELK
  pipeline deterministically. This is not manual positioning and does not add
  Agentic-only Mermaid syntax: the first contract is typed render/mutation
  metadata, kept in the request digest and source-preservation receipt when an
  agent workflow persists it. Design questions: interaction with
  the determinism contract (hints must be explicit input, never ambient);
  which ELK knobs (`org.eclipse.elk.layered.layering.*`, `priority`,
  `desiredEdgeLength`) map cleanly. Scope the first slice to flowchart/state.
- [ ] **BUILD-2 — `process --mode validate|canonicalize` triage** (`todo`).
  Current verbs are `verify` and `format`; do not add another command until it
  proves agent value. Needed: inventory overlap with `verify`, `format`,
  `parse`, `serialize`, `mutate`, and `batch`; write the exact JSON/exit-code
  contract for `validate` and `canonicalize`; test whether it reduces agent
  routing errors in docs/evals; then either implement as a thin, schema-tested
  wrapper or explicitly park/decline it. Independent of other items.
- [ ] **BUILD-1 — Adopt merged collapsible subgraphs (#7785)** (`todo`). Mermaid PR
  <https://github.com/mermaid-js/mermaid/pull/7785>, merged 2026-07-01. Pin the
  first adopted Mermaid version, add a compatibility fixture for
  `@{ view: collapsed }`, preserve the metadata before typed support exists,
  then add typed `collapse`/`expand` mutation ops only if the upstream syntax
  and real agent demand justify them.

## Standing promotion policies (not backlog)

- **Ecosystem issue promotion.** Upstream searches are research input, not a
  second queue. Promote only a minimal, version-pinned reproduction that exposes
  an Agentic Mermaid gap; cite it from a failing fixture and one owning TODO ID.
- **Native family adoption.** Select from the version-pinned upstream manifest
  using demand, maturity, syntax stability, and semantic leverage. Every promoted
  family passes the citizenship and source/primitive/backend/output/transport
  contracts; official or unknown headers remain preserved or diagnosed.

## Agent-usage verification backlog

- [ ] **EVAL-3 — Eval the `agentic-mermaid-diagram-workflow` skill for
  helpfulness** (`todo`). The public skill
  (`website/public/skills/agentic-mermaid-diagram-workflow/SKILL.md` +
  `references/`) is the site's main agent call-to-action, now linked from the
  footer. Verify it actually improves outcomes: run agent-usage cases with vs.
  without the skill loaded and compare on task success, verify-before-return
  discipline, Code-Mode vs. prose answers, and source-level-vs-structured edit
  choice — reuse the existing `eval/agent-usage/` sandbox, task oracle, and
  trace linter.
  Fold any skill gaps back into `SKILL.md`/`references/`; keep or cut the
  footer link based on whether it demonstrably helps.


## Parked / evidence-required ideas

- [ ] **PARK-2 — Agent Skills discovery and skills.sh visibility** (`parked`,
  experimental draft). Current Cloudflare documentation describes an
  experimental runtime skill registry, not a stable well-known discovery
  contract. Reassess discovery when
  its `agent-skills` well-known suffix is registered or the ecosystem contract
  stabilizes. If adopted earlier, generate a v0.2.0
  `/.well-known/agent-skills/index.json`, package the workflow skill plus its
  references as a safe archive, publish its SHA-256 digest, support GET/HEAD +
  JSON/Markdown/archive content types + CORS/cache headers, and test fetch,
  extraction, and digest verification against the published schema. Once that
  endpoint exists, change the homepage `Link` header from the direct `SKILL.md`
  to the index. Separately document `npx skills add adewale/agentic-mermaid`;
  skills.sh has no submission API and gains visibility from real CLI installs.
- [ ] **PARK-3 — Fork feature ports** (`parked`). Vercel themes,
  browser/package export tweaks, ArchiMate (upstream PR #34), and
  animation remain fork-audit ideas. Promote one only with a focused issue
  and owner.
- [ ] **PARK-4 — Adopt MCP revision 2026-07-28 backwards-compatibly**
  (`parked` until 2026-07-28,
  [#186](https://github.com/adewale/agentic-mermaid/issues/186)). Re-verify the
  final specification on or after its publication date, then promote the issue
  to `todo`: accept the new protocol header without dropping older versions,
  keep post-2025-06-18 batching disabled, pin no-initialize tools/list and
  tools/call tests, tolerate request `_meta` and new routing headers, audit error
  codes, and update discovery/docs. Do not implement RC assumptions as final.


## Testing architecture backlog

- [ ] **TEST-3 — Complexity-aware, registry-derived test portfolio** (`blocked`).
  The executable migration in
  [`docs/project/complexity-aware-test-portfolio-plan.md`](docs/project/complexity-aware-test-portfolio-plan.md)
  is implemented: immutable before/candidate reports, exhaustive finite
  authorities, automatic family enrollment, focused exact goldens,
  independently verified variable-strength arrays, six mandatory complexity
  strata, mixed outputs, fault probes, precise receipt dependency graphs,
  platform release smoke, and plan-derived Cynefin contact sheets. The former
  4,500-row matrix is removed. Structured human review remains available as
  advisory evidence rather than a publication gate. Keep this item open only
  for evidence that cannot be manufactured in the implementation turn: the
  configured macOS/Windows release jobs must execute, and the after-report must
  be revisited after 30 merges for CI p50/p95, flake/retry, human findings,
  churn, and escaped defects.
  Upstream cost/covering-array research is tracked in
  [`testing-best-practices#21`](https://github.com/adewale/testing-best-practices/issues/21).
- [ ] **TEST-4 — Correct and strengthen the Python MCP interop probe** (`todo`,
  [#191](https://github.com/adewale/agentic-mermaid/issues/191)). Replace the
  deprecated `streamablehttp_client` alias, record the Python client's actual
  request path, and correct the verification plan: all three SDKs prove
  sessionless initialize/version negotiation/tool calls, while only TypeScript
  and Go currently prove `GET -> 405`. Keep pinned `mcp==1.28.1` and latest
  canary coverage green.
- [ ] **TEST-5 — Make route-verification policy executable and retire the stale
  score target** (`todo`, supersedes the historical framing in
  [#35](https://github.com/adewale/agentic-mermaid/issues/35)). Treat 50.69% as
  a historical diagnostic, not a quality gate. Resolve whether
  `offOutlineEndpoints` is hard or cosmetic, enroll final rendered-endpoint
  diagnostics in `audit:ugly` if that public command should own them (the
  independent diagnostic is now enforced by `auditRouteContracts` and the
  layout rubric), extract an independent certificate consistency audit, and
  make production pipeline invariant checks explicit.
  Use the canonical 2,800-case corpus, focused mutation lanes, and bounded route
  sabotage to prove named behaviors; do not restore a broad percentage chase.

## Consolidation / dedup backlog

- [ ] **CONS-26 — Finish agent/render grammar-authority convergence** (`todo`).
  Flowchart, Pie, Quadrant, Mindmap, and GitGraph already project renderer-owned
  ASTs; State, Timeline, and Journey share parse cores; XYChart now projects the
  strict renderer AST and no longer owns a second grammar. The remaining
  duplicated families are Class, ER, Sequence, Architecture, Gantt, and Radar.
  Migrate one family at a time behind differential and unknown-line tests. For
  Class/ER/Sequence/Gantt, do not project from a lossy final AST that discards
  statement order or opaque segments; expose a shared statement parser/event
  stream consumed by both surfaces instead.
- [ ] **CONS-30 — `agent/body-utils.ts` extraction** (`todo`). Mechanically
  deduplicate repeated LABEL_OVERFLOW, id-allocation, `set_title`, collection,
  source-map, label-extraction, seeded-hash, and CSS-mix helpers. Characterize
  semantics first and extract one proven cluster at a time.
- [ ] **CONS-43 — Continue physical layout-pass extraction** (`todo`). Move
  cohesive pass implementations out of `layout/passes/index.ts` one at a time
  behind the checked manifest; preserve order, mutation declarations,
  certificate reissue, layout bytes, and SVG bytes.
- [ ] **CONS-44 — Finish config and residual adapter schema authority**
  (`todo`). Family descriptors own config sections, keys and no-op declarations,
  but built-in value rules and richer resolver diagnostics remain centralized in
  `src/shared/family-config-diagnostics.ts`. Move those rules behind
  descriptor-owned schemas or diagnostic hooks, then inventory repeated
  transport schemas not already projected from the family, StyleSpec, or
  RenderOptions descriptors. Generate only proven duplicates while retaining
  transport-neutral `applyOps` and tool dispatch.
- [ ] **CONS-45 — Finish terminal-context convergence** (`todo`). Move remaining
  family-local cell writers and context argument lists onto shared grapheme-safe
  canvas/context helpers without projecting pixel Scene geometry.

## Source-preservation defects

- [ ] **SRC-1 — Segment-preserving Class and Timeline bodies** (`todo`). Preserve typed mutation around unmodeled statements without violating byte-for-byte opaque fallback. Add parser/serializer closure and adversarial reorder tests before promotion.
- [ ] **SRC-2 — Positional comments for Flowchart and State** (`todo`). Replace announced `COMMENT_DROPPED` loss with positionally anchored opaque segments that survive typed mutation.

## Non-goals

- Do not port Vercel-specific package rename, committed `dist/`, `.vercel`, or Vercel branding.
- Do not fold `zhenhuaa/mdv` wholesale into this package; terminal Markdown viewing belongs in a separate tool or companion package.
- Do not port old dagre-specific layout code directly; translate only ideas that still apply to the current ELK/layout-engine architecture.
- Do not treat historical archives or process notes as backlog unless an item is promoted here with an ID.
