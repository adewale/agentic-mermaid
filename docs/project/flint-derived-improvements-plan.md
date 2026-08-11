# Flint-derived improvements: specification and test plan

> **Status: specification, not implemented.** Derived from
> [`research/flint-chart-deep-dive.md`](../../research/flint-chart-deep-dive.md)
> (2026-08-02, aesthetics addendum 2026-08-03). **Revised 2026-08-03 after a
> simplification review**: the plan is now a small core built immediately, a
> tail gated on named evidence signals, and one parked decision — matching
> this repo's own demand-before-build doctrine (see
> `mcp-abuse-controls-plan.md`, `computational-aesthetics-prototype-plan.md`).
> Cuts from the first revision are listed in "Cut outright" below. This
> document supplies contracts, file-level design, testing, and verification
> detail; it is not a second status-bearing backlog — `TODO.md` is
> authoritative for active work, and nothing here is committed work until it
> appears there.
>
> **Scope boundary.** This plan deliberately excludes the research note's other
> recommendations: no new specification language (counter-lesson #1), no
> transplant of Flint's spring/gas formulas into graph layout (counter-lesson
> #2), and no semantic-type annotation layer for data-ish families (research
> lesson 6 — worthwhile but a separate design with grammar implications).
> Pressure-based density negotiation (WS3 "stage 3") is named as a follow-on
> and intentionally not specified here.

The plan's shape:

| Bucket | Item | Scope | Size |
|---|---|---|---|
| **Core — build now** | WS1 | `eval/edit-cost`, bytes-per-edit measurement + published number | S |
| **Core — build now** | WS3 stage 1 | `BELOW_READABLE_SIZE` warning (`fitTo` / `scale` / raster budget) + `minLabelPx` | S |
| **Core — build now** | WS2-lite | Two MCP resources + one prompt, both eras, drift-guarded, demand-signal instrumented | S–M |
| **Gated on evidence** | WS6 core | Stressor registry + designed contact sheet (gate: next layout-touching PR needing visual evidence) | M |
| **Gated on evidence** | WS5 | Perceptual-constants ledger (gate: next PR touching a rostered constant, or standalone when convenient) | S |
| **Gated on evidence** | WS2-full | Remaining resources/prompts + agent-usage A/B (gate: WS2-lite demand signal, then pilot) | M |
| **Gated on evidence** | WS6 site page | Public torture-test gallery (gate: the sheet proves useful in ≥1 real PR review) | S–M |
| **Gated on evidence** | WS4 | MCP App editor view (gate: sustained third-party pulls on the hosted surface) | M–L |
| **Parked decision** | Outcome eval | Paired typed-workflow vs regeneration evaluation — see "Parked" section | L |

Core items are independent and can land in any order, each as its own PR.
No gated item enters `TODO.md` until its gate fires; the gates are named
signals, not vibes, and each is defined in its workstream section.

**Cut outright** (first-revision scope removed on review):
`agentic-mermaid://ops/{family}` resource templates and
`resources/templates/list` (duplicate the existing `describe_sdk` tool);
the `agentic-mermaid://styles` resource and `author_mermaid_diagram` prompt
(deferred into WS2-full); WS1's secondary token estimate (bytes only);
WS3's `fitStrategy: 'error'` mode (an agent can treat the warning as fatal;
build only if a consumer asks); WS6's three-surface convergence machinery
(rebuilt as two-surface now, extended only when the site page exists).

## Shared invariants (apply to every workstream)

1. **Determinism.** Every new output is a pure function of its inputs. No
   `Math.random`, `Date.now`, `performance.now` in shipped code paths; the
   existing grep-lint test's scope extends to any new `src/` module these
   workstreams add. Eval scripts (WS1) must produce byte-identical output
   across runs so `--check` modes are meaningful.
2. **One mutation engine.** Nothing here adds a second edit path. WS4's UI
   edits round-trip through the same `mutateChecked` core as Code Mode, the
   hosted `mutate` tool, and the CLI.
3. **No second source of truth.** Every MCP resource and prompt (WS2) is a
   build-time or runtime *projection* of an existing registry or file
   (`FamilyDescriptor`, `describeOps`, the skill file, the palette catalog).
   A drift-guard test pins each projection to its source.
4. **Verify-before-emit.** WS4's hand-back to the model always carries a
   server-side verify receipt. No surface introduced here emits unverified
   source as a success result.
5. **Hosted security posture unchanged.** Strict SVG policy, body/batch
   limits, WAF posture, and the no-outbound isolate model stay as documented
   in `docs/project/mcp-abuse-controls-plan.md`. WS2/WS4 add only cacheable
   static reads and one capability-gated tool.
6. **PR discipline.** One workstream stage per PR; every PR runs the full
   `bun run test` + `bun run typecheck`, passes
   `bash scripts/ci/check-pr-readiness.sh main`, applies the good-pr skill,
   and states its red→green evidence explicitly (which tests fail with the
   change reverted). PRs are opened only when explicitly requested.

---

## WS1 — `eval/edit-cost`: the bytes-per-edit measurement

### Motivation

Flint's most-quoted result is a constant ("specs 85% shorter than native
code"). Ours is stronger if measured: a typed op is O(edit) while regeneration
is O(diagram), so the savings *scale with diagram size*. The measurement is
deterministic (no LLM, no network) and therefore cheap to keep true in CI.

### Design

New directory `eval/edit-cost/`:

