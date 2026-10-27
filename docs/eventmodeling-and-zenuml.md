# Event Modeling and ZenUML

Event Modeling is a native family. `parseRegisteredMermaid`, `asEventModeling`,
`serializeMermaid`, `createMermaid`, `buildMermaid`, checked mutations, facts,
accessibility trees, verification, SVG/PNG and terminal output use the same
frame identities and directed relations. Registry discovery also supplies the
browser loader, editor examples, CLI and MCP authoring menu.

```ts
const cart = buildMermaid('eventmodeling', [
  { kind: 'insert_frame', frame: {
    id: '01', reset: false, type: 'ui', entity: 'Cart.UI', sources: [],
  } },
  { kind: 'insert_frame', frame: {
    id: '02', reset: false, type: 'command', entity: 'Cart.AddItem', sources: [],
    data: { text: ' description: string ' },
  } },
])
```

Frame IDs are one to three authored digits; source order determines time.
`set_frame` replaces a frame while retaining its ID, including its type,
namespace, data and explicit source references. `move_frame` changes time;
`remove_frame` rejects dangling data/specification/relationship ownership.
`set_data` changes a named data block. Rejected edits leave the input unchanged.

Compact and relaxed frame/type names, qualified entities, reset frames,
explicit references, inline and named data, notes, declared entities,
Given/When/Then specifications, titles and accessibility metadata have native
representations. References replace inference. A reset frame receives only its
explicit references; ordinary frames without references connect to the latest
frame in a different lane. A namespace can return without allocating a new lane.
SVG uses chronological columns in namespace/band lanes; terminal output depicts
the directed graph and names each frame's lane rather than promising pixel
geometry in cells. Unknown statements and duplicate IDs stay opaque and retain
the original source; they cannot accept structured edits.

Compact frame declarations can share a line; writers emit one statement per
line. Line and multiline comments are read outside data payloads. Data, notes and specifications are retained
and displayed. `set_entities`, `set_notes` and `set_specifications` replace those
owned records atomically, with reference validation.
Titles are written as one merged YAML metadata field; accessibility uses native
comments because the shipped pinned parser rejects those in-body statements.
Agentic paints the title, while the upstream renderer currently omits it.
The maturity remains `experimental` under the pinned policy; upstream stability
classification is unresolved. This is not a complete-library support claim.

## Native ZenUML

ZenUML uses the same public authoring and output surfaces as the other native
families: `parseRegisteredMermaid`, `asZenUML`, `createMermaid`, checked mutations,
serialization, facts, accessibility trees, verification, SVG/PNG, terminal, CLI,
MCP and the browser editor. The family remains experimental.

The authored model retains participant declarations and aliases, annotations,
stereotypes, starter, nested calls, assignments, object creation, explicit
messages/replies, returns, comments and control branches. Implicit participants
are resolved by the shared semantic projection; they need no invented source
declarations. Statement IDs are local editing addresses, while participant IDs
are authored identities. Unsupported constructs preserve the whole source and
refuse structured edits and partial rendering.

```ts
const parsed = parseRegisteredMermaid(`zenuml
Buyer as Customer
API
Stock
Buyer->API.checkout() {
  Stock.reserve()
}`)
if (parsed.ok) {
  const zen = asZenUML(parsed.value)
  if (zen) {
    const changed = mutateChecked(zen, {
      kind: 'rename_participant', id: 'Stock', newId: 'Inventory',
    })
    if (changed.ok) console.log(serializeMermaid(changed.value))
  }
}
```

`upsert_participant`, `remove_participant`, `rename_participant`,
`insert_statement`, `set_statement` and `remove_statement` validate references
and reparse canonical output before committing. Renaming updates nested
endpoints and the starter atomically. Title and accessibility edits use the
existing metadata authority, preserving unrelated YAML. An alias coupling the
title to another configuration value returns `INVALID_OP` without changing the
input. Writers emit portable ZenUML; reference checks use the real parser in
**@zenuml/core 3.47.9**, alongside Mermaid **12.2.0** and the first-party addon
**1.0.1**. The addon's no-op parser shim does not establish syntax correctness.

### Shared rendering, Looks and palettes

Zen owns authored semantics. Its direct Sequence-model projection reuses the
existing measured Sequence layout, Scene lowering, positioned geometry and
terminal compositor. It preserves nested parent identities, call/return
direction, activation scopes and creation timing. Outside calls use an internal
anchor without inventing an authored participant or visible header. Pixel and
terminal geometry remain in their existing output adapters.

Assignments retain their name and optional type. When a call or constructor
has an explicit return, its incoming label includes the assignment and the
return keeps its own label. Self-calls also keep the assignment on their label;
otherwise an implicit reply carries it. An unrelated callback reply does not
replace the owning call's result.

Full Looks and palettes use the standard style authority and drawing backends:

```ts
const svg = renderMermaidSVG(source, {
  style: ['hand-drawn', 'dracula'],
})
```

The reviewed checkout fixture also exercises `patent-drawing` with
`github-light` and `watercolor` with `solarized-light`, including aliases,
branch returns, nested activations and object creation. Role overrides follow
the ordinary native Scene path. The family declares only Scene primitives that
its native model can actually produce. It does not promise Sequence features
that Zen does not model, such as participant boxes or destroy statements.

### Asynchronous entry and upstream migration

`agentic-mermaid/zenuml` now renders natively in Node and browsers, without a
backend URL or iframe:

```ts
import { createZenUMLRenderer, renderZenUMLSVG } from 'agentic-mermaid/zenuml'
const svg = await renderZenUMLSVG(source, { style: ['watercolor', 'solarized-light'] })
const renderer = createZenUMLRenderer({ style: 'github-light' })
try {
  const preview = await renderer.render(source, { style: ['hand-drawn', 'dracula'] })
} finally {
  renderer.dispose()
}
```

Sessions serialize requests, admit at most 32 pending calls, capture options at
submission and retain no source/SVG result cache. Disposal rejects active and
queued calls. `timeoutMs` includes asynchronous dependency loading after a
request starts; it excludes queue time and cannot interrupt synchronous layout.
The separately built entry has its own style registry. Built-in names and
inline `StyleSpec` values work; custom names registered in another bundle must
be resolved there and passed inline.

The previous isolated browser renderer remains explicitly available as
`createUpstreamZenUMLRenderer` and `renderUpstreamZenUMLSVG`, with
`backendURL` pointing to the shipped `dist/zenuml-frame.global.js`. It retains
the upstream geometry and paint-only palette adapter; full native Looks and
checked editing belong to the native path. Passing `backendURL` to the native
entry reports the migration rather than silently selecting the old renderer.
The published package still includes that optional frame: lazy loading avoids
requests, not installation bytes.

Historical benchmark results retain their recorded implementation and
configuration. Native default-entry results, explicit upstream results and
configured Mermaid reference results are separate measurements.

See [Event Modeling composition and visual contract](design/families/eventmodeling.md)
for the #409 reuse trace and Event style witnesses. Generous Event reads of
missing or reordered Given/When/Then markers report `UNSUPPORTED_SYNTAX`;
export writes the portable clause order. `EVENT_SOURCE_TYPE` warns when an
explicit source violates the pinned domain rule; rendering preserves the
authored connection. Private Langium service-registry wiring is not a native
Agentic contract.
