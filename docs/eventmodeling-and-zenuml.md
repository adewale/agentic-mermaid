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

## Optional ZenUML rendering

ZenUML remains losslessly preserved in the core parser. It has no native Agentic
semantic model or typed edits. The optional entry provides an asynchronous,
browser-only rendering backend using exact **@zenuml/core 3.47.9**. No DOM shim,
Node renderer, terminal renderer, CLI, MCP or hosted ZenUML render path is
advertised. Existing synchronous APIs retain their unsupported-family error.

Serve the shipped `dist/zenuml-frame.global.js` as a static asset and call:

```ts
import { renderZenUMLSVG } from 'agentic-mermaid/zenuml'
const svg = await renderZenUMLSVG(`zenuml
  title Demo
  Alice->John: Hello John
  John->Alice: Great!`, {
  backendURL: new URL('/assets/zenuml-frame.global.js', location.href),
})
```

The backend script runs in a disposable iframe because its upstream dependency
injects global CSS when imported. The frame validates syntax through ZenUML's
own parser, awaits completion, checks SVG bounds and active/external content,
then returns native SVG. It is removed after success, failure or timeout.
`UNSUPPORTED_RUNTIME`, `BACKEND_UNAVAILABLE`, `INVALID_SOURCE` and
`RENDER_FAILED` distinguish those outcomes. Passing an Agentic `style` to this optional API returns `UNSUPPORTED_APPEARANCE` instead of silently rendering the vendor theme. The consumer must permit its
same-origin frame and script under its CSP. A blocked script expires as
`BACKEND_UNAVAILABLE`. This entry does not promise Agentic style presets or full
Mermaid theme equivalence; it uses ZenUML's Mermaid theme.

The configured reference is Mermaid 12.2.0 plus
@mermaid-js/mermaid-zenuml 1.0.1 and core 3.47.9, with external registration
awaited before rendering. That first-party configuration is a positive control,
not an independent renderer vote. The addon's parser shim is not a syntax oracle.
Historical default-core Dave results retain all 32 ZenUML failures and their
original 1,095-occurrence denominator. Optional backend evidence uses a separate
configuration identity and never reclassifies those default-entry failures.

Title edits preserve unrelated YAML values. If an alias couples the title to another configuration value, the edit returns `INVALID_OP` atomically; remove that coupling before editing the title. Generous reads of missing or reordered Given/When/Then clause markers report `UNSUPPORTED_SYNTAX`; export writes the portable clause order.

See [Event Modeling composition and visual contract](design/families/eventmodeling.md) for the concrete #409 reuse trace, aesthetic thesis, style/palette witnesses and remaining limits. `ZENUML_CAPABILITIES` explicitly reports `nativeScene`, `styles` and `palettes` as false; the fixed upstream theme is separate from native style support.
