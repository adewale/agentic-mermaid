# Issue #248 construct-level Mermaid fidelity delivery plan

Status: proposed. This document turns
[#248](https://github.com/adewale/agentic-mermaid/issues/248) into a staged
delivery programme. The issue remains the authority for the audited findings
and closure criteria; this plan owns sequencing, PR boundaries, dependency
policy, and review discipline.

## 1. Decision

Treat #248 as a tracking epic, not a single implementation PR. Deliver it as a
small number of infrastructure stacks followed by focused family repair PRs.
Every PR must be independently reviewable and green against its declared base.

The programme has two inseparable outcomes:

1. every known construct-level loss is fixed or represented by an exact,
   executable compatibility disposition; and
2. capability and citizenship claims are generated from construct-level
   semantic receipts so the same class of overclaim cannot recur.

The architecture is deliberately factored. One generated authority fixes the
16-family scope. Family cases prove construct semantics once through the
canonical core. Generated route-conformance cases prove that CLI, SDK, MCP,
editor, website, and output adapters preserve or accurately diagnose those
semantics. One executable gate joins both results into the compact public
capability index. A0 enforces candidate identity and evidence provenance; it is
not a mandate to build a general-purpose governance platform.

Fixing only the audit's defect table does not close #248. Building only the
evidence framework while leaving silent corruption in place does not close it
either.

## 2. PR #192 is not a programme prerequisite

Work on #248 should start from `main` without waiting for
[#192](https://github.com/adewale/agentic-mermaid/pull/192).

The following work is independent of #192 and should not be based on its
branch:

- upstream revision closure;
- the fidelity contract, receipt runner, and semantic projector API;
- capability/citizenship aggregation from receipts;
- agent/native-render seam contracts;
- parser statement-consumption and token-boundary guardrails;
- official-example classification infrastructure;
- the generated config-effect matrix;
- non-Sankey family fixes; and
- generic typed local Scene resources, including gradients and compositing.

Sankey-specific native receipts and final Sankey closure do depend on a Sankey
family implementation landing. That may be #192 after it is rebased and
narrowed, or a replacement stack that extracts its generic infrastructure and
then lands family enrollment separately.

Do not stack the general #248 infrastructure on #192. At the time this plan was
written, #192 was behind `main`, conflicted, and mixed Sankey work with generated
cross-family artifacts. Making it the base of the programme would couple every
other family and evidence change to that integration risk.

Preferred Sankey sequence:

1. land typed local Scene paint resources from `main`;
2. rebase and narrow #192, or replace it with a smaller Sankey-enrollment PR;
3. stack Sankey semantic receipts and any remaining renderer fixes on the
   enrollment PR;
4. merge in dependency order; and
5. rerun the final Sankey audit after rebasing onto the merged bases.

The epic can therefore begin immediately, but under #248's current 16-family
scope it cannot close until Sankey is enrolled with truthful receipts. If a
separate product decision abandons Sankey, #248's authority, scope, and
acceptance criteria must be explicitly amended before that decision can affect
epic closure.

## 3. Non-negotiable delivery rules

### 3.1 One semantic claim, one executable receipt

A construct may be reported `native` only when a receipt proves its applicable
semantic implications. File existence, hook invocation, source preservation,
successful parsing, non-empty output, stable serialization, and SVG byte
difference are useful evidence but are not sufficient individually or in the
aggregate.

Every receipt must identify:

- stable case ID, family, construct IDs, and upstream authority coordinates;
- exact upstream authority revision;
- minimal authored source;
- a typed expectation for every pipeline stage, including whether it applies;
- a versioned semantic oracle for every applicable native stage;
- exact structured diagnostic expectations for every public non-native
  disposition and an explicit dependency for every blocked stage;
- applicable serialization, mutation, layout, Scene, SVG, terminal,
  interaction, configuration, and accessibility implications; and
- a named divergence ID when local behavior intentionally differs.

### 3.2 No silent statement loss

Every nonblank, non-comment family statement must be modeled, preserved with a
route-specific typed runtime diagnostic, or rejected with a named error. A
parser must never return a visually plausible partial diagram after silently
skipping an authored statement. Lossless preservation by a serialization stage
may be silent only when every applicable public parse, verify, and render route
models the construct natively; preservation does not excuse a semantic gap on
another route.

### 3.3 Fail-closed public claims

Receipt aggregation uses the following policy:

- `native`: every applicable receipt required by the claim passes;
- `source-preserved`: source survives, native semantics are not established,
  and the applicable public route emits the exact typed diagnostic;
- `diagnosed`: a named unsupported or divergent behavior is surfaced exactly;
- `not-applicable`: the upstream behavior genuinely cannot apply to authored
  source or the output surface; and
- `absent`: there is neither implementation nor an honest supported envelope.

Unknown, uncovered, opaque, and divergent cases cannot contribute to a
family-wide native claim. Whenever the agent surface applies, `native`
aggregation requires a structured agent disposition, a passing structured
semantic projection, and native render semantics. An opaque agent case caps
the construct and public claim at `source-preserved` even when the native
renderer succeeds. `diagnosed` is valid only when the actual public path
emits the exact asserted runtime diagnostic. A divergence-ledger entry alone
cannot manufacture diagnosed behavior. Silent semantic loss is `absent`,
blocks programme closure, and may be promoted only when an exact runtime
diagnostic or native fix lands. Divergence ledgers are inputs to aggregation,
not parallel documentation.

### 3.4 Every regression test must discriminate

For each behavioral fix, demonstrate that the focused test or receipt is red on
the defective implementation and green with the fix. Where a literal revert is
impractical, use a bounded sabotage that removes the relevant parser token,
config read, style implication, diagnostic, or Scene projection and show that
the contract fails.

### 3.5 Generated evidence follows its authority

Generated reports, manifests, receipts, and galleries must be regenerated by
their owning PR. Do not manually merge hashes or defer required freshness to a
later integration PR. Generated binary evidence should appear only when the PR
makes a visual claim that requires it.

## 4. Mandatory multi-agent audit loop for every PR

Every PR in this programme, including this plan PR and documentation-only PRs,
must pass the following loop before it is marked ready or merged.

### 4.1 Freeze and prepare the audit candidate

1. Finish the scoped implementation.
2. Commit the complete candidate and require a clean working tree. An
   uncommitted or dirty candidate cannot begin a formal audit round.
3. Run the mandatory baseline and touched-authority checks from §9.
4. Record the candidate tuple: repository ID, PR number, target branch,
   target-tip SHA, merge-base SHA, head SHA, intended merge strategy, protected
   governance-policy revision, and frozen semantic PR title/body digest.
   Recompute and record the head-tree and full-diff digests as derived integrity
   receipts rather than treating them as additional identity fields.
5. Before dispatch, create a content-addressed round manifest that registers
   the three role/session/run IDs, prompt/scope hashes, candidate tuple, tree/
   diff digest, and timestamp.
6. Freeze implementation work while the auditors inspect that registered
   candidate.

### 4.2 Run at least three independent agent audits

Use one distinct, trusted-runner-issued read-only agent/session per role in
independent contexts.
Auditors must not see or coordinate with the other auditors before submitting
their first report. The implementation agent may orchestrate the audit but must
not count as an auditor or reuse one session for multiple roles.

Required audit roles:

1. **Upstream and semantic fidelity auditor** — checks the pinned Mermaid
   authority, authored witness, normalized expectation, divergence policy, and
   whether the change preserves the intended domain meaning.
2. **Architecture, integration, and security auditor** — checks registry and
   transport seams, source preservation, agent/native agreement, Scene/output
   lowering, deterministic IDs, offline/security boundaries, stacking
   assumptions, and generated authorities.
3. **Adversarial test and evidence auditor** — attempts to invalidate the tests,
   looks for assertions that pass with the defect restored, checks malformed and
   boundary inputs, and verifies that reports are derived from the new receipt
   rather than merely citing it.

For a documentation-only PR, reinterpret the same roles as authority/scope,
architecture/dependency feasibility, and enforceability/adversarial review.

Each auditor must return:

- `APPROVE` or `CHANGES_REQUIRED`;
- stable finding IDs ordered by severity;
- exact file, contract, or upstream evidence for each finding;
- the smallest acceptable correction; and
- residual risks or explicitly tested non-findings.

An audit that only summarizes the PR is not an approval.

Every commissioned run must resolve to a recorded first report, failure,
timeout, or cancellation. Do not replace or omit an unfavorable, failed, or
abandoned run. A replacement requires a new manifest and a new round containing
the complete registered role set.

### 4.3 Fix, retest, and audit again

1. Preserve each auditor's first report verbatim, then consolidate the findings
   without weakening them by majority vote.
2. Fix every actionable finding. A scope suggestion may be rejected only with a
   written explanation showing that it is not a defect in the PR's claim or
   acceptance criteria.
3. Rerun focused and affected wider checks.
4. Start a new independent audit round against the new candidate tuple.
5. Repeat until every auditor returns `APPROVE` with no actionable findings.

Any change to the repository/PR identity, semantic title/body digest, head SHA,
target-tip SHA, merge-base SHA, target branch, intended merge strategy, or
protected governance-policy revision invalidates checks and approval and
requires another round. This includes target-branch advancement, semantic PR
description edits, retargeting, parent-PR merge, and rebasing even when the
child head tree appears unchanged. Immediately before merge, compare the
current tuple, tree/diff and semantic-description digests, required workflow
and governance-policy revisions, and newest non-superseded provider-issued
check runs with the final audit record and fail closed on any difference. A
newer failed or cancelled run for the same tuple supersedes an older success.

### 4.4 Preserve audit evidence in the PR

The trusted runner preserves each individual first report as a content-addressed
immutable payload. One detached signed or protected round envelope records all
payload hashes, roles, actor/session/run identities, candidate tuple, tree/diff
and semantic-description digests, prompt/scope hashes, timestamps, commissioned-
run reconciliation, and finding ledger. Never require a payload to contain its
own byte hash. The PR conversation needs one machine-owned comment per round
pointing to this bundle; it does not duplicate each report as a separate pasted
comment. The bundle contains an audit table with:

| Round | Target | Target tip | Merge base | Head | Strategy | Individual reports | Result |
| --- | --- | --- | --- | --- | --- | --- | --- |

Maintain a persistent finding ledger with:

| Finding ID | Originating auditor | Severity | Disposition | Correction commit or rejection rationale | Validating round |
| --- | --- | --- | --- | --- | --- |

The final row must identify the audited tuple and show approval from every role
with no unresolved finding. Reviewers must be able to trace a finding to its
correction without accessing an ephemeral agent transcript. Audit results and
the finding ledger live in the immutable round bundle, referenced by its
machine-owned comment, not in mutable semantic PR-body sections. Readiness
automation added by A0 must reject a missing report, reused role, unreconciled
commissioned run, unresolved finding, invalid payload/envelope hash, or approval
bound to a stale tuple/digest; implementer-authored summary text alone is not
audit evidence. The final readiness job runs after the final audit and accepts
only the newest required provider-issued check for each declared check
identity.

### 4.5 Manual bootstrap for this plan and A0

This plan PR and the A0 governance PR necessarily precede the trusted audit
runner. They use one explicit, temporary bootstrap protocol; no later PR may
claim this exception:

1. commit a clean candidate and record repository/PR identity, semantic
   title/body digest, target tip, merge base, head, tree, diff digest, protected
   policy revision, and squash strategy;
2. run `git diff --check <merge-base>...<head>` and verify the changed-path set;
3. validate the external issue/PR links with `gh issue view 248` and
   `gh pr view 192`, and require every target-bound `gh pr checks` identity to
   be complete and green before registration or dispatch;
4. before dispatch, anchor a canonical round-manifest payload in an
   independently controlled append-only record that does not mutate the frozen
   candidate: a protected audit ref, signed annotated tag, or server-issued
   immutable record. A detached envelope records the manifest payload hash,
   session IDs, prompt/scope hashes, tuple, tree/diff and semantic-description
   digests, timestamp, and anchor object/URL. A PR comment points to that anchor
   but is not its authority;
5. require each auditor to publish the first report through an independently
   authenticated identity or a server-issued immutable transcript/artifact;
   record the provider artifact/transcript ID, immutable URL, actor/run identity,
   origin timestamp, and payload hash before accepting an implementer-preserved
   copy; an implementer-pasted report alone is invalid;
6. post the round-bundle pointer under one stable comment ID, record the
   manifest/report payload and envelope SHA-256 values plus comment
   `created_at`/`updated_at` in the bundle, and have an independent human witness
   compare the preserved bytes with the origin artifacts and anchored manifest
   before final readiness;
7. reconcile every commissioned session and the committed manifest, fix every
   actionable finding, and
   repeat against each new tuple until unanimous approval; and
8. have a human maintainer verify the final tuple, hashes, comments, and checks
   before merge.

A0 must add a deterministic package script named `check:programme-docs` for
future plan/governance link and path validation and replace this bootstrap with
trusted runner artifacts and automation.

## 5. Evidence architecture

### 5.1 Scoped family, construct, and public-route authorities

The current syntax-feature inventory is derived largely from documentation
headings and the upstream manifest covers families outside #248. A1 must first
generate one `FidelityScopeAuthority` containing exactly the 16 families named
by #248: the 15 built-ins on `main` plus Sankey. It then establishes the scoped
construct roster from pinned grammar/spec blocks, official fences, and config
authority, with reviewed many-to-many mappings to documentation headings and
manifest coordinates. Manifest rows outside this family authority remain in an
explicit unsupported/out-of-scope envelope; they do not silently enter this
programme or require projectors and cases.

A2 generates a versioned public-route registry from canonical SDK declarations,
CLI command/selector tables, MCP tool declarations, browser/editor/website
entrypoints, and `RENDER_TRANSPORT_SURFACES` × `RENDER_OUTPUTS`. A route records
independent transport, operation, entrypoint, selector, and optional output
dimensions plus its owning adapter. One adapter may own many routes; every route
has exactly one owner. No semantic dimension is hidden only inside a route-ID
string or hand-maintained in cases.

Exact-set validation must prove:

- the in-scope family-ID set equals the 16-family authority unless #248 itself
  is amended;
- every scoped construct maps to at least one fidelity case and every case maps
  back to scoped constructs and authorities;
- every scoped manifest `syntaxFeature`, official `example`, `configKey`, and
  `themeVariable` appears in its typed index, while every unscoped row has an
  explicit out-of-scope disposition;
- every generated route maps to one owner, every public entrypoint/selector/
  output cell maps back to a route, and an adapter may map to multiple routes;
- every construct exercised by an official fence is enumerated rather than
  treating the fence as one atomic feature;
- multiple witnesses may exercise the same construct without inventing new
  feature IDs; and
- orphan constructs, cases, sources, invocations, authorities, routes, and
  ambiguous ownership fail generation.

### 5.2 Factored semantic and route contracts

Do not materialize a construct × source × public-route × stage Cartesian
product. Most public adapters are transport projections over the same semantic
core, so repeating every construct through every transport adds cost without
independent evidence. Use two exact, joined contracts instead:

1. family cases prove construct/source semantics through the canonical agent and
   native core routes; and
2. route-conformance cases prove every public adapter's accepted inputs,
   operation, selector, output, diagnostics, and pass-through/projection rules.

An adapter may use factored conformance only when its registry declaration and
tests prove it is family-agnostic: it delegates to the canonical core without
branching on family or construct, and its touched-authority rule invalidates
that classification when dispatch code changes. Any family/construct-specific
branch is `route-specific` and requires direct family-case coverage for the
affected constructs. A2 owns the precise TypeScript schema; this plan requires
the following records and joins rather than freezing implementation syntax:

| Record | Required data |
| --- | --- |
| Family case | Stable case/family IDs, non-empty construct and authority IDs, upstream revision, sources, canonical invocations, semantic cells, comparisons, optional divergence ID |
| Source | Stable ID, exact source, authored/metamorphic/boundary/malformed role, and base/transform IDs for a derived variant |
| Invocation | Stable ID, source/mutation/build kind, canonical core or public route ID, source or family input, and declarative options/operations |
| Semantic cell | Stable ID, construct ID, invocation ID, stage, disposition, oracle/diagnostic requirements, or governed blocking/not-applicable evidence |
| Public route | Generated transport, operation, entrypoint, selector, optional output, owning adapter, pass-through/route-specific mode, family/input applicability, and reachable stages |
| Route-conformance case | Stable ID, route ID, contract IDs, fixture invocation IDs, oracle, and diagnostic expectations |
| Comparison | Stable ID, construct IDs, two exact invocation-stage results, and a versioned oracle |

`FidelityStage` covers detection, agent parse, verification, native parse,
configuration, layout, Scene, SVG, PNG, terminal, serialization, mutation,
accessibility, and interaction. `FidelityInputKind` includes source, config,
theme, interaction, mutation, and build inputs. Transport, operation, and output
IDs are generated branded types, not handwritten unions in the cases. Oracle
IDs resolve through a runner-owned typed registry whose outputs are versioned,
family-discriminated semantic or implication snapshots; generated JSON never
embeds arbitrary executable callbacks.

The generator derives two required grids. The semantic grid contains exactly one
cell for every construct × named source × applicable core stage. Every source
must participate in a canonical semantic invocation; orphan sources are
rejected. Every metamorphic source must name its derivation and participate in a
comparison with its base. Multi-construct official fences produce separate
construct/source cells even when one invocation exercises several constructs.

The route grid contains exactly one conformance result for every generated
public route × accepted input kind × operation/selector/output contract. It
checks real transport admission, option/config/theme/interaction pass-through,
diagnostic envelopes, mutation atomicity, serialization, output bytes, and
security rules as applicable. Use a small cross-family fixture set chosen by
semantic category, not one fixture per construct. A `route-specific` adapter
also generates direct required family-case cells for each affected construct.
Aggregation permits a public native claim only when both its semantic cells and
the applicable route-conformance cells pass.

Every invocation, cell, diagnostic, comparison, source, route case, and
authority reference must resolve and have reverse coverage. Public mutation and
build conformance must execute the real route; runner-internal operations cannot
stand in for CLI, MCP, SDK, or other public admission, batching, diagnostics,
verification, and serialization behavior. A native mutation/build semantic
cell requires a result oracle and preservation oracles for unrelated semantic
facets. A route that does not support an operation must emit an exact diagnosed
outcome or carry governed `not-applicable` evidence; the programme does not
require inventing a mutation API merely to satisfy a native render claim.

Schema validation rejects a native applicable cell without an oracle, a
source-preserved cell without both a preservation oracle and at least one
expected runtime diagnostic, a diagnosed/rejected cell without at least one
expected diagnostic, invalid diagnostic cardinalities, and a not-applicable
cell without a typed reason and authority evidence. Silent loss is not a
compatibility disposition. When agent parse applies, native aggregation
additionally requires a structured agent oracle; opaque preservation caps the
aggregate at `source-preserved` even when downstream rendering succeeds.

Define the stage dependency graph explicitly. A locally blocked downstream
stage remains applicable, identifies the blocking invocation/stage and required
oracle, stays in the claim denominator, and inherits the blocking disposition
as an aggregate cap. Agent parsing does not block an independently executable
native-render invocation. Diagnostics and oracles are bound to their exact
invocation, route, construct, and stage; they cannot select hidden sources,
routes, configuration variants, backends, mutations, or builds.

Config and theme semantic effects use the same family cells. Ownership is exact
per `(authority ID, family ID, input dialect)`, so a shared global theme path
has one disposition for every applicable in-scope family rather than one
arbitrary family owner. Route conformance separately proves pass-through for
each accepting public route; a route-specific transformation requires its own
A/B case. Every wired effect joins to an explicit named A/B comparison. Pinned
Mermaid rejecting the source is the ordinary basis for local `reject`; if pinned
Mermaid accepts a complete fence, local rejection requires an executable named
diagnosed compatibility divergence.

### 5.3 Receipt runner

The runner executes every named declarative invocation through its real public
route adapter and the applicable dependency graph:

```text
detection
  |-> agent parse/body -> verification -> agent semantic projection
  `-> native parser -> layout -> native semantic projection
                                     |-> Scene and output implication
                                     |-> canonical serialize/reparse
                                     `-> public mutation/build invocation
  named A/B and metamorphic comparisons join declared invocation-stage results
```

It records disposition and semantic results, not just thrown/not-thrown status.
Every opaque agent outcome caps the applicable construct/public claim at
`source-preserved` and requires its exact route-specific typed diagnostic,
regardless of native-render success. Opaque agent success paired with render
failure additionally requires an exact diagnosed policy rather than
`verify.ok === true` under an unqualified claim.

A2 adds one deterministic package script, `fidelity:check`. It executes the
complete scoped semantic and route-conformance corpus against the pinned
upstream revision, builds raw receipts in a temporary directory, derives the
compact capability index in the same process, and compares generated committed
outputs. Committed or manually edited raw result files are never trusted as
inputs. CI may retain
the raw receipts as immutable debugging artifacts, but a freshness-only check
cannot substitute for execution.

### 5.4 Family semantic projectors

Create renderer-independent projectors for all built-in families. At minimum:

- Flowchart: nodes, shapes, edge endpoints, edge identities, classes, styles;
- State: states, transitions, nesting, classes, comments;
- Sequence: participants, messages, arrow kinds, blocks, activation intervals;
- Class: class IDs, annotations, members, relationships, tooltips;
- ER: entities, attributes, cardinalities, relationship identities;
- Journey and Timeline: ordered sections/periods, events, actors, scores, text;
- Architecture and Mindmap: hierarchy, services/nodes, edges, icon resolution;
- XY, Pie, Quadrant, and Radar: series/points, domains, labels, values, identity,
  configured appearance;
- Gantt: tasks, sections, resolved dates, dependencies, statuses;
- GitGraph: commits, parents, branches, heads, tags, cherry-pick ancestry; and
- Sankey: nodes, links, layers, widths, endpoint paint, and overlap compositing.

Compare local projections with the pinned Mermaid parser/DB where executable,
then verify that the required identities and implications survive Scene/output
lowering.

Upstream parser/DB adapters are offline test and evidence tooling only. They
must never enter production, browser, CLI, or hosted runtime bundles. Each
adapter binds to the declared revision, resets or isolates mutable upstream DB
state per case, and emits a deterministic typed/versioned snapshot consumed by
the receipt.

### 5.5 Runtime projection boundary

Use a two-tier dataflow:

1. case definitions, authored witnesses, upstream adapters, semantic
   expectations, ephemeral raw receipts, and divergence authorities live in
   test/eval-only modules that production code cannot import;
2. `fidelity:check` validates and executes those authorities, then emits a
   compact, versioned aggregate capability index consumed by runtime family
   descriptors, CLI discovery, and public report generators;
3. freshness hashes bind the aggregate to case definitions, the executed result
   summary, public-route registry and adapter versions, projector/oracle/schema
   versions, divergence ledgers, and upstream revision;
   and
4. build metafile, tarball, and bundle negative tests prove that Mermaid oracle
   code, case source, raw receipts, and semantic snapshots do not enter Node,
   browser, CLI, MCP, hosted, or package runtime artifacts.

Runtime surfaces consume the derived index, never the dev-only runner. Public
reports and runtime discovery therefore share one generated result without
shipping the evidence corpus.

### 5.6 Capability and citizenship projection

Replace blanket built-in capability evidence with aggregation over freshly
executed passing receipts. Section A, the syntax capability ledger, citizenship,
CLI discovery, and generated docs must consume the same result.
`fidelity:check` must fail when behavior, a case, a divergence, an authority, or
an upstream revision changes without a matching execution-derived public claim.

## 6. Delivery stacks and work packages

Stacks are encouraged where they keep each review focused. Keep stacks shallow
(normally no more than four open PRs), identify the parent PR in every
description, and ensure every PR is green against its actual target branch.

### A0 — programme governance prerequisite

Land this immediately after the plan and before every implementation or
adoption PR. Only this plan and A0 may use the manual bootstrap in §4.5:

- make canonical trusted CI run for every programme pull-request target branch
  and attest the repository/PR identity, semantic-description digest, exact
  target tip, merge base, head, tested merge result, workflow revision, and
  governance-policy revision;
- protect every temporary programme base with a ruleset or sole merge bot,
  disallow bypass and force-push, and enforce the declared squash strategy;
- evaluate readiness workflows and the path/dependency-to-authority policy from
  a protected target revision or external service, never solely from candidate
  bytes. A governance-changing PR is checked against the union of base and
  candidate policies, receives fixed meta-checks, and activates its new policy
  only after merge;
- add trusted multi-agent runner artifacts, pre-registered round manifests,
  distinct actor/session/run identities, content hashes, and reconciliation of
  failed/timed-out/abandoned runs;
- isolate hostile candidate content from audit authority: dependency acquisition
  uses a vetted cache stage; candidate tests and auditors run without secrets or
  write tokens, without network after acquisition, and with the candidate
  mounted read-only for auditors. A separate narrowly privileged publisher that
  never executes candidate bytes emits audit artifacts/checks. Privileged
  `pull_request_target` checkout or execution of candidate bytes is forbidden;
- extend the PR template and readiness tooling to require one immutable round
  bundle containing the three individual reports, finding ledger, newest check
  identities, and current tuple/tree/diff/semantic-description digests;
- fail readiness when reports are missing, roles are reused, findings remain
  unresolved, runs are unreconciled, or approvals/checks are stale or
  superseded;
- own a versioned path/dependency-to-authority map, derive the complete affected
  authority set from the full diff, fail closed on unknown or ambiguous paths,
  and require the newest trusted/provider-issued result for every derived check
  identity; an exception is valid only as an immutable auditor-approved ledger
  entry;
- from the first behavioral repair, run a trusted exact-head red/green job in a
  detached worktree that applies the content-addressed revert/sabotage, verifies
  the expected red signature, restores the audited tree, and verifies green;
- add the `check:programme-docs` package script; and
- run the final readiness/tuple comparison from §4.3 after the final audit.

The existing CI workflow runs pull requests targeting `main`; without A0, a
child PR targeting its immediate parent can appear reviewable without canonical
CI or an enforceable merge gate against its actual base. Locally recorded or
implementer-authored manual results are not substitutes after bootstrap.

### Stack A — authority and truthful evidence

1. **A1: upstream revision closure**
   - choose the canonical Mermaid 11.16 revision;
   - make all executable artifacts name it or an explicit reviewed
     compatibility revision;
   - generate the exact 16-family scope, explicit out-of-scope envelope,
     construct-complete roster, and many-to-many authority joins from §5.1; and
   - fail generation on unacknowledged splits or roster gaps.
2. **A2: fidelity contract and runner skeleton**
   - add stable `caseId`, discriminated authority references, construct IDs,
     deterministic coverage cells, exact-set indexes for scoped features/
     examples/config keys/theme variables/public routes, route-bound source/
     mutation/build invocations, A/B comparisons, and a small cross-family
     exemplar set;
   - add `fidelity:check` to execute the complete scoped corpus and
     derive the compact index in one process;
   - keep cases, ephemeral raw receipts, snapshots, and upstream adapters behind
     an enforced test/eval-only import boundary;
   - add the deterministic compact-index generator contract and initial bundle
     exclusion tests;
   - do not change public capability claims yet.
3. **A3: semantic projectors for the complete family roster**
   - A3.0 establishes the runner-owned oracle registry and normalized snapshot/
     versioning rules, then lands enough projectors for Phase 0;
   - A3.x family shards complete projectors for all 15 families currently on
     `main`, with exact-set tracking; and
   - the Sankey projector shard depends on C3 enrollment.
4. **A4: receipt-driven reports and citizenship**
   - feed divergences and freshly executed receipts into capability aggregation;
   - generate the compact versioned runtime/report index and bind its freshness
     hash to scope, cases, executed result summary, routes, projectors/oracles/
     schemas, divergences, and upstream revision;
   - make `evidence:check` invoke `fidelity:check`; a hash-only or
     generated-file-only check is insufficient;
   - prove raw evidence and Mermaid oracle code are absent from every shipped
     bundle and tarball;
   - deliberately downgrade every not-yet-receipted claim during migration;
   - classify known defects from actual behavior: `diagnosed` only when the
     public path emits the exact asserted diagnostic, otherwise
     `source-preserved` or `absent` as applicable; and
   - commit and review the expected transitional report state before repairs
     promote individual constructs.

Primary dependency graph:

```text
A0 ───────────────────────────────> every implementation/adoption PR
A1 -> A2 -> A3 -> A4
          |           |-> family repairs + relevant B guardrail/projector
          |           |-> Stack D official-example closure
          |           `-> Stack E config-effect closure
          |-> Stack B parser/seam work where the receipt API is required
          `-> Stack C may start independently from main, but C4 consumes A4
```

Family repairs depend on A4 plus their family projector and relevant guardrail.
Each family shard in Stacks D and E depends on that family's completed projector
as well as the receipt schema and aggregation base. B and generic C
infrastructure may begin earlier where they do not consume those authorities.

### Stack B — parser and seam guardrails

1. **B1: statement-consumption contract** — consume, preserve with an exact
   route-specific typed diagnostic, or reject every nonblank statement.
2. **B2: shared comment/delimiter normalization and agent/native seam** — run
   each fidelity source through both paths and require compatible dispositions.
3. **B3: keyword-boundary and dual-vocabulary checks** — detect prefix regexes
   and unexplained parser vocabulary drift.
4. **B4: shared identity grammar contracts** — reuse declaration/reference/
   mutation ID parsing within each family.

These PRs may stack on A2/A3 where they need the receipt API, but should not wait
for A4's report migration.

### Stack C — typed Scene resources and Sankey

1. **C1: typed local paint resources**
   - introduce a typed resource union with globally unique definition IDs and
     references across marker and paint resources;
   - decide and test the core Scene contract-version migration;
   - explicitly version exposure through External Scene or deliberately reject
     the new resource in the existing external contract;
   - bound snapshot/admission/validation, stop counts, and resource bytes;
   - require every built-in graphical backend to prove the new resource through
     conformance fixtures; and
   - test reference ownership, namespacing, deterministic serialization, local-
     only references, and external-reference rejection.
2. **C2: typed compositing**
   - model compositing as an explicit Scene feature/field independent of paint
     resources, with a bounded blend-mode set and deterministic inheritance/
     defaulting rules;
   - decide and test the core Scene contract-version migration separately from
     C1, including old snapshot and consumer compatibility;
   - explicitly version compositing through External Scene or deliberately
     reject it at that boundary with an exact diagnostic;
   - add backend-specific Scene-to-output conformance fixtures for every
     supported mode rather than inferring compositing from gradient support;
   - update backend capability claims and conformance so unsupported backends
     cannot retain a false native compositing claim; and
   - add explicit terminal loss/projection diagnostics for gradients and
     compositing.
3. **C3: Sankey enrollment** — rebased/narrowed #192 or its replacement,
   with C1 and C2 as hard merge dependencies. The only exception is a C3 that
   rejects or emits exact runtime diagnostics for gradient/compositing and keeps
   every affected capability/report row downgraded.
4. **C4: Sankey receipts and closure** — source-to-target gradient stops,
   multiply overlap, contrast behavior, header consistency, quoted-field
   whitespace identity, and final report state. The identity receipt must prove
   that leading/trailing whitespace inside quoted fields follows the pinned
   Mermaid normalization (currently trim-before-node-identity), or record an
   exact diagnosed divergence; preserving the whitespace while claiming native
   identity is a failure.

If #192 is used as C3, it cannot merge or contribute to any programme claim
until that PR itself passes the complete audit loop on its final tuple. If it
has already merged before A0 can enforce that gate, treat the imported Sankey
diff as quarantined: a dedicated adoption PR must identify and audit the entire
effective imported diff, add the required receipts, and pass the loop before
any later C-stack work or public claim may rely on it. Retrospective inspection
inside an otherwise unrelated C-stack PR is not sufficient.

### Family repair PRs — Phase 0

Create focused child issues and PRs for:

- Sequence half-arrows, semicolon statements, `critical option`, and rect fill;
- State trailing comments and spaced class targets;
- Class annotations, bare dashed relationships, and escaped/backtick IDs;
- ER word-form aliases;
- Timeline `%` comments and unsupported header directions;
- XY Chart unknown-statement rejection; and
- Sankey gradients/compositing, quoted-field whitespace identity, and header
  claim consistency through Stack C.

Each family PR adds the receipt first, proves it discriminates, fixes both agent
and native paths as applicable, and regenerates the affected claim rows.

### Family implication PRs — Phase 1

Follow with focused work for:

- Flowchart edge-class paint and animation implications;
- Class safe tooltips;
- ER multiple-class syntax and stale subgraph diagnostics;
- Gantt config effects, inline task comments, and explicit duration divergence;
- Journey fractional scores;
- Timeline semantic line breaks and mutation-safe clock/URL colons;
- GitGraph float precision, duplicate-ID fence classification, and explicit
  synthetic-ID divergence;
- XY data-label placement, axis rotation, and theme data-label color;
- Pie duplicate-label identity semantics;
- Architecture unresolved registered icons and the bare-header extension;
- Mindmap unresolved host icon-font classes; and
- executable uncertainty receipts for Quadrant and Radar duplicate/lexer edge
  cases.

### Stack D — exhaustive official examples

1. generate one case record for every official fence projected through the
   16-family scope authority;
2. review the complete generated scoped set (331 in the audit baseline) as
   structured, opaque, reject, partial, or config-only; do not use a hard-coded
   count as the authority;
3. enumerate every construct exercised by each fence and join it to the
   construct authority rather than treating the fence as one feature;
4. attach one or more semantic receipts or a named diagnosed compatibility
   divergence;
5. permit `reject` only when pinned Mermaid also rejects the source or the fence
   is proven partial/config-only; otherwise require an executable named
   diagnosed divergence;
6. require exact-set closure for scoped family, construct, feature, example,
   source, semantic-cell, route-conformance, and case indexes, plus explicit dispositions for
   out-of-scope manifest rows, so new, removed, orphaned, or ambiguous entries
   cannot disappear; and
7. keep selected galleries as visual reviewer evidence, not native proof.

Classification may discover new defects. File each as a child of #248 and add
it to the appropriate severity phase; do not weaken the case expectation to
match current behavior.

### Stack E — generated config and theme-effect matrix

For every applicable `(authority path, family ID, input dialect)` semantic cell,
generate exactly one disposition:

- `wired`, with an A/B predicate over typed semantics, geometry, paint, or
  interaction;
- `diagnosed-noop`, with unchanged semantics and an exact warning; or
- `unsupported`, with a named reason and exact warning or rejection on every
  public route that accepts the configuration.

Join the upstream config and `semanticInventory.themeVariables` inventories,
descriptor declarations, runtime resolver/theme reads, docs, and tests. Expand
object-valued or `any` authorities to reviewed leaf paths from the pinned type/
default authority, or explicitly enumerate their nested effect cases; a shallow
`xyChart: any` row cannot hide `dataLabelColor`. Expand shared global paths such
as `primaryColor` across every applicable in-scope family instead of assigning
one arbitrary owner. Route-conformance cases prove unchanged admission and
pass-through for every accepting route; a route-specific transformation adds a
direct A/B case. Every wired disposition references a named A/B invocation pair.
Fail on missing cells or duplicate ownership of the same tuple. Do not create
another hand-maintained config or theme roster.

### Stack F — depth and adversarial quality

After truthful baseline coverage exists:

- add comment/delimiter/whitespace metamorphic laws;
- add duplicate and permutation tests for identity-bearing families;
- add statement-deletion sentinels;
- add config A/B semantic probes;
- sample gradients at source/midpoint/target and overlap;
- add bounded parser/diagnostic sabotage profiles; and
- add controlled upstream visual/geometry comparisons with explicit tolerances
  and divergence IDs.

## 7. Stacked PR operating procedure

Every stacked PR description must include:

| Position | PR | Base | Purpose | Merge dependency |
| --- | --- | --- | --- | --- |

Rules:

1. target the immediate parent branch, not `main`, while the parent is open;
2. keep each diff meaningful when viewed against that parent;
3. do not hide generated artifacts or unrelated refactors in the top stack PR;
4. after a parent merges, rebase or recreate each descendant on the merged
   parent when the parent was squash-merged; retargeting alone is permitted only
   when ancestry was preserved and exact merge-base/diff proof shows that the
   child candidate is unchanged;
5. rerun checks and the full multi-agent audit loop after every rebase;
6. merge from the bottom of the stack upward; and
7. split a stack if reviewers must understand more than one semantic decision
   to approve a PR.

Family repair PRs may proceed in parallel once their required receipt/projector
base is stable. They should not stack on each other merely to avoid updating
`main`.

## 8. Required PR description and evidence

Before audit registration, every implementation PR must freeze these semantic
description sections and include their digest in the candidate tuple:

- child issue and parent epic;
- exact claim being changed;
- upstream witness and revision;
- current incorrect disposition;
- intended semantic result or named divergence;
- focused receipt/test and a reproducible red/green record containing the
  defective base SHA or deterministic sabotage/probe ID, patch/hash, exact
  command, expected failure signature, observed red failure, and green result
  on the audited head, all linked to the required trusted exact-head job rather
  than supplied only as implementer-authored prose;
- mandatory baseline and touched-authority checks, with the newest exact-head
  provider-issued CI job identities and URLs;
- generated artifacts changed and why;
- stack position and dependencies;
- residual limitations.

After dispatch, the round-bundle pointer, finding ledger, round status, and
final tuple live in machine-owned audit comments and immutable artifacts. They
are not appended to or edited into the frozen semantic body.

Visual-output PRs must include proportional before/after evidence generated from
the same named input at immutable base/head revisions. The semantic receipt is
the oracle; the image helps a reviewer inspect the consequence.

## 9. Validation ladder

Run the smallest relevant checks while iterating, then freeze a committed head
and run the mandatory audit baseline. Every implementation PR runs:

```bash
bun run typecheck
bun run lint
bun run test
```

After A2 lands, every implementation PR also runs the `fidelity:check` gate;
focused receipts accelerate iteration but never replace the complete corpus.

A documentation-only PR runs `git diff --check`, repository-path/link
validation for every changed document, and the documentation audit roles from
§4. It need not rerun unchanged runtime behavior unless the document is itself
an executable/generated authority.

Add deterministic checks by touched authority:

| Touched authority | Required additions to the baseline |
| --- | --- |
| Family parser/renderer/projector | Focused fidelity receipt, parser/renderer family tests, red/green record |
| Upstream manifest or authority | `upstream-manifest:check`, upstream bench/corpus checks, revision closure |
| Fidelity scope/routes/cases, Section A/B, citizenship, receipts | `fidelity:check`, `section-a-report:check`, `section-b-report:check`, `quality:check`, `evidence:check` |
| Scene, backend, security, output | Backend conformance, External Scene compatibility, renderer security, affected output/browser checks, `build` |
| Browser family/catalog | `check:browser-families`, browser-lazy checks, affected browser contracts |
| Website/package/transport | Website freshness/payload checks, package build, affected CLI/MCP/transport contracts |
| Official fence, config, or theme matrix | Exact-set corpus/config/theme generator check and every affected named semantic A/B case |
| Governance policy, workflow, readiness, or touched-authority map | Fixed external/protected meta-gate and union of base/candidate required checks |

The audited tuple must have canonical CI or the A0 equivalent against its exact
target base; a green run against `main` cannot substitute for a stacked PR whose
target is a parent branch. A0 defines the required check identities; readiness
accepts only the newest non-superseded provider-issued run for each identity,
including every identity derived from the versioned touched-authority map,
bound to the tested merge tree, semantic-description digest, and protected
workflow/governance-policy revisions. Candidate changes to those policies
cannot weaken their own gate. Unknown or ambiguous paths fail closed; any
exception must be an immutable auditor-approved ledger entry. From the first
behavioral repair onward, the trusted red/green job is a required check and must
run the content-addressed revert or sabotage in a detached worktree against the
exact audited head. A manual command transcript cannot satisfy either gate.

The final programme closure run includes at least:

```bash
bun run typecheck
bun run test
bun run lint
bun run quality:check
bun run evidence:check
bun run upstream-manifest:check
bun run section-a-report:check
bun run section-b-report:check
bun run check:browser-families
bun run build
```

Once A2 lands, the final closure run also includes its `fidelity:check` gate.

Family and browser/output changes add their focused corpus, gallery, browser,
package, and transport checks. Upstream refresh commands must execute against
the exact declared checkout revision and leave committed artifacts reproducible.

## 10. Programme tracking

Create child issues before implementation starts. Each child must name its
work package, acceptance receipt, expected stack/base, and whether it blocks a
public claim. Link child PRs back to #248; do not use PR prose as the only
backlog.

Maintain a checklist on #248 grouped by:

- authority/evidence infrastructure;
- parser and seam guardrails;
- Phase 0 silent-corruption fixes;
- Phase 1 implication/config/interaction fixes;
- official-fence classification;
- config/theme-effect closure;
- per-family projector and receipt closure; and
- depth/hardening and final audit.

The audit artifact remains historical evidence. Current executable receipts
and generated reports become the live authority.

## 11. Closure criteria

Close #248 only when all of the following hold:

- the generated family scope equals the 16 families named by #248 unless the
  issue is explicitly amended, and every unscoped manifest family/row has an
  explicit out-of-scope disposition;
- every officially authorable scoped construct has freshly executed coverage;
- the scoped construct, feature, example, config-key, theme-variable, source,
  public-route, semantic-cell, route-conformance, and case indexes have exact-set
  closure with no orphan or ambiguous ownership;
- every construct × named source × applicable core stage has a semantic
  invocation and oracle/diagnostic, and every public route × accepted input ×
  operation/selector/output contract has conformance evidence or an evidenced
  `not-applicable` disposition; route-specific branches also have direct
  affected-construct cases; missing, unknown, duplicate, and orphaned cells are
  zero;
- every scoped official fence has a reviewed disposition;
- every nonblank statement is modeled, preserved with an exact route-specific
  typed runtime diagnostic, or rejected; no silent semantic preservation can
  satisfy closure;
- every applicable agent-native claim has a passing structured agent oracle;
  an opaque agent outcome remains capped at `source-preserved` even if native
  rendering succeeds;
- agent parse, verification, native render, serialization, mutation, Scene,
  applicable output, accessibility, and interaction behavior agree with the
  case policy;
- every applicable public mutation/build route is exercised through that real
  route; a native cell has a discriminating result oracle and preservation
  oracles, while unsupported operations are exactly diagnosed or evidenced
  not-applicable;
- every applicable `(config/theme authority, family, input dialect)` semantic
  cell has exactly one executable effect disposition, with every wired effect
  joined to a named A/B comparison, and each accepting route passes its
  conformance or route-specific A/B case;
- capability and citizenship reports derive in the same `fidelity:check` run
  from passing receipts and downgrade divergences automatically;
- every enrolled family has a complete, versioned semantic projector and every
  shipped runtime/report claim comes from the compact aggregate index; cases,
  Mermaid oracles, ephemeral raw receipts, and snapshots are absent from runtime,
  browser, CLI, MCP, hosted, and package artifacts;
- all upstream oracle revisions are closed and reproducible;
- every Phase 0 defect is fixed or truthfully downgraded with a discriminating
  regression receipt;
- Sankey receipts observe endpoint stops and overlap compositing, not merely a
  changed stroke byte, and prove pinned trim-before-identity behavior for
  leading/trailing whitespace in quoted fields or an exact diagnosed
  divergence;
- generated authorities have no unexplained drift;
- the full validation ladder passes; and
- a final cross-programme multi-agent audit of the closure head returns
  unanimous `APPROVE` with no actionable findings.

## 12. Governance risks and ownership

A0 has one named maintainer owner and is itself a merge prerequisite, not an
optional reporting enhancement. Repository rules or the sole merge bot must
prevent a privileged bypass from merging a programme PR without exact-base CI,
complete audit artifacts, and final readiness. Any emergency bypass is a
programme stop: quarantine the resulting diff and use the adoption procedure
defined for #192 before relying on it.

Multi-agent review reduces blind spots but does not prove independence when all
auditors use correlated models, prompts, or training data. The trusted runner
must preserve prompt/scope hashes and actor/session/run identities, rotate or
diversify audit implementations where available, and record correlated-model
risk in the final residual-risk report. Human maintainer verification remains
mandatory for the manual bootstrap and final programme closure.

## 13. Strengths to preserve

Do not weaken the repository's existing deterministic layout/output contracts,
typed registry enrollment, role/primitive Scene admission, opaque source
preservation, canonical serialization, source maps, mutation surfaces, strict
output security, or property-based geometry tests. The fidelity layer joins
these strengths to construct-level semantic evidence; it does not replace them.
