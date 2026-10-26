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
  follow-up to #505, and resolve #449's native coverage/quality/cost limits
  before promoting that backend. The rejected native recorder rewrite and
  blocked renderer-lifetime prototype are not shipped improvements. Production
  SVG-only distribution remains unimplemented. Renderer-lifetime controls still
  need qualification within the payload caps; broader geometry reuse requires
  explicit geometry/proof ownership. Keep the
  [campaign preservation contract](docs/design/system/performance-campaign.md).

- [ ] **REL-1 — Qualify, publish and verify 0.5.0** (`todo`,
  [#378](https://github.com/adewale/agentic-mermaid/issues/378)). The release
  target is 0.5.0; source still declares 0.4.2 and npm served 0.4.1 when checked
  on 25 October. No intermediate 0.4.2 publication is required. Settle scope,
  update version/changelog and the release issue's automation marker, and run
  canonical CI plus package, semantic and performance qualification on the
  actual immutable release candidate. Follow `docs/contributing/releasing.md`,
  publish the verified artifact, then verify npm/MCP Registry metadata and the
  matching deployed site/MCP identity and a live capability.
  #410's Class work, #418's ER/Journey/empty-edit/YAML repairs, #419's text
  preservation and #416's config ownership are merged. #363, #367 and #372
  are closed; they are no longer pending source integrations. Qualify release
  claims with the [remaining export limits](docs/project/divergences.md#mermaid-input-decisions-363)
  and output-specific projection limits. Green source CI alone does not prove
  publication or hosted delivery; #477 and #478 remain delivery concerns.
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
