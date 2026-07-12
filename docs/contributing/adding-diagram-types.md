# Adding Mermaid Diagram Types

Use this guide when adding a diagram type that Mermaid supports but Agentic Mermaid does not yet render.

## Upstream Guidance

Mermaid already documents the broad shape of a new diagram contribution:

- [Mermaid: Adding a New Diagram/Chart](https://mermaid.js.org/community/new-diagram)
- [Mermaid: Contributing](https://mermaid.js.org/community/contributing.html)

Their guidance is useful for structure: new diagrams usually need parsing, rendering, styling, registration, examples, docs, and tests. They also call out cross-cutting concerns such as directives, accessibility, theming, and comments.

That is necessary, but not sufficient for this repo. Agentic Mermaid also needs complete accounting of Mermaid's documented stable syntax and output that preserves the diagram family's recognizable domain metaphor. Registration is blocked until both contracts are evidenced.

## 1. Confirm The Target

- Verify the diagram is already supported by Mermaid.
- Verify it is not already routed in `src/index.ts` or `src/ascii/index.ts`.
- Add the family to the type-checked built-in family metadata manifest in `src/agent/families.ts` first. `BUILTIN_FAMILY_METADATA` is the reviewer-facing list for shipped families and has a compile-time coverage assertion against `DiagramKind`.
- Update the [diagram-family citizenship matrix](./diagram-family-citizenship.md) in the same PR: every citizenship surface must be marked `satisfied` with evidence or `exception` with a tracked follow-up.
- Prefer Mermaid's stable header if Mermaid supports both stable and beta forms.
- Pin the Mermaid version and syntax page being implemented. Inventory every stable documented construct before coding; parser acceptance or source preservation alone does not count as rendered support.
- Choose a Wikipedia/domain reference for the diagram form and write one sentence naming its recognizable visual hallmark (for example, a Mindmap has a central idea with radiating hierarchy).
- Record both in [`mermaid-family-fidelity-audit.md`](../design/mermaid-family-fidelity-audit.md) and the matrix's `mermaidSyntaxParity` / `familyVisualMetaphor` cells. A missing stable Mermaid construct blocks registration unless it is an unavoidable security/offline divergence with a named diagnostic and executable test.

## 2. Start From Mermaid's Own Example

Every new diagram PR should include at least one official Mermaid example.

1. Open the Mermaid syntax page for that diagram type.
2. Copy a representative example from the Mermaid site, ideally the main example a user is most likely to try first.
3. Add that exact Mermaid source to this repo's tests.
4. Render it with official Mermaid and Agentic Mermaid from the same source. Confirm semantic equivalence and the family hallmark; pixel identity is not required.
5. Commit the example source, official comparison (when reproducible), Agentic artifact, and exact regeneration command.
6. Put the artifact in the PR's captioned Visual Evidence table with separate **Why** and **What to inspect** text.

For this repo, that usually means:

- a test that renders the Mermaid docs example
- a committed golden SVG in `src/__tests__/testdata/svg/` when SVG fidelity matters
- a screenshot or SVG preview attached to the PR description so reviewers do not have to run the branch to judge the result

If an official stable example uses syntax the implementation cannot render faithfully, the family is not ready to register. Do not substitute an easier example. The only exceptions are deliberately inert security/offline behaviors (such as JavaScript callback execution or network image fetching); those must preserve safe semantics, emit a named diagnostic, and have positive/negative tests.

## 3. Fit Agentic Mermaid's Architecture

Prefer the same shape used by the existing diagram families:

- `src/<type>/types.ts`
- `src/<type>/parser.ts`
- `src/<type>/layout.ts`
- `src/<type>/renderer.ts`
- `src/ascii/<type>.ts` when ASCII output is practical
- routing in `src/index.ts` and `src/ascii/index.ts`
- built-in family metadata in `src/agent/families.ts`
- structured hooks in `src/agent/families-builtin.ts`

Follow these repo standards:

- Keep the parse -> layout -> render pipeline clean and deterministic.
- Keep rendering DOM-free and synchronous.
- Use shared theme helpers and CSS custom properties instead of hardcoded colors where theme tokens already exist.
- Reuse existing text measurement, multiline, spacing, and escaping utilities before inventing new ones.
- Match the repo's visual language: readable labels, balanced padding, clear hierarchy, and outputs that still look good across built-in themes and CSS-variable inputs.
- If the diagram needs unusual rendering rules, add a short design note like [docs/design/families/xychart.md](../design/families/xychart.md).

## 4. Mermaid Syntax And Family-Metaphor Checklist

Before merge, verify that the new diagram is **syntax-complete** for the pinned Mermaid documentation target:

- every stable construct on the official syntax page appears in an independently reviewed inventory and executable fixture;
- the documented header, aliases, statement variants, comments, labels, escaping, multiline forms, frontmatter, directives, and family config are modeled with their documented semantic effect;
- parse → model → serialize → render remains closed; parser acceptance, opaque preservation, flattening, warning, or a non-empty SVG does not count as native support;
- upstream examples/spec blocks are imported or placed in an executable divergence ledger with pinned source and rationale;
- unsupported or invalid forms fail loudly rather than silently disappearing.

Before merge, verify that it is **Visual-metaphor complete**:

- Mermaid's rendered example and a Wikipedia/domain reference are both cited;
- the family's recognizable hallmark is stated in the matrix (central idea for Mindmap, lifelines for Sequence, time-scaled bars for Gantt, and so on);
- at least one independent semantic/geometry assertion proves that hallmark rather than snapshotting implementation bytes;
- a representative generated screenshot is committed and captioned in the PR's Visual Evidence table;
- SVG and terminal output are reviewed separately: surface availability does not prove visual fidelity.

See [`mermaid-family-fidelity-audit.md`](../design/mermaid-family-fidelity-audit.md) for the current 14-family standard.

## 5. Required Tests

New diagram support should normally include most of these layers:

- An upstream test-suite harvest per [`harvesting-upstream-tests.md`](./harvesting-upstream-tests.md): vendor the family's mermaid grammar/semantics specs (and ASCII-fork inputs) into `eval/mermaid-<type>-bench/` with an executable exclusions ledger, and add the family's docs examples to the mermaid-docs corpus. For not-yet-built families, do the harvest BEFORE implementation — it surfaces the real semantics the docs omit.
- Parser tests for valid syntax, invalid syntax, comments, quoted labels, multiline labels, and diagram-specific edge cases
- Layout tests when layout rules are specialized, especially spacing, bounds, and overlap avoidance
- Integration tests for parse -> layout -> render using a basic example, a realistic example, and an edge case
- SVG snapshot or golden tests when visual structure matters, including at least one Mermaid docs example; follow [`visual-review-evidence.md`](./visual-review-evidence.md) for contact sheets, layout-compare, rubric galleries, and browser screenshot expectations
- Theme and compatibility tests for dark/light themes, CSS variable inputs, and frontmatter/config handling where relevant
- ASCII tests when ASCII rendering is supported, including Unicode mode and ASCII-safe mode; add exact fixtures under `src/__tests__/testdata/{ascii,unicode}/` and regenerate them with `bun run goldens:ascii`
- Regression tests for easy-to-break behavior such as ordering, escaping, markers, label normalization, or routing
- Sample coverage in `scripts/site/samples-data.ts` when the feature should appear on the visual samples page
- Live editor coverage in `editor/js/examples.js`: add one basic example under the `Supported diagrams` category, add an explicit picker glyph, and let `src/__tests__/editor-examples.test.ts` prove it parses and renders. This is required for every registered built-in family, not just marketing-worthy ones.
- Citizenship matrix coverage in `docs/contributing/diagram-family-citizenship.matrix.json`, including `mermaidSyntaxParity` and `familyVisualMetaphor` evidence: pinned Mermaid docs/upstream harvest, a Wikipedia/domain reference, a named signature, an independent invariant test, and a committed renderer artifact.
- README updates for the new supported diagram type and any intentional compatibility gaps

Use the existing naming pattern where possible:

- `src/__tests__/<type>-parser.test.ts`
- `src/__tests__/<type>-integration.test.ts`
- `src/__tests__/<type>-ascii.test.ts`
- `src/__tests__/<type>-layout.test.ts`

Regression guard:

- Confirm at least one new or changed test fails when the implementation is reverted or the new routing is removed.
- Mention that verification in the PR description.

## 6. Commands To Run

Run the checks that fit the change:

- `bun test src/__tests__/`
- `bun run goldens:ascii:check` if you added or changed ASCII/Unicode fixtures
- `npm run build`
- `bun run samples` if you added or changed visual samples
- `bun run bench` if the diagram type adds meaningful layout or rendering cost

## 7. Agent-Native Typed Mutation (Required)

Typed mutation is part of the definition of done for a new family, not a follow-up. Every renderable family ships a structured editing surface by default; source-level-only families are no longer accepted. Add, alongside the renderer pipeline above:

- A body module `src/agent/<type>-body.ts` with a structured-or-opaque parser, a canonical serializer, a mutator (per-family ops), and a `verify` hook. Follow an existing module — `src/agent/journey-body.ts` (pilot), `src/agent/pie-body.ts`, or `src/agent/quadrant-body.ts` are clean templates.
- Body + op types in `src/agent/types.ts` (e.g. `PieBody`, `PieMutationOp`), added to the `DiagramBody`, `AnyMutationOp`, and `MutableValidDiagram` unions, plus a narrower `as<Type>` and its `<Type>ValidDiagram` alias.
- Structured hooks registered in `src/agent/families-builtin.ts` (replace any source-level-only registration), the narrower exported from `src/agent/index.ts`, and a `mutate` overload in `src/agent/mutate.ts`.
- The surface sync the doc-sync tests enforce: `BUILTIN_FAMILY_METADATA` (`src/agent/families.ts`), `MUTATION_OPS_BY_FAMILY` (`src/cli/index.ts`), `SDK_DECLARATION` (`src/mcp/sdk-decl.ts`) + sandbox narrower wiring, `AGENT_NATIVE.md` op list and workflow, the `Instructions_for_agents.md` mirror + `llms.txt` regeneration, `am init-agent` generated snippets, editor examples, fixture-backed `skill-evals/shared-benchmark.json` cases, and the per-family docs/skill tables.
- Tests: parse/narrow/mutate/verify/serialize, structured-or-opaque fallback cases (table-driven sad paths), a fast-check round-trip property test, and a differential test against the legacy renderer parser proving the canonical source you emit re-parses identically.

**Structured-or-opaque law:** any line your parser does not model must be preserved verbatim (opaque fallback) — never silently dropped. Opaque bodies round-trip byte-verbatim; structured bodies serialize to canonical source and must be serialize-idempotent (parse → serialize → parse → serialize is byte-stable).

**Wrapper law (1C):** the leading source wrapper — frontmatter block, `%%{init}%%`/`%%{initialize}%%` directives, `%%` comments before the header, blank lines — round-trips byte-verbatim through `serializeMermaid` and through mutation (`meta.wrapperSource`). Canonical wrapper synthesis (Mermaid's documented shape: `title`/`displayMode` top-level, everything else nested under `config:`, directives folded) is opt-in via `serializeMermaid(d, { wrapper: 'canonical' })` / `am format --canonical-wrapper`, and must never emit frontmatter Mermaid cannot read back (no flattened config keys).

**In-body comment policy (2C):** structured bodies do not model in-body `%%` comments; their canonical serialization drops them, and that loss must be *announced* — parse records the casualties (`meta.droppedComments`, computed by diffing against the serialized output) and verify surfaces the Tier 3 `COMMENT_DROPPED` lint. Opaque bodies and preserved opaque segments keep comments verbatim. The destination state is segment-preserving comment retention (the BUILD-18 pattern); until a family ships that, dropping silently is a bug, dropping announced is the documented trade.

**Enforcement:** the test `every registered renderable family ships typed mutation (default-by-default enforcement)` in `src/__tests__/agent-doc-sync.test.ts` fails CI if a registered family lacks mutate/serialize hooks, an ops declaration, or a narrower. A new family that registers source-level-only will not pass CI.

## 8. Definition Of Done

A new Mermaid-backed diagram type is ready when:

- every stable construct in the pinned Mermaid syntax documentation is accounted for and rendered with its documented semantics (except named, tested security/offline divergences)
- Mermaid's official example renders with recognizably similar structure and preserves the Wikipedia/domain visual hallmark
- the PR includes the example source, official comparison where reproducible, regeneration command, and captioned rendered evidence used to review it
- parser, integration, and regression coverage exist for the important syntax paths
- specialized layout, renderer, theme, and ASCII behavior are covered when applicable
- output quality matches the rest of Agentic Mermaid
- the agent-native typed mutation surface from section 7 is wired and tested (the default-by-default enforcement test passes)
- the live editor has a basic working example and explicit glyph for the family
- the shared skill-eval manifest has at least one fixture-backed case tagged for the family
- `mermaidSyntaxParity` and `familyVisualMetaphor` are `satisfied` with real evidence; parse-only, source-preserved-only, flattened, or warned syntax is never described as full support
