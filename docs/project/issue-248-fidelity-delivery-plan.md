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
- expected agent disposition: `structured`, `opaque`, or `reject`;
- expected render disposition: `native`, `diagnosed`, or `reject`;
- normalized semantic expectation;
- exact expected diagnostics;
- applicable serialization, mutation, layout, Scene, SVG, terminal,
  interaction, configuration, and accessibility implications; and
- a named divergence ID when local behavior intentionally differs.

### 3.2 No silent statement loss

Every nonblank, non-comment family statement must be modeled, preserved with a
typed reason, or rejected with a named error. A parser must never return a
visually plausible partial diagram after silently skipping an authored
statement.

### 3.3 Fail-closed public claims

Receipt aggregation uses the following policy:

- `native`: every applicable receipt required by the claim passes;
- `source-preserved`: source survives but native semantics are not established;
- `diagnosed`: a named unsupported or divergent behavior is surfaced exactly;
- `not-applicable`: the upstream behavior genuinely cannot apply to authored
  source or the output surface; and
- `absent`: there is neither implementation nor an honest supported envelope.

Unknown, uncovered, opaque-only, and divergent cases cannot contribute to a
family-wide native claim. `diagnosed` is valid only when the actual public path
emits the exact asserted runtime diagnostic. A divergence-ledger entry alone
cannot manufacture diagnosed behavior. Silent loss remains `source-preserved`
or `absent`, as applicable, until a runtime diagnostic or native fix lands.
Divergence ledgers are inputs to aggregation, not parallel documentation.

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
4. Record the exact target branch, target-tip SHA, merge-base SHA, head SHA, and
   intended merge strategy. This tuple identifies the effective candidate.
5. Freeze implementation work while the auditors inspect that tuple.

### 4.2 Run at least three independent agent audits

Use one distinct, read-only agent/session per role in independent contexts.
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

### 4.3 Fix, retest, and audit again

1. Preserve each auditor's first report verbatim, then consolidate the findings
   without weakening them by majority vote.
2. Fix every actionable finding. A scope suggestion may be rejected only with a
   written explanation showing that it is not a defect in the PR's claim or
   acceptance criteria.
3. Rerun focused and affected wider checks.
4. Start a new independent audit round against the new candidate tuple.
5. Repeat until every auditor returns `APPROVE` with no actionable findings.

Any change to the head SHA, target-tip SHA, merge-base SHA, target branch, or
intended merge strategy invalidates checks and approval and requires another
round. This includes target-branch advancement, retargeting, parent-PR merge,
and rebasing even when the child head tree appears unchanged. Immediately
before merge, compare the current tuple with the final audit record and fail
closed on any difference.

### 4.4 Preserve audit evidence in the PR

The PR conversation must preserve each individual first report verbatim or by
an immutable link and identify the distinct session/role that produced it. It
must also contain an audit table with:

| Round | Target | Target tip | Merge base | Head | Strategy | Individual reports | Result |
| --- | --- | --- | --- | --- | --- | --- | --- |

Maintain a persistent finding ledger with:

| Finding ID | Originating auditor | Severity | Disposition | Correction commit or rejection rationale | Validating round |
| --- | --- | --- | --- | --- | --- |

Post one consolidated audit comment per round in addition to the individual
reports. The final row must identify the audited tuple and show approval from
every role with no unresolved finding. Reviewers must be able to trace a
finding to its correction without accessing an ephemeral agent transcript.
Readiness automation added by A0 must reject a missing report, reused role,
unresolved finding, or approval bound to a stale tuple; implementer-authored
summary text alone is not audit evidence.

## 5. Evidence architecture

### 5.1 Construct authority and exact-set joins

The current syntax-feature inventory is derived largely from documentation
headings; it is not by itself a construct-complete grammar authority. A1 must
establish a stable construct roster from the pinned grammar/spec blocks,
official fences, and config authority, with reviewed many-to-many mappings to
documentation headings and existing manifest coordinates.

Exact-set validation must prove:

- every pinned built-in construct maps to at least one fidelity case;
- every case maps back to one or more stable construct IDs;
- every manifest `syntaxFeature`, official `example`, and `configKey` appears in
  its own typed index;
