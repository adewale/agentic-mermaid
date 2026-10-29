# Native C4 implementation

Current rebase candidate: `8cad259fdcb8e0117531bf1d33585d9c79ae89f2`
(18 October 2026), based on main
`b1a613a47ee50d99f59dbf24bdf499f5a68ae2df`, including Class PR #410 and
documentation PR #414. C4 geometry, XML fast paths and shared Scene admission
reuse are unchanged from the second rebase below. All 34 imported reference
files still match main exactly, with Mermaid 12.2.0 installed.

Fresh combined validation passes 90 tests and 790 assertions across the full
official corpus, focused C4 contracts, Section B golden/backend checks and
297-diagram layout-equivalence gate. Every existing main layout-baseline entry
is preserved; only the C4 fixture is added. The combined Section B golden
regenerates byte for byte, and independent inspection of its eight Class/C4
panels confirms all four Class panels retain main's exact pixels. This rebinds
the bounded geometry review without carrying older performance measurements
forward as measurements of the new base.

Second rebase candidate: `1465fafb77d540af2d884fc2d4afec9b646984ca`
(18 October 2026), based on main
`26a481284b80371ccd0d7d104cd5ab20006d3cac` after PR #412. The branch adopts
main's shared Scene admission reuse, SVG assembly and schema caching while
retaining C4 geometry and the XML fast paths in `svg-structure.ts` and
`output-security.ts`. The performance comparison at
`56e463243e2361b2eb742c256a38eb8c8f9f54fe` remains historical; its measured
delta is not the delta against this newer main.

Independent review reconfirmed all 34 imported reference files match this main
byte for byte and Mermaid 12.2.0 remains installed. With the official-fence
extractor now owned by `eval/shared/official-fences.ts`, the full 537-fence
corpus and focused C4 contracts again pass 84 tests and 661 assertions. Five
fresh visibility SVGs and three PNGs match the audited `cb799434` artifacts
byte for byte: the thick self-marker fits, and overlapping thick markers
still fail verification. The existing layout limitations remain.

First Mermaid 12.2.0 rebase candidate: `6dcd68317a82c3b859d0c1c517a85dd8bbc8db3a`
(18 October 2026), based on Agentic main
`5442a3cce1e847953e2e5fcbc79a01662f96ecb7` after PR #413. The current syntax
and installed dependency pin is Mermaid 12.2.0, source
`1fb7869866dd619168d840291c9c54b4f129758b`. Independent review confirmed all
34 imported reference files (33 syntax pages and their README) match that main
revision byte for byte. The five C4 fences are unchanged and retain their
precise `VerifyError` expectations for real occlusion; the earlier pages were
not restored over the new references.

Fresh validation passed 84 tests and 661 assertions across the complete
537-fence official corpus and the C4 layout-quality, presentation, rendering
and public-contract test files. C4 production geometry is unchanged from the
audited pre-rebase candidate. These checks bind the rebased source and installed
dependency; they do not replace the historical measurements or establish a
package publication, deployment or universal layout guarantee.

Pre-rebase follow-up production candidate: `cb7994341c309e4da1ebb54fa5045548bacc63b4`
(18 October 2026). The renewed derivative comparison at `6724062c` found an
ancestor arrow hidden by its label and unreadable dense labels despite clean
verification. The earlier bounded audits below did not cover those witnesses.

The follow-up applies #409's family-adapter approach: retain the existing
semantic model, prepared text, identity plan, Scene/style system and independent
terminal geometry. Ancestor clearance now reserves real frame space; final
label allocation and visibility diagnostics use the emitted halo geometry.
Measured occlusion is a geometric error, rather than a syntax warning.

The seven-card/21-interaction witness remains crowded: overlapping label pairs
decrease from nine to seven, and verification now fails with sixteen targeted
visibility diagnostics, including shaft/frame conflicts. It is an explicit
layout limitation, not a solved dense-layout claim. Ancestor and parallel/self
witnesses have visible markers and labels and verify cleanly.

Opt-in `c4.maxWidth` and `c4.compact` provide measured reflow and tighter spacing.
Impossible budgets retain content and diagnose their limit. Automatic type
legends are configurable and consume existing palette/style contracts. Boundary
navigation uses the editor's existing camera; canonical whole-diagram exports
and exact source export retain interaction semantics. The initial shared
performance work removed repeated schema cloning and equivalent XML scanning
work; main now owns the shared changes noted above. Paired results must bind
their exact candidate, baseline and fully consumed receipts.

The three independent reviewers found and closed four concrete integration
findings: invalid row settings disabling compact packing; geometric errors
shown as advisory in the editor; thick self-markers clipped by the viewport;
and overlapping thick markers passing verification. The final candidate sizes
the viewport around actual marker envelopes and diagnoses marker overlap. Two
marker regressions fail against the earlier `40790299` production tree.

This delivers a focused C4 slice of #409. It neither closes that delivery epic
nor adds another family registry, layout engine, runtime dependency or audit
framework. The remaining historical evidence is retained at its original pins.

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

The three Astra XHigh reviewers challenged the combined PR and prompted fixes
for effective-shape metadata, configuration bounds, an SVG CDATA fast-path
regression, accessibility label companions and an edge-count test that could
skip a failed family. The final production commit is
`6895af7c2aac29e9c7b1f6db1173e1b95f364be7`; the subsequent
`315f8619961181545b9ce48cfd7e60e36debbfb1` strengthens that test and reviews
a 137-byte gzip overrun by increasing only GitGraph's cap from 184,500 to
185,000 bytes. It changes no renderer code. Fresh independent review bound
42 SVGs, 36 terminal outputs and nine PNGs to this production code, including
142 graphical endpoint contacts and 72 terminal contacts. These finite cases
do not establish every dense layout, font/browser combination or assistive
technology experience. Final CI status remains recorded on the PR.

Final browser behavioral tests passed, then website payload checks exposed
intended native-family costs beyond the old route ceilings: the build-time C4
example takes the examples route to 418,997 raw bytes, and the synchronous
all-family editor measures 3,590,858 raw / 1,089,260 gzip / 859,297 Brotli bytes.
Review found no new dependency or accidental layout engine; deferring the
editor's synchronous adapters requires a separate async loading contract.
Only those route byte ceilings were adjusted with tight headroom. Their request
and resource restrictions, and the separate per-PR growth review, remain gates.

A subsequent CI runner completed an existing 1,200-node timeout witness inside
its two-second budget. That successful execution was valid; the test's assumed
runtime was not a deadline contract. Its replacement runs real automatic
verification on a tiny trusted diagram, fixes elapsed time at 750ms and observes
the actual commit watchdog receiving the remaining 1,250ms of a 2,000ms budget.
An isolated fresh-budget mutant receives 2,000ms and fails the same assertion.
This is a test-only correction, not a new cancellation API or production seam.

## Contract

Support the current Mermaid 12.2.0 contract for the five legacy dialects (`C4Context`, `C4Container`,
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

- Initial grammar research used Mermaid 11.16 C4 syntax and
  `mermaid@11.16.1`; the current reference/dependency pin and rebase validation
  are recorded above. C4's domain reference is <https://c4model.com/>.
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
