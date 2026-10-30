# Project Backlog

`TODO.md` is the canonical owner-facing inventory of unfinished work, owner
decisions, blocked observations, and evidence-triggered watch items. Explicitly
status-marked landing/completion evidence lives under `docs/project/archive/`;
current capabilities live in `docs/features.md` and generated registry
surfaces. IDs are stable names, not ordering.

Status legend: `todo` | `blocked` | `owner-decision` | `parked`.

Reconciliation updated on 2026-10-25 against merged code and current issue
dispositions; [completed and retired entries](docs/project/archive/backlog-reconciliation-2026-10-25.md)
retain their evidence. Candidate implementation does not establish merge,
publication or deployment; a closed issue is not completion evidence when its
acceptance conditions still fail. Plans supply design context, never additional
queues. Retired IDs are not reused.
CONS-43 is retired: `src/layout/passes/index.ts` contains only re-exports;
cohesive implementations already live in their owning pass modules. Further
route-contract extraction preserves the existing pipeline manifest and order.

## Release / owner decisions

- [ ] **PERF-1 — Close the remaining measured performance gaps**
  (`todo`, owner requested 2026-10-22). PRs #467 and #468 merged. Their
  [campaign report](docs/project/archive/performance-campaign-2026-10-22.md),
  [recommendation crosswalk](docs/project/archive/performance-campaign-2026-10-22-crosswalk.md)
  and [follow-up report](docs/project/archive/performance-followup-2026-10-23.md)
  retain their measured revisions, rejected trials and mixed timing/memory
  results. Later performance work also landed in #433, #479, #480, #495 and
  #496; those merges do not establish current release qualification or general
  superiority over peers. Finish the current candidate's semantic, peer,
  tail-latency and allocation comparisons, qualify the SVG-number conversion
  follow-up to #505, and resolve #449's native coverage/quality/cost limits for
  **0.6.0** before promoting that backend. The rejected native recorder rewrite and
  blocked renderer-lifetime prototype are not shipped improvements. Production
  SVG-only distribution remains unimplemented. Renderer-lifetime controls still
  need qualification within the payload caps; broader geometry reuse requires
  explicit geometry/proof ownership. Keep the
  [campaign preservation contract](docs/design/system/performance-campaign.md).

