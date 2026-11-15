# Ishikawa

Syntax target: Mermaid 12.2.0, commit `1fb7869866dd619168d840291c9c54b4f129758b`.
The [pinned official syntax](https://github.com/mermaid-js/mermaid/blob/1fb7869866dd619168d840291c9c54b4f129758b/packages/mermaid/src/docs/syntax/ishikawa.md)
and [domain reference](https://en.wikipedia.org/wiki/Ishikawa_diagram) define the recognizable hallmark: A fishbone diagram has a causal spine ending in one effect, with alternating category bones and nested contributing causes.

## Semantics and editing

The first item is the effect. Subsequent indentation expresses category and cause parentage. The model preserves nested causes and authored order; typed edits keep parent references and reject cycles. Stable and beta header aliases are accepted.

Use `asIshikawa` after parsing and `describeOps('ishikawa')` for the live operation schema.
Unknown syntax stays preserved as an opaque body and does not pretend to support structured mutation.
Leading wrappers are preserved by the shared source envelope.

## Placement and aesthetics

The family allocates measured cause rows and category reach envelopes before placing its fishbone branches. Shared text preparation, Scene connectors, shapes and owned bounds supply artwork. Terminal output independently retains the causal spine and hierarchy in cell space; it does not borrow pixel placement.

The family uses Agentic Mermaid typography, theme tokens, readable padding and deterministic styling.
Mermaid is the syntax and semantic oracle; its pixels and layout are not rendering targets.

## Executable evidence

The full primary Blurry Photo example is retained in ishikawa-demo.mmd. Hierarchy/indentation, typed-move and independent fishbone geometry tests protect the recognizable domain metaphor.

Regenerate a review artifact from the retained source:

```sh
bun run bin/am.ts render docs/design/families/ishikawa-demo.mmd --format svg --output /tmp/ishikawa-demo.svg
bun run bin/am.ts render docs/design/families/ishikawa-demo.mmd --format png --output /tmp/ishikawa-demo.png
```

Why: make the official family example inspectable in Agentic's visual language.
What to inspect: the domain hallmark, complete authored labels, actual containment and endpoint correspondence.
Review artifacts are generated outside the tracked source tree.

## Community references

Upstream #7474, included in the pin, sets cause indentation relative to the first cause rather than the effect line. Open draft #7891 proposes empty spacer branches; native measured clearance addresses the motivation without adopting that unmerged syntax. https://github.com/mermaid-js/mermaid/pull/7474

Pele's MIT-licensed implementations informed bounded placement and parser contracts;
see [the retained license](../../../LICENSES/pele-MIT.txt). Its compatibility target,
rendering policies and editing API do not replace Agentic's own contracts.
