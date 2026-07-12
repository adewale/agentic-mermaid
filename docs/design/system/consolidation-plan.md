# Post-family-elevation consolidation plan

Status: bounded implementation pass, final audit remediation, and PR evidence complete. Baseline: merge `18979d1f` (PR #149). Broader architectural migrations discovered during this bounded pass are promoted to stable `TODO.md` items rather than hidden here.

This plan converts the post-merge multi-agent audit into a characterization-first consolidation program. It deliberately avoids brittle prose counts: family, style, palette, operation, test, artifact, and package inventories must be derived from registries/manifests or checked structurally rather than copied into documentation.

## Governing constraints

- Use red → green → refactor for every behavior change. Record the failing test or sabotage signal before implementation.
- For behavior-preserving refactors, add characterization first and forbid unexplained golden changes.
- Prefer correctness by construction: parse untyped input once into precise internal types; do not repeat equivalent validation through internal layers.
- Preserve deterministic bytes unless a separately justified bug fix changes an observable contract.
- Preserve structured-or-opaque fidelity, serializer closure, wire-or-warn diagnostics, semantic identity, accessibility, strict security, display-cell terminal behavior, and family-recognizable metaphors.
- Keep family layout/routing/palette semantics separate. Consolidate checked contracts and already-resolved drawing values, not domain algorithms.
- Generated freshness is not semantic correctness; every generated artifact also needs a discriminating invariant.
- Historical counts and acceptance records are immutable evidence only when tied to a head/run. Current docs describe contracts, not yesterday's totals.

## Work packages

| ID | Package | Status | Exit evidence |
|---|---|---|---|
| CONS-01 | Remove brittle counts and repair active documentation/backlog integrity | done | doc-sync tests prove commands, navigation, registry-derived inventories, archive/current separation |
| CONS-02 | Establish the refactor-characterization manifest and Hyrum-law gates | done | the checked manifest maps registry scope to byte, semantic, geometry, terminal, warning, security, distribution, and generated contracts |
| CONS-03 | Type Scene rotations/world bounds and add canonical primitive serialization | done | transform fidelity, arbitrary-angle properties, and byte-equivalence pass without baseline regeneration |
| CONS-04 | Add typed document/defs furniture and ratchet RawMark | done | close/defs are typed across renderers; Mindmap/GitGraph accessibility furniture is typed; regression test forbids fallback |
| CONS-05 | Pilot one configured positioning path on Mindmap and GitGraph | done | rendering and `layoutMermaid` share resolvers/positioners and structured bodies no longer reparse canonical source |
| CONS-06 | Make config schemas own diagnostics | done | source/explicit paths share validation, qualification, ordering, and deduplication |
| CONS-07 | Consolidate transformed bounds, generated receipts, and opaque segments | done | shared kernels have property/tamper tests and public bytes remain unchanged |
| CONS-08 | Move Gantt/XYChart onto grapheme-safe shared terminal primitives | done | Gantt uses shared width fitting; XYChart uses shared cell/role canvas construction and text writing |
| CONS-09 | Verify registry-generated surfaces and transport-neutral handlers | done | registry/doc-sync/package tests and existing `applyOps`/MCP tool-surface differentials remain the authorities |
| CONS-10 | Begin mechanical pass-module extraction behind existing contracts | done | origin translation moved to its own module; manifest order, mutation declarations, certificates, layout, and SVG bytes remain pinned |
| CONS-11 | Resolve dangling/deferred items and archive completed plans | done | current TODO is actionable-only; historical records and evergreen lessons are separated |
| CONS-12 | Final full validation, multi-agent audit, remediation, and good-pr evidence | complete | independent reviewers find no unresolved Blocker/P1/P2; resulting-head CI and PR evidence are current |

## Characterization index used before refactoring

`consolidation-characterization.json` is a reviewer navigation index, not a
substitute for the cited executable gates. Those tests independently derive family
scope from registries and cover these contract categories without copied totals:

- source parse/serialize/mutate/verify laws;
- configured positioning and `RenderedLayout` projection;
- Scene local and transformed/world geometry;
- crisp SVG bytes and semantic identity tuples;
- style/palette invariance of source identity and geometry;
- SVG post-pass composition: namespace, accessibility, strict sanitization and compaction;
- terminal grapheme conservation, target width, region coordinates and color/plain parity;
- warning code/severity/field/message ordering and deduplication;
- library, installed package, CLI, local MCP and hosted facade envelopes;
- generated repository-input receipts and independent semantic checks.

Gallery receipts hash repository sources, their generator/helper, package metadata,
and the lockfile. Browser binaries, OS font fallback, and rasterizer versions remain
environmental reproduction inputs, so reviewed PNG bytes and semantic tests—not the
receipt alone—are the acceptance evidence.

Every newly lifted invariant gets both:

1. an invariant-proof property over valid constructed values; and
2. a model-gap test attempting to construct each invalid state the type/schema claims to exclude.

## Planned sequence

1. Documentation/count hygiene and manifest scaffolding.
2. Characterization red tests for transforms, config parity, SVG post-passes, identities, Unicode and installed surfaces.
3. Typed Scene presentation and canonical serialization, piloted on the smallest equivalent family shapes.
4. Typed document/defs furniture and an audited RawMark escape hatch.
5. Configured positioning pilot and vertical-family characterization.
6. Config diagnostics and shared pure kernels.
7. Terminal consolidation for the duplicated Gantt/XYChart mechanics.
8. Public-surface/application-service characterization.
9. Mechanical extraction of one self-contained layout pass behind the existing pass manifest.
10. Archive/backlog cleanup, full validation, audit/fix loop, and PR.

The pilot boundaries are deliberate: universal Scene migration, all-family positioning,
full pass-file decomposition, and further generated-surface work are independently
reviewable follow-ups in `TODO.md`. This plan does not claim those broader migrations
landed merely because their construction seams are now characterized.

## Explicit non-goals

- A universal family grammar, layout, router or palette policy.
- Pixel-geometry projection into terminal cells.
- Dynamic family loading or runtime TypeScript reflection.
- Removing opaque fallback or weakening security/accessibility layers that defend distinct failure modes.
- Accepting golden churn merely because a serializer emits equivalent SVG.