- every construct exercised by an official fence is enumerated rather than
  treating the fence as one atomic feature;
- multiple witnesses may exercise the same construct without inventing new
  feature IDs; and
- orphan constructs, orphan cases, stale authorities, and ambiguous ownership
  fail generation.

### 5.2 `FamilyFidelityContract`

Add a typed registry beside the built-in family descriptors, projected from the
construct authority and existing upstream manifest rather than maintained as a
second roster. The conceptual core is:

```ts
type FidelityAuthorityRef =
  | { kind: 'feature'; id: string }
  | { kind: 'example'; id: string }
  | { kind: 'config-key'; id: string }

type SurfaceApplicability =
  | { state: 'applicable' }
  | { state: 'not-applicable'; reasonCode: string; upstreamEvidence: string[] }

type FidelityExpectation =
  | {
      renderDisposition: 'native'
      semanticSnapshot: FamilySemanticSnapshot
      expectedDiagnostics: readonly string[]
    }
  | {
      renderDisposition: 'diagnosed' | 'reject'
      semanticSnapshot?: FamilySemanticSnapshot
      expectedDiagnostics: readonly [string, ...string[]]
    }

interface FamilyFidelityCase {
  caseId: string
  familyId: string
  constructIds: readonly [string, ...string[]]
  authority: FidelityAuthorityRef
  upstreamRevision: string
  source: string
  expectedAgentDisposition: 'structured' | 'opaque' | 'reject'
  expectation: FidelityExpectation
  surfaces: Record<FidelitySurface, SurfaceApplicability>
  divergenceId?: string
}
```

`FamilySemanticSnapshot` must be a versioned, family-discriminated union rather
than `unknown`. Schema validation must reject a native case without a semantic
snapshot, a diagnosed/rejected case without an exact diagnostic, and any
`not-applicable` surface without a typed reason and upstream evidence. Keep
expectations deterministic; do not encode arbitrary executable callbacks in
generated JSON authorities.

Pinned Mermaid rejecting the source is the only ordinary basis for local
`reject`. An official fence may also be rejected when it is proven partial or
config-only. If pinned Mermaid accepts a complete fence, local rejection must
be an executable named diagnosed compatibility divergence.

### 5.3 Receipt runner

The runner executes the same source through:

```text
detection
  -> agent parse/body
  -> verification
  -> native parser and layout
  -> normalized family semantic projection
  -> Scene and output implication
  -> canonical serialize/reparse
  -> declared mutation round trip
```

It records disposition and semantic results, not just thrown/not-thrown status.
Opaque agent success paired with native render failure must be an explicit
diagnosed policy rather than `verify.ok === true` under an unqualified native
claim.

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

### 5.5 Capability and citizenship projection

Replace blanket built-in capability evidence with aggregation over passing
receipts. Section A, the syntax capability ledger, citizenship, CLI discovery,
and generated docs must consume the same result. A report freshness check must
fail when behavior, a receipt, a divergence, or an upstream revision changes
without regenerating the public claims.

## 6. Delivery stacks and work packages

Stacks are encouraged where they keep each review focused. Keep stacks shallow
(normally no more than four open PRs), identify the parent PR in every
description, and ensure every PR is green against its actual target branch.

### A0 — programme governance prerequisite

Land this before opening non-`main`-targeted implementation stacks:

- make canonical CI run for every pull-request target branch, or provide an
  equivalent required reusable/manual workflow bound to the exact target-tip,
  merge-base, and head tuple;
- extend the PR template and readiness tooling to require three distinct
  individual audit reports, the finding ledger, and the current tuple;
- fail readiness when reports are missing, roles are reused, findings remain
  unresolved, or approvals/checks are stale; and
- add the pre-merge tuple comparison required by §4.3.

The existing CI workflow runs pull requests targeting `main`; without A0, a
child PR targeting its immediate parent can appear reviewable without a
canonical CI result against its actual base.

### Stack A — authority and truthful evidence

