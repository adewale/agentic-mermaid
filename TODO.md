# Project Backlog

`TODO.md` is the canonical owner-facing inventory of unfinished work, owner
decisions, blocked observations, and evidence-triggered watch items. Explicitly
status-marked landing/completion evidence lives under `docs/project/archive/`;
current capabilities live in `docs/features.md` and generated registry
surfaces. IDs are stable names, not ordering.

Status legend: `todo` | `blocked` | `owner-decision` | `parked`.

## Release / owner decisions

- [ ] **DEC-1 — Get one real external consumer** (`todo`). Validate
  `agentic-mermaid/agent`, `am`, or `agentic-mermaid-mcp` in a real agent,
  TUI, CI gate, or editor integration outside this repo.
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
  outer WAF covers both compute-capable POST routes, while the application
  controls and production game day remain unfinished).
  Execute the bounded admission,
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
- [ ] **BUILD-34 — Measure peer colors as drawn (chart honesty H5)** (`todo`).
  Palettes separate peers where colors are generated (`categoricalPalette`,
  ΔE_OK ≥ 0.10), but a scene-keyed census of every family's honesty corpus in
  every style found three cases where the drawn colors compress: the
  watercolor wash glazes pie slices at 30% (ΔE_OK 0.03 between slices) while
  their legend keys stay opaque; journey actor dots under watercolor (0.049);
  and radar legend keys, drawn at the curve opacity with a neutral border
  (0.06–0.09 between keys in most palettes — the curves themselves separate by
  their opaque outlines). Build an as-drawn oracle keyed by legend categories
  (keys distinguishable; each key matches the marks it names), then decide the
  look policy for keyed marks. See
  [`docs/design/system/chart-honesty.md`](docs/design/system/chart-honesty.md).
- [ ] **BUILD-35 — Report radar scales that exclude zero (chart honesty H6)**
  (`todo`). An authored radar `min` above zero draws radii proportional to
  `value − min` (`radarValueRatio`), and values outside `[min, max]` are
  clamped, so a curve can misstate its values with no report. XY charts report
  the same distortion as `BAR_RANGE_EXCLUDES_ZERO`; give radar the equivalent
  verify warning (or a shared scale-baseline code).
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


## Testing architecture backlog

