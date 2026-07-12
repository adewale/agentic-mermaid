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
    validate the generated artifact’s meaning. Gitignored deploy builds are not
    committed product inputs.
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