1. **A1: upstream revision closure**
   - choose the canonical Mermaid 11.16 revision;
   - make all executable artifacts name it or an explicit reviewed
     compatibility revision;
   - establish the construct-complete roster and many-to-many authority joins
     from §5.1; and
   - fail generation on unacknowledged splits or roster gaps.
2. **A2: fidelity contract and runner skeleton**
   - add stable `caseId`, discriminated authority references, construct IDs,
     deterministic receipt schema, exact-set indexes for features/examples/
     config keys, and a small cross-family exemplar set;
   - do not change public capability claims yet.
3. **A3: semantic projector API and initial projectors**
   - establish normalized snapshot/versioning rules;
   - land enough projectors to exercise the Phase 0 defects.
4. **A4: receipt-driven reports and citizenship**
   - feed divergences and receipts into capability aggregation;
   - deliberately downgrade every not-yet-receipted claim during migration;
   - classify known defects from actual behavior: `diagnosed` only when the
     public path emits the exact asserted diagnostic, otherwise
     `source-preserved` or `absent` as applicable; and
   - commit and review the expected transitional report state before repairs
     promote individual constructs.

Primary dependency graph:

```text
A0 ───────────────────────────────> every stacked implementation PR
A1 -> A2 -> A3 -> A4
          |           |-> family repairs + relevant B guardrail/projector
          |           |-> Stack D official-example closure
          |           `-> Stack E config-effect closure
          |-> Stack B parser/seam work where the receipt API is required
          `-> Stack C may start independently from main, but C4 consumes A4
```

Family repairs depend on A4 plus their family projector and relevant guardrail.
Stacks D and E depend on the receipt schema and aggregation base. B and generic
C infrastructure may begin earlier where they do not consume those authorities.

### Stack B — parser and seam guardrails

1. **B1: statement-consumption contract** — consume, typed-preserve, or reject
   every nonblank statement.
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
   - add the bounded blend-mode behavior required for upstream Sankey overlap;
   - update backend capability claims and conformance so unsupported backends
     cannot retain a false native resource claim; and
   - add explicit terminal loss/projection diagnostics for gradients and
     compositing.
3. **C3: Sankey enrollment** — rebased/narrowed #192 or its replacement,
   with C1 and C2 as hard merge dependencies. The only exception is a C3 that
   rejects or emits exact runtime diagnostics for gradient/compositing and keeps
   every affected capability/report row downgraded.
4. **C4: Sankey receipts and closure** — source-to-target gradient stops,
   multiply overlap, contrast behavior, header consistency, and final report
   state.

If #192 is used as C3, that PR itself must pass the complete audit loop after
its final rebase. If it merges before this programme can audit it, the first
C-stack PR must audit the imported Sankey implementation against its effective
merged base before relying on it.

### Family repair PRs — Phase 0

Create focused child issues and PRs for:

- Sequence half-arrows, semicolon statements, `critical option`, and rect fill;
- State trailing comments and spaced class targets;
- Class annotations, bare dashed relationships, and escaped/backtick IDs;
- ER word-form aliases;
- Timeline `%` comments and unsupported header directions;
- XY Chart unknown-statement rejection; and
- Sankey gradients/compositing and header claim consistency through Stack C.

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

1. generate one case record for every harvested official fence;
2. review all 331 audited fences as structured, opaque, reject, partial, or
   config-only;
3. enumerate every construct exercised by each fence and join it to the
   construct authority rather than treating the fence as one feature;
4. attach one or more semantic receipts or a named diagnosed compatibility
   divergence;
5. permit `reject` only when pinned Mermaid also rejects the source or the fence
   is proven partial/config-only; otherwise require an executable named
   diagnosed divergence;
6. require exact-set closure for construct, feature, example, and case indexes
   so new, removed, orphaned, or multiply ambiguous entries cannot disappear;
   and
7. keep selected galleries as visual reviewer evidence, not native proof.

Classification may discover new defects. File each as a child of #248 and add
it to the appropriate severity phase; do not weaken the case expectation to
match current behavior.

### Stack E — generated config-effect matrix

For every pinned built-in-family config key, generate exactly one disposition:

- `wired`, with an A/B predicate over typed semantics, geometry, paint, or
  interaction;