- `tasks.ts` — canonical edit tasks per family. A task is
  `{ id, family, describe, ops(diagram): MutationOp[] | null }`: given a
  parsed corpus entry, either produce an applicable op list (e.g. flowchart:
  `add_node` + `add_edge` to an existing node; sequence: `add_message`
  between existing participants; class: add a relation; gantt: retitle a
  section) or return `null` with a machine-readable skip reason. Tasks are
  built against `describeOps`/`op-schema.ts` field specs so they cannot drift
  from the real surface.
- `run.ts` — for every entry in
  `eval/mermaid-docs-corpus/corpus.json` (271 examples, 12 families, pinned
  upstream revision) × every applicable task:
  1. parse → narrow → apply ops via the checked core → verify must pass
     (entries in `divergences.json` follow the ledger's expectations);
  2. record `opBytes = utf8(JSON.stringify(ops))`,
     `regenBytes = utf8(serializeMermaid(mutated))` — the payload an agent
     would have to emit to make the same change without the editing surface;
  3. record size covariates: source bytes, node/edge (or family-equivalent)
     counts.
- `RESULTS.md` — regenerated by `run.ts`; contains methodology, the headline
  (median and p90 of `opBytes / regenBytes` overall and per family), a
  scaling table bucketed by diagram size, and the **skip ledger** (every
  `(entry, task)` skipped, with reason and counts — no silent coverage
  gaps, mirroring `eval/mcp-protocol`'s "cannot quietly collapse" rule).
- Units: bytes, full stop — tokenizer-independent and deterministic. No
  token estimate, no tokenizer dependency; the ratio and its scaling curve
  are the story, and bytes tell it.

Wiring: `package.json` scripts `eval:edit-cost` (regenerate) and
`eval:edit-cost:check` (assert `RESULTS.md` is current), following the
`benchmark:palette` / `benchmark:palette:check` pattern.

Consumers: one headline sentence + link in `README.md` ("a typed edit is
~N× smaller than regenerating the source, and the gap grows with diagram
size") and a short section in `docs/comparison.md`. `CHANGELOG.md` entry.

### Fairness statement (required in RESULTS.md)

What is counted: the payload the agent must *emit*. What is not counted:
read-back/context cost (favors neither side symmetrically), retry loops from
regeneration syntax errors (favors us; referenced qualitatively via
`eval/agent-usage/failure-corpus` rather than estimated), and MCP envelope
overhead (identical for both paths). Publishing the methodology preempts the
obvious objections.

### Testing plan

- **Determinism test**: run the measurement twice in-process; assert
  byte-identical `RESULTS.md` output. Grep-lint scope extension covers
  `eval/edit-cost/` (no clock/random).
- **Coverage floor test**: every family present in the corpus has ≥1
  *applied* (not skipped) task, or the test names the family and fails —
  the skip ledger cannot quietly absorb a whole family.
- **Oracle test**: for each task template, one fixture asserting the op list
  applies cleanly and the mutated diagram parses back with the intended
  structural change (parse-back oracle, not substring match — the
  `eval/agent-usage/harness.ts` convention).
- **Check-mode test**: `eval:edit-cost:check` fails when `tasks.ts` or the
  corpus changes without regenerating `RESULTS.md`.
- **Red→green statement**: with `run.ts`'s measurement inverted or a task
  misapplied, the oracle and determinism tests fail; state which in the PR.

### Verification / acceptance

- `RESULTS.md` committed with headline, per-family table, scaling curve,
  skip ledger, fairness statement.
- CI runs `eval:edit-cost:check`.
- README + comparison.md cite the number with a link to the methodology.
- Acceptance gate: measurement covers ≥ 10 of the corpus's 12 families with
  applied tasks; skips individually justified.

### Risks

- *Metric gaming accusation* — mitigated by pinned corpus provenance and the
  fairness statement.
- *Task bias toward small ops* — mitigated by including at least one
  multi-op task per family (e.g. add node + connect + restyle) so the
  numerator isn't only trivial edits.

---

## WS2 — MCP resources and prompts

### Motivation

The safe-path doctrine (`skills/agentic-mermaid-diagram-workflow/SKILL.md`,
147 lines; `Instructions_for_agents.md`) reaches only agents with a repo
checkout. An MCP-only client gets tools with no doctrine — precisely the
conditions under which `lintAgentTrace` observes `REGENERATE` and
`SERIALIZE_WITHOUT_VERIFY`. Flint ships its skill *through* the server
(`flint://agent-skill`) and makes loading it step 1 of the documented
workflow. We have richer content and no delivery channel.

### Contract

**WS2-lite (core) — resources** (all projections; none hand-authored):

| URI | mimeType | Source of truth |
|---|---|---|
| `agentic-mermaid://skill/diagram-workflow` | `text/markdown` | the SKILL.md file, embedded at build time |
| `agentic-mermaid://capabilities` | `application/json` | the same projection as `am capabilities --json` (FamilyDescriptor registry) |

Per-family op discovery deliberately does **not** get a resource: the
`describe_sdk` tool already serves that registry on both servers, and a
second delivery path for the same data is exactly what
`mcp-code-mode-rationale.md` argues against. A styles resource is deferred
to WS2-full — the catalog is already runtime-discoverable through the
library and CLI.

**WS2-lite (core) — one prompt:**

- `edit_mermaid_diagram` — args `{ source: string }`; returns the
  parse → narrow → mutate → verify → serialize recipe with the anti-pattern
  warnings, parameterized with the caller's source. (This is the doctrine
  the linter's anti-pattern codes police; delivering it is the point of the
  whole workstream.)

**WS2-full (gated)** adds `agentic-mermaid://styles`, the
`author_mermaid_diagram` prompt, and anything else the demand signal
justifies. Gate: see Verification below.

**Methods**: `resources/list`, `resources/read`, `prompts/list`,
`prompts/get`. The surface is static per package version:
capabilities advertise `listChanged: false`; `resources/subscribe` is not
implemented and its absence is declared, never silently ignored.

**Both protocol eras** (`src/mcp/protocol-versions.ts`): legacy clients see
the new capabilities in the `initialize` result; modern (2026-07-28) clients
see them in `server/discover` and may call the methods statelessly with
per-request `_meta`. Error semantics for unknown URIs / prompt names / bad
arguments follow each revision's rules as exercised by the official
conformance scenarios — the conformance suite, not this document, is the
authority on exact codes per era.

### Design

- New `src/mcp/resource-surface.ts` + `src/mcp/prompt-surface.ts` building
  the entries above from live registries. The skill markdown is embedded as
  a **generated string module** (the `sdk-decl.ts` precedent) because the
  hosted Worker has no filesystem; a repo test pins the embedded string to
  the file on disk.
- `src/mcp/tool-surface.ts`: extend `SERVER_CAPABILITIES` (both
  advertisement sites) with `resources` and `prompts`; add dispatch entries.
- `src/mcp/admission.ts`: admit the new methods in both eras; on HTTP, add
  them to the `mcp-method` header-mirror allowlist.
- Hosted (`website/src/mcp-handler.ts`): same handlers as plain Worker
  responses — no isolate. Responses are cacheable keyed by package version
  (the content is version-static); body/batch/WAF limits unchanged.
- `server.json` and `docs/MCP-DIRECTORY-LISTINGS.md`: refresh so directory
  listings describe the resource/prompt surface; `docs/mcp-code-mode-rationale.md`
  gains a short section explaining why resources/prompts exist alongside the
  deliberately narrow tool surface (discovery, not authoring).

### Testing plan

- **Unit (per era)**: each method handled under legacy handshake and under
  modern per-request `_meta`; malformed modern requests rejected per
  `modernRequestMetaProblems`; unknown resource URI and unknown prompt name
  produce the revision-correct errors.
- **Drift guards**: `resources/read` of `capabilities` deep-equals the live
  registry projection; the embedded skill string equals
  `skills/agentic-mermaid-diagram-workflow/SKILL.md` byte-for-byte; the
  prompt's recipe is pinned to the embedded skill content (regenerating the
  skill must fail the guard until the prompt surface is rebuilt).
- **Protocol matrix** (`eval/mcp-protocol/cases.json`, currently 13 cases):
  add data-driven cases — modern `resources/read` missing `_meta` (400,
  -32602), unknown URI (error case), `prompts/get` with missing required arg,
  plus **positive controls in both eras** (the README's both-sides rule: the
  suite must contain success and failure cases so it cannot collapse into
  reject-everything).
- **Conformance** (`eval:mcp-conformance`): run the official scenarios
  covering resources/prompts; update `expected-failures.yml` only with
  justified, commented entries.
- **Local/hosted differential**: extend the existing differential suite so
  `resources/*` and `prompts/*` payloads are byte-identical local vs hosted
  (modulo transport envelope), the same way tool semantics are pinned today.
- **Red→green statement**: reverting the dispatch registration fails the
  era-matrix unit tests and the new protocol cases; reverting the embedded
  skill regeneration fails the drift guard. State both in the PR.

### Verification / acceptance — staged by evidence

Heavy verification is not bought before a cheap signal justifies it:

- **Stage 0 (ships with WS2-lite)**: instrumentation. Hosted request logs
  count `resources/read` and `prompts/get` (the observability posture from
  the abuse-controls plan — counts, not content). WS2-lite acceptance:
  era-matrix units, protocol cases, conformance, drift guards, local/hosted
  differential parity all green, and the counters live.
- **Stage 1 — demand gate for everything downstream**: sustained
  third-party fetches (default: ≥25 distinct client sessions reading a
  resource in a 30-day window; threshold owner-adjustable when the counter
  ships). No fetches → the channel is dead; WS2-full and WS4 stay out of
  `TODO.md`, and that is a finding, not a failure.
- **Stage 2 — pilot** (gate fired): ~5 `eval:agent-live` sessions on one
  small model, MCP-only client, doctrine served vs not, scored by
  `lintAgentTrace` anti-pattern counts. Cheap answer to "does served
  doctrine change behavior at all?"
- **Stage 3 — full A/B** (pilot shows an effect): ≥20 sessions per
  condition at two model tiers (one frontier, one small — Flint's
  capability-gradient finding predicts the larger effect on the small
  model). Results land in `eval/agent-usage/` **whatever they show**; a
  null result is reportable and caps further prompt-surface investment.

### Risks

- *Era-matrix complexity* — mitigated by data-driven cases and the existing
  branded-era admission machinery; no new negotiation logic is invented.
- *Hosted cache staleness across releases* — cache key includes package
  version; a deploy-time test fetches `resources/read` and asserts the
  version stamp.
- *Prompt bloat* — the prompt embeds the skill recipe, never whole
  documents; a size ceiling test (≤ 16 KiB per prompt result) keeps it
  cheap to carry.

---

## WS3 — raster legibility: `BELOW_READABLE_SIZE`

### Motivation

`PngFitTo` is `{width} XOR {height}` (`src/png-contract.ts:27`), resolved
into a `{mode, value}` policy whose effective scale multiplies every glyph.
Two paths shrink text silently today: (1) a caller-supplied `fitTo` smaller
than the natural size; (2) the hosted raster budget
(`MAX_HOSTED_PNG_PIXELS` = 4,194,304; 8 MiB response cap), which downscales
large diagrams *without the caller asking*. A 14px label at effective scale
0.5 rasterizes at 7px. A text-only agent cannot see this; Flint's stretch
model treats the readability floor (ℓ_min) as a first-class contract with a
warned overflow regime, and we adopt the same posture at the raster
boundary.

### Contract

- New deterministic warning, following the `PngFontWarning` precedent
  (`shared/png-font-warnings.ts` → new sibling or extension in
  `shared/`):

  ```
  {
    code: 'BELOW_READABLE_SIZE',
    message: <one sentence with the numbers>,
    details: {
      naturalSize: { width, height },
      effectiveScale: number,
      baseMinLabelPx: number,        // smallest configured text size in the resolved style
      effectiveMinLabelPx: number,   // baseMinLabelPx × effectiveScale
      floorPx: number,               // the active floor
      cause: 'fitTo' | 'scale' | 'raster-budget'
    }
  }
  ```

- New portable option `minLabelPx?: number` in `PortablePngOutputOptions`
  (default **9**; `0` disables), flowing through the generated option
  descriptors so CLI, library, local MCP `render_png`, and hosted
  `render_png` all accept it identically. The floor's default and rationale
  are documented where the option is defined; it is a legibility heuristic,
  not a standards claim, and is caller-tunable.
- Emission points: the render receipt
  (`renderMermaidPNGWithReceipt`), the `onWarning` callback / CLI stderr
  (existing font-warning channel), and the MCP `render_png` structured
  result. The hosted `render_png` result envelope gains the same warnings
  array (today it returns base64 only); local/hosted parity is pinned by the
  differential suite.
- Semantics: warn iff `effectiveMinLabelPx < floorPx` after full policy
  resolution (fitTo, explicit `scale` < 1, and raster-budget clamps all
  feed the same computation; `cause` reports the binding constraint).
  Exactly-at-floor does not warn. SVG/ASCII/Unicode outputs are untouched —
  this is a rasterization contract.
- First implementation computes `baseMinLabelPx` from the **resolved
  style's configured text sizes** (labels, titles, annotations), not by
  walking scene text runs. That is conservative and cheap; if it proves too
  coarse (warning on diagrams that don't actually use the smallest size),
  the refinement path is a scene-walk over rendered text runs — noted, not
  specced.
- Stage 2 (**cut from committed scope**): `fitStrategy: 'error'` — a hard
  failure mode duplicates what any caller can do by treating the warning as
  fatal. Build only if a consumer asks for it in their own words.
- Stage 3 (explicitly deferred): density negotiation via ELK spacing
  modulation before glyph shrink. Requires its own design against the
  layout rubric and drift sentinel; out of scope here.

### Testing plan

- **Contract tests** (in the `png-output-options-contract.test.ts` family):
  - a corpus diagram with `fitTo` forcing effective scale ≈ 0.5 → exactly
    one `BELOW_READABLE_SIZE` warning with all `details` fields populated
    and `cause: 'fitTo'`;
  - the same render without `fitTo` → no warning;
  - `minLabelPx: 0` → no warning under any fit;
  - boundary: fit chosen so `effectiveMinLabelPx === floorPx` → no warning;
    one ulp below → warning.
- **Hosted raster-budget test** (`hosted-mcp.test.ts` +
  `host-png-backend-parity.test.ts` patterns): a diagram whose natural
  raster exceeds `MAX_HOSTED_PNG_PIXELS` → warning with
  `cause: 'raster-budget'` even though the caller supplied no `fitTo`;
  local/native/browser backends agree (parity test).
- **Property test** (fast-check, pinned-seed preload): for generated
  `fitTo` widths across a corpus sample, warning presence ⇔
  `resolvedScale × baseMinLabelPx < floor`. This pins the predicate to the
  resolution math rather than to fixture-specific numbers.
- **Determinism**: two renders of the same input produce identical warning
  lists (ordering included).
- **Error-mode test** (only if stage 2 is ever built): `fitStrategy:
  'error'` converts the condition into the documented structured error;
  `render_png` MCP path returns it in the tool-error envelope required by
  ≥ 2025-11-25 revisions.
- **Red→green statement**: reverting the emission leaves the contract and
  property tests failing; state the count in the PR.

### Verification / acceptance (the value demonstration)

- A one-off scan script (may live in `scripts/` or the PR description
  workflow, not necessarily committed): render the 271-entry docs corpus
  plus the gantt/radar bench fixtures at `fitTo.width` 800 and 1280;
  report how many renders land below the floor **today, silently**. That
  count is the PR's motivation section, per good-pr's reproduction-steps
  dimension.
- After: the same scan shows the identical set now warned — zero silent
  cases. The table goes in the PR description.
- Visual evidence (good-pr dimension 2): one before/after pair — the same
  PNG at effective 7px labels, captioned with the warning text now
  accompanying it. (Geometry is unchanged — the *evidence* is the warning,
  and the PR must say exactly that rather than padding with identical
  screenshots.)
- Acceptance: contract/property/parity/determinism tests green across
  native + browser + hosted backends; docs updated
  (`docs/config.md` option table, `docs/features.md`, `CHANGELOG.md`).

### Risks

- *Over-warning from style-derived minimum* — accepted for v1 and
  documented; refinement path named above. `minLabelPx: 0` and a tunable
  floor bound the annoyance.
- *Floor value bikeshed* — the default is a documented heuristic with an
  escape hatch; changing the default later is a one-line, well-tested edit.

---

## WS4 — MCP App editor view (`open_editor_view`)

### Motivation

The last mile of "beautiful diagrams with your agent" is a human glance and
nudge. Today that means copying source to the website editor and pasting
back — no lineage, no verify receipt on what comes back. MCP Apps
(SEP-1865; extension id `io.modelcontextprotocol/ui`; first official MCP
extension, folded into the 2026-07-28 extensions framework our dispatcher
already validates — see `mcpClientCapabilitiesProblems`'s namespaced
`extensions` check) lets the hosted server ship an interactive editor into
the chat client with the tool-call consent path intact. Flint's
`create_chart_view` is the precedent.

### Build gate

WS4 does not enter `TODO.md` on sequencing alone. It requires **both**:
WS2-lite deployed, and its Stage 1 demand gate fired (sustained third-party
pulls on the hosted resource/prompt surface — the counter and default
threshold live in WS2's verification section). A hosted surface nobody
fetches does not need an interactive editor; if the gate never fires, WS4
never builds, and the plan considers that a correct outcome.

### Contract

- **Template resource** (rides on WS2): `ui://agentic-mermaid/editor`,
  `mimeType: "text/html;profile=mcp-app"`, listed via `resources/list` and
  fetched via `resources/read`. Content: a **fully self-contained** HTML
  document built at build time from the existing `editor/` sources (css/js/
  html) plus the browser render bundle — embedded-string module, same
  mechanism as WS2's skill embedding. `_meta.ui.csp` is omitted **on
  purpose**: the spec's default then blocks all external access, which is
  exactly right — the template must need no network.
- **Tool**: hosted `open_editor_view` with
  `_meta.ui = { resourceUri: "ui://agentic-mermaid/editor", visibility: ["model", "app"] }`.
  Input `{ source: string, options?: <canonical nested render options> }`.
  Model-visible result: a compact summary `{ family, verify: { ok, warningCount }, canvas }`
  so the model has context even before any human interaction.
- **Listing gate**: the tool (and the `ui://` resource) appear only to
  clients whose declared capabilities include
  `extensions["io.modelcontextprotocol/ui"]`; other clients see today's
  surface unchanged. Hosted-only initially; local stdio deferred until a
  local host exists to render it.
- **In-frame protocol** (per the 2026-01-26 extension spec):
  1. host ↔ iframe handshake: `ui/initialize` →
     `ui/notifications/initialized`;
  2. host delivers `ui/notifications/tool-input` (the source) and
     `ui/notifications/tool-result`;
  3. structured edit controls issue host-mediated `tools/call` →
     **`mutate`** with `{ source, ops }` — the same tool, same
     `mutateChecked` core, same verify-before-emit envelope; free-text
     edits in the frame are local previews only;
  4. hand-back: the frame calls `tools/call` → `verify` on the final
     source, then `ui/update-model-context` with
     `{ source, verify: <summary>, ops: <applied op lineage> }`. The model
     never receives handed-back source without a server verify receipt
     (shared invariant 4).
  5. teardown: respond to `ui/resource-teardown`.
- **Budget**: the template has an enforced size ceiling, measured before
  committing to a number (the current editor + browser bundle sizes decide
  it; `docs/project/website-payload-plan.md` is the precedent for how this
  repo budgets payloads). The ceiling is a test, not an aspiration.

### Design notes

- The browser bundle already renders synchronously with zero DOM
  dependencies for layout — the preview inside the sandbox needs no server
  round trip; server round trips are reserved for *mutation* and *verify*,
  which is where the contract lives.
- The tool handler itself is thin: render summary + hand the template URI
  to the host. No new isolate work beyond an ordinary `verify`.
- `server.json`, directory listings, and `docs/mcp-code-mode-rationale.md`
  updated to describe the App surface and its gate.

### Testing plan

- **Template self-containment lint** (unit): the built template string
  contains no `http(s)://`, `//`-protocol-relative, or `import(` external
  references; parses as a single document; stays under the size ceiling.
  This is the CSP-compatibility proof and runs in CI on every build.
- **Capability gating** (era-matrix unit tests): client without the
  extension capability → `tools/list` omits `open_editor_view` and
  `resources/list` omits the `ui://` entry; with it → present, and the
  tool's `_meta.ui` fields validate against the extension spec's field
  names exactly.
- **Protocol cases** (`eval/mcp-protocol/cases.json`): declared-capability
  and missing-capability calls of `open_editor_view` (success + failure
  sides), keeping the suite's both-sides rule.
- **E2E round trip** (Playwright against the preinstalled Chromium; a test
  host page implementing the host side of `ui/initialize`,
  `tool-input`/`tool-result`, and a `tools/call` bridge wired to a local
  instance of the same handler code):
  1. load template, deliver a sample diagram as tool-input;
  2. drive a structured edit control programmatically;
  3. assert the bridge observed `tools/call mutate` with a well-formed op
     list (schema-validated), and the preview updated;
  4. trigger hand-back; assert `ui/update-model-context` carries source
     **byte-identical** to `am mutate --ops` applying the same op list to
     the same input — extending the
     `examples/mcp-vs-cli-complex-diagrams.ts` equivalence story to the App
     channel — and a verify summary with `ok: true`.
- **Teardown test**: the frame acknowledges `ui/resource-teardown` and
  stops issuing calls afterward.
- **Conformance**: if the ext-apps repo publishes conformance scenarios,
  wire them into `eval:mcp-conformance` with `expected-failures.yml`
  entries individually justified.
- **Red→green statement**: reverting the host-bridge wiring fails E2E
  steps 3–4; reverting the gate fails the capability tests. State both.

### Verification / acceptance

- Lab proof: the full E2E loop green headless in CI, plus the equivalence
  assertion (App channel ≡ CLI channel, byte-identical output).
- Field proof (honest framing): adoption is the real metric —
  `open_editor_view` request counts on the hosted Worker (the observability
  posture from the abuse-controls plan), reported after a release. The plan
  does not dress adoption up as a lab result.
- Demo artifact: one recorded session (agent drafts → human nudges in the
  frame → agent continues from verified source) for docs/marketing.
- Acceptance: self-containment lint, gating matrix, protocol cases, E2E,
  and size budget all green; docs updated; WS2 shipped first.

### Risks

- *Extension churn / partial client support* — the gate degrades cleanly
  (no capability → surface unchanged); pin to the 2026-01-26 extension
  revision; track client variance in `expected-failures.yml` with dated
  comments.
- *Bundle weight* — the measured ceiling test fails the build rather than
  letting the template bloat quietly.
- *A second editing surface drifting from the engine* — precluded
  structurally: the frame's structured edits and hand-back verify are
  `tools/call` into the same server code paths; there is nothing to drift.

---

## WS5 — Generated perceptual-constants ledger

### Motivation

Every layout, quality, and color decision in this repo rests on a numeric
constant, and each one has provenance — but scattered: `DEFAULT_BOUNDS` +
`BOUND_PROVENANCE` in `src/agent/quality.ts`, rubric severities and route
thresholds in `src/layout-rubric.ts`, the ΔE_OK 0.10 collision floor and
APCA/WCAG visibility floors in the palette contract, the 40-char label cap
in verify, WS3's `minLabelPx` once it lands, ASCII truncation limits.
Flint's `design-stretch-model.md` shows the value of the opposite posture:
every constant named, valued, and justified in one reviewable document
(banking 45° ← Cleveland; facet floor 3px ← "readers compare patterns
rather than read precise values"). The ledger makes our defaults reviewable
*as a set* and exposes which ones are validated research versus heuristic
convention — the aesthetics addendum's lesson 2.

### Build gate

Opportunistic, not on any critical path: build alongside the next PR that
touches a rostered constant (WS3's `minLabelPx` is a natural companion), or
standalone when convenient. The roster is deliberately bounded to
`src/agent/quality.ts`, `src/layout-rubric.ts`, and the shipped color
contract — not "every constant in the repo", which is a tarpit.

### Contract

A **generated** document, `docs/design/perceptual-constants.md`, emitted by
`scripts/design/perceptual-constants.ts` with a `--check` mode (the
`characterization:check` pattern). Hand-editing it is a CI failure — the
no-second-source-of-truth invariant. One row per constant:

| field | meaning |
|---|---|
| name | e.g. `maxCrossingsRatio`, `minStep`-analog, `deltaEOkFloor` |
| value + unit | the shipped default |
| enforced in | file reference(s) where the constant is read |
| task-dependence | `global` or the reading task it should vary by (detail vs overview render, pattern-reading vs value-reading) — documentation first, parameterization later |
| source | citation (Purchase 2002, APCA, WCAG 2.x, Kakoulis–Tollis, …) or `project convention` |
| confidence | `validated-research` \| `project-convention` \| `heuristic-default` |

The generator imports constants from their homes — constants do **not**
move into a central module (that refactor is explicitly not required). A
roster in the generator names what must appear; completeness is
test-enforced.

The `heuristic-default` tier is the point: its row count is the standing
backlog of constants that lack evidence, and the prototype plan's
evidence-before-weight rule applies to upgrading them.

### Testing plan

- **Check mode**: `--check` fails when any imported constant, roster entry,
  or provenance record changed without regenerating the doc.
- **Completeness**: every `DEFAULT_BOUNDS` key must have a
  `BOUND_PROVENANCE` entry *and* a ledger row; every rubric hard metric and
  every shipped color-contract constant likewise. Adding a bound without
  provenance fails the test — extending the discipline `BOUND_PROVENANCE`
  already establishes.
- **Determinism**: two generator runs produce byte-identical output.
- **Red→green statement**: change a constant without regenerating → check
  fails; add a roster entry without provenance → completeness fails.

### Verification / acceptance

The deliverable is the ledger itself plus its gates. Acceptance: all
rostered constants present with source and confidence tier; CI runs the
check; `docs/quality.md` and the rubric header link to it as the canonical
inventory. Success metric over time: the `heuristic-default` count goes
down, never silently up (a PR adding a heuristic constant must say so).

### Risks

- *Provenance theater* — citing research a constant doesn't actually
  implement. Mitigation: the confidence tier is mandatory and
  `heuristic-default` is an acceptable, honest answer.
- *Scope creep into refactoring constants* — explicitly out of scope; the
  generator imports from where constants live today.

---

## WS6 — Stressor registry, designed contact sheet, and site gallery

### Motivation

The mechanisms already exist but are scattered and engineer-only:
`eval/visual-rubric/` renders 44 lettered route-contract scenarios into one
utilitarian PNG (`bun run contact:sheet`) that doubles as a CI byte-gate
(`contact-sheet.test.ts` geometry hashes, `contact-sheet-png.test.ts`);
`scripts/characterization/` and `scripts/pr-assets/` maintain three more
sheet generators; the palette rollout added hashed machine-readable
comparisons (prototype-plan lesson 8). What's missing is what Flint's
gallery has: **organization by named failure mode, a designed human
surface, and a public home** — while its site plan names the constraint we
must respect: real diagrams, large renders, unified whitespace, and no
"test-page aesthetics" on the public surface.

A throwaway demonstrator (2026-08-03, not committed) validated the shape:
10 cases in three failure-mode sections, rasterized through the same DejaVu
pipeline as CI, captioned with `measureQuality` chips flagged against
`DEFAULT_BOUNDS` in DESIGN.md's paper/ink language. It also proved the
concept pays immediately: it surfaced a real rendering artifact (a class
docs-corpus example renders a literal `<br>` inside a note label, absent
from `divergences.json`) and a real caption bug (a trailing-zero formatter
displayed 100% as 1%) — both of which become required tests below.

### Contract

**1. Stressor registry** (`eval/stressors/registry.ts`): the single source
of case membership. Each case:
`{ id, family, failureMode, why, source, provenance, expectations }` where
`failureMode` is a small closed taxonomy (route-contracts,
density-and-scale, degenerate-inputs, label-stress, style-stress — extend
deliberately), `provenance` is `hand-authored | corpus(origin) |
generator(name)`, and `expectations` names the verify warnings the case is
*supposed* to produce (an overlong-label stressor EXPECTS
`LABEL_OVERFLOW`). Existing scenario sources are **referenced, not
copied** — `eval/visual-rubric/scenarios.ts` stays authoritative for its
letters and keeps its own pins. Corpus-sourced cases likewise **reference
their `divergences.json` entry** instead of restating expectations, so each
source keeps exactly one ledger.

**Build gate for the core**: the next layout-touching PR that needs visual
evidence anyway (per good-pr dimension 2), or standalone when the owner
wants it — the registry and sheet are then that PR's evidence mechanism
rather than extra work beside it.

**2. Contact sheet, engineer surface** (`bun run contact:sheet:stressors`):
two artifacts from one registry —
- the flat PNG grid (CI byte-gate, exactly today's mechanism extended);
- a designed self-contained HTML sheet: DESIGN.md tokens (paper `#F5F0E4`,
  ink, surface cards with hairline `#D8D0C1` borders, serif section
  headings, mono metric chips, terracotta reserved for out-of-band values
  and warnings), one section per failure mode with a one-line rationale,
  renders rasterized via the DejaVu font pipeline so text metrics are
  honest, captions carrying `measureQuality` values chip-flagged against
  `DEFAULT_BOUNDS` plus the verify-warning count.

Pinning follows the palette-rollout pattern: a **machine-readable
manifest** (case ids, per-case render SHA-256, metric values) is the
hash-pinned artifact; the HTML is regenerated from it and size-ceilinged
but not byte-pinned.

**3. Site gallery, public surface — GATED follow-up** (gate: the engineer
sheet proves useful in at least one real PR review first). A generated page
in the website build (`website/src/generated/` ephemeral as usual, covered
by `website:check`) rendering the same registry through the site design
system. Presentation rules — the no-test-page-aesthetics clause, contract
text for whenever this ships:
- The public **showcase** gallery (existing samples surface) leads with
  real diagrams under default and flagship looks: large renders, unified
  whitespace, code secondary. Stressors never mix into it.
- The **stressor** gallery is a separate, clearly named page in the
  standards-manual voice ("torture tests", stated purpose up front), same
  design language, honest metric captions. Hard cases are presented as
  evidence of discipline — published, not hidden, and never dressed as
  showcase pieces.
- Both pages follow DESIGN.md: flat panels, hairline borders, serif
  headings, terracotta as the single accent; no SaaS gloss.

**4. Convergence rule**: the PNG grid and HTML sheet render the same
registry through the same render pipeline; a test compares case-id sets so
they cannot diverge in membership. The test extends to the site page when
(and only when) that surface exists — no convergence machinery for
surfaces that don't.

### Testing plan

- **Registry integrity**: every case parses and verifies with *exactly* its
  declared expectations — an expected warning disappearing (renderer
  improved) or appearing (regression) both fail until the registry is
  consciously updated. This is the divergence-ledger discipline applied to
  stressors.
- **Determinism + pinning**: manifest byte-identical across two runs;
  manifest hash pinned in a test (conscious re-pin + re-review on any
  geometry/metric drift — the `contact-sheet.test.ts` contract extended);
  new registry cases require a pin entry or the test names them.
- **Caption correctness** (the demonstrator's bug, encoded): a unit test
  that chip values equal `measureQuality` output for a fixture, including
  the 100%/boundary formatting cases; a chip flagged iff the metric is
  outside `DEFAULT_BOUNDS`.
- **Self-containment + budget**: the HTML sheet passes the
  no-external-reference lint (shared with WS4) and a measured size
  ceiling.
- **Site coverage** (ships with the gated site page, not the core):
  `website:check` covers the gallery page's clean regeneration; a
  Playwright smoke (preinstalled Chromium) asserts the page renders and
  shows the registry's case count.
- **First-find regression**: the `<br>`-in-class-note artifact is filed
  during implementation (issue or `divergences.json` entry, whichever the
  triage supports) with a pinned test either way — the sheet's first
  catch must not evaporate.
- **Red→green statement**: revert the manifest pin → pinning test fails;
  break a caption formatter → caption test fails; drop a case from one
  surface → convergence test fails. State all three in the PR.

### Verification / acceptance (the value demonstration)

- **Review-time value**: one designed sheet regenerated per relevant PR
  replaces ad-hoc gallery scripts for layout-touching changes; the
  `scripts/pr-assets/` sheets remain and may migrate into registry
  sections later (follow-on, not forced).
- **Discovery value**: the registry's find log — starting with the `<br>`
  artifact — records what the stressor surface caught and when. A stressor
  gallery that never catches anything is a smell the log makes visible.
- **Public honesty value**: `docs/comparison.md` gains one line: we
  publish our torture tests with instrument readings; the strongest
  comparable project (Flint) reviews charts by eye in a private gallery.
- Acceptance: registry + both sheets + site page shipped under the tests
  above; visual evidence in the PR is the sheet itself (captioned,
  per good-pr dimension 2); presentation reviewed against DESIGN.md and the
  no-test-page-aesthetics clause.

### Risks

- *Sheet bloat* — per-section case budgets; the PNG grid stays the CI
  gate; the HTML sheet exists for humans and has a size ceiling.
- *Two aesthetics regimes drifting* (CI sheet vs site page) — one
  registry, one render pipeline, the convergence test.
- *Test-page aesthetics creeping into the public gallery* — the
  presentation rules above are contract text; PR review checks against
  DESIGN.md explicitly.
- *Stressor cases ossifying* — expectations force conscious updates in
  both directions (improvement and regression), so the registry tracks the
  renderer instead of rotting.

---

## Parked — the paired outcome eval

The research note's highest-value recommendation is deliberately **not** a
workstream here, and the omission must be visible rather than silent. The
item: a paired outcome evaluation — the same task set driven by two agents,
one using the typed workflow (parse → narrow → mutate → verify →
serialize), one regenerating raw Mermaid against a stock renderer — graded
pairwise by a VLM judge (the `docs/quality.md` axes) *plus* the
deterministic rubric, win/tie/loss with a sign test, at two or three model
tiers. It is the experiment that would prove the product thesis outright
and test Flint's capability-gradient prediction on this surface; it is also
the most expensive item in the research note (harness work plus on the
order of a hundred live agent sessions plus judge spend).

That combination — highest value, highest cost — makes it an owner
decision, not something a plan should smuggle in by inclusion. Unparking
requires an explicit go (and a spend ceiling); it then receives its own
spec section covering task derivation from the corpus, judge protocol, and
significance testing, mirroring Flint's Section 5.2 methodology. Until
then, WS1's compactness number is the cheap proxy the README can cite.

## Execution order

**Core — now, any order, one PR each** (WS2-lite may split local/hosted if
the diff grows):

1. **WS1** — `eval/edit-cost`, bytes only; README + comparison.md cite the
   number.
2. **WS3 stage 1** — the warning, the `minLabelPx` option, backend parity.
3. **WS2-lite** — two resources, one prompt, both eras, drift guards,
   demand counters.

**Gated — each enters `TODO.md` only when its named gate fires** (gates
defined in the workstream sections): WS6 core (next layout-touching PR
needing visual evidence), WS5 (next PR touching a rostered constant),
WS2-full → then WS4 (the WS2 Stage 1 demand signal, then the pilot), WS6
site page (the sheet proves useful in a real review).

**Parked** — the outcome eval, awaiting an explicit decision.

Every PR follows the good-pr dimensions, states its red→green evidence,
and is opened only when explicitly requested. Documentation ships with its
workstream, not batched at the end: `docs/features.md`, `CHANGELOG.md`,
`llms.txt`, `Instructions_for_agents.md` (WS2-lite: "load the skill
resource first" becomes the documented step 1 for MCP-only clients),
`docs/config.md` (WS3 option), MCP docs and directory listings
(WS2/WS4).

## Acceptance summary

| WS | Proof it works (CI) | Proof it's worth it |
|---|---|---|
| WS1 | determinism + coverage-floor + oracle + check-mode tests | RESULTS.md headline + scaling curve, cited in README/comparison |
| WS2-lite | era-matrix units, protocol cases, conformance, drift guards, local/hosted differential, demand counters live | staged: fetch counts (Stage 1) → pilot (Stage 2) → full A/B (Stage 3), each bought only if the prior stage fires |
| WS3 | contract + property + parity + determinism tests, hosted budget case | corpus scan: N silently-unreadable renders today → 0 silent (all warned) |
| WS4 | self-containment lint, gating matrix, E2E round trip, App≡CLI byte equivalence, size budget | adoption counts post-release + recorded demo; lab proof is the round trip |
| WS5 | check mode, completeness vs roster, determinism | the ledger itself; `heuristic-default` count as the standing evidence backlog |
| WS6 core | registry expectations, manifest pinning, caption correctness, two-surface convergence, size ceiling | the find log (first entry: the `<br>` note artifact); one designed sheet replacing ad-hoc PR galleries |
| WS6 site page (gated) | website:check coverage, Playwright smoke, presentation review vs DESIGN.md | the published torture-test page as the honesty artifact cited in comparison.md |
