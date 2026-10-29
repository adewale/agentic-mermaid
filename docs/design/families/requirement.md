# Requirement

Syntax target: Mermaid 12.2.0, commit `1fb7869866dd619168d840291c9c54b4f129758b`.
The [pinned official syntax](https://github.com/mermaid-js/mermaid/blob/1fb7869866dd619168d840291c9c54b4f129758b/packages/mermaid/src/docs/syntax/requirementDiagram.md)
and [domain reference](https://en.wikipedia.org/wiki/Requirement_diagram) define the recognizable hallmark: Requirements remain compartmented boxes with ID, text, risk and verification fields, joined by typed traceability relations.

## Semantics and editing

The native model keeps six requirement kinds, evidence elements and all seven relation kinds. Both arrow spellings preserve effective source/target orientation. Inline styles, class definitions, multi-class assignments and the four directions survive canonical serialization. The circled containment mark belongs to the container endpoint; other relationships use labelled dashed connectors.

Use `asRequirement` after parsing and `describeOps('requirement')` for the live operation schema.
Unknown syntax stays preserved as an opaque body and does not pretend to support structured mutation.
Leading wrappers are preserved by the shared source envelope.

## Placement and aesthetics

Graph placement reuses ELK and prepared pixel text. Field rows reserve their complete measured bounds. Terminal output independently allocates compartmented cards and connects their physical ports through the shared terminal router. Terminal containment uses a circle plus the explicit <<contains>> relationship label.

The family uses Agentic Mermaid typography, theme tokens, readable padding and deterministic styling.
Mermaid is the syntax and semantic oracle; its pixels and layout are not rendering targets.
Authored fill, stroke, text color, stroke width and dash arrays reach Scene paint. Font size and normal, bold or numeric font weight are measured before placement and retained by the rendered compartment text. Whitespace between dash lengths is preserved so `5 5` remains a two-length border pattern.

## Executable evidence

The first official example is retained in requirement-demo.mmd. The pin-oracle bench runs original grammar/database assertions and all nine documentation inputs against independent Mermaid model snapshots. Generated relationship-ID spelling is an implementation-owned exclusion; unique native identities are tested.

Regenerate a review artifact from the retained source:

```sh
bun run bin/am.ts render docs/design/families/requirement-demo.mmd --format svg --output /tmp/requirement-demo.svg
bun run bin/am.ts render docs/design/families/requirement-demo.mmd --format png --output /tmp/requirement-demo.png
```

Why: make the official family example inspectable in Agentic's visual language.
What to inspect: the domain hallmark, complete authored labels, actual containment and endpoint correspondence.
Review artifacts are generated outside the tracked source tree.

## Community references

Upstream #6219 supplies the unified box model, #6386 fixes the containment endpoint and #7445 restores <<relation>> labels. All are included in the pin. https://github.com/mermaid-js/mermaid/pull/6219

Pele's MIT-licensed implementations informed bounded placement and parser contracts;
see [the retained license](../../../LICENSES/pele-MIT.txt). Its compatibility target,
rendering policies and editing API do not replace Agentic's own contracts.
