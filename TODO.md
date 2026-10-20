# Project Backlog

`TODO.md` is the canonical owner-facing inventory of unfinished work, owner
decisions, blocked observations, and evidence-triggered watch items. Explicitly
status-marked landing/completion evidence lives under `docs/project/archive/`;
current capabilities live in `docs/features.md` and generated registry
surfaces. IDs are stable names, not ordering.

Status legend: `todo` | `blocked` | `owner-decision` | `parked`.

Reconciliation updated on 2026-10-18 after merged #410 and against the current
follow-up candidates. Candidate implementation does not establish merge,
publication or deployment; a closed issue is not completion evidence when its
acceptance conditions still fail. Plans supply design context, never additional
queues. Retired IDs are not reused.

## Release / owner decisions

- [ ] **REL-1 — Publish and verify the prepared release** (`todo`,
  [#378](https://github.com/adewale/agentic-mermaid/issues/378)). Source declares
  0.4.2, but npm and the hosted site/MCP still serve 0.4.1 at the reconciliation
  date. Follow `docs/contributing/releasing.md`, choose the actual green release
  SHA rather than an old issue-body SHA, finish the changelog, and verify npm,
  site build identity and a hosted capability after publication. A green CI run
  or a deliberately skipped deployment is not delivery evidence.
  Merged PR [#410](https://github.com/adewale/agentic-mermaid/pull/410) resolves
  [#406](https://github.com/adewale/agentic-mermaid/issues/406),
  [#407](https://github.com/adewale/agentic-mermaid/issues/407),
  and [#408](https://github.com/adewale/agentic-mermaid/issues/408):
  relationship endpoint/shaft preservation, native multi-ended lollipops,
  explicit relation metadata, checked lollipop admission, member admission and
  caller-array ownership. The Class fact additions have an explicit
  `exact: true` migration example in `docs/api.md`. Its semantic export/reload,
  rendered-marker and installed-package checks passed before merge; that is
  source completion, not publication or a general lossless-editing guarantee.
  [PR #418](https://github.com/adewale/agentic-mermaid/pull/418) implements ER
  entity order (#372) and the remaining Journey, empty-edit and YAML fixes
  (#367). [PR #419](https://github.com/adewale/agentic-mermaid/pull/419) implements
  CONS-46 and the remaining #372 text work. Completion of #372 depends on PR #418's ER fix and this candidate being
  integrated and verified together; final CI and merge remain pending. The
  completed #363 disposition record can close its investigation independently
  of the runtime follow-ups it identifies. Config ownership in
  [PR #416](https://github.com/adewale/agentic-mermaid/pull/416) is a separate
  candidate, not a dependency of those text decisions. Qualify release claims
  with [the remaining export limits](docs/project/divergences.md#mermaid-input-decisions-363)
  and the preexisting Sequence terminal omission under CONS-45. REL-1 still
  requires final-candidate CI and artifact/delivery verification.
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
  Native C4 from [#387](https://github.com/adewale/agentic-mermaid/issues/387)
  is implemented in source; see [its dispositions and validation](docs/design/families/c4.md).
  Native admission does not imply a published package or deployed site update.
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
- [ ] **TEST-9 — Widen the upstream differentials** (`todo`). The seeded
  grammar comparison now also mutates with fixed lexer-boundary fragments
  (`eval/mermaid-modern-compat/grammar-fragments.ts`: entity codes, directives,
  keyword and digit-led names, `@`, `||`, `:::`, Unicode blanks), reports silent
  reads per family with reduced examples, and a nightly rolling-seed lane files
  them in one issue. Left: the fast-check flowchart and sequence generators still
  omit those spellings, `\n`, markdown strings, `@{}`, `style` lines and subgraph
  membership (flowchart); `* # \ < >`, `activate`, `box`, `properties` and
  `links` (sequence). Add ER, class and state DBs to the upstream worker, and
  compare what upstream displays (the Pie browser oracle's approach), not only
  its DB.
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
- [ ] **CONS-44 — Integrate the config authority candidate** (`todo`). Source
  implementation is complete in separate PR
  [#416](https://github.com/adewale/agentic-mermaid/pull/416): family-owned
  diagnostic hooks include public extension verification, and repeated
  terminal/MCP schemas use their existing contracts. The candidate includes
  native C4's family hook; final-head checks are recorded in the PR, and merge
  remains pending. This PR is not a
  dependency of the #363 dispositions or CONS-46 text
  implementation; release delivery remains under REL-1.
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
  [#386](https://github.com/adewale/agentic-mermaid/issues/386), prepared text
  landed in #395, shared identities/compound routes in #404, and marker and
  State-note/atomic-route fixes in #401/#405. The old pre-merge reconciliation
  is complete. Promote a remaining adapter extraction only with a concrete
  repeated behavior; this is not a request to redo those delivered contracts.
  A preexisting combined Sequence box/`alt` case omits the header and divider
  from terminal ink while SVG retains them. The exact witness and baseline are
  recorded in [divergences](docs/project/divergences.md#preexisting-sequence-terminal-limit);
  separate box and fragment tests do not prove that composition. CONS-46 does
  not fix or qualify this geometry as complete.

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

TRIAGE-2 is retired. PR #418 supplies #372's bounded ER order fix; the wholesale
serializer WIP is superseded. The Flowchart rejection proposal is declined in
favor of read-and-warn, and the Sequence proposal is replaced by context codecs.
State/Mindmap text handling is implemented in this candidate. CONS-46's source
implementation is complete and leaves the active backlog; final combined CI,
merge and #372's dependency on PR #418 remain tracked under REL-1. Terminal
geometry and Flowchart source-map tokenization remain under CONS-45 and CONS-47.

## Known defects

Found by the property and model tests. Where a test pins the wrong behaviour
or a generator steers around it, the entry names the test; remove the pin
and the steering with the fix.

Only differences a user sees without comparing against Mermaid are listed
here (see "Mermaid is our input language, not our spec" in `CLAUDE.md`).
Differences that exist only against Mermaid, such as which subgraph wins a
tie, participant creation order, sources only Mermaid rejects and display
choices, have explicit dispositions in
[the #363 decision record](docs/project/divergences.md#mermaid-input-decisions-363).
That investigation is complete; the reader/writer defects below remain runtime
work. BUG-9 is retired: its ER attribute-insertion witness already passes an
owning regression test. The completed CONS-46 candidate covers the
BUG-19/23/30/31/32 source/display work; its final checks and merge are tracked
under REL-1.

- [ ] **BUG-20 — Flowchart ellipse shape `A(-a-)` is unsupported** (`todo`). We read it as a rounded node labelled `-a-`.
- [ ] **BUG-26 — Flowchart source-map scanners still honour `\` escapes and `'` quotes** (`todo`). `flowchart-body.ts` and `source-map-spans.ts` disagree with the parser on those lines, so spans can be wrong.
- [ ] **BUG-35 — Contact-sheet case AJ routes an edge label onto a shared trunk** (`todo`). `ROUTE_LABEL_ON_SHARED_TRUNK` on `D->E` is allow-listed in `heuristic-tracker.test.ts`.
- [ ] **BUG-37 — Architecture router sends an edge through a card** (`todo`). The nightly finder's seed `AM_FC_SEED=1102132276` in `architecture-layout.test.ts` routes `s0_0:T --> T:s0_1` through `s0_2` (three services in one group, each linked left to a service in a second group). Pinned as a fast-check example in that file.
- [ ] **BUG-42 — ELK throws on an edge between a nested subgraph's node and its enclosing subgraph** (`todo`). With `direction TB` overrides, `B --> Outer` or `Outer --> B` (B inside Inner inside Outer) raises `UnsupportedGraphException` and the render fails. Pinned in `subgraph-hierarchy-exhaustive.test.ts`.
- [ ] **BUG-43 — Edges between a subgraph and its own contents break routing rules** (`todo`). Nine such pairs (for example `A --> Outer`, `Inner --> Outer`) render but leave an endpoint off the outline, route through a node, or misanchor on the container; `verify` reports them. Pinned in `subgraph-hierarchy-exhaustive.test.ts`.
- [ ] **BUG-46 — SVG output carries unrounded floats** (`todo`). The default style emits `36.900000000000006` (state) and `4.199999999999999` (timeline, pie), and hand-drawn styles emit `stroke-width="2.0999999999999996"`. Round once where numbers become SVG text, shared by Scene and SVG; goldens that pin these values change with the fix.
- [ ] **BUG-54 — Quote Quadrant text in its grammar context** (`todo`; #363). Clear keyword and semicolon labels draw, but some lack portability warnings and serialize to rejected source. Keep generous reading; finish canonical quoting and warnings at the Quadrant reader/writer.
- [ ] **BUG-56 — Close accepted-source reader gaps** (`todo`; #363). Class style comments and `classDiagram-v2`, Quadrant empty far-axis labels and statement separators, and Architecture declaration text/spacing remain unsupported or fail rendering. The lollipop case is already fixed by #410. Work belongs in the existing family readers; completed grammar-consolidation issues stay closed.
- [ ] **BUG-58 — Enforce portable Quadrant style authoring** (`todo`; #363). Functional colors, variables, fractional radii and unknown properties can produce rejected structured output. Keep clear source extensions with warnings; refuse regeneration without a meaning-preserving portable spelling. The initial strict subset is supported hexadecimal colors and integer radii, as specified in the decision record; do not round, resolve page variables or drop fields.
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

The #363 record also retains two export limits: unsupported Architecture IDs
and icons may draw with warnings but still emit rejected structured source;
an empty Class diagram has no accepted bare-header spelling. Use explicit
source preservation/refusal boundaries, without renaming IDs, replacing icons
or inventing classes. BUG-57's consistent Quadrant reading is a documented
divergence, not another runtime defect.

## Non-goals

- Do not port Vercel-specific package rename, committed `dist/`, `.vercel`, or Vercel branding.
- Do not fold `zhenhuaa/mdv` wholesale into this package; terminal Markdown viewing belongs in a separate tool or companion package.
- Do not port old dagre-specific layout code directly; translate only ideas that still apply to the current ELK/layout-engine architecture.
- Do not treat historical archives or process notes as backlog unless an item is promoted here with an ID.
