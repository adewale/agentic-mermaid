# Swimlane

Syntax target: Mermaid 12.2.0, commit `1fb7869866dd619168d840291c9c54b4f129758b`.
The [pinned official syntax](https://github.com/mermaid-js/mermaid/blob/1fb7869866dd619168d840291c9c54b4f129758b/packages/mermaid/src/docs/syntax/swimlanes.md)
and [domain reference](https://en.wikipedia.org/wiki/Swimlane) establish the
family hallmark: Responsibility lanes group tasks by participant; directed connections expose handoffs across those responsibilities.

## Semantics and editing

The explicit `swimlane-beta` header uses the shared Flowchart graph grammar.
Top-level subgraphs define lanes; nested subgraphs remain containers within
their lane. Node shapes, authored edge identities, labels and parentage remain
part of the graph rather than being flattened into lane captions.

Use `asSwimlane` after parsing and `describeOps('swimlane')` for the current
operation schema. Unsupported graph syntax stays opaque. The older bare
`swimlane` graph keyword retains its established Flowchart identity; use the
beta header to request native responsibility lanes.

## Placement and limitations

The native layout assigns equal responsibility bands and packs disconnected
tasks along the process direction. Independent handoffs retain distinct routes
instead of sharing an unlabelled bus. Terminal layout owns cell-space lanes,
parent regions and endpoint-connected handoffs independently of pixel placement.

## Executable evidence

The [order-fulfilment scenario](../../../eval/layout-compare/fixtures/swimlane-native.mmd)
combines two responsibilities, a decision and cross-lane handoffs. The
[independent citizenship expectations](../../../src/__tests__/helpers/family-conformance-profiles.ts)
assert exact lane membership and edge endpoints before and after a decision-label
edit.

[Swimlane tests](../../../src/__tests__/swimlane.test.ts) protect nested
membership, equal bands in all four directions, collision-safe implicit lanes,
terminal endpoint ownership and absence of overlapping independent handoff
segments. The [Excalidraw golden](../../../src/__tests__/testdata/styled/swimlane-basic.excalidraw.svg)
shows the responsibility bands under a sketch style.

For shared style/configuration rules and cross-output checks, see the
[common rendering and verification contract](README.md#shared-rendering-and-verification).
