# Cynefin

Syntax target: Mermaid 12.2.0, commit `1fb7869866dd619168d840291c9c54b4f129758b`.
The [pinned official syntax](https://github.com/mermaid-js/mermaid/blob/1fb7869866dd619168d840291c9c54b4f129758b/packages/mermaid/src/docs/syntax/cynefin.md)
and [domain reference](https://en.wikipedia.org/wiki/Cynefin_framework) establish the
family hallmark: Items belong to the complex, complicated, clear, chaotic or confusion domain; directed transitions describe movement between decision contexts.

## Semantics and editing

The native body preserves ordered domain items, repeated item labels, transition
endpoints and captions, plus title and accessibility text. An item is identified
within its domain rather than deduplicated by label. Repeated domain declarations
that would overwrite earlier items are refused by the native parser.

Use `asCynefin` after parsing and `describeOps('cynefin')` for the current
operation schema. Source without a complete typed spelling stays opaque.
Authored self-transitions are retained rather than dropped to copy Mermaid;
see the [recorded divergence](../../project/divergences.md).

## Placement and limitations

Five named domains remain visible, with confusion at the center. Measured item
rows can enlarge the domains; their areas are not a quantitative encoding.
Repeated, reverse and self-transitions use separate exterior channels with
owned captions. This trades canvas size for legibility and does not establish
readability at arbitrary density.

Rendering uses the shared style and palette system; Mermaid's pixels are not a
layout target. Accepted Mermaid configuration keys and ineffective controls come
from the [family registry](../../../src/agent/family-registry.ts), rather than an
independent configuration list here.

## Executable evidence

The [decision scenario](../../../eval/layout-compare/fixtures/cynefin-native.mmd)
combines all five domains and two transitions. The
[independent citizenship expectations](../../../src/__tests__/helpers/family-conformance-profiles.ts)
assert domain membership, item containment and exact transition endpoints before
and after an item edit.

[Cynefin tests](../../../src/__tests__/cynefin-native.test.ts) independently
check label-box separation, unrelated-domain avoidance, retained loop labels and
large confusion-domain containment. The [chalkboard golden](../../../src/__tests__/testdata/styled/cynefin-basic.chalkboard.svg)
shows the styled domain metaphor.

The [citizenship test](../../../src/__tests__/diagram-family-citizenship.test.ts)
checks the representative source through typed editing, canonical reload,
verification, SVG, ASCII/Unicode, real regions and uncached determinism. The
[render conformance portfolio](../../../src/__tests__/render-conformance-plan.test.ts)
and [styled-output tests](../../../src/__tests__/styled-output.test.ts) exercise
shared looks and palettes. These finite examples do not establish exhaustive
syntax coverage or readability at arbitrary complexity.
