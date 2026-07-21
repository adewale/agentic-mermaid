# Project lessons learned

This is the maintained, evergreen engineering guidance for Agentic Mermaid. The
chronological fork narrative through PR #149 is archived at
[`archive/fork-lessons-through-pr-149.md`](./archive/fork-lessons-through-pr-149.md).
Dated contributor-process lessons live in
[`../contributing/lessons-learned.md`](../contributing/lessons-learned.md).
Historical evidence explains decisions; current contracts live in code, tests,
family docs, and `TODO.md`.

## Evergreen engineering lessons

1. **Derive breadth from registries, not prose totals.** Family inventories,
   operation menus, editor examples, capability output, test generators, and
   generated declarations should consume authoritative descriptors. Prose should
   say “every registered family” and link the executable inventory.
2. **Characterize before consolidating.** Pin semantic identities, diagnostics,
   terminal cells, geometry, security properties, and intentional bytes before
   moving a seam. Preserve exact default bytes during structural refactors, but
   do not accidentally declare every historical byte a permanent public API.
3. **Parse into valid domain values.** Make invalid states unrepresentable where
   practical; reject ambiguous duplicate identities; keep source identity
   separate from DOM identity; use length-prefixed or structured tuples for
   authored IDs that may contain delimiters.
4. **Never trade editability for loss.** A family is structured, segmented, or
   opaque. Typed promotion is complete only when its serializer grammar is
   closed under every typed mutation. Unsupported syntax remains ordered and
   byte-preserved, or the whole body falls back losslessly.
5. **One semantic path should own each fact.** A structured body should reach one
   authoritative positioning path. Config schemas should own recognition,
   normalization, destination, and diagnostics. Public transports should adapt
   shared application services rather than reimplement behavior.
6. **Share mechanisms, not family policy.** Geometry predicates, color math,
   display width, receipts, Scene serialization, and config plumbing are good
   shared kernels. Layout semantics, routing policy, grammar, terminal metaphor,
   palettes, and error boundaries remain family-owned.
7. **Test causes, not only artifacts.** Pair golden changes with independent
   semantic/geometric invariants. Use red→green tests, properties, metamorphic
   checks, sabotage/revert probes, and mutation evidence to show that the fix—not
   a baseline refresh—caused the pass.
8. **Final pixels and public projections must agree.** Verification and quality
   audits must consume the placement and typography the renderer actually draws.
   Semantic transforms, markers, and rotated bounds belong in typed geometry,
   not hidden only in crisp SVG strings.
9. **Terminal rendering is a cell-space product.** Use grapheme clusters,
   display-cell width, deterministic fitting, and hard `targetWidth` errors.
   Never project pixel Scene coordinates into terminal output.
10. **Configuration is wire-or-warn.** A recognized value must affect output or
    produce a deterministic, fully qualified diagnostic. Unknown, invalid, and
    no-op values need the same policy across wrappers and explicit options.
11. **Generated freshness is delivery evidence, not semantic truth.** Receipts
    must hash complete inputs and deterministic ordering, while independent tests
    validate the generated artifact’s meaning. Local↔production byte equality
    proves deployment parity, not current provenance. Every deployable file needs
    an owner—authored input, generated output with a freshness oracle, or versioned
    external asset—and blind copies of unowned renderer snapshots are forbidden.
    Gitignored deploy builds are not committed product inputs.
12. **Citizenship is default-by-default.** A family is not shipped until library,
    CLI, MCP, editor, website, terminal, accessibility, security, configuration,
    eval, package, and documentation surfaces derive from the same registry with
    no silent exceptions.
13. **Safe static rendering stays non-executable.** Escape attributes, sanitize
    links, reject external fetches under strict mode, keep icon assets offline and
    bounded, and do not expose unrestricted SVG attribute bags.
14. **Archive completion; promote remaining work.** Completed implementation
    ledgers and release retrospectives retain provenance under `project/archive/`.
    Genuine defects receive stable IDs and acceptance criteria in `TODO.md`.
