# Venn

Syntax target: Mermaid 12.2.0, commit `1fb7869866dd619168d840291c9c54b4f129758b`.
The [pinned official syntax](https://github.com/mermaid-js/mermaid/blob/1fb7869866dd619168d840291c9c54b4f129758b/packages/mermaid/src/docs/syntax/venn.md)
and [domain reference](https://en.wikipedia.org/wiki/Venn_diagram) establish the
family hallmark: Overlapping sets identify membership and intersections; authored quantities and text remain attached to their exact set combination.

## Semantics and editing

The native body retains singleton sets, intersection values, region labels,
owned text and authored styles. Renaming a set updates actual region, text and
style references; collisions and dangling deletions are rejected atomically.

Use `asVenn` after parsing and `describeOps('venn')` for the current operation
schema. Source without a complete typed spelling stays opaque. Exact numerical
values remain in the model and terminal output even when the circular drawing
cannot realize them.

## Placement and limitations

Two-circle placement preserves feasible set areas and pairwise overlap.
Three-plus-set overlap fitting is approximate; an intersection larger than a
containing set is also not geometrically realizable. Verification reports
`VENN_APPROXIMATION` for these cases; see the [warning catalog](../../../AGENT_NATIVE.md).
A complete measured caption fits inside its region or uses an owned outside
callout, without changing the circle quantities to make room for text.

Rendering uses the shared style and palette system; Mermaid's pixels are not a
layout target. Accepted Mermaid configuration keys and ineffective controls come
from the [family registry](../../../src/agent/family-registry.ts), rather than an
independent configuration list here.

## Executable evidence

The [membership scenario](../../../eval/layout-compare/fixtures/venn-native.mmd)
combines two sets, an intersection and an owned note. The
[independent citizenship expectations](../../../src/__tests__/helpers/family-conformance-profiles.ts)
assert exact values and text ownership, the authored set-area ratio and an edit
to the intersection quantity.

[Venn tests](../../../src/__tests__/venn-native.test.ts) independently check
circle and lens areas, extreme finite quantities, reference-safe renaming,
approximation warnings and whole-caption containment or callout ownership. The
[hand-drawn golden](../../../src/__tests__/testdata/styled/venn-basic.hand-drawn.svg)
shows the overlapping-set metaphor.

The [citizenship test](../../../src/__tests__/diagram-family-citizenship.test.ts)
checks the representative source through typed editing, canonical reload,
verification, SVG, ASCII/Unicode, real regions and uncached determinism. The
[render conformance portfolio](../../../src/__tests__/render-conformance-plan.test.ts)
and [styled-output tests](../../../src/__tests__/styled-output.test.ts) exercise
shared looks and palettes. These finite examples do not establish exhaustive
syntax coverage or readability at arbitrary complexity.
