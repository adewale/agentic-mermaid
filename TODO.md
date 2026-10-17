# Project Backlog

`TODO.md` is the canonical owner-facing inventory of unfinished work, owner
decisions, blocked observations, and evidence-triggered watch items. Explicitly
status-marked landing/completion evidence lives under `docs/project/archive/`;
current capabilities live in `docs/features.md` and generated registry
surfaces. IDs are stable names, not ordering.

Status legend: `todo` | `blocked` | `owner-decision` | `parked`.

Reconciled against `main` `aa16b127` and GitHub on 2026-10-17. An open PR is
proposed work, not a shipped capability; a closed issue is not completion
evidence when its acceptance conditions still fail. Plans supply
design context, never additional queues. Retired IDs are not reused.

## Release / owner decisions

- [ ] **REL-1 — Publish and verify the prepared release** (`todo`,
  [#378](https://github.com/adewale/agentic-mermaid/issues/378)). Source declares
  0.4.2, but npm and the hosted site/MCP still serve 0.4.1 at the reconciliation
  date. Follow `docs/contributing/releasing.md`, choose the actual green release
  SHA rather than an old issue-body SHA, finish the changelog, and verify npm,
  site build identity and a hosted capability after publication. A green CI run
  or a deliberately skipped deployment is not delivery evidence.
- [ ] **DEC-6 — Decide the hosted `execute` boundary from usage evidence**
  (`owner-decision`, [#204](https://github.com/adewale/agentic-mermaid/issues/204)).
  Compare hosted direct tools, hosted Code Mode and local Code Mode for real
  tasks, demand, cost and compatibility before deciding retain/gate/remove.
  This does not authorize removing the tool. Keep SEC-4 relevant to every
  compute-capable route retained publicly.
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
  preview/verify view (proposed in PR #374, not yet merged) before adding an editable surface; keep tool results useful
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
  work from the pinned upstream syntax references, current family descriptors
  and `am capabilities --json`, using demand, maturity, syntax stability and
  semantic leverage; the former upstream manifest/report was removed in #361.
  Do not rebuild it or pre-rank a shadow queue here. Each
  promoted family passes the citizenship ratchet and the current source,
  primitive, backend, output, transport and extension contracts. Section A
  supplies the recognition floor: official and unknown headers are
  preserved or diagnosed and never fall through to Flowchart. Maturity comes
  from reviewed upstream evidence rather than a `-beta` spelling heuristic.
  Native C4 is a design proposal in
  [#387](https://github.com/adewale/agentic-mermaid/issues/387), not a currently
  native family or an automatic priority over confirmed defects.
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

- [ ] **TEST-3 — Review observed test/release outcomes** (`todo`). The July
  portfolio migration is complete and its
  [measurement record](docs/project/archive/complexity-aware-test-portfolio-plan.md)
  is historical. Inspect actual macOS/Windows release-job runs and compare CI
  p50/p95, retries/flakes, human findings, churn and escaped defects over a
  documented post-migration window of at least 30 merges. The window has
  elapsed; the analysis has not been supplied. Account for #361 and later
  runtime/suite changes rather than attributing every difference to July's
  migration. Do not recreate removed reports, receipts or mandatory review gates.
  Upstream cost/covering-array research is tracked in
  [`testing-best-practices#21`](https://github.com/adewale/testing-best-practices/issues/21).
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
  Use retained public route contracts and representative final-output witnesses
  to prove named behaviors. The removed mutation/sabotage lanes are not
  prerequisites; do not restore them or a broad percentage chase.
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
- [ ] **TEST-8 — Label-text census** (`todo`). For every case in the docs
  corpus, the upstream bench and the official fences, record each label's text
  on every surface (model, SVG, ASCII, meta, facts, metrics) and upstream's DB
  text. Assert the surfaces agree and match upstream, replace the bench's
  self-harvested `labelsContain` values with upstream-harvested ones, and post a
  base-vs-head diff of changed label text on pull requests. It flags BUG-19 and
  BUG-20 on existing corpus cases, and would have flagged the untrimmed labels
  fixed in #359; image contact sheets would not, because most of these defects
  render identically before and after a change.
- [ ] **TEST-9 — Widen the upstream differentials** (`todo`). The flowchart and
  sequence generators still omit characters and constructs where defects live:
  entity codes other than `#quot;`, `\n`, markdown strings, `@{}`, `style` lines
  and subgraph membership (flowchart); `* # \ < >`, `activate`, `box`,
  `properties` and `links` (sequence). Add ER, class and state DBs to the upstream
  worker, and compare what upstream displays (the Pie browser oracle's
  approach), not only its DB.
- [ ] **TEST-10 — Random-order, fresh-process finder lane** (`todo`). Two
  order-dependent failures (resvg initialization, the Bun `node:vm` timer)
  surfaced only by accident. Run the suite nightly in shuffled file order and
  each file alone. The existing `nightly-finder.yml` already randomizes property
  seeds and reports to #362; shuffled order and file isolation are the additional
  work here, not a second random-seed finder.
- [ ] **TEST-11 — Run the CJK font tests in CI** (`todo`). The two CJK cases in
  `png-fonts.test.ts` skip unless `fonts-wqy` is installed, and no workflow
  installs it, so they never run. Install the font in the unit job and make the
  skip fail when `CI=true`.
- [ ] **TEST-12 — Sweep for Bun's asymmetric-matcher write-back** (`todo`). In
  Bun 1.4.2, `toMatchObject`/`toEqual` with `expect.any`, `arrayContaining` or
  `closeTo` overwrite the checked field of the received object with the matcher,
  so a later read of that field sees the matcher, not the data. Find tests that
  read an object after such an assertion, and report the bug upstream.
- [ ] **TEST-13 — Execute installed-package quickstarts** (`todo`,
  [#377](https://github.com/adewale/agentic-mermaid/issues/377)). Run the documented
  Getting Started commands against a packed, installed tarball in a clean
  consumer directory. Existing command-vocabulary checks do not execute those
  commands or prove package-runner resolution.

## Consolidation / dedup backlog

- [ ] **CONS-30 — Decide residual body-helper consolidation** (`owner-decision`).
  The `agent/body-utils.ts` extraction landed: optional fields, insert positions,
  overflow collection and accessibility serialization are shared. Per-family
  validators, move-target codes and seeded IDs differ intentionally. Decide
  whether insert-position error wording should converge; promote any further
  extraction only with a demonstrated repeated behavior and characterization.
  Do not mechanically unify the intentionally different code.
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
- [ ] **CONS-46 — One text codec per grammar context** (`todo`, in progress). Most Known
  defects were one codec re-implemented per stage (parse, serialize, render,
  ASCII, meta, metrics, source map) and per family. Built so far: the shared
  Mermaid entity layer (`src/shared/mermaid-entities.ts`, from Pie's), one YAML
  reader for `@{}` metadata and frontmatter (`src/shared/mermaid-yaml.ts`, with
  per-family block lexers), and one display rule for label text that SVG,
  ASCII, meta and metrics all read (`displayText` in `src/multiline-utils.ts`).
  What remains is adopting the entity layer and a `decode`/`encode` pair per
  grammar context (flowchart bracket/pipe/title, sequence alias/message/note, ER
  quoted text, class label), guarded by `decode(encode(x)) === x` and
  "upstream reads `encode(x)` as `x`". Remaining members: BUG-19, 23, 30, 31, 32.
- [ ] **CONS-47 — One flowchart tokenizer with source spans** (`todo`). At least
  17 hand-written quote/bracket scanners lex the flowchart line (parser,
  statement splitter, unsupported-syntax gate, analyze masks, source map), and a
  rule change reaches only some of them (BUG-21, 22, 26). Emit tokens with spans
  once; derive the source map from spans instead of re-lexing, and lint against
  new ad-hoc quote scanners.
- [ ] **CONS-45 — Finish terminal-context convergence** (`todo`). Move remaining
  family-local cell writers and context argument lists onto shared grapheme-safe
  canvas/context helpers without projecting pixel Scene geometry. Build on the
  shared terminal compositor delivered by #394 under
  [#386](https://github.com/adewale/agentic-mermaid/issues/386). PR #395
  incorporates an older #394 revision and needs reconciliation with current
  main before merge; retain #395's distinct prepared-text/XY work.

## Contribution governance backlog

- [ ] **GOV-2 — Require canonical CI on `main`** (`owner-decision`,
  [#331](https://github.com/adewale/agentic-mermaid/issues/331)). Configure the
  repository rule requiring `CI complete` on main. Main remains unprotected at
  reconciliation; the golden-token removal and follow-up code changes already
  landed. This is a repository-owner setting, not another CI implementation.
- [ ] **GOV-1 — Enforce one primary contract boundary per PR** (`todo`,
  [#263](https://github.com/adewale/agentic-mermaid/issues/263)). Require one of
  grammar authority, mutation closure, rendered geometry, or an explicitly
  justified coupled exception. Start with a ten-PR advisory period, measure
  false positives and overrides, and only then make the least-privilege,
  API-only metadata check blocking. Keep file-path inference advisory.

## Source-preservation defects

- [ ] **SRC-1 — Segment-preserving Class and Timeline bodies** (`todo`). Preserve typed mutation around unmodeled statements without violating byte-for-byte opaque fallback. Add parser/serializer closure and adversarial reorder tests before promotion.
- [ ] **SRC-2 — Positional comments for Flowchart and State** (`todo`). Replace announced `COMMENT_DROPPED` loss with positionally anchored opaque segments that survive typed mutation.

## Documentation / issue triage

- [ ] **TRIAGE-1 — Revalidate the color issue's remaining surface matrix**
  (`todo`, [#303](https://github.com/adewale/agentic-mermaid/issues/303)). Several
  original cases have since been fixed. Reproduce each remaining source,
  typed-edit, terminal and error-reporting claim on current main before keeping
  or closing it; its original before/after table is historical, not today's state.
- [ ] **TRIAGE-2 — Resolve the unfinished ER/preprocessor exploration** (`todo`,
  [#372](https://github.com/adewale/agentic-mermaid/issues/372)). Reproduce the
  ER entity-order witness separately from the proposed serializer rewrite and
  existing BUG-9/BUG-10. Do not merge the known-failing WIP wholesale. Evaluate
  the proposed flowchart preprocessor rejection against the current input-language
  policy; upstream-only rejection is not automatically a product requirement.

## Known defects

Found by the property and model tests. Where a test pins the wrong behaviour
or a generator steers around it, the entry names the test; remove the pin
and the steering with the fix.

Only differences a user sees without comparing against Mermaid are listed
here (see "Mermaid is our input language, not our spec" in `CLAUDE.md`).
Differences that exist only against Mermaid, such as which subgraph wins a
tie, participant creation order, sources only Mermaid rejects and display
choices, are collected in
[#363](https://github.com/adewale/agentic-mermaid/issues/363) for one
investigation of the class rather than per-item fixes.

- [ ] **BUG-9 — ER `add_attribute` can move an entity ahead of others** (`todo`). It inserts the declaration before the first relation naming the entity, so re-parse creates it before that relation's other end; the serializer compensates unless that end belongs to a subgraph (`D ||--o{ B`, then `subgraph G` / `D ||--o{ B` / `end`, `add_attribute B` re-parses as B before D). Inserting after that relation keeps the order.
- [ ] **BUG-10 — ER order a declaration in the entity's own subgraph cannot keep** (`todo`). A top-level entity whose body position falls between two entities of one subgraph (`D ||--o{ C : r0` / `subgraph G0` / `D` / `E` / `end`, remove `r0` → D, E, C), or a `style`-created entity inside a subgraph, re-parses in a different position. About 0.6% of fuzzed edits.
- [ ] **BUG-19 — Entity codes stay literal in flowchart (other than `#quot;`), sequence and ER text** (`todo`). Upstream renders `#9829;` as ♥, `#35;` as `#` and `#amp;` as `&` in labels, aliases and messages; ours shows the code. Decoding `#lt;`/`#gt;` must not inject formatting tags. `src/pie/parser.ts` already implements upstream's full entity pipeline and has a browser oracle; reuse it.
- [ ] **BUG-20 — Flowchart ellipse shape `A(-a-)` is unsupported** (`todo`). We read it as a rounded node labelled `-a-`.
- [ ] **BUG-23 — Flowchart labels containing a literal backslash-n or `#quot;` don't round-trip** (`todo`). Upstream's DB keeps `\n` as two characters, but since 11.13 its renderer draws it as a line break in plain labels, as ours does. The display difference is in markdown strings, where upstream keeps `\n` literal and ours breaks the line. A typed label containing a literal backslash-n, or the text `#quot;`, re-parses differently; the serializer should write them with upstream's entities (`#92;n`, `#35;quot;`).
- [ ] **BUG-26 — Flowchart source-map scanners still honour `\` escapes and `'` quotes** (`todo`). `flowchart-body.ts` and `source-map-spans.ts` disagree with the parser on those lines, so spans can be wrong.
- [ ] **BUG-30 — ER quoted text accepts and writes `\"`** (`todo`). Upstream has no escapes in ER quoted strings and rejects `A["a\"b"]` and `A ||--o{ B : "l\"m"`; `src/er/parser.ts` unescapes them and `quoteErText` writes them, so serialized ER text containing `"` is source upstream can't read. Write `"` as `#quot;`, as flowchart does.
- [ ] **BUG-31 — Sequence and ER aliases get markdown emphasis at parse time, and the serializer rewrites the source** (`todo`). Upstream stores `participant A as *x* y` and `A["p*q*"]` as written; ours stores `<i>x</i> y` and `p<i>q</i>`, so any typed edit writes `as <i>x</i> y` and `A["p<i>q</i>"]`.
- [ ] **BUG-32 — Sequence message text differs between the renderer and the typed body** (`todo`). For `A->>B: m*a*n c\nd` the renderer draws `m<i>a</i>n` and a line break, while the typed body stores `m*a*n` and `c\nd`, as upstream's DB does.
- [ ] **BUG-35 — Contact-sheet case AJ routes an edge label onto a shared trunk** (`todo`). `ROUTE_LABEL_ON_SHARED_TRUNK` on `D->E` is allow-listed in `heuristic-tracker.test.ts`.
- [ ] **BUG-37 — Architecture router sends an edge through a card** (`todo`). The nightly finder's seed `AM_FC_SEED=1102132276` in `architecture-layout.test.ts` routes `s0_0:T --> T:s0_1` through `s0_2` (three services in one group, each linked left to a service in a second group). Pinned as a fast-check example in that file.
- [ ] **BUG-42 — ELK throws on an edge between a nested subgraph's node and its enclosing subgraph** (`todo`). With `direction TB` overrides, `B --> Outer` or `Outer --> B` (B inside Inner inside Outer) raises `UnsupportedGraphException` and the render fails. Pinned in `subgraph-hierarchy-exhaustive.test.ts`.
- [ ] **BUG-43 — Edges between a subgraph and its own contents break routing rules** (`todo`). Nine such pairs (for example `A --> Outer`, `Inner --> Outer`) render but leave an endpoint off the outline, route through a node, or misanchor on the container; `verify` reports them. Pinned in `subgraph-hierarchy-exhaustive.test.ts`.
- [ ] **BUG-46 — SVG output carries unrounded floats** (`todo`). The default style emits `36.900000000000006` (state) and `4.199999999999999` (timeline, pie), and hand-drawn styles emit `stroke-width="2.0999999999999996"`. Round once where numbers become SVG text, shared by Scene and SVG; goldens that pin these values change with the fix.
- [ ] **BUG-47 — A Journey title, section or task that is only `<br/>` is rejected** (`todo`). Mermaid draws `<br/>` as text there; ours reports "Invalid user journey line". Pinned `it.failing` in `property-svg-wellformedness.test.ts`.
- [ ] **BUG-52 — Mutators keep "don't empty" floors that predate renderable empty charts** (`todo`). `set_title` on `createMermaid('pie')` is refused ("Pie must keep at least one slice"); the Architecture and Journey mutators keep similar floors.
- [ ] **BUG-60 — A YAML string whose first line is only spaces does not round-trip through frontmatter** (`todo`). The `yaml` writer turns ` \n` into a block scalar that reads back as `\n`. Pinned `test.failing` in `metadata-yaml.test.ts`.
- [ ] **BUG-70 — Terminal projectedText collapses authored empty rows** (`todo`,
  [#402](https://github.com/adewale/agentic-mermaid/issues/402)). A label such as
  `long label<br><br>x` retains its visible row gap and exact cell coordinates,
  but metadata reports `long label\nx`. Preserve complete text-occurrence
  provenance rather than joining only rows that contain glyphs.
- [ ] **BUG-61 — Code Mode trailing line comments break the wrapper** (`todo`,
  [#366](https://github.com/adewale/agentic-mermaid/issues/366)). Protect
  multi-statement snippets ending in `//` from swallowing wrapper syntax.
  PR #365 addresses #274/#275, not this case.
- [ ] **BUG-68 — Code Mode result capture and ops-array recovery hint** (`todo`,
  [#274](https://github.com/adewale/agentic-mermaid/issues/274),
  [#275](https://github.com/adewale/agentic-mermaid/issues/275)). PR #365 proposes
  returning a final expression after preceding statements and replacing the
  nonexistent `applyOps` recovery hint. Verify the public behavior at merge;
  this does not close BUG-61's trailing-comment case.
- [ ] **BUG-62 — Multiline titles can clip** (`todo`,
  [#381](https://github.com/adewale/agentic-mermaid/issues/381)). Pie, Sankey and
  Architecture need complete title geometry; proposed PR #395 also incorporates
  the XY title fix in PR #380. Keep the nightly #362 collector separate from
  closure of one counterexample.
- [ ] **BUG-63 — Quadrant wrapping changes capitalization** (`todo`,
  [#382](https://github.com/adewale/agentic-mermaid/issues/382)). Apply display
  transforms before wrapping without changing authored meaning; proposed in #395.
- [ ] **BUG-64 — Gantt/Radar wrapping duplicates literal formatting tags**
  (`todo`, [#383](https://github.com/adewale/agentic-mermaid/issues/383)). Prepare
  display text once rather than reinterpreting wrapped text; proposed in #395.

## Non-goals

- Do not port Vercel-specific package rename, committed `dist/`, `.vercel`, or Vercel branding.
- Do not fold `zhenhuaa/mdv` wholesale into this package; terminal Markdown viewing belongs in a separate tool or companion package.
- Do not port old dagre-specific layout code directly; translate only ideas that still apply to the current ELK/layout-engine architecture.
- Do not treat historical archives or process notes as backlog unless an item is promoted here with an ID.