15. **A test portfolio needs separate authorities for finite algebra, expensive interactions, fixed faults, and human sense-making.** Exhaust cheap closed domains, use independently verified variable-strength arrays for expensive crossings, retain exact regressions/goldens for known failures, and use contact sheets for emergent aesthetic judgment. Calling one rectangular matrix “exhaustive” hides every dimension it holds constant.
16. **Coverage generators are claims; independent obligation enumerators are evidence.** A planner can omit the same family or tuple in both its rows and its self-check. Derive enrollment from registries, make family conformance data exact-closed, and verify required pairs/triples with a separately implemented enumerator plus fake/removed-member sabotage.
17. **Aesthetics live on scene roles, not in family renderers.** A family inherits
    the whole house style — hand-drawn/wash, every registered Palette × Look combination, text halos, DOM
    identity — by lowering its marks onto existing scene roles whose traits the
    backends dispatch on; it never draws styled pixels or branches on family. Assign
    the signature shape a sketchable role, keep the scaffold on a crisp role so it
    recedes, take categorical color from the shared palette re-derived from context,
    and hold labels to the whole-repo union (wrap, compress, de-collide, leader-line,
    reserve vertical room, knockout-box, guard derived contrast, diagnose authored contrast). The deterministic rubric
    certifies only a hygiene floor; the aesthetic ceiling comes from a per-family
    thesis plus good role choices. Full cross-family analysis in
    [`../design/system/cross-family-aesthetics.md`](../design/system/cross-family-aesthetics.md).
18. **Security gates are time-dependent release inputs.** A dependency audit can
    change while application bytes do not. Never suppress or reorder the gate to
    make CI green: identify the exact vulnerable chain, select the smallest
    compatible fixed version, pin it through the repository's dependency policy,
    and execute the dependent tool as a compatibility proof. Aggregate failures
    that inherit the security result should be reported as such, not mislabelled
    as independent test failures.

## Lessons from the consolidation audits

- **A typed semantic field is unfinished until every backend consumes it.** Crisp
  SVG fidelity and transformed bounds were green while the rough backend dropped
  rotations on shapes and connectors. Enumerate consumers—crisp, styled,
  terminal, bounds, verification, and export—and add a backend-discriminating
  probe for each semantic field.
- **Closed models should fail at compile time, not serialize to nothing.** A
  helper accepted the full geometry union and returned an empty string for
  unsupported variants. Narrow serializer inputs to the geometry they can
  represent and make switches exhaustive so the next model expansion creates a
  type error rather than invisible output loss.
- **Determinism forbids ambient locale policy.** `localeCompare()` made warning
  order depend on runtime locale even though ordinary runs looked stable. Public
  ordering uses explicit code-point comparators and Unicode fixtures exercised
  in different insertion orders; human collation belongs only where locale is an
  authored input.
- **Atomic output requires preflight before mutation.** Checking terminal bounds
  one cell at a time allowed half of a width-two grapheme to be written. Validate
  the complete grapheme span first, then write the cluster and continuation cells
  as one operation. Apply the same preflight principle to multi-part SVG marks,
  archive moves, and generated updates.
- **Architecture direction is part of consolidation correctness.** Positioning
  code importing a renderer-owned font resolver made the supposedly shared seam
  depend on its consumer. Shared measurement/configuration belongs below both
  layout and rendering; extraction is incomplete when the dependency arrow still
  points upward.
- **Archive moves are provenance operations, not documentation rewrites.** Move
  accepted historical evidence byte-for-byte, pin immutable records by digest,
  preserve old link targets with explicit bridges when necessary, and run local
  Markdown-link closure. Put present-day interpretation in a current README, not
  inside the archived record.
- **An evidence manifest must validate its coordinates.** Existing evidence files
  did not make a stale `file#symbol` authority true. Contract tests resolve the
  declared path and exported symbol, while the manifest remains a navigation
  index rather than proof of the behavior it cites.
