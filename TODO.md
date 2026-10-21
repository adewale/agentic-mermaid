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
  and output-specific projection limits. REL-1 still
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
- [ ] **BUILD-1 — Collapsible subgraphs (#7785)** (`todo`). Track Mermaid PR
  <https://github.com/mermaid-js/mermaid/pull/7785> (`@{ view: collapsed }`
  metadata syntax) and stay syntax-compatible. Large, but a real readability
  win for agent-generated architecture diagrams; pairs naturally with typed
  `collapse`/`expand` mutation ops.

## Agent-usage verification backlog

- [ ] **EVAL-3 — Eval the `agentic-mermaid-diagram-workflow` skill for
  helpfulness** (`todo`). The public skill
  (`skills/agentic-mermaid-diagram-workflow/SKILL.md` +
  `references/`) is the site's main agent call-to-action, now linked from the
  footer. Verify it actually improves outcomes: run agent-usage cases with vs.
  without the skill loaded and compare on task success, verify-before-return
  discipline, Code-Mode vs. prose answers, and source-level-vs-structured edit
  choice — reuse the existing `eval/agent-usage/` sandbox, task oracle, and
  trace linter.
  A two-task fresh-agent comparison on 2026-10-21 produced correct diagrams
  in both conditions (2/2 each); skill-guided runs used the hosted typed edit
  and verify path. This small sample supplies no efficacy or cost estimate.
  The API runner now captures usage (including Anthropic cache tokens), actual
  execution timing and paired skill/no-skill results, but model credentials
  were unavailable and the existing Codex CLI could not initialize on its
  read-only state directory. Finish a larger instrumented comparison, fold any
  gaps into the skill, and make the footer decision from that evidence.


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
- [ ] **TEST-8 — Complete identity-aware label correspondence** (`todo`).
  The independent reference census now records raw labels and model, layout,
  SVG, terminal metadata, ASCII, facts and describe surfaces for the docs,
  official fences, upstream bench and authored witnesses; it supports paired
  base/head reports. This is existential text-presence evidence, not a proof
  of label identity, multiplicity or complete equality. Extend its scoped
  projections to Class/ER member signatures, accessibility and Sequence
  note/control text. Preserve explicit unavailable results and documented
  display/configuration differences. Metrics expose aggregate counts rather
  than per-label text. The bench's self-harvested `labelsContain` admission
  hints still need independent replacement; do not treat them as the oracle.
- [ ] **TEST-9 — Finish display-oriented grammar differentials** (`todo`).
  The seeded grammar comparison mutates with fixed lexer-boundary fragments
  (`eval/mermaid-modern-compat/grammar-fragments.ts`: entity codes, directives,
  keyword and digit-led names, `@`, `||`, `:::`, Unicode blanks), reports silent
  reads per family with reduced examples, and a nightly rolling-seed lane
  records them in one issue. Flowchart properties cover additional entity
  codes, literal `\n`, styles and nested membership; Sequence generates boxes,
  properties, activation, metadata, aliases and punctuation. The reference
  worker observes Class, ER and State DBs. Remaining work is broader Markdown
  and `@{}` combinations plus browser-displayed text for families where DB
  text differs from display. Source admission differences alone are not bugs.
  Triage finder reports by real-world use before adding code (see the
  likelihood paragraph in `docs/project/divergences.md`): most mutated
  spellings occur in no real diagram.

- [ ] **TEST-12 — Sweep for Bun's asymmetric-matcher write-back** (`todo`). In
  Bun 1.4.2, `toMatchObject`/`toEqual` with `expect.any`, `arrayContaining` or
  `closeTo` overwrite the checked field of the received object with the matcher,
  so a later read of that field sees the matcher, not the data. Find tests that
  read an object after such an assertion, and report the bug upstream.

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

