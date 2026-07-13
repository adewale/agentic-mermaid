# Project Backlog

`TODO.md` is the canonical owner-facing backlog and contains only actionable items. Completed records live under `docs/project/archive/`; current capabilities live in `docs/features.md` and generated registry surfaces. IDs are stable names, not ordering.

Status legend: `todo` | `blocked` | `owner-decision` | `parked`.

## 0. Release / owner decisions

- [ ] **DEC-1 — Get one real external consumer** (`todo`). Validate
  `agentic-mermaid/agent`, `am`, or `agentic-mermaid-mcp` in a real agent,
  TUI, CI gate, or editor integration outside this repo. Unblocked
  substantially by BUILD-7 (remote MCP reachability).
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


## 1. Security backlog

- [ ] **SEC-1 — Sanitize editor share/draft render config before SVG insertion** (`todo`). Audit on 2026-07-09 found that `/editor/` accepts hash/draft `config`, merges it into render options, and inserts rendered SVG with `innerHTML`; malicious color/font/style values can break out of the SVG root `style` attribute and create executable SVG markup under the current CSP. Fix by allowlisting editor-restorable config keys/values, escaping SVG root styles/attrs in `svgOpenTag`, sanitizing preview SVG before insertion, and adding hostile hash/draft/browser regression tests.
- [ ] **SEC-2 — Cap editor share-link decompression and draft restore size** (`todo`). Deflated share links and localStorage drafts currently decode/read without a byte cap, so a crafted hash or stale draft can hang the browser. Add encoded/decoded size limits, streaming abort on overflow, visible too-large errors, and tests for corrupt/oversized links and missing `DecompressionStream`.
- [ ] **SEC-3 — Make editor autosave privacy explicit** (`todo`). The editor persists diagram source, render config, style, and seed in plaintext `localStorage` by default. Add a visible disclosure plus a clear/private-mode option or switch persistent drafts to opt-in/session-only storage.


## 2. Ready build backlog

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
  pipeline deterministically. Design questions: hint syntax in Mermaid source
  (frontmatter? comment directives?) vs. render-option-only; interaction with
  the determinism contract (hints must be part of the input, never ambient);
  which ELK knobs (`org.eclipse.elk.layered.layering.*`, `priority`,
  `desiredEdgeLength`) map cleanly. Scope the first slice to flowchart/state.
- [ ] **BUILD-2 — `process --mode validate|canonicalize` triage** (`todo`).
  Current verbs are `verify` and `format`; do not add another command until it
  proves agent value. Needed: inventory overlap with `verify`, `format`,
  `parse`, `serialize`, `mutate`, and `batch`; write the exact JSON/exit-code
  contract for `validate` and `canonicalize`; test whether it reduces agent
  routing errors in docs/evals; then either implement as a thin, schema-tested
  wrapper or explicitly park/decline it. Independent of other items.