- **A combinatorial estimate must respect its mathematical lower bound.** The planned 350–600-row Style portfolio could never satisfy the declared Look × Palette × three-background obligation: that triple alone requires 900 rows. Keep the obligation and report the miss; never tune a covering-array budget by silently dropping the tuple that made it valuable.
- **Complexity is a vector and a registration obligation, not one score.** Entity count cannot stand in for nesting, reciprocal/parallel routes, cycles, Unicode classes, authored text volume, configuration, or family-risk syntax. Every family now supplies minimal, representative, dense, text-stress, risk, and real-corpus-outlier sources; adding a family without those witnesses fails closure rather than reducing its test depth invisibly.
- **Contact sheets are Cynefin probes, not visual proof.** A diversity-selected overview lets a reviewer sense repeated patterns and surprising outliers in a complex aesthetic space, while native-size cells answer readability questions. Bind the selection, source, dimensions, and HTML bytes in a manifest; keep model sanity separate from independent human approval, and leave optional review evidence pending rather than inventing reviewer identity or minutes.
- **Receipt dependencies should follow the build graph, not the repository tree.** Hashing every `src/**/*.ts` file invalidated four visual receipts after unrelated test-only edits while every output byte stayed unchanged; merge-ref CI then found three more broad visual authorities after a script-only package change. A fail-closed transitive local-import graph reduced the seven input sets by 59.9–98.5%, still invalidates true renderer dependencies, and turns receipt churn into causal evidence instead of source-tree noise.
- **Run generators after the final source/test edit and final rebase.**
  Dependency-complete receipts correctly became stale after late test changes and
  again when a moving base changed the merge-ref input tree. The reliable order is
  implementation → tests → audit remediation → final rebase → generation →
  freshness gates → merge-ref CI. Receipts should include package and lock inputs,
  but still disclose environmental fonts, browser binaries, and rasterizers they
  cannot pin.
- **Conditional skips are capability gaps, not passes.** A skipped positive-path
  integration test must name the missing external capability, retain adjacent
  deterministic coverage for behavior available everywhere, and be reported
  separately from passes. Prefer a committed fixture or provisioned CI dependency
  when that positive path becomes a release-critical guarantee.
- **Specialized independent audits beat one broad green review.** Security and
  package surfaces were sound while separate reviewers found backend fidelity,
  terminal atomicity, locale ordering, dependency direction, archive integrity,
  and evidence-coordinate defects. Partition reviews by failure domain, require
  exact reproductions, remediate all Blocker/P1/P2 findings, then rerun freshness
  and resulting-head gates instead of treating an earlier acceptance as durable.
- **Boundary configuration is part of the contract.** Loopback-origin tests
  proved the local MCP server rejected an attacker, but never exercised the
  configured reverse-proxy origin. Test both halves of an allow-list: known-bad
  input must fail and every configured public identity must succeed on each
  protected route.
- **Compare exact inventories with their registry.** Presence tests for selected
  tools let `describe_sdk` disappear from `llms.txt` and `website/README.md`
  while the runtime grew from eight to nine hosted tools. Any prose that claims
  a complete inventory must parse back to the canonical runtime names and count;
  subset prose should avoid claiming completeness.
- **Build provenance describes bytes, not just Git HEAD.** `rev-parse HEAD`
  identifies the parent commit but says nothing about uncommitted inputs. Manual
  builds now qualify dirty or unverifiable checkouts, while trusted CI supplies
  the immutable workflow revision explicitly.
- **A passing test command is not a compiler gate.** Keep type checking as a
  named package script shared by CI and release workflows, and run it after the
  final test edit; transpile-only builds and Bun tests do not prove strict
  TypeScript compilation.
- **Workflow success is not delivery success.** A deployment job can conclude
  green after its deploy step was skipped for missing credentials. Model external
  effects as explicit `deployed`/`skipped`/`failed` outcomes, retain the platform
  version identity, and close delivery only after live positive and negative route
  probes. A green orchestration wrapper is not evidence that production changed.
