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

The backend script runs in an isolated iframe because its upstream dependency
injects global CSS when imported. The frame validates syntax through ZenUML's
own parser, awaits completion, checks SVG bounds and active/external content,
then returns native SVG. Actual SVG ink bounds expand a viewport that would
otherwise clip a long title or nested sequence number. The one-shot API removes
its frame after success, failure or timeout.
`UNSUPPORTED_RUNTIME`, `BACKEND_UNAVAILABLE`, `INVALID_SOURCE` and
`RENDER_FAILED` distinguish those outcomes. The consumer must permit its
same-origin frame and script under its CSP. A blocked script expires as
`BACKEND_UNAVAILABLE`. A synchronous host Trusted Types refusal also returns
that typed error and releases the partial frame; this API does not create a
Trusted Types policy. Failure to load the optional palette module is a backend
availability error, distinct from an unsupported style input.

### Palettes and owned paint

Pass the existing named palette or a paint-only style stack as `style`:

```ts
const svg = await renderZenUMLSVG(source, {
  backendURL: '/assets/zenuml-frame.global.js',
  style: ['dracula', { roles: { edge: { strokeColor: '#8be9fd' } } }],
})
```

The shared style registry admits and composes the input; the existing color
resolver supplies palette tones and contrast repair. The optional adapter maps
those paints to explicit participant, message, reply, fragment and frame marks.
It preserves the backend's measured text, geometry, message direction and dashes.
Each request captures caller-owned style data before asynchronous admission;
changing that object after calling `render` cannot repaint the queued request.

Supported role fields are node/group `fillColor`, `borderColor`, `textColor`;
edge `strokeColor`, `textColor`; and label `textColor`. Named palettes and
explicit color values use the same syntax as native styles. Unresolved CSS
variables are unavailable at this standalone boundary. Full Looks, fonts,
padding, line widths, sketch/wash effects, bindings and constraints return
`UNSUPPORTED_APPEARANCE`; they are not silently approximated. The upstream
renderer fixes its own typography and layout, so this is palette/paint
integration rather than native Scene or full Look support.

The directly served browser entry bundles the same style authority for its own
module graph. Built-in palette names are available there; host registrations
in a separate native or `svg-styles` bundle do not cross that module boundary.
Resolve a custom registered palette through the host's existing
`resolveStyleStack` and pass the resulting concrete `StyleSpec` inline. This
does not require a second registration or a duplicate style resolver.

### Repeated browser rendering

For previews or batches, explicitly own a reusable renderer:

```ts
import { createZenUMLRenderer } from 'agentic-mermaid/zenuml'
const renderer = createZenUMLRenderer({
  backendURL: '/assets/zenuml-frame.global.js',
})
try {
  const light = await renderer.render(source, { style: 'github-light' })
  const dark = await renderer.render(source, { style: 'dracula' })
  // Omitting a per-call style inherits the session's default. An explicit
  // style: undefined resets that default to the unmodified vendor theme.
  const vendor = await renderer.render(source, { style: undefined })
} finally {
  renderer.dispose()
}
```

A session retains at most one frame and one parser, serializes requests, and
rejects submission above 32 pending calls. Each call parses and lays out its
source; there is no source/SVG result cache. The frame is replaced after 64
requests to bound upstream module caches. Invalid syntax can be followed by a
valid call in the same frame; backend failure or timeout discards the frame
before the next call. `timeoutMs` bounds an executing request, including palette
admission and frame startup, rather than time waiting behind earlier requests. Disposal rejects
active and queued calls, including calls waiting for palette-module admission,
and releases the frame. Consumers must dispose a session when its owner ends.
The deadline uses browser timers and cannot preempt synchronous vendor work.

One-shot and session timings describe different lifecycle configurations.
Browser-lazy loading does not remove npm-install bytes: the optional frame is
still included in the published package.

The configured reference is Mermaid 12.2.0 plus
@mermaid-js/mermaid-zenuml 1.0.1 and core 3.47.9, with external registration
awaited before rendering. That first-party configuration is a positive control,
not an independent renderer vote. The addon's parser shim is not a syntax oracle.
Historical default-core Dave results retain all 32 ZenUML failures and their
original 1,095-occurrence denominator. Optional backend evidence uses a separate
configuration identity and never reclassifies those default-entry failures.

Title edits preserve unrelated YAML values. If an alias couples the title to another configuration value, the edit returns `INVALID_OP` atomically; remove that coupling before editing the title. Generous reads of missing or reordered Given/When/Then clause markers report `UNSUPPORTED_SYNTAX`; export writes the portable clause order.

See [Event Modeling composition and visual contract](design/families/eventmodeling.md) for the concrete #409 reuse trace, aesthetic thesis, style/palette witnesses and remaining limits. `ZENUML_CAPABILITIES` reports palette and role-paint support separately from `nativeScene: false` and `styles: false`; full native Looks remain unavailable.