- [ ] **REL-1 — Qualify, publish and verify 0.5.4** (`todo`). The release
  target on Main is 0.5.4, including #580's Class/ER rendering fixes and
  #393's directory guidance and deployment automation changes. This retained
  qualification branch keeps source version 0.4.2 and performs no publication.
  Version 0.5.3 was published to npm and the MCP Registry and deployed on
  29 October ([publication](https://github.com/adewale/agentic-mermaid/actions/runs/40940647568),
  [deployment](https://github.com/adewale/agentic-mermaid/actions/runs/40943546603));
  [#378](https://github.com/adewale/agentic-mermaid/issues/378) is closed.
  Its immutable package cannot include these later fixes. The
  0.5.0 and 0.5.2 source tags are retained after their blocked publications.
  The macOS release gate uses a standard Intel macOS 26 host after GitHub's
  arm64 pool could not acquire the 0.5.2 job. Retain the
  documented source-edit/export limits and run
  canonical CI, including its independent semantic and packed-consumer checks,
  on the actual immutable release candidate. The publication workflow also
  requires platform smoke tests and the verified package artifact. Following
  #492, benchmarks run separately in explicit local sessions; they do not block
  or authorize publication. Keep performance claims within their measured scope
  under PERF-1. Follow `docs/contributing/releasing.md`,
  publish the verified artifact, then verify npm/MCP Registry metadata and the
  matching deployed site/MCP identity and a live capability. Automatic
  release-issue creation is disabled; an unpublished version leaves a warning
  and Actions summary while production retains the previous published build.
  #410's Class work, #418's ER/Journey/empty-edit/YAML repairs, #419's text
  preservation and #416's config ownership are merged. #363, #367 and #372
  are closed; they are no longer pending source integrations. Qualify release
  claims with the [remaining export limits](docs/project/divergences.md#mermaid-input-decisions-363)
  and output-specific projection limits. Green source CI alone does not prove
  publication or hosted delivery; #477 and #478 remain delivery concerns.
  The owner's 27 October decision defers #449's Native-layout qualification
  to 0.6.0; it is not a 0.5 publication condition. ELK remains the default.
  The owner's 29 October decision also moves AGENT-1, AGENT-2 and AGENT-3
  to 0.6.0. Those improvements remain open and are not 0.5.4 release claims.
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

- [ ] **AGENT-1 — Consolidate the agent starting guide** (`todo`, owner
  requested 2026-10-27; deferred to 0.6.0 by the owner on 2026-10-29).
  Make `/start.md` a short task/channel
  router into one maintained operating guide and version-matched references.
  Generate overlapping instructions for the CLI, installed drop-in and website
  from that guide. Preserve useful channel entry points while removing repeated
  rules and competing mini-tutorials. Validate with fresh-agent tasks that choose
  a channel once and reach the relevant operation details without reconciling
  multiple guides.
- [ ] **AGENT-2 — Reduce library import decisions** (`todo`, owner requested
  2026-10-27; deferred to 0.6.0 by the owner on 2026-10-29). Recommend one
  portable agent entry for parsing,
  typed editing, verification and rendering, including resolved-scene parity;
  make native PNG an explicit runtime-specific addition. Preserve existing
  import paths and aliases. Reuse the current entries rather than adding another
  SDK layer, and verify shipped declarations/runtime behavior in Node, Bun,
  browsers and Workers before changing the recommendation.
- [ ] **AGENT-3 — Make resolved scenes discoverable and failures actionable**
  (`todo`, owner requested 2026-10-27; deferred to 0.6.0 by the owner on
  2026-10-29). Expose resolved-scene
  support through existing agent discovery and the Code Mode SDK, with explicit
  result-size/runtime limits. Give unsupported-artwork failures stable typed
  fields such as `code`, `partId` and `feature`, preserving readable messages
  and the prior artifact on failure. Test supported artwork and named unsupported
  features such as gradients through installed library and agent boundaries.
  Document released availability so agents can select a supported representation
  or report the precise limitation without parsing English error messages.

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

- [ ] **GOV-2 — Require canonical CI on `main`** (`blocked`,
  [#331](https://github.com/adewale/agentic-mermaid/issues/331)). Configure the
  repository rule requiring `CI complete` on main. The owner has approved the
  ruleset, but the integration cannot write repository rules (HTTP 403). Main
  was still unprotected with no rulesets on 25 October. Apply the prepared
  policy through a credential with repository-rules permission; no further
  approval or additional CI implementation is needed.

## Source-preservation defects

- [ ] **SRC-1 — Segment-preserving Class and Timeline bodies** (`todo`). Preserve typed mutation around unmodeled statements without violating byte-for-byte opaque fallback. Add parser/serializer closure and adversarial reorder tests before promotion.

## Documentation / issue triage

TRIAGE-2 and CONS-46 are retired after merged #418/#419. The wholesale ER
serializer WIP and Flowchart rejection proposal are superseded by the existing
declaration planner and read-and-warn codecs. Publication remains under REL-1;
terminal convergence remains under CONS-45.

## Export limits

The original BUG-20 ellipse and BUG-54/58 Quadrant witnesses are implemented
and removed from the active backlog. The [completion record](docs/project/archive/backlog-reconciliation-2026-10-25.md)
names the owning tests and distinguishes portable structured output from
warning-bearing source preservation. Their historical decisions remain in
[the #363 record](docs/project/divergences.md#mermaid-input-decisions-363).

Unsupported Architecture IDs/icons remain subject to the explicit
source-preservation and typed-authoring refusal boundary. An empty Class
diagram has no accepted bare-header spelling; do not invent classes or replace
identities to conceal these limits. BUG-57 is a documented reading divergence.
A new defect needs a current reproduction at its owning boundary.

## Non-goals

- Do not port Vercel-specific package rename, committed `dist/`, `.vercel`, or Vercel branding.
- Do not fold `zhenhuaa/mdv` wholesale into this package; terminal Markdown viewing belongs in a separate tool or companion package.
- Do not port old dagre-specific layout code directly; translate only ideas that still apply to the current ELK/layout-engine architecture.
- Do not treat historical archives or process notes as backlog unless an item is promoted here with an ID.

## Owned graph backend qualification (owner request, PR #449)

**Release target: 0.6.0**, per the owner's 27 October decision. This section
remains the sole backlog owner. The six requested goals are described in the
assistant-authored [Native layout work plan](docs/design/system/layout-0.6-qualification.md):
repair coverage; establish broader held-out correctness; match or beat ELK
aesthetics; match ELK performance; soundly verify the seven unverified diagrams;
and compare correctness with public Mermaid and Pele artifacts. The owner did
not approve that document as an acceptance contract. Its extra statistical and
human-study methods are proposals; a human panel or administrator is not a
completion gate. Report actual progress and gaps for each goal. Checked
historical work below is implementation/evaluation evidence at its
named revision. Keep the feature
opt-in while qualifying it; this deferral does not change package versions,
publish a release or authorize a default switch.

Correctness implementation is the focus through Friday 30 October; performance
experiments are paused during this work.

- [x] Add independent Class development models over 8–24 cards and full public-SVG occurrence checks for six 8-card engine/wrapper arms. Repair the two new Native TB refusals by retrying a blocked content domain inside a known canonical host outline; retain rounded-corner, unknown-shape and cumulative-budget controls. These are development inputs, not held-out qualification or broad parity.
- [x] Extend independent ER development coverage with 12-entity BT and 18-entity RL cases combining aliased display collisions, distinct Unicode identities, nested frames, long attributes and parallel/reciprocal/self relationships. Four strict-backend OFF SVG calls on `3344f753` preserve authored models and actual XML occurrences, with passing certificates and zero Native ELK calls. Independent physical review binds all 144 endpoint roles to their own carriers and intended painted borders, checks 420 glyph pieces, 72 relationship pills and 732 prepared-text bands; four proper crossings remain explicit. Two ELK endpoints meet the actual border band rather than the nominal face. This is finite development evidence, not held-out, cache/repeat/terminal, font-outline, aesthetic/performance or original-seven-U qualification.
- [x] Investigate independently authored 12-state BT and 18-state RL development cases with nesting, concurrency, scoped initial/final roles, identity collisions, notes and parallel/reciprocal/self transitions. At `e8c84a44`, Native passes both; ELK passes one and honestly leaves three partly caption-masked arrowheads unverified. Repair unresolved marker-caption placement after the existing search with bounded single/joint label-only rescue and complete sufficient paint supports, retaining the same remaining work ledger and independent final certification. Four actual OFF SVGs at `9f8bd69e` now pass; three SVGs and full receipts remain exact, while ELK18 changes only four caption centers. Independent meaning and physical reviews retain all 116 carriers, 232 attachments, 40 contextual glyphs and 116 arrowheads. All 514 affected owners and both typechecks pass. These are development cases, not broad parity or promotion of the seven original U diagrams. Mermaid 12.2 rejects the original12 inline-note colon; preserve that observation, the portability warning and meaning-preserving block-note serialization.
- [ ] Test full painted-caption reservations as a separate ELK input experiment. Actual State requests reserve text+8/+6 while width-one halos paint text+24/+24; two unsafe loop seats already exist in stock output. A third unsafe seat is introduced later, so changing ELK inputs cannot replace final clearance. Preserve all changed ranks/routes/ports/frames, loop allocation warnings and existing limits; the two retained loops still lack constructed allocation authority despite corrected caption paint.
- [x] Bind the first paint lifetime foundation to the emitted occurrence: one inert captured leaf feeds one writer and inspection, with shared document/group rosters and immutable paint operands. Seven mutation/ownership/getter/viewport/roster counterexamples close; the 50,000-point immutable boundary remains certified under the unchanged 400,000-operation cap. Acquisition at `49ad0c99` preserves all 920 SVGs and terminal outputs in the 230-input development corpus; Native stays223P/7U and ELK218P/12U per cache policy. Only SVG receipt work counts and written viewport values change. This is not complete served-geometry or stylesheet authority.
- [ ] Close the remaining paint-context and raw-to-served geometry gaps before promoting the seven original unverified diagrams. Private safety experiment `97de3245` makes demonstrated rounding unsafe passes and zero-dimension false failures honestly unverified, but is not adopted: six ordinary passes become unverified and valid large connectors exhaust the unchanged proof budget. Test sole-writer, occurrence-owned actual token receipts to avoid reparsing; require complete final emitted-token mapping, exact outward bounds before broadphase, actual stylesheet/palette/viewport applicability and independent full-ink witnesses before granting new passes.
- [x] Preserve authored freestanding Class note order when the selected producer returns no graph extent. Seat notes inside the shared padding before final repair; keep the imported vertical-order assertion and cover default, strict ELK and strict Native at the existing namespace owner. The discovered notes-only integration regression remains recorded separately from the broader correctness qualification.
- [x] Diagnose and repair the retained 24-class RL ELK-lane refusal at the `C2 -> C2` self-contact on `49ad0c99`. The solver's tiny coordinate drift became a written diagonal; construct a normal join only for known sharp, unmarked, unlabelled four-point self-loops, then prove fresh final support under the unchanged work ledger. Author commit `3d608c1d`, integrated as `52924301`: the actual retry renders with one ELK call, preserves all authored meaning, and changes only one bend coordinate. Independent checks cover all 25 carriers, 24 markers, 50 endpoint contacts, headers, notes, prepared-text halos and title. Preserve the old failed cell; this finite development case does not establish general correctness, font-outline visibility or aesthetic parity.
- [x] Compute generated CSS scope identities after the one numeric-canonicalization pass. The styled Journey Native/Scene viewport-repair control fails before `4371bf45` and passes afterward; retain exact SVG equality, CSS isolation and the final security gate. Earlier output-preservation acquisitions keep their recorded revision.
- [x] Qualify standalone browser/source parity through the same public render-and-verify operation and production configuration. Keep complete SVG and receipt equality, including work, viewport, issues and status. In the actual CI working directory, the old oracle fails and the corrected oracle passes with 457 assertions; root-directory preload controls pass both versions and are not counted as red-to-green evidence. This test-only fix does not close the retained editor delivery-size failures.
- [ ] Integrate and acquire the separately developed Trident painted-attachment observer. Its local controls repair zero-area fill and unresolved-carrier omissions; local observer correctness does not establish Mermaid/Pele parity, whole-route continuity or whole-head visibility.

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
- [x] Compare the owned solver with community lineages and published artifacts, including Zombie simple; retain complete same-input SVG/A/A results and the corrected field-label gate. See [community comparison](docs/design/system/layout-community-comparison.md). This is evaluation progress, not a claim to have beaten all peers.
- [x] Explore academic/community/industrial ideas, subtraction and native-family portfolios with five parallel investigations; run 20 isolated CPU/allocation profile workers with four repeats. See [exploration and experiment gates](docs/design/system/layout-exploration.md) and [follow-up experiments](docs/design/system/layout-experiment-results.md).
- [x] Preserve ER label reservations through adapter changes and include foreign shafts in final placement; close the retained 16-conflict ER40 regression. Runtime23 removes all 16 conflicts with unchanged source crossing/bend/length/area/paint outcomes; drawing and projection share actual-style final labels. ELK output stays unchanged.
- [x] Give Architecture an unfinished placement-only producer contract, preserving every relationship and merged actual-outline contacts. Runtime24 improves source case3 area by 60.5% and length by 64.1%; see [guidance results](docs/design/system/layout-guidance-results.md).
- [x] Diagnose Architecture0/5 final port-constrained crossing witnesses and compare legal sibling slots using final family routes. Runtime26's bounded single-crossing cleanup removes their crossing and shortens routes922→596 with unchanged bends/area; the two occurrences share one source. Runtime25's extra Architecture4 improvement2→1 costs85.5% more uncached allocation than24 and is surrendered:26 restores its2-crossing ELK tie. Independent authored-side, obstacle, shared-ink and paint checks remain; see [follow-up results](docs/design/system/layout-followup-results.md).
- [x] Specialize exact two-route crossing queries for Node/IIFE repair while retaining the general reference metric and compact lazy-browser path. Final cyclic18 off-cache allocation falls 13.1% at the paired median; noisy controls, worse pass-wide allocation and remaining ELK deficits are recorded in the [experiment results](docs/design/system/layout-experiment-results.md).
- [x] Measure interval/spatial lane-blocker indexing separately. Reject the tested index: cyclic18 allocation rises 9.4% at paired median. Immediate private candidate-proof reuse also fails to earn inclusion; preserve independent final proof. The earlier own-label capacity guard remains rejected (160/54,327 probes, none on cyclic18).
- [x] Instrument rank span, private-vertex expansion and repeated candidate normalization before choosing a sparse rewrite. Final 40-input diagnostic has zero outcome/counter mismatches; cyclic tails perform 17–27 normalizations and build 1,388–3,049 cumulative private vertices per call.
- [x] Test lazy shifted-order construction separately before retaining another cyclic optimization. Reject it:0/6 required tails reach the predeclared3% allocation saving, whole27 allocation is0.9980× baseline and State allocation is1.0603×; cached qualification is incomplete and timing controls drift. The interrupted ray-array experiment remains unqualified. Preserve both in [follow-up results](docs/design/system/layout-followup-results.md).
- [x] Reprofile the accepted runtime26 artifact and attribute repeated normalization with exact controls. All12CPU/heap workers complete. The40-input untimed diagnostic preserves every outcome and passes1207checks;160/174 exact-rank successes overwrite257greedy sweeps, while14declines retain fallback. Record245best-order snapshots without treating object/visit counts or overlapping sampled profile shares as measured savings.
- [x] Test rank-first, detached band-snapshot reuse and ray views separately against accepted26. All three miss their primary target on all6required uncached tails, with18/16/18successful workers out of36 and no cached candidate results. Rank-first raises cyclic19allocation14.8%; band/ray whole27allocation is1.000648×/1.002351×. Keep these variants outside production, preserve missing controls/output comparisons and all failed deadlines; see [current cyclic experiments](docs/design/system/layout-followup-results.md#further-cyclic-attribution-on-frozen-runtime-26).
- [x] Measure a separately predeclared combined ray-view/query-local-record prototype directly against accepted26 and current-artifactELK. All30memory workers and108exact fullSVG/receipt/certificate/layout/edit comparisons pass, but0/6uncached tails reach5%less allocation and whole27is0.998425×26, missing the0.98target. Reject the prototype; standalone/Architecture payload reserve would fall to306/108bytes. Keep accepted26 unchanged and preserve complete raw controls, failures, exact source patches and profile-premise correction in the [follow-up evidence](docs/design/system/layout-followup-results.md#combined-query-local-crossing-records-complete-negative-experiment).
- [x] Test subtraction from Architecture refinement before retaining its cost. First-return preserves quality but misses its declared15% allocation target (14.7966% saving), so reject it. Complete single-crossing cleanup saves44.3% on source4 and4.5% on the whole13-input uncached pass versus25. Final direct26/24 whole13 allocation is1.001647×uncached/1.000278×cached, with healthy allocation controls: effectively flat, retaining0/5 repairs while surrendering4's costly partial improvement. The repaired0/5 occurrences themselves cost2.3%/4.7% more uncached allocation; drifting time controls establish no speedup.
- [x] Freeze runtime26 artifacts and declare untouched Flowchart512–575 and Architecture0–63 cohorts before inspection, then qualify all enrolled outputs. Retain2418 known/new Flowchart observations with only the declared source4 rollback from25, seven unchanged ELK failures and234 unchanged original edits. The separately declared64 Architecture bases/edit/undo sequences produce1536 successful observations across24/25/26/ELK and both cache policies, with512 exact SVG/layout undos and no measured semantic discrepancies. Preserve every case and full proof evidence in [runtime26 quality](docs/design/system/layout-runtime26-quality.json.gz); this completes evaluation, not ELK parity.
- [ ] Close the prospective Architecture quality and threshold-coverage gaps without hiding adverse data. Fresh64 native bases have21 crossing,6 bend,32 length,13 area and4 opposing-overlap losses versus ELK; aligned edit motion is worse on48/128 transitions. The one observed cleanup removes a crossing but adds84 route-length units. Only1 base/3 edits meet inferred single-cross guard admission, no direct1↔2 edit occurs, and25/26 outputs tie throughout this cohort. Preserve these64 as evaluated data; require a separately declared future cohort for any new holdout claim. See [final quality results](docs/design/system/layout-followup-results.md#prospective-architecture-quality-and-edit-stability).
- [ ] Compare candidate selection under explicit bend/area budgets and retain the crossing/bend/area frontier rather than claim all-metric domination.
- [ ] Reduce repeated cyclic candidate/normalization cost using the current artifact's attribution and exact operation counters. Rank-first, band reuse, lazy orders, lane indexing and immediate proof reuse have already failed their declared experiments; do not relist them as untouched recommendations. Preserve relationships, fallback, search bounds/budgets and independent final proofs, and measure a new owning mechanism directly before adoption.
- [ ] Satisfy the [latest landing guidance](https://github.com/adewale/agentic-mermaid/pull/449#issuecomment-6358150200): resolve release/differential/churn failures or obtain owner review of a concrete [narrower shipping contract](docs/design/system/layout-shipping-options.md). Prefer #467 then #433 before this branch; current main87c9 is already an ancestor, so this is integration order rather than a missing dependency. No narrower contract is implemented/approved. After actual rebase, retain thin startup, backend-aware cache keys, fixed quotas/public isolation, native drawing/security precedence and State80/PNG controls; qualify the actual combined package without pooling historical percentages.
- [ ] Qualify shared drawing/request/SVG subtraction and cache-specific factorial/churn arms with observed hits/evictions and immutable proof/input ownership.
- [ ] Measure declared reduced-family policies and mixed-session request unions; retain explicit native admission/fallback counts and avoid source-name dispatch rules.
- [ ] Improve targeted paint predicates, intent-aware edit/port/symmetry measurement and family-task readability evidence; retain unknown proof status and configured incremental ELK controls.
- [ ] Recover deliberate browser/standalone payload reserve under existing caps; compare capability entrypoints and precompiled SVG workflows. Runtime26 keeps optional refinement out of the default ELK path and avoids a rubric dependency in its producer; all caps pass, but the canonical root build's Architecture reserve is356 Brotli bytes and standalone reserve457 raw bytes. Maintenance headroom remains inadequate. Corrected runtime24 prose subtraction and the rejected YAML-import experiment remain recorded separately.
- [ ] Support remaining compound/cross-boundary geometry without changing authored endpoints or required child order.
- [ ] Complete specialized-family quality dimensions and preserve all declines in comparison populations.
- [ ] Qualify fully consumed cold, cached, edited and cache-churn workflows with healthy A/A controls, memory and emitted browser transfer evidence. Final26 dedicated release/differential fail uncached qualification: deadlines leave all candidate memory missing, and differential cyclic15 exceeds1.5×ELK. Normal reports and all Architecture supplement reports pass. Churn108/108memoryworkers pass, but both256source diagnoses time out and leave unlaunched rows. Required sourceCI is green; earlier3258 canary fallback fails cyclic15 at1.511118×ELK, and later f2af reporting-head canary fails all3uncached comparisons with strict/fallback1.515862×/1.512741×ELK and missing memory. Separate local whole27 memory completes30/30workers with lower RSS than ELK, effectively flat allocation against24 and six cyclic allocation losses. Preserve all runtime24/25/26 failures and controls; see [final follow-up results](docs/design/system/layout-followup-results.md) and [historical guidance](docs/design/system/layout-guidance-results.md).
- [x] Restore complete three-browser CI provisioning without reducing engines, versions, signatures, tests or timeouts. Replace the observed stalled Azure archive/mirror-file indirection with official HTTPS Ubuntu archives; separate OS and browser installation logs. Actual26 sourceCI passes95browser tests including Firefox/WebKit; generated-layout advisory and failed performance qualifications remain explicit.
- [ ] Confirm the serial-isolation workaround across further combined CI heads; the first rebased run passes all required lanes, but the prior parallel-shard stall root cause remains unidentified. Retain adverse runs.
