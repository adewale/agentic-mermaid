# Wardley

Syntax target: Mermaid 12.2.0, commit `1fb7869866dd619168d840291c9c54b4f129758b`.
The [pinned official syntax](https://github.com/mermaid-js/mermaid/blob/1fb7869866dd619168d840291c9c54b4f129758b/packages/mermaid/src/docs/syntax/wardley.md)
and [domain reference](https://en.wikipedia.org/wiki/Wardley_map) establish the
family hallmark: Components occupy authored visibility and evolution coordinates; dependencies form a value chain, and evolution arrows describe movement along the evolution axis.

## Semantics and editing

The native body preserves components and anchors, dependency direction and
labels, pipelines, evolution targets, notes, annotations, accelerators and
component decorators. Moving a pipeline parent keeps its children at the
parent's visibility coordinate and keeps related evolution targets coherent.

Use `asWardley` after parsing and `describeOps('wardley')` for the current
operation schema. Edits must have a complete Mermaid spelling; unsupported
source stays opaque instead of losing map features. Authored coordinates are
semantic input, not suggestions for an automatic graph layout.

## Placement and limitations

The renderer preserves component coordinates and adjusts automatic captions
rather than moving components to remove text collisions. Short owned leaders
connect displaced captions to their components. Explicit label offsets remain
authored constraints. Pipeline spans, axes and evolution/dependency artwork
retain their distinct roles; dense caption avoidance can increase layout work.

Rendering uses the shared style and palette system; Mermaid's pixels are not a
layout target. Accepted Mermaid configuration keys and ineffective controls come
from the [family registry](../../../src/agent/family-registry.ts), rather than an
independent configuration list here.

## Executable evidence

The [platform-evolution scenario](../../../eval/layout-compare/fixtures/wardley-native.mmd)
combines a value chain, pipeline, decorators, annotations and an evolution
arrow. The [independent citizenship expectations](../../../src/__tests__/helpers/family-conformance-profiles.ts)
assert exact component coordinates, pipeline membership, dependency direction
and annotation content before and after an evolution edit.

[Wardley tests](../../../src/__tests__/wardley-native.test.ts) protect
pipeline visibility, complete builder-value round-trips, negative authored label
offsets, dense caption separation without coordinate changes, and dashed
relationship paint. The [publication-figure golden](../../../src/__tests__/testdata/styled/wardley-basic.publication-figure.svg)
shows the map in the shared typographic system.

The [citizenship test](../../../src/__tests__/diagram-family-citizenship.test.ts)
checks the representative source through typed editing, canonical reload,
verification, SVG, ASCII/Unicode, real regions and uncached determinism. The
[render conformance portfolio](../../../src/__tests__/render-conformance-plan.test.ts)
and [styled-output tests](../../../src/__tests__/styled-output.test.ts) exercise
shared looks and palettes. These finite examples do not establish exhaustive
syntax coverage or readability at arbitrary complexity.
