# Project Backlog

`TODO.md` is the canonical owner-facing backlog and contains only actionable items. Explicitly status-marked landing/completion evidence lives under `docs/project/archive/`; current capabilities live in `docs/features.md` and generated registry surfaces. IDs are stable names, not ordering.

Status legend: `todo` | `blocked` | `owner-decision` | `parked`.

## Release / owner decisions

- [ ] **DEC-1 — Get one real external consumer** (`todo`). Validate
  `agentic-mermaid/agent`, `am`, or `agentic-mermaid-mcp` in a real agent,
  TUI, CI gate, or editor integration outside this repo.
- [ ] **DEC-2 — Add the WAF rate-limit rule on `POST /mcp` before broadly
  promoting the hosted endpoint** (`owner-decision`). The hosted MCP (`#94`,
  `https://agentic-mermaid.dev/mcp`) is public, unauthenticated compute. Body /
  input / output caps, the batch fan-out cap, edge caching, isolate CPU
  budgets, and CORS Origin validation bound each request in code, but the abuse
  backstop is a **dashboard** WAF rate-limit rule (e.g. 60 req/min per IP) that
  cannot live in the repo. Don't market or broadly promote the endpoint until it
  is live. See the promotion checklist in `website/README.md`.
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
- [ ] **COMPAT-1 — Remove the deprecated bare `default` Style alias** (`todo`;
  earliest in `0.3.0`, no earlier than 2027-01-31). Remove `default` only after
  receipt diagnostics have shipped for the published window, migration docs use
  `crisp`, and regression tests prove discovery no longer advertises the
  compatibility name. The ambiguous bare `tufte` input is already retired;
  callers must choose `look:tufte` or `palette:tufte` explicitly.


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
  in MCP hosts that ignore the UI extension.
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
  the endpoint. Complete organization verification and `api.apps.write`
  access, then prepare the plugin submission's name, logo, description, company
  and privacy-policy URLs, screenshots, test prompts/responses, localization,
  and review notes. Submit through the plugin portal only when the live endpoint
  and UI are stable enough to preserve the reviewed metadata contract.
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
- [ ] **BUILD-26 — Promote ecosystem issues into migration fixtures** (`todo`).
  Upstream issue searches are research input, not a second queue. Promote an
  issue only when a minimal, version-pinned reproduction exposes an Agentic
  Mermaid gap in supported syntax, semantic preservation, determinism,
  security, or workflow ergonomics. Each promotion must cite the source issue,
  add a failing fixture or capability-evidence case, name its owning TODO ID,
  and define the parity outcome. Unpromoted issue lists are deliberately not
  retained in this backlog.
- [ ] **BUILD-6 — Native upstream Mermaid family adoption** (`todo`). Select
  work from the version-pinned upstream manifest and generated capability
  report using current demand, maturity, syntax stability and semantic
  leverage; do not copy their roster or pre-rank a shadow queue here. Each
  promoted family passes the citizenship ratchet and the current source,
  primitive, backend, output, transport and extension contracts. Section A
  already owns the recognition floor: official and unknown headers are
  preserved or diagnosed and never fall through to Flowchart. Maturity comes
  from manifest data rather than a `-beta` spelling heuristic.
- [ ] **BUILD-1 — Collapsible subgraphs (#7785)** (`todo`). Track Mermaid PR
  <https://github.com/mermaid-js/mermaid/pull/7785> (`@{ view: collapsed }`
  metadata syntax) and stay syntax-compatible. Large, but a real readability
  win for agent-generated architecture diagrams; pairs naturally with typed
  `collapse`/`expand` mutation ops.

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
  experimental draft). Reassess Cloudflare's Agent Skills Discovery draft when
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


## Consolidation / dedup backlog

- [ ] **CONS-11 — One shape-outline module** (`todo`). Every non-rectangular
  flowchart silhouette is authored twice: the emitter in `src/renderer.ts` and
  the edge clipper in `src/shape-clipping.ts` (hexagon `h/4`, cylinder `ry=7`,
  trapezoid `w*0.15`, asymmetric `12`, diamond, stadium). Extract one
  `shapeOutline(shape, x, y, w, h)` returning canonical vertices/cap radii;
  renderer maps to SVG, clipper ray-intersects the same vertices.
- [ ] **CONS-16 — Modeling `accTitle`/`accDescr` parser** (`todo`). The
  directive regex has drifted (`xychart`/`agent` accept optional colon;
  `architecture`/`timeline`/`gantt` require it) and the `accDescr { … }` block
  scan is copy-pasted. Extend `src/shared/accessibility-directives.ts` with a
  modeling `parseAccessibilityDirective(lines, i)` used by all parsers; pick one
  colon rule consciously.
- [ ] **CONS-26 — Unify agent vs legacy per-family parsers** (`owner-decision`,
  architectural). The agent `*-body.ts` parsers re-encode grammars that
  `src/<family>/parser.ts` already owns, kept in sync only by differential
  tests. Build agent bodies as a projection of the legacy parser's AST so the
  legacy parser is the single grammar authority. Schedule separately.
- [ ] **CONS-27 — Canonical minimal diagram per family** (`todo`). The
  "minimal diagram" is duplicated across family metadata, editor examples,
  website comparisons, and test fixture helpers, and has drifted. Make `BUILTIN_FAMILY_METADATA[].example`
  canonical and derive `COMPARISON_CASES` + fixtures from it.
- [ ] **CONS-30 — `agent/body-utils.ts` extraction** (`todo`). Mechanically
  deduplicate repeated LABEL_OVERFLOW, id-allocation, `set_title`, collection,
  source-map, label-extraction, seeded-hash, and CSS-mix helpers. Characterize
  semantics first and extract one proven cluster at a time.
- [ ] **CONS-41 — Classify remaining non-marker `RawMark` escapes** (`todo`).
  Connector terminals and marker resources are typed. Replace or explicitly
  classify the remaining accessibility/prelude, CSS, icon/image, tooltip, and
  hit-overlay escapes with typed document, icon, or interaction primitives,
  preserving default bytes and strict-security evidence.
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

## Terminal semantic defects

- [ ] **TERM-1 — Preserve every node in a three-node graph containing a 2-cycle** (`todo`). The characterized terminal projection currently loses or corrupts content; add a failing semantic-conservation test before changing routing.
- [ ] **TERM-2 — Make RL terminal direction honest** (`owner-decision`). Terminal rendering silently aliases RL to LR. Either implement a recognizably reversed projection or emit a named unsupported-direction diagnostic.

## Non-goals

- Do not port Vercel-specific package rename, committed `dist/`, `.vercel`, or Vercel branding.
- Do not fold `zhenhuaa/mdv` wholesale into this package; terminal Markdown viewing belongs in a separate tool or companion package.
- Do not port old dagre-specific layout code directly; translate only ideas that still apply to the current ELK/layout-engine architecture.
- Do not treat historical archives or process notes as backlog unless an item is promoted here with an ID.