- [ ] **BUILD-26 — Ecosystem issue harvest: Mermaid / Mermaid ASCII /
  Beautiful Mermaid migration fixtures** (`todo`). Convert the pinned ecosystem
  issue harvest into **fixture seeds and parity gaps**, not blanket scope
  expansion; the harvest artifact, rather than prose totals, is authoritative. Priority is direct Agentic Mermaid
  relevance: supported-family syntax parity, ASCII semantic preservation,
  deterministic layout/text/theming/security, and workflow/API ergonomics.
  - **Flowchart syntax + subgraphs**: typed metadata/style interop and parser
    safety (`mermaid-js/mermaid#7826`, `#7596`; `lukilabs/beautiful-mermaid#125`),
    subgraph direction/order/limits (`mermaid-js/mermaid#7946`, `#7477`, `#7741`,
    `#7848`; `lukilabs/beautiful-mermaid#55`). Feed #44 / BUILD-23 and the
    subgraph-direction/layout fixture matrix.
  - **ER/class/sequence/Gantt/chart parity**: ER aliases/directions/cardinality/
    subgraphs (`mermaid-js/mermaid#7482`, `#7472`, `#7351`, `#7417`;
    `lukilabs/beautiful-mermaid#131`, `#129`, `#124`); class generics/
    namespaces/annotations (`mermaid-js/mermaid#7648`, `#7480`, `#7753`, `#7618`;
    feeds BUILD-25/#118); sequence notes/fragments/async arrows (`AlexanderGrooff/mermaid-ascii#69`,
    `#68`, `#62`; `mermaid-js/mermaid#7681`, `#7664`, `#7687`;
    `lukilabs/beautiful-mermaid#107`, `#108`); Gantt scheduling/compact/
    multiline/vertical-marker gaps (`mermaid-js/mermaid#7714`, `#7407`, `#7603`,
    `#7602`, `#7564`, `#7339`, `#7300`); XY/pie/quadrant/architecture text or
    feature gaps (`mermaid-js/mermaid#7650`, `#7599`, `#7392`, `#7607`, `#7325`,
    `#7608`, `#7487`, `#7308`, `#7301`).
  - **ASCII/Unicode semantic preservation**: import or reproduce terminal
    fixtures for dropped labels, multiple edges, ID-vs-label parsing,
    international/fullwidth text, arrowhead attachment, fan-out trunks, ER/class
    labels, and semicolon/line-break parsing (`AlexanderGrooff/mermaid-ascii#70`,
    `#63`, `#59`, `#56`, `#46`; `lukilabs/beautiful-mermaid#122`, `#121`,
    `#119`, `#112`, `#111`, `#109`, `#61`, `#13`, `#12`, `#7`, `#5`). Treat
    these as semantic-loss blockers before visual polish.
  - **Layout/text/theming/security/workflow**: use Mermaid/Beautiful issues as
    quality-rubric seeds for spacing, subgraph overflow, edge crossings, long
    text/CJK/PNG clipping, html-label wrapping, consistent theme variables,
    contrast, CSS class emission, CSP/Trusted Types, external image blocking,
    CLI/API/package exports, minified/output options, and post-render mutation
    signals (`mermaid-js/mermaid#7901`, `#7930`, `#7932`, `#7911`, `#7827`,
    `#7505`, `#7496`, `#7354`, `#7341`, `#7359`, `#7565`, `#7555`, `#7794`,
    `#7873`, `#7815`, `#7695`, `#7645`, `#7517`, `#7556`; `lukilabs/beautiful-mermaid#83`,
    `#68`, `#65`, `#64`, `#56`, `#32`, `#25`, `#11`, `#89`, `#43`, `#14`,
    `#115`, `#130`, `#100`, `#101`, `#80`, `#79`, `#18`, `#1`, `#20`, `#33`,
    `#45`, `#73`, `#76`).
  - **Strategic new-family watchlist**: TreeView/filetree, C4/ArchiMate,
    mindmap, swimlane, and newer requested families (Domain Storytelling,
    Cynefin, DITAA, BPMN, RASCI, Data Pipeline, Use Case, PERT/CPM, Org Chart,
    Info) are roadmap signals only. Route TreeView through BUILD-6 first;
    do not expand family scope without a focused issue and evidence.
- [ ] **BUILD-6 — New upstream Mermaid families (11.4–11.15)** (`todo`). Mermaid added kanban (11.4), radar (11.6), treemap
  (~11.9), Venn (beta, 11.13), Ishikawa/fishbone (beta, 11.13), Wardley Maps
  (beta, 11.14), TreeView (11.14), and Event Modeling (11.15). Upstream
  syntax references for these already ship in the skill bundle. Prioritize
  TreeView first: it is hierarchical, ASCII-friendly, and requested against
  the upstream fork network (lukilabs/beautiful-mermaid#114). Treat
  beta-grammar families (Venn, Ishikawa, Wardley) as watch-and-wait until
  upstream syntax stabilizes. C4 belongs here too: the layout-aesthetic
  complaint mermaid-js/mermaid#7492 (C4 overlapping labels/text overflow/
  crossing arrows) cannot get a regression fixture until C4 is rendered — the
  aesthetic-issue coverage audit
  (`docs/issue-derived-test-cases.md`) defers it to this item.
