# Adding Mermaid Diagram Types

Use this guide when adding a diagram type that Mermaid supports but Agentic Mermaid does not yet render.

## Upstream Guidance

Mermaid already documents the broad shape of a new diagram contribution:

- [Mermaid: Adding a New Diagram/Chart](https://mermaid.js.org/community/new-diagram)
- [Mermaid: Contributing](https://mermaid.js.org/community/contributing.html)

Their guidance is useful for structure: new diagrams usually need parsing, rendering, styling, registration, examples, docs, and tests. They also call out cross-cutting concerns such as directives, accessibility, theming, and comments.

That is necessary, but not sufficient for this repo. Agentic Mermaid also needs Mermaid syntax compatibility and output quality that matches the rest of the library.

## 1. Confirm The Target

- Verify the diagram is already supported by Mermaid.
- Verify it is not already routed in `src/index.ts` or `src/ascii/index.ts`.
- Prefer Mermaid's stable header if Mermaid supports both stable and beta forms.
- Write down any known Mermaid features you are intentionally not implementing yet. Those gaps must be documented in the PR before merge.

## 2. Start From Mermaid's Own Example

Every new diagram PR should include at least one official Mermaid example.

1. Open the Mermaid syntax page for that diagram type.
2. Copy a representative example from the Mermaid site, ideally the main example a user is most likely to try first.
3. Add that exact Mermaid source to this repo's tests.
4. Render it with Agentic Mermaid and confirm the structure is recognizably similar to Mermaid's published example.
5. Commit both the example source and the rendered artifact used to verify it.

For this repo, that usually means:

- a test that renders the Mermaid docs example
- a committed golden SVG in `src/__tests__/testdata/svg/` when SVG fidelity matters
- a screenshot or SVG preview attached to the PR description so reviewers do not have to run the branch to judge the result

If the Mermaid example uses syntax we do not support yet, pick the closest official example we can support now and call out the remaining gap explicitly.

## 3. Fit Agentic Mermaid's Architecture

Prefer the same shape used by the existing diagram families:

- `src/<type>/types.ts`
- `src/<type>/parser.ts`
- `src/<type>/layout.ts`
- `src/<type>/renderer.ts`
- `src/ascii/<type>.ts` when ASCII output is practical
- routing in `src/index.ts` and `src/ascii/index.ts`

Follow these repo standards:

- Keep the parse -> layout -> render pipeline clean and deterministic.
- Keep rendering DOM-free and synchronous.
- Use shared theme helpers and CSS custom properties instead of hardcoded colors where theme tokens already exist.
- Reuse existing text measurement, multiline, spacing, and escaping utilities before inventing new ones.
- Match the repo's visual language: readable labels, balanced padding, clear hierarchy, and outputs that still look good across built-in themes and CSS-variable inputs.
- If the diagram needs unusual rendering rules, add a short design note like [docs/design/xychart.md](../design/xychart.md).

## 4. Mermaid Compatibility Checklist

Before merge, verify that the new diagram:

- accepts Mermaid's documented header and supported syntax variants
- handles comments, quoted labels, escaping, and multiline labels when they apply
- respects Mermaid frontmatter or config for that diagram type when the syntax supports it
- fails clearly for unsupported Mermaid syntax instead of silently mis-rendering it
- uses Mermaid terminology in parser types and errors where practical

## 5. Required Tests

New diagram support should normally include most of these layers:

- Parser tests for valid syntax, invalid syntax, comments, quoted labels, multiline labels, and diagram-specific edge cases
- Layout tests when layout rules are specialized, especially spacing, bounds, and overlap avoidance
- Integration tests for parse -> layout -> render using a basic example, a realistic example, and an edge case
- SVG snapshot or golden tests when visual structure matters, including at least one Mermaid docs example
- Theme and compatibility tests for dark/light themes, CSS variable inputs, and frontmatter/config handling where relevant
- ASCII tests when ASCII rendering is supported, including Unicode mode and ASCII-safe mode; add exact fixtures under `src/__tests__/testdata/{ascii,unicode}/` and regenerate them with `bun run goldens:ascii`
- Regression tests for easy-to-break behavior such as ordering, escaping, markers, label normalization, or routing
- Sample coverage in `scripts/site/samples-data.ts` when the feature should appear on the visual samples page
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

## 7. Definition Of Done

A new Mermaid-backed diagram type is ready when:

- Mermaid's official example renders with recognizably similar structure
- the PR includes the example source and the rendered evidence used to review it
- parser, integration, and regression coverage exist for the important syntax paths
- specialized layout, renderer, theme, and ASCII behavior are covered when applicable
- output quality matches the rest of Agentic Mermaid
- intentional gaps versus Mermaid are documented
