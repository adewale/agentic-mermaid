# TreeView

Syntax target: Mermaid 12.2.0, commit `1fb7869866dd619168d840291c9c54b4f129758b`.
The [pinned official syntax](https://github.com/mermaid-js/mermaid/blob/1fb7869866dd619168d840291c9c54b4f129758b/packages/mermaid/src/docs/syntax/treeView.md)
and [domain reference](https://en.wikipedia.org/wiki/Tree_view) establish the
family hallmark: Indented file and directory rows have an ordered parent hierarchy, with branch guides that make sibling continuation visible.

## Semantics and editing

The native body preserves file/directory type, ordered parentage, descriptions,
class annotations, icon references, title and accessibility text. Indented and
box-drawing source forms share the same hierarchy model.

Use `asTreeview` after parsing and `describeOps('treeview')` for the current
operation schema. Node IDs are positional reader addresses: structural edits
can renumber them, so read IDs from the returned diagram before the next edit.
Moves reject ancestry cycles. Unmodeled source stays opaque.

## Placement and limitations

Measured rows reserve separate space for labels, descriptions and icon artwork.
Known bundled icons render offline; an unavailable icon uses an explicit compact
fallback badge while its authored reference stays in the model. This does not
claim a fetched or exact copy of an unknown logo. Terminal output draws its own
sibling-continuation guides. PNG coverage for CJK text requires an appropriate
installed caller font.

Rendering uses the shared style and palette system; Mermaid's pixels are not a
layout target. Accepted Mermaid configuration keys and ineffective controls come
from the [family registry](../../../src/agent/family-registry.ts), rather than an
independent configuration list here.

## Executable evidence

The [project-tree scenario](../../../eval/layout-compare/fixtures/treeview-native.mmd)
combines nested directories, multiple roots, a description, a highlight and an
icon. The [independent citizenship expectations](../../../src/__tests__/helpers/family-conformance-profiles.ts)
assert each row's type and parent, exact branch endpoints and retained annotation
facts before and after a filename edit.

[TreeView tests](../../../src/__tests__/treeview-native.test.ts) protect
cycle rejection, subtree movement with canonical returned IDs, description
bounds, source locations, terminal continuation guides and offline icon/fallback
artwork. The [pen-and-ink golden](../../../src/__tests__/testdata/styled/treeview-basic.pen-and-ink.svg)
shows the same hierarchy with styled ink.

The [citizenship test](../../../src/__tests__/diagram-family-citizenship.test.ts)
checks the representative source through typed editing, canonical reload,
verification, SVG, ASCII/Unicode, real regions and uncached determinism. The
[render conformance portfolio](../../../src/__tests__/render-conformance-plan.test.ts)
and [styled-output tests](../../../src/__tests__/styled-output.test.ts) exercise
shared looks and palettes. These finite examples do not establish exhaustive
syntax coverage or readability at arbitrary complexity.