- [ ] **BUILD-1 — Collapsible subgraphs (#7785)** (`todo`, after BUILD-23 metadata safety floor; independent of BUILD-20 harvest). Track Mermaid PR
  <https://github.com/mermaid-js/mermaid/pull/7785> (`@{ view: collapsed }`
  metadata syntax) and stay syntax-compatible. Large, but a real readability
  win for agent-generated architecture diagrams; pairs naturally with typed
  `collapse`/`expand` mutation ops. Measure with BUILD-13. (BUILD-14, the
  ASCII phantom-node bug that would have interfered with collapsed-subgraph
  edge attachment, is now fixed.)

## 3. Agent-usage verification backlog

- [ ] **EVAL-3 — Eval the `agentic-mermaid-diagram-workflow` skill for
  helpfulness** (`todo`). The public skill
  (`website/public/skills/agentic-mermaid-diagram-workflow/SKILL.md` +
  `references/`) is the site's main agent call-to-action, now linked from the
  footer. Verify it actually improves outcomes: run agent-usage cases with vs.
  without the skill loaded and compare on task success, verify-before-return
  discipline, Code-Mode vs. prose answers, and source-level-vs-structured edit
  choice — reuse the EVAL-1/EVAL-2 sandbox, task oracle, and trace linter.
  Fold any skill gaps back into `SKILL.md`/`references/`; keep or cut the
  footer link based on whether it demonstrably helps.


## 5. Parked / evidence-required ideas

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
  browser/package export tweaks, C4, ArchiMate (upstream PR #34), and
  animation remain fork-audit ideas. Promote one only with a focused issue
  and owner. (QuadrantChart was promoted to BUILD-11; fan-in grouping was
  PARK-1, promoted to BUILD-9.)


## 6. Consolidation / dedup backlog

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
- [ ] **CONS-30 — `agent/body-utils.ts` extraction** (`todo`). Mechanical,
  high-confidence dedup inside `src/agent/`: the LABEL_OVERFLOW closure (×6), the
  id allocator (×5), byte-identical `set_title` (×7), `pie-body` ≡ `quadrant-body`
  collection ops, the source-map builders, and the `extractLabels` frame (~12×).
  Also FNV-1a hash re-rolled in 6 family renderers → import `seedFrom`
  (`scene/seed.ts`), and ~47 hand-built `color-mix(in srgb, …)` strings → a
  shared `cssMix`.
- [ ] **CONS-40 — Generate the per-family stryker configs** (`todo`). The
  `stryker.<family>.config.json` lanes duplicate pure `family → globs → tests` data.
  Generate them from the citizenship matrix. Caveat: the citizenship test and
  matrix hard-code the config filenames, so a generator must keep on-disk names
  or update both in lockstep.
- [ ] **CONS-41 — Complete typed Scene leaf/marker migration** (`todo`). Extend
  the characterized transform/serializer/document primitives beyond the Mindmap
  and GitGraph pilot; replace family-local marker XML and classify every remaining
  `RawMark` escape without changing default bytes.
- [ ] **CONS-42 — Complete authoritative positioning for every family** (`todo`).
  Generalize the Mindmap/GitGraph `resolve → position → project` pilot so SVG and
  `layoutMermaid` never independently parse or resolve the same structured body.
- [ ] **CONS-43 — Continue physical layout-pass extraction** (`todo`). Move
  cohesive pass implementations out of `layout/passes/index.ts` one at a time
  behind the checked manifest; preserve order, mutation declarations,
  certificate reissue, layout bytes, and SVG bytes.
- [ ] **CONS-44 — Generate remaining public declarations and adapters** (`todo`).
  Derive SDK declarations and repeated CLI/MCP schemas from authoritative family
  descriptors, while retaining transport-neutral `applyOps` and tool dispatch.
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