- [ ] **CONS-45 — Finish terminal-context convergence** (`todo`). Move remaining
  family-local cell writers and context argument lists onto shared grapheme-safe
  canvas/context helpers without projecting pixel Scene geometry. Build on the
  shared terminal compositor delivered by #394 under
  [#386](https://github.com/adewale/agentic-mermaid/issues/386), prepared text
  landed in #395, shared identities/compound routes in #404, and marker and
  State-note/atomic-route fixes in #401/#405. The old pre-merge reconciliation
  is complete. Promote a remaining adapter extraction only with a concrete
  repeated behavior; this is not a request to redo those delivered contracts.


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
geometry remains under CONS-45; Flowchart tokenization is shared already.

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
- [ ] **BUG-35 — Contact-sheet case AJ routes an edge label onto a shared trunk** (`todo`). `ROUTE_LABEL_ON_SHARED_TRUNK` on `D->E` is allow-listed in `heuristic-tracker.test.ts`.
- [ ] **BUG-42 — ELK throws on an edge between a nested subgraph's node and its enclosing subgraph** (`todo`). With `direction TB` overrides, `B --> Outer` or `Outer --> B` (B inside Inner inside Outer) raises `UnsupportedGraphException` and the render fails. Pinned in `subgraph-hierarchy-exhaustive.test.ts`.
- [ ] **BUG-43 — Edges between a subgraph and its own contents break routing rules** (`todo`). Nine such pairs (for example `A --> Outer`, `Inner --> Outer`) render but leave an endpoint off the outline, route through a node, or misanchor on the container; `verify` reports them. Pinned in `subgraph-hierarchy-exhaustive.test.ts`.
- [ ] **BUG-46 — SVG output carries unrounded floats** (`todo`). The default style emits `36.900000000000006` (state) and `4.199999999999999` (timeline, pie), and hand-drawn styles emit `stroke-width="2.0999999999999996"`. Round once where numbers become SVG text, shared by Scene and SVG; goldens that pin these values change with the fix.
- [ ] **BUG-54 — Quote Quadrant text in its grammar context** (`todo`; #363). Clear keyword and semicolon labels draw, but some lack portability warnings and serialize to rejected source. Keep generous reading; finish canonical quoting and warnings at the Quadrant reader/writer.
- [ ] **BUG-56 — Close accepted-source reader gaps** (`todo`; #363). `classDiagram-v2`, Quadrant statement separators and Architecture text icons remain unsupported or fail rendering. Compact Architecture edges, the checked Class style-comment case and empty far-axis Quadrant labels now pass; do not retain them as open witnesses. The lollipop case is already fixed by #410. Work belongs in the existing family readers; completed grammar-consolidation issues stay closed.
- [ ] **BUG-58 — Enforce portable Quadrant style authoring** (`todo`; #363). Functional colors, variables, fractional radii and unknown properties can produce rejected structured output. Keep clear source extensions with warnings; refuse regeneration without a meaning-preserving portable spelling. The initial strict subset is supported hexadecimal colors and integer radii, as specified in the decision record; do not round, resolve page variables or drop fields.


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

## Owned graph backend qualification (owner request, PR #449)

- [x] Retain explicit ELK, checked native selection, typed fallback and immutable execution receipts.
- [x] Native Flowchart/State measured placement and independent nested scopes; flat Requirement and Architecture adapters, Class cards and independent namespaces, plus ER frames and boundary relations.
- [x] Close the retained seed228 crossing gap in the256-case development population (11 versus12 crossings;75 versus74 bends).
- [x] Preserve the valid native straight contact that triggered seed319’s pass-contract error; do not loosen metric allowances.
- [x] Close the retained seed296 crossing gap with bounded small-cut diversity (19 versus22 crossings,90 versus94 raw bends). All320 seeds remain development data, with all five ELK rejections retained.
- [x] Execute the predeclared320–383 holdout on clean980a:64/64 render with both engines and no extra proper crossings; retain preference and paint uncertainty.
- [x] Qualify independent counter-generated populations: initial0–63 exposes seed22 (16 versus15 crossings); bounded three-edge cuts reduce it to14. Fresh64–127 runs on clean53c17357:64 native/63 ELK successes, no added crossing/label/shared-ink metrics. All512 generated sources and six ELK rejections remain enrolled.
- [x] Add bounded cross-scope leaf corridors without flattening frames: nine source/workload promotions including the96-node grouped workload,232/238 native; preserve explicit declines and ELK fallback.
- [x] Extend frame terminals, empty scopes and grouped Architecture; repair nested endpoint obstacles. Frozen `e9db0dbe` renders246/246 source/workload occurrences and640/640 generated cases; preserve all six ELK generated rejections and all216 prior native SVGs unchanged. See [current qualification](docs/design/system/layout-qualification.md).
- [x] Measure specialized label conflicts, all-family shared spans, bends/length/area, and declared edit sequences in both cache regimes; comparison reports expose support gains and adverse tradeoffs. This completes instrumentation, not quality parity.
- [ ] Support remaining compound/cross-boundary geometry without changing authored endpoints or required child order.
- [ ] Complete specialized-family quality dimensions and preserve all declines in comparison populations.
- [ ] Qualify fully consumed cold, cached, edited and cache-churn workflows with healthy A/A controls, memory and emitted browser transfer evidence.
- [ ] Confirm the serial-isolation workaround across further combined CI heads; the first rebased run passes all required lanes, but the prior parallel-shard stall root cause remains unidentified. Retain adverse runs.
