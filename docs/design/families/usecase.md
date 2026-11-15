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

For strict grammar inspection, `parseUsecaseModel` exposes the actual native
model and statement occurrences; see the [typed parser API](../../api.md#typed-parsers)
for source-coordinate units. Editable parsing computes its source map from that
same grammar result. Body nodes follow their first authored occurrence while
using the final resolved declaration, including references before declarations.
The serializer's independent portability check remains in place.

## Placement and limitations

Actors retain their person silhouette and use cases their ellipses, with labels
measured as part of their envelopes. System boundaries retain owned members.
Include/extend dependencies keep their stereotype and dashed shaft; graph
projection preserves typed endpoints. A qualified unconstrained forest can use
the native producer; compounds, cycles and explicit choices keep their existing
layout path.

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

For shared style/configuration rules and cross-output checks, see the
[common rendering and verification contract](README.md#shared-rendering-and-verification).
