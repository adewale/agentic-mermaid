# Native C4 implementation

Implementation baseline: `a87ec8612c3df98a5b9e8f52ac0e35814b02c523`
(17 October 2026). This work implements the contract requested for #387;
it does not reopen the retired fidelity programme.

Initial focused validation on 18 October 2026 passed the
native/official-example/citizenship and all-style C4 checks, both typechecks,
lint, browser and package builds, lazy payload budgets, website regeneration
and ESM package validation. Independent review rechecked 20 SVGs, 35 routed
connectors and 35 complete label rectangles after the final allocation and
halo-clearance refinements, including 100 label/card comparisons.
These are bounded witnesses, not a universal layout guarantee or a deployment.
[PR #411](https://github.com/adewale/agentic-mermaid/pull/411) records the
combined-head validation and independent review after the Pele comparison.

## Contract

Support Mermaid 11.16's five legacy dialects (`C4Context`, `C4Container`,
`C4Component`, `C4Dynamic`, `C4Deployment`) as one native family. Preserve
element kind, external/database/queue distinctions, technology, description,
nested boundaries, deployment nodes, directed/reversed/bidirectional relations,
and each repeated interaction. An interaction's source identity is distinct
from its endpoint pair and displayed dynamic index.

One family-owned parsed model and collision-safe identity plan feed both
projections. Prepared display content is shared; graphical pixels and terminal
cells retain their existing layout/routing owners. Terminal output contains
connected relationships and owned geometry, rather than a detached relation
list. C4 remains recognizable without color.

Typed operations must close through serialization/reparsing without changing
meaning. Unknown syntax stays lossless and refuses unsafe structured edits.
Offline sprites and unsafe links remain inert, preserved and diagnosed. Reader
extensions must be identified; serializers obey the pinned Mermaid writing
contract. Parsing must advance or fail, including comments and malformed input;
any cancellation hook follows the existing execution contract.

## Delivery order

1. Parse the complete documented syntax and peer counterexamples into typed
   elements, boundaries, relations and directives. Define validation, source
   preservation, canonical encoding and the pure identity plan first.
2. Add typed creation/mutation, semantic facts and structural verification.
   Exercise duplicate interactions, nested moves/removals, hostile text and
   serialization closure at their owning boundaries.
3. Own C4 hierarchical placement over measured boxes, reuse existing graphical
   route repair and Scene primitives, and separately use the terminal compositor
   and routed cell geometry. Preserve exact parent/endpoint identity and prepared text.
4. Register the family across library, CLI, Code Mode/MCP, lazy browser,
   editor, discovery, examples and docs. Derive discovery from the registry.
5. Independently challenge actual SVG/XML, PNG, terminal text and ownership,
   including nested parallel/reciprocal/self relationships, width refusal,
   no-color distinctions, styles and dynamic ordering. Run the existing
   citizenship, packaging and browser contracts; inspect payload cost.

## Prior art and evidence

Hard dependencies were semantic/source authority before adapter identity,
prepared content before measurement and emission, and serialization closure
before typed edits. Pixel and terminal allocation could then proceed in parallel.
Review depends on the combined final candidate, not individual agent passes.
Portable legacy syntax was the preferred first priority; legends/tag extensions
and presentation refinements followed without creating a second family model.

Prepared text (#395), shared identity/compound terminal fixes (#404), marker
orientation (#401) and state-note ownership (#405) are already in the baseline.
Earlier plans to wait for those PRs, copy a fork's generic router, or implement
C4 as a preservation-only envelope are superseded. No new runtime dependency,
audit infrastructure or publication step is part of this change. The requested
PR receives an independent audit of its combined immutable head.

Release validation is source semantics/edit closure, public output and ownership,
family citizenship, typecheck/lint, browser/package build, and website generation.
An untested layout or deployment is not made complete by a passing parser test.

- Mermaid 11.16 C4 syntax and grammar: the pinned local upstream reference and
  installed `mermaid@11.16.1`; C4's domain reference is <https://c4model.com/>.
- Beautiful PR #34 (`b8bea07b`) and #71 (`45b6ce78`): parser/layout examples;
  public terminal dispatch and technology retention differ.
- Zombie C4: dedicated boundary/interaction layout and repeated dynamic
  interactions. Refresh its current head before asserting equivalence.
- HealthSamurai `5f17f630`: compound boundary layout; pgavlin `ab8074a9`
  and CjiW `7e533a2d`: terminal width cases and semantic loss counterexamples.
- Merman `d9f8f27a`: shared displayed content and bounded lexer progress;
  its performance results are not Agentic measurements.

Use existing tests and evidence paths. Tests assert explicit authored semantics,
real DOM identities and emitted ownership/connectivity, not pixel parity with
another renderer or values produced by the implementation under test.

## Remaining order and release gates

Hard dependencies are unchanged: source identity and display interpretation
precede adapter projection; measured allocation precedes route/label emission;
serialization closure precedes typed editing claims. A source release requires
the combined head's native/public/packaged/browser contracts and independent
audit to pass. Publishing and then verifying the matching deployment are
separate delivery steps; the 0.4.1 installation is not native-C4 evidence.

Preferred next priorities, independently schedulable after those gates, are:

1. Profile dense routing and main-entry startup before changing algorithms;
   preserve measured labels, connectivity, containment and security evidence.
2. Design opt-in browser mount/reflow using explicit available-width/font inputs,
   keeping deterministic standalone rendering. It does not block this C4 model.
3. Prioritize additional native families by demand, with their own editing,
   metadata and output dispositions. A 33-family smoke roster is not a reason
   to weaken the semantic contract or a hard dependency of C4 delivery.

The prior preservation-only C4 plan and waiting for already-merged primitives
are superseded. No additional issue, generic router rewrite, global lexer
framework or duplicated audit infrastructure is required by the reproduced cases.
