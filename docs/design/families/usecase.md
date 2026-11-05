# UseCase

Syntax target: Mermaid 12.2.0, commit `1fb7869866dd619168d840291c9c54b4f129758b`.
The [pinned official syntax](https://github.com/mermaid-js/mermaid/blob/1fb7869866dd619168d840291c9c54b4f129758b/packages/mermaid/src/docs/syntax/usecase.md)
and [domain reference](https://en.wikipedia.org/wiki/Use_case_diagram) establish the
family hallmark: Actors participate in named use cases inside system boundaries; association, inclusion, extension and generalization remain distinct relationships.

## Semantics and editing

The native body distinguishes actors from use cases and retains direction,
boundary membership, typed relationships, notes, JSON records, class definitions
and metadata. Typed edits operate on the modeled identities and reject broken
references atomically.

Use `asUsecase` after parsing and `describeOps('usecase')` for the current
operation schema. A parsed feature is not necessarily a dedicated mutation
operation; inspect that schema before editing it. Source outside the native
grammar remains opaque rather than being rewritten as a partial model.

## Placement and limitations

Actors retain their person silhouette and use cases their ellipses, with labels
measured as part of their envelopes. System boundaries retain owned members.
Include/extend dependencies keep their stereotype and dashed shaft; graph
projection preserves typed endpoints. A qualified unconstrained forest can use
the native producer; compounds, cycles and explicit choices keep their existing
layout path.

Rendering uses the shared style and palette system; Mermaid's pixels are not a
layout target. Accepted Mermaid configuration keys and ineffective controls come
from the [family registry](../../../src/agent/family-registry.ts), rather than an
independent configuration list here.

## Executable evidence

The [storefront scenario](../../../eval/layout-compare/fixtures/usecase-native.mmd)
combines a customer actor, system boundary, two use cases and an include
relationship. The [independent citizenship expectations](../../../src/__tests__/helpers/family-conformance-profiles.ts)
assert node kinds, boundary membership and relation types before and after a
direction edit.

[UseCase tests](../../../src/__tests__/usecase-native.test.ts) independently
check ellipse-outline contacts for parallel and reciprocal links, retained JSON
property order, atomic edits and visible dashed dependency paint. The
[architectural-plan golden](../../../src/__tests__/testdata/styled/usecase-basic.architectural-plan.svg)
shows the actor, boundary and dependency artwork.

The [citizenship test](../../../src/__tests__/diagram-family-citizenship.test.ts)
checks the representative source through typed editing, canonical reload,
verification, SVG, ASCII/Unicode, real regions and uncached determinism. The
[render conformance portfolio](../../../src/__tests__/render-conformance-plan.test.ts)
and [styled-output tests](../../../src/__tests__/styled-output.test.ts) exercise
shared looks and palettes. These finite examples do not establish exhaustive
syntax coverage or readability at arbitrary complexity.
