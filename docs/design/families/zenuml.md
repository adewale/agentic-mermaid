# ZenUML

Syntax target: Mermaid 12.2.0, commit `1fb7869866dd619168d840291c9c54b4f129758b`.
The [pinned official syntax](https://github.com/mermaid-js/mermaid/blob/1fb7869866dd619168d840291c9c54b4f129758b/packages/mermaid/src/docs/syntax/zenuml.md)
and [sequence-diagram domain reference](https://en.wikipedia.org/wiki/Sequence_diagram)
define the hallmark: participant lifelines carry ordered interactions, while
nested calls and control scopes retain the caller, return destination and branch
that give each message its meaning.

## Semantics and editing

The native body retains participant aliases and annotations, calls, messages,
assignments, returns, object creation, notes and nested control branches. Calls
and returns are projected together rather than reconstructed from message text.
Narrow with `asZenUML` and use `describeOps('zenuml')` for the current operation
schema. Returned statement identities should be read before a later edit.

Unsupported statements preserve the complete source. They do not authorize a
partial native drawing or typed rewrite that would discard an unknown scope.
The explicit asynchronous browser backend remains a separate opt-in iframe path;
native rendering and editing do not require it.

## Executable evidence

The [checkout scenario](../../../eval/layout-compare/fixtures/zenuml-native-checkout.mmd)
combines a starter, an alias, an assigned nested call, conditional returns and
object creation. Its [independent citizenship expectations](../../../src/__tests__/helpers/family-conformance-profiles.ts)
assert participant identities, ordered directed interactions and branch ownership
before and after a participant rename.

[Native parser/model tests](../../../src/__tests__/zenuml-native.test.ts) protect
actual callers and return destinations, lexical scope order, empty branches,
assignments, object creation and canonical read-back. [Native rendering tests](../../../src/__tests__/zenuml-native-render.test.ts)
check the resulting graphical and terminal paths. The
[hand-drawn Dracula golden](../../../src/__tests__/testdata/styled/zenuml-native-checkout.hand-drawn.dracula.svg)
shows the representative scenario with a composed look and palette.

For shared style/configuration rules and cross-output checks, see the
[common rendering and verification contract](README.md#shared-rendering-and-verification).
