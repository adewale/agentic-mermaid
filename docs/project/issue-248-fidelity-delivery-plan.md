# Delivery plan for issue #248

Status: in progress.

This document turns [issue #248](https://github.com/adewale/agentic-mermaid/issues/248)
into an implementation sequence. The issue remains the source of truth for the
audit findings, reproductions, and upstream evidence. This plan deliberately
does not repeat that material.

## The problem

Agentic Mermaid has strong tests for family enrollment, deterministic output,
source preservation, and basic rendering. Those tests do not prove that every
Mermaid construct keeps its authored meaning.

Issue #248 found examples that parse or render successfully while losing
topology, identity, style, configuration, interaction, or paint. A family can
therefore look fully supported even when a specific construct is silently
changed or dropped.

We need one missing layer: small executable cases that prove the semantics of
individual constructs and feed the public capability report.

## Decisions

1. Treat #248 as a tracking epic, not one large implementation PR.
2. Add a small construct-level case registry and runner before fixing every
   family independently.
3. Test construct semantics once through the canonical family implementation.
   Test public routes separately for transport and diagnostic consistency.
4. Generate capability claims from passing cases. Do not maintain another
   handwritten support ledger.
5. Start every independent implementation from current `main`. PR #192 has
   landed, so no remaining work is blocked on it.
6. Require every PR in this programme to complete the audit loop below before
   merge. The loop supplements normal repository CI; it does not replace it.

## Current state

As of 2026-09-24:

- PR #192 has landed Sankey enrollment, typed local gradients, endpoint-stop
  evidence, Mermaid-compatible multiply compositing on light or unresolved
  backgrounds, and a deliberate normal-alpha divergence on concrete dark
  backgrounds where multiply would erase ribbon visibility. The shared
  construct receipts still need to exercise both compositing paths and make the
  divergence visible to capability reporting.
- PR #220 has consolidated XYChart agent parsing onto the strict renderer
  parser and preserves unsupported syntax opaquely. Final cross-surface
  disposition and receipt coverage remain open.
- PR #267 has landed shrinkable Flowchart mutation and whitespace-preservation
  coverage. It is one family slice, not the programme-wide metamorphic law.
- PR #252 was reverted by PR #255 and contributes no current evidence.
- The executable construct-receipt registry, shared runner, revision-closure
  gate, receipt-derived capability projection, official-fence classification,
  and config-effect matrix have not landed.

## What the evidence must prove

For every scoped construct, a case must answer three questions:

1. What can a Mermaid author write?
2. What meaning should survive?
3. What does each applicable Agentic Mermaid surface actually do?

A public claim uses one of four outcomes:

- `native`: the applicable structured semantic assertion passes;
- `source-preserved`: source survives, but native semantics are not claimed;
- `diagnosed`: the public route returns the expected unsupported or divergent
  diagnostic;
- `absent`: there is no supported or accurately diagnosed behavior.

Unknown and untested cases are `absent`. Opaque source preservation is useful,
but it cannot contribute to a `native` claim.

Every nonblank statement must be modeled, preserved with an accurate public
diagnostic, or rejected. A plausible partial diagram after silently dropping a
statement is always a bug.

## Minimal case model

Keep the test-only case definition small. Add fields only when a real finding
needs them.

```ts
type FidelityDisposition = 'native' | 'source-preserved' | 'diagnosed' | 'absent'
type FidelitySurface = 'agent' | 'render' | 'serialize' | 'mutate'

interface FidelityDiagnosticExpectation {
  surface: FidelitySurface
  code: string
}

interface FidelityCase {
  id: string
  family: string
  feature: string
  source: string
  upstreamReference: string
  expected: Partial<Record<FidelitySurface, FidelityDisposition>>
  expectedDiagnostics?: FidelityDiagnosticExpectation[]
  assertSemantics?: (result: unknown) => void
}
```

Each case should contain the smallest source that demonstrates one meaningful
claim. Semantic assertions should inspect normalized family data—participants,
edges, dates, cardinalities, labels, paint stops, or similar domain meaning—not
just non-empty output or changed SVG bytes.

An omitted surface is one where the construct genuinely does not apply. If an
earlier failure prevents an applicable later surface from running, the runner
must record that surface as blocked by the failing stage; it must not silently
turn it into an omission or `not-applicable` result. Match expected diagnostics
by their stable code and surface rather than by free-form message text.

Where pinned Mermaid exposes a stable parser or database, compare normalized
local and upstream meaning. Where it does not, use the official syntax reference
plus a focused local semantic assertion. Do not build a second Mermaid
implementation merely to test the first.

Cases, upstream adapters, and raw results stay in tests. Production code only
needs a compact generated capability summary.

## Avoiding a construct-by-route test explosion

Use two layers:

### Construct cases

Run each construct through the canonical family parser, model, serializer, and
renderer stages that matter to its claim. These cases prove the semantics.

### Route conformance

Use a small shared suite to prove that CLI, SDK, MCP, editor, website, and output
adapters pass source and options to the same core behavior and preserve its
result or diagnostics.

A route needs a direct construct case only when it transforms the input or
result in a way that can change meaning. Simple pass-through routes should not
duplicate every family case.

Route conformance should assert typed request and result equivalence at the
adapter boundary: the same source and options reach the core, and the adapter
preserves the resulting disposition, semantics, and diagnostics. Do not infer
conformance merely from the absence of route-specific branches or from a small
fixture count.

Mutation tests follow the same rule: directly test each advertised operation
that changes a construct, and separately assert that unrelated meaning survives.

## Runner and capability reporting

The first implementation PR should add one command that:

1. discovers the checked-in case registry;
2. rejects duplicate or unknown case and feature IDs;
3. runs the applicable semantic assertions and diagnostics;
4. emits a machine-readable result;
5. binds the result to the pinned upstream revision and fails any unacknowledged
   revision split; and
6. derives a shadow capability summary for comparison with existing reports.

The generated result must be freshness-bound to its cases and projector code so
stale output cannot be published accidentally. This first PR must not switch
public claims while it contains only a few seed cases.

After landed behavior has been adopted into receipts, a separate cutover PR
should make existing capability and citizenship reports consume the generated
result instead of inferring semantics from file presence, family enrollment, or
one smoke fixture. That PR must fail if a claimed native feature has no passing
case; unreceipted claims must become `absent`, not retain their earlier state.

## Delivery sequence

### 1. Receipt foundation

Land the case type, registry, runner, result format, pinned-revision closure,
freshness binding, and a shadow capability projection. Prove the design with a
few existing high-signal failures rather than trying to cover every family in
the first PR. Do not change public capability claims in this PR.

Good initial cases include one silent statement loss, one parser/render seam,
one appearance implication, and one accurately diagnosed unsupported behavior.

### 2. Adopt landed behavior

Add retrospective receipts for the behavior already landed by PRs #192, #220,
and #267. Include the known divergence dispositions that affect those cases.
This validates native paint, source-preserved or diagnosed syntax, and mutation
semantics before new family fixes depend on the runner. The Sankey receipts must
exercise multiply compositing on light or unresolved backgrounds and the
documented normal-alpha divergence on concrete dark backgrounds separately.
Because PRs #192, #220, and #267 predate this mandatory audit policy, the
audited adoption PR is their retrospective programme reconciliation record; it
does not attempt to manufacture per-PR approvals for already-merged trees.

### 3. Cut public claims over to receipts

Make capability and citizenship reports consume the receipt-derived summary.
Add the shared route-conformance checks and fail closed: any native claim without
a current passing receipt becomes `absent`. Keep this cutover separate from the
runner and retrospective-adoption PRs so its public reporting impact is explicit
and reviewable.

### 4. Silent corruption and identity

Fix the highest-risk findings first, in small family-focused PRs:

- Sequence token and statement splitting;
- State trailing comments and class targets;
- Class relationships, annotations, and escaped identities;
- ER word aliases;
- Timeline comments and direction handling; and
- XY Chart unknown-statement handling.

Each fix adds a discriminating case that fails when the fix is reverted.

### 5. Remaining semantic implications

Address the confirmed style, configuration, mutation, and identity findings in
Flowchart, Gantt, Journey, Pie, icons, and the remaining family seams. Split
shared parser or identity work from family-specific rendering work when that
keeps review smaller.

### 6. Completeness

After the confirmed defects are covered:

- classify every harvested official example as native, source-preserved,
  diagnosed, or intentionally out of scope;
- classify every pinned configuration key as effective, diagnosed no-op, or
  unsupported;
- close any remaining parser/agent/render disagreements; and
- make the generated capability report the only source of public native claims.

## PR boundaries and evidence

Keep implementation PRs narrow: one family, one shared parser seam, or one
clearly related infrastructure change.

Every implementation PR should include:

- the #248 finding or child issue it addresses;
- the focused case that proves the behavior;
- confirmation that the case fails when the fix is removed, where practical;
- the relevant family and route tests;
- regenerated capability output when the public claim changes; and
- visual evidence only when pixels are part of the claim. For newly supported
  output, preserve the real prior error or unsupported state as the baseline;
  never manufacture a successful "before" render.

Run the normal repository CI and the following audit loop for every PR,
including documentation, infrastructure, adoption, and closure PRs:

1. Complete the scoped implementation and its focused evidence.
2. Assign at least one distinct review agent, independent of the implementation
   author for that round, to each required lane: semantic/upstream correctness,
   architecture and scope, and test strength/sabotage coverage. Add a distinct
   security auditor whenever the change touches trust boundaries, external
   resources, parsing limits, or output safety.
3. Resolve every finding. Either fix it and have the reporting lane recheck the
   result, or have that auditor explicitly accept it as informational or not
   actionable with a recorded rationale. No unresolved objection may remain.
4. Rebase onto the current parent and rerun affected checks and normal CI.
5. Run the final independent audit round against that exact merge candidate.
   Each lane must approve the exact head SHA and parent or merge-base SHA with no
   unresolved objection.
6. If any audit round, including the final round, reports a finding, return to
   finding resolution, rebase and rerun checks as applicable, and then run a new
   complete final audit round. Repeat until every lane approves.
7. If the head tree, dependency versions, parent, merge base, or conflict
   resolution changes after approval, rerun affected tests and every audit lane
   against the new head and parent or merge-base tuple. Merge only when CI and
   the complete final audit round are clean for the current candidate.

Keep a durable record in the PR discussion identifying each audit round, the
head and parent or merge-base SHAs, the distinct auditor for each lane, all
findings and their dispositions or fixing commits, relevant test results, and
each lane's final clean declaration. Expiring check artifacts may supplement
but must not replace this record. The record is review evidence, not production
runtime machinery.

## Dependency on PR #192

PR #192 has landed. Every independent lane starts from current `main`,
including:

- the case registry and runner;
- capability projection;
- parser and agent/render seam fixes;
- non-Sankey family fixes;
- official-example and configuration classification;
- Sankey adoption receipts and final all-family closure; and
- any follow-up corrections exposed by those receipts.

Genuinely dependent work may target the smallest parent PR rather than waiting
for `main`. After that parent lands, rebase the child onto current `main` and run
the final audit against the resulting merge candidate.

## Completion criteria

Issue #248 is complete when:

- every confirmed finding has a passing regression case or an explicit public
  downgrade;
- every officially authorable construct in the scoped built-ins has a reviewed
  case or disposition;
- no parser silently drops a nonblank statement;
- applicable agent, parser, serializer, mutation, render, and output behavior
  agree with each case's disposition;
- every harvested official example has a reviewed disposition;
- every pinned configuration key is effective, diagnosed no-op, or unsupported;
- public capability reports are generated from current passing cases; and
- the upstream revision used by cases is pinned and reproducible; and
- every programme PR opened after this policy lands and the final closure
  candidate have a durable, clean multi-agent audit record for the exact landed
  or proposed tree; and
- the audited adoption PR provides the retrospective reconciliation record for
  pre-policy PRs #192, #220, and #267.

## Risks

- **Overengineering:** keep the case schema and runner small; add machinery only
  for a reproduced failure.
- **Brittle upstream comparisons:** normalize domain meaning and pin the upstream
  revision instead of comparing unstable SVG bytes.
- **Parser drift:** prefer shared tokenization where practical and keep seam
  cases where separate parsers remain.
- **Large generated diffs:** isolate generated capability changes from unrelated
  family fixes.
- **Sankey coupling:** keep generic Scene work and all non-Sankey fixes independent
  of the enrollment PR.

The aim is straightforward: make public support claims follow executable
construct semantics, then fix the known gaps in reviewable pieces.