- **Prototype maturity is an evidence ladder, not a naming promotion.** Move a
  design probe from temporary research to a checked-in prototype only when its
  public data validates, its own fixture executes the claimed roles/policy, its
  deterministic visual is reviewed, and discovery proves it remains non-built-
  in. Brand inspiration never supplies ownership, endorsement, or permission to
  manufacture proprietary assets; BrandPack and built-in promotion require
  separate distribution evidence.
- **A semantic-binding witness must discriminate the binding from role defaults.**
  Render the same family fixture with and without slots/bindings, make the base
  role visibly different, and assert the bound mark—not merely the presence of a
  color already supplied by the role. Trim valid-but-inert bindings instead of
  treating schema admission as executable evidence; keep editorial feature tags
  explicitly outside capability authority.
- **Ambiguous aliases should disappear, never change meaning.** Establish the
  intended surviving canonical identity before retirement; if the second meaning
  is duplicate rather than useful, remove that resource too. Old inputs should
  fail rather than silently switch from a Look to a Palette. Honor published
  compatibility windows by default; if the repository owner explicitly overrides
  one, record a breaking migration in the changelog and PR risk instead of
  rewriting history as though no promise existed.
- **A diagnostic prototype should pass its own policy.** Run style-aware verify
  on each fixture and tune authored text/surface pairs until its inspect-only
  constraints are quiet. A screenshot generator proving only that bytes exist is
  weaker than a prototype whose render, policy, terminal cue, registration, and
  non-registration boundaries all execute.
- **Perceptually-uniform categorical color beats HSL.** Equal HSL lightness is
  *unequal perceived* lightness across hues, so an HSL hue-sweep collapses
  hue-adjacent categories (measured on the old pie ladder: two of fifteen fills
  at WCAG 1.01:1; worst pair ΔE_OK 0.049 — a near-identical green pair).
  Generate categorical fills at constant OKLCH lightness, enforce a minimum
  ΔE_OK distinctness floor, and gate wedge visibility with polarity-aware APCA
  (WCAG is polarity-blind and passes wedges that vanish on a dark theme). Put it
  in the *canonical* palette (`pieSliceColors`): radar already inherits it, and
  the cross-family plan routes xychart/journey/mindmap/gitgraph through it, so
  one perceptual fix compounds across every family that shares the color waist.
  See [`../design/system/cross-family-aesthetics.md`](../design/system/cross-family-aesthetics.md) L3.
- **A guarantee is only as honest as its domain and runtime bound.** The ΔE_OK
  collision floor is hard for 7–24 fills across every built-in theme and
  adversarial custom backgrounds. Above 24, the pairwise pass is skipped so
  generation remains linear and separation becomes explicitly best-effort.
  State the supported range, degraded tail, and cost budget together; a
  deterministic O(n²) search can still be a production failure.
- **Reachability and independence come before a new diagnostic.** A proposed
  `LABEL_LINE_OVERLONG` finding was private to a render audit and duplicated the
  public, universal `LABEL_OVERFLOW` warning already exposed through verify,
  CLI, API, and MCP. Removing the duplicate was better than wiring a second
  threshold. When a revert strands a helper, delete it; when an existing metric
  already owns the defect class, extend that metric instead of adding a shadow.

## How to apply these lessons

- Start with the smallest failing characterization or invariant test.
- Make one behavior-preserving change at a time; keep one writer per worktree.
- Run the focused test red→green, then adjacent suites, typecheck, generated
  freshness gates, full unit/E2E gates, and quality trackers appropriate to the
  touched surface.
- For visual changes, provide captioned generated evidence and state honestly
  when the baseline hard-failed rather than fabricating a “before” render.
- Before a pull request, use the repository’s `good-pr` skill and report residual
  risks, environment-dependent checks, and accepted divergences explicitly.