- `diagnosed-noop`, with unchanged semantics and an exact warning; or
- `unsupported`, with a named reason.

Join the upstream config inventory, descriptor declarations, runtime resolver
reads, docs, and tests. Fail on missing or multiply owned keys. Do not create a
third hand-maintained config roster.

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
4. after a parent merges, rebase or retarget descendants promptly;
5. rerun checks and the full multi-agent audit loop after every rebase;
6. merge from the bottom of the stack upward; and
7. split a stack if reviewers must understand more than one semantic decision
   to approve a PR.

Family repair PRs may proceed in parallel once their required receipt/projector
base is stable. They should not stack on each other merely to avoid updating
`main`.

## 8. Required PR description and evidence

Every implementation PR must state:

- child issue and parent epic;
- exact claim being changed;
- upstream witness and revision;
- current incorrect disposition;
- intended semantic result or named divergence;
- focused receipt/test and a reproducible red/green record containing the
  defective base SHA or deterministic sabotage/probe ID, patch/hash, exact
  command, expected failure signature, observed red failure, and green result
  on the audited head;
- mandatory baseline and touched-authority checks, with exact-head CI job URLs
  or command/result records;
- generated artifacts changed and why;
- stack position and dependencies;
- individual audit reports, finding ledger, rounds, and final audited tuple; and
- residual limitations.

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

A documentation-only PR runs `git diff --check`, repository-path/link
validation for every changed document, and the documentation audit roles from
§4. It need not rerun unchanged runtime behavior unless the document is itself
an executable/generated authority.

Add deterministic checks by touched authority:

| Touched authority | Required additions to the baseline |
| --- | --- |
| Family parser/renderer/projector | Focused fidelity receipt, parser/renderer family tests, red/green record |
| Upstream manifest or authority | `upstream-manifest:check`, upstream bench/corpus checks, revision closure |
| Section A/B, citizenship, receipts | `section-a-report:check`, `section-b-report:check`, `quality:check`, `evidence:check` |
| Scene, backend, security, output | Backend conformance, External Scene compatibility, renderer security, affected output/browser checks, `build` |
| Browser family/catalog | `check:browser-families`, browser-lazy checks, affected browser contracts |
| Website/package/transport | Website freshness/payload checks, package build, affected CLI/MCP/transport contracts |
| Official fence or config matrix | Exact-set corpus/config generator check and every affected semantic A/B case |

The audited tuple must have canonical CI or the A0 equivalent against its exact
target base; a green run against `main` cannot substitute for a stacked PR whose
target is a parent branch.

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
- config-effect closure;
- per-family projector and receipt closure; and
- depth/hardening and final audit.

The audit artifact remains historical evidence. Current executable receipts
and generated reports become the live authority.

## 11. Closure criteria

Close #248 only when all of the following hold:

- every officially authorable construct for every claimed built-in family has
  an executed receipt;
- the construct, feature, example, config-key, and case indexes have exact-set
  closure with no orphan or ambiguous ownership;
- every official fence has a reviewed disposition;
- every nonblank statement is modeled, typed-preserved, or rejected;
- agent parse, verification, native render, serialization, mutation, Scene,
  applicable output, accessibility, and interaction behavior agree with the
  case policy;
- every config key has exactly one executable effect disposition;
- capability and citizenship reports derive from passing receipts and
  downgrade divergences automatically;
- all upstream oracle revisions are closed and reproducible;
- every Phase 0 defect is fixed or truthfully downgraded with a discriminating
  regression receipt;
- Sankey receipts observe endpoint stops and overlap compositing, not merely a
  changed stroke byte;
- generated authorities have no unexplained drift;
- the full validation ladder passes; and
- a final cross-programme multi-agent audit of the closure head returns
  unanimous `APPROVE` with no actionable findings.

## 12. Strengths to preserve

Do not weaken the repository's existing deterministic layout/output contracts,
typed registry enrollment, role/primitive Scene admission, opaque source
preservation, canonical serialization, source maps, mutation surfaces, strict
output security, or property-based geometry tests. The fidelity layer joins
these strengths to construct-level semantic evidence; it does not replace them.