- [ ] **TEST-3 — Complexity-aware, registry-derived test portfolio** (`todo`).
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
  score target** (`todo`,
  [#265](https://github.com/adewale/agentic-mermaid/issues/265); supersedes the historical framing in
  [#35](https://github.com/adewale/agentic-mermaid/issues/35)). Treat 50.69% as
  a historical diagnostic, not a quality gate. Resolve whether
  `offOutlineEndpoints` is hard or cosmetic, enroll final rendered-endpoint
  diagnostics in `audit:ugly` if that public command should own them (the
  independent diagnostic is now enforced by `auditRouteContracts` and the
  layout rubric), extract an independent certificate consistency audit, and
  make production pipeline invariant checks explicit.
  Use the canonical 2,800-case corpus, focused mutation lanes, and bounded route
  sabotage to prove named behaviors; do not restore a broad percentage chase.
- [ ] **TEST-6 — Audit cross-family endpoint-marker and geometry authority**
  (`todo`, [#258](https://github.com/adewale/agentic-mermaid/issues/258)).
  Derive the marker-producing family inventory from the registry, characterize
  Architecture and Journey contact intent before changing them, and require
  separate shaft/surface and visible-marker/surface evidence. Inventory every
  final endpoint writer per affected family; share family-owned production
  geometry while keeping final verification independently derived.
- [ ] **TEST-7 — Characterize tangential rectangle arrivals** (`todo`,
  [#259](https://github.com/adewale/agentic-mermaid/issues/259)). Add the
  independent final-geometry incidence metric and report ordinary curated cases
  separately from the 2,800-case pathological corpus. Keep it non-blocking and
  make no route repair unless the issue's representative-witness and
  non-regression decision gate passes.

## Consolidation / dedup backlog

- [ ] **CONS-26 — Finish agent/render grammar-authority convergence** (`todo`,
  delivered as focused child work under
  [#248](https://github.com/adewale/agentic-mermaid/issues/248)).
  Flowchart, Pie, Quadrant, Mindmap, and GitGraph already project renderer-owned
  ASTs; State, Timeline, and Journey share parse cores; XYChart now projects the
  strict renderer AST and no longer owns a second grammar. Radar also projects
  the strict renderer-owned `parseRadarChart()` result; it was incorrectly
  retained in the old remainder list. Sankey projects the renderer-owned
  `parseSankeyDiagram()` result from its first release. The remaining duplicated families are
  [Class #260](https://github.com/adewale/agentic-mermaid/issues/260),
  [ER #266](https://github.com/adewale/agentic-mermaid/issues/266),
  [Sequence #264](https://github.com/adewale/agentic-mermaid/issues/264),
  [Architecture #262](https://github.com/adewale/agentic-mermaid/issues/262),
  and [Gantt #261](https://github.com/adewale/agentic-mermaid/issues/261).
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

## Contribution governance backlog

- [ ] **GOV-1 — Enforce one primary contract boundary per PR** (`todo`,
  [#263](https://github.com/adewale/agentic-mermaid/issues/263)). Require one of
  grammar authority, mutation closure, rendered geometry, or an explicitly
  justified coupled exception. Start with a ten-PR advisory period, measure
  false positives and overrides, and only then make the least-privilege,
  API-only metadata check blocking. Keep file-path inference advisory.

## Source-preservation defects

- [ ] **SRC-1 — Segment-preserving Class and Timeline bodies** (`todo`). Preserve typed mutation around unmodeled statements without violating byte-for-byte opaque fallback. Add parser/serializer closure and adversarial reorder tests before promotion.
- [ ] **SRC-2 — Positional comments for Flowchart and State** (`todo`). Replace announced `COMMENT_DROPPED` loss with positionally anchored opaque segments that survive typed mutation.

## Known defects

Found by the property and model tests. Where a test pins the wrong behaviour
or a generator steers around it, the entry names the test; remove the pin
and the steering with the fix.

- [ ] **BUG-9 — ER `add_attribute` can move an entity ahead of others** (`todo`). It inserts the declaration before the first relation naming the entity, so re-parse creates it before that relation's other end; the serializer compensates unless that end belongs to a subgraph (`D ||--o{ B`, then `subgraph G` / `D ||--o{ B` / `end`, `add_attribute B` re-parses as B before D). Inserting after that relation keeps the order.
- [ ] **BUG-10 — ER order a declaration in the entity's own subgraph cannot keep** (`todo`). A top-level entity whose body position falls between two entities of one subgraph (`D ||--o{ C : r0` / `subgraph G0` / `D` / `E` / `end`, remove `r0` → D, E, C), or a `style`-created entity inside a subgraph, re-parses in a different position. About 0.6% of fuzzed edits.
- [ ] **BUG-11 — ER subgraph precedence differs between the typed body and the renderer** (`todo`). The typed body lets a later declaration inside a subgraph override the subgraph an earlier relation gave the entity; `src/er/parser.ts` keeps the first and still lists the entity in both (`subgraph G2` / `C ||--o{ A` / `end` / `subgraph G1` / `A` / `end`). Pinned 11.16 has no ER subgraphs (it reads `subgraph G` as entities); upstream added them in 11.17 (mermaid-js/mermaid#7792) with `makeUniq`: the first subgraph to close keeps the entity, which is listed once. Use that rule in both parsers, as BUG-27 does for flowchart, and correct the "Mermaid 11.16 ER subgraphs" comment in `src/er/parser.ts`.
- [ ] **BUG-12 — Sequence renderer creates actors on `activate`/`deactivate`** (`todo`). Upstream creates none: `activate Z` then `A->>Z` gives A, Z upstream but Z, A in ours, and a phantom Z inside a `rect`. The typed body already matches upstream.
- [ ] **BUG-13 — Sequence `add_participant` or indexed `add_message` can reorder participants on re-parse** (`todo`). A new participant is declared or first used ahead of existing ones (`A->>B: hi`, `add_participant C` re-parses as C, A, B).
- [ ] **BUG-14 — Sequence metadata alias precedence** (`todo`). `participant B@{ "alias": "Y" } as B` is labelled Y upstream but B in ours (renderer and typed body).
- [ ] **BUG-15 — Sequence `properties` and `details` lines create no participant** (`todo`). `properties P: {…}` creates P upstream; both our parsers ignore it, so participant order differs. Upstream's grammar routes `details` through the same `actor` rule, so it likely creates one too (not run: upstream's `addDetails` needs a DOM).
- [ ] **BUG-16 — Sequence naming re-declaration keeps old links** (`todo`). Upstream resets the actor's links to `{}` when `participant X as Y` re-declares a known participant; ours keeps them.
- [ ] **BUG-17 — Sequence box membership of an already-created participant** (`todo`). `A->>B` then `box` / `participant A` / `end`: upstream leaves the box's actor list empty (but sets `A.box`); ours puts A in the box.
- [ ] **BUG-18 — Flowchart: emulate upstream's HTML-tag rewrite or not** (`owner-decision`). Upstream's preprocessor (`cleanupText`) treats a `<word … >` span as an HTML tag and rewrites `="…"` inside it to `='…'`, so it rejects `A -->|"<a="| B["b"] --> C` and silently mangles `A["<a"] --- B["x"] --- C["c="] --- D["d"] --> E` (C's label swallows D). We parse both as written. The flowchart differential's generator skips these sources.
- [ ] **BUG-19 — Entity codes stay literal in flowchart (other than `#quot;`), sequence and ER text** (`todo`). Upstream renders `#9829;` as ♥, `#35;` as `#` and `#amp;` as `&` in labels, aliases and messages; ours shows the code. Decoding `#lt;`/`#gt;` must not inject formatting tags. `src/pie/parser.ts` already implements upstream's full entity pipeline and has a browser oracle; reuse it.
- [ ] **BUG-20 — Flowchart ellipse shape `A(-a-)` is unsupported** (`todo`). We read it as a rounded node labelled `-a-`.
- [ ] **BUG-21 — Flowchart `A>x;y]` is rejected** (`todo`). Upstream treats the `;` as label text; our statement splitter does not treat `>…]` as a bracket.
- [ ] **BUG-22 — Flowchart `@{` inside a quoted label makes the diagram opaque** (`todo`). The unsupported-syntax gate reads `A["x a@{y"]` as metadata, so typed labels containing `@{` re-parse as opaque.
- [ ] **BUG-23 — Flowchart labels containing a literal backslash-n or `#quot;` don't round-trip** (`todo`). Upstream's DB keeps `\n` as two characters, but since 11.13 its renderer draws it as a line break in plain labels, as ours does. The display difference is in markdown strings, where upstream keeps `\n` literal and ours breaks the line. A typed label containing a literal backslash-n, or the text `#quot;`, re-parses differently; the serializer should write them with upstream's entities (`#92;n`, `#35;quot;`).
- [ ] **BUG-24 — Flowchart `@{ label }` YAML escapes** (`todo`). We unescape only `\\`, `\"` and `\'`; upstream's YAML also handles `\t`, `\a`, `\x41` and `''`, and rejects `'a}b;c'`, which we accept.
- [ ] **BUG-25 — ASCII draws formatting tags literally** (`todo`). Flowchart markdown strings, `<b>` labels and sequence/state emphasis are drawn with their tags in ASCII/Unicode output, while the meta projection strips them, so `projectedText` differs from the drawing there.
- [ ] **BUG-26 — Flowchart source-map scanners still honour `\` escapes and `'` quotes** (`todo`). `flowchart-body.ts` and `source-map-spans.ts` disagree with the parser on those lines, so spans can be wrong.
- [ ] **BUG-27 — A flowchart node re-defined in a second subgraph belongs to both** (`todo`). `subgraph S0` / `A[x]` / `end` / `subgraph S1` / `A[y]` / `B` / `end` / `A --> B` lays out two nodes with id `A`, and `verify` fails with two `GROUP_BREACH` warnings. Upstream's `makeUniq` leaves A only in S0, the first subgraph to close. `defineNode` → `trackInSubgraph` in `src/parser.ts` has no uniqueness check.
- [ ] **BUG-28 — Invalid YAML frontmatter is ignored silently** (`todo`). `---` / `title: [unclosed` / `---` renders, and `verify` returns `ok: true` with no warning; upstream rejects the diagram. `parseYamlDocument` in `src/mermaid-source.ts` swallows the error. Report it, at least as a warning.
- [ ] **BUG-29 — Flowchart `style X` creates no node** (`todo`). Upstream creates X at the `style` line (`style Z fill:#f00` then `A --> Z` orders Z before A, and a node that is only styled is drawn); ours orders A, Z and draws nothing for a style-only node.
- [ ] **BUG-30 — ER quoted text accepts and writes `\"`** (`todo`). Upstream has no escapes in ER quoted strings and rejects `A["a\"b"]` and `A ||--o{ B : "l\"m"`; `src/er/parser.ts` unescapes them and `quoteErText` writes them, so serialized ER text containing `"` is source upstream can't read. Write `"` as `#quot;`, as flowchart does.
- [ ] **BUG-31 — Sequence and ER aliases get markdown emphasis at parse time, and the serializer rewrites the source** (`todo`). Upstream stores `participant A as *x* y` and `A["p*q*"]` as written; ours stores `<i>x</i> y` and `p<i>q</i>`, so any typed edit writes `as <i>x</i> y` and `A["p<i>q</i>"]`.
- [ ] **BUG-32 — Sequence message text differs between the renderer and the typed body** (`todo`). For `A->>B: m*a*n c\nd` the renderer draws `m<i>a</i>n` and a line break, while the typed body stores `m*a*n` and `c\nd`, as upstream's DB does.

## Non-goals

- Do not port Vercel-specific package rename, committed `dist/`, `.vercel`, or Vercel branding.
- Do not fold `zhenhuaa/mdv` wholesale into this package; terminal Markdown viewing belongs in a separate tool or companion package.
- Do not port old dagre-specific layout code directly; translate only ideas that still apply to the current ELK/layout-engine architecture.
- Do not treat historical archives or process notes as backlog unless an item is promoted here with an ID.
