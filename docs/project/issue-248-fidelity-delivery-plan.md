# Delivery plan for issue #248

Status: proposed.

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
5. Start from `main`. Most work does not depend on PR #192; only Sankey-specific
   work and final Sankey closure do.
6. Use the repository's normal CI and review process. This programme does not
   require custom audit manifests, locked evidence branches, mandatory agent
   counts, or a separate maintainer-witness ceremony.

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

interface FidelityCase {
  id: string
  family: string
  feature: string
  source: string
  upstreamReference: string
  expected: Partial<Record<FidelitySurface, FidelityDisposition>>
  expectedDiagnostics?: string[]
  assertSemantics?: (result: unknown) => void
}
```

Each case should contain the smallest source that demonstrates one meaningful
claim. Semantic assertions should inspect normalized family data—participants,
edges, dates, cardinalities, labels, paint stops, or similar domain meaning—not
just non-empty output or changed SVG bytes.

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

Mutation tests follow the same rule: directly test each advertised operation
that changes a construct, and separately assert that unrelated meaning survives.

## Runner and capability reporting

The first implementation PR should add one command that:

1. discovers the checked-in case registry;
2. rejects duplicate or unknown case and feature IDs;
3. runs the applicable semantic assertions and diagnostics;
4. emits a machine-readable result;
5. derives the compact capability summary consumed by existing reports; and
6. fails if a claimed native feature has no passing case.

The generated result must be freshness-bound to its cases and projector code so
stale output cannot be published accidentally. Existing capability and
citizenship reports should consume this result instead of inferring semantics
from file presence, family enrollment, or one smoke fixture.

## Delivery sequence

### 1. Foundation

Land the case type, registry, runner, result format, and capability projection.
Prove the design with a few existing high-signal failures rather than trying to
cover every family in the first PR.

Good initial cases include one silent statement loss, one parser/render seam,
one appearance implication, and one accurately diagnosed unsupported behavior.

### 2. Silent corruption and identity

Fix the highest-risk findings first, in small family-focused PRs:

- Sequence token and statement splitting;
- State trailing comments and class targets;
- Class relationships, annotations, and escaped identities;
- ER word aliases;
- Timeline comments and direction handling; and
- XY Chart unknown-statement handling.

Each fix adds a discriminating case that fails when the fix is reverted.

### 3. Remaining semantic implications

Address the confirmed style, configuration, mutation, and identity findings in
Flowchart, Gantt, Journey, Pie, icons, and the remaining family seams. Split
shared parser or identity work from family-specific rendering work when that
keeps review smaller.

### 4. Scene resources and Sankey

Land generic typed local gradients and compositing from `main`. These resources
must remain deterministic and must not introduce external references.

Then rebase and narrow PR #192, or replace it with a smaller Sankey enrollment
PR. Add Sankey semantic cases only after the family implementation is available.
Sankey closure must prove endpoint gradient stops, overlap compositing, header
handling, and node identity—not merely a changed stroke color.

### 5. Completeness

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
- visual evidence only when pixels are part of the claim.

Run the normal repository CI. Additional independent review is welcome for
cross-family or security-sensitive changes, but it is not a bespoke release
protocol.

## Dependency on PR #192

Do not base the general evidence work or non-Sankey fixes on PR #192.

The following can proceed directly from `main`:

- the case registry and runner;
- capability projection;
- parser and agent/render seam fixes;
- non-Sankey family fixes;
- official-example and configuration classification; and
- generic local Scene resources.

Only Sankey enrollment, Sankey receipts, and final all-family closure wait for a
rebased/narrowed #192 or a replacement Sankey PR.

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
- the upstream revision used by cases is pinned and reproducible.

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
