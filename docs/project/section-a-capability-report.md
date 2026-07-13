# Section A capability report

> Generated from live registries and manifests by `sectionACapabilityReportMarkdown`. Do not edit by hand.

Report digest: `fnv1a64:5fe742b919ee4680`.

## Summary

| Measure | Count |
|---|---:|
| sharedRequestFieldCount | 29 |
| hostOnlyRequestFieldCount | 1 |
| registeredBackendCount | 3 |
| outputCount | 6 |
| resourceCount | 10 |
| registeredFamilyCount | 14 |
| upstreamPublicFamilyCount | 31 |
| upstreamNativeHeaderCount | 17 |
| upstreamUnsupportedHeaderCount | 28 |
| upstreamInventoryOnlyHeaderCount | 5 |
| scenePrimitiveCount | 7 |
| sceneRoleCount | 42 |
| evidenceSystemCount | 4 |
| retiredAuthorityCount | 15 |

## Contract versions

| Contract | Version |
|---|---|
| renderRequest | 1 |
| scene | 1 |
| outputSecurity | 2 |
| backendConformance | 1 |
| outputColor | 1 |
| terminalStyle | 1 |
| resourceManifest | 1 |
| upstreamManifest | 4 |
| familyDescriptorVersions | 1 |

## State vocabularies

| Dimension | Values |
|---|---|
| requestKind | shared, host-only |
| requestTransport | accepted, excluded |
| requestReceipt | included, excluded |
| requestSchema | declared, not-applicable |
| backend | registered, scene-contracted |
| backendClaims | declared |
| backendConformance | registration-svg-smoke |
| outputAvailability | public, internal, reserved |
| outputSecurity | enforced, not-applicable, reserved |
| outputColor | srgb, terminal-projected, not-applicable, reserved |
| outputTerminal | projected, not-applicable, reserved |
| outputTransport | direct, projected, indirect, unavailable |
| resourceNetwork | forbidden |
| familySupport | native, partial-native, unsupported, inventory-only, extension |
| familyCapability | native, source-preserved, diagnosed, not-applicable, absent |

## Request matrix

| Field | Kind | Transport | Receipt | Schema |
|---|---|---|---|---|
| bg | shared | accepted | included | declared |
| fg | shared | accepted | included | declared |
| line | shared | accepted | included | declared |
| accent | shared | accepted | included | declared |
| muted | shared | accepted | included | declared |
| surface | shared | accepted | included | declared |
| border | shared | accepted | included | declared |
| font | shared | accepted | included | declared |
| style | shared | accepted | included | declared |
| padding | shared | accepted | included | declared |
| nodeSpacing | shared | accepted | included | declared |
| layerSpacing | shared | accepted | included | declared |
| wrappingWidth | shared | accepted | included | declared |
| componentSpacing | shared | accepted | included | declared |
| transparent | shared | accepted | included | declared |
| interactive | shared | accepted | included | declared |
| shadow | shared | accepted | included | declared |
| class | shared | accepted | included | declared |
| architecture | shared | accepted | included | declared |
| timeline | shared | accepted | included | declared |
| journey | shared | accepted | included | declared |
| gantt | shared | accepted | included | declared |
| mermaidConfig | shared | accepted | included | declared |
| embedFontImport | shared | accepted | included | declared |
| compact | shared | accepted | included | declared |
| idPrefix | shared | accepted | included | declared |
| security | shared | accepted | included | declared |
| ganttToday | shared | accepted | included | declared |
| seed | shared | accepted | included | declared |
| onConfigDiagnostic | host-only | excluded | excluded | not-applicable |

## Backend matrix

Primitive capability rows are declarations. The admission column is a bounded executable SVG smoke, while PNG inherits the admitted secured SVG through the canonical rasterizer.

| Backend | Version | Aliases | Registration | Scene input | Claim status | SVG admission | Primitives | Claims | Roles |
|---|---|---|---|---|---|---|---:|---:|---:|
| backend:default | 1.0.0 | default | registered | scene-contracted | declared | registration-svg-smoke passed | 7 | 38 | 42 |
| backend:hybrid | 1.0.0 | hybrid | registered | scene-contracted | declared | registration-svg-smoke passed | 7 | 38 | 42 |
| backend:rough | 1.0.0 | rough | registered | scene-contracted | declared | registration-svg-smoke passed | 7 | 38 | 42 |

### Backend registration conformance

| Backend | Fixture | Direct output | Inherited output | Checks |
|---|---|---|---|---|
| backend:default | backend-registration-svg-smoke@1 | svg | png via canonical-secured-svg-rasterizer (directly tested: false) | draw-node-determinism:pass, draw-node-semantics:pass, document-determinism:pass, single-svg-document:pass, finite-serialization:pass, output-security:pass, document-semantics:pass, container-semantics:pass, shape-semantics:pass, text-semantics:pass, connector-semantics:pass, marker-semantics:pass, data-mark-semantics:pass |
| backend:hybrid | backend-registration-svg-smoke@1 | svg | png via canonical-secured-svg-rasterizer (directly tested: false) | draw-node-determinism:pass, draw-node-semantics:pass, document-determinism:pass, single-svg-document:pass, finite-serialization:pass, output-security:pass, document-semantics:pass, container-semantics:pass, shape-semantics:pass, text-semantics:pass, connector-semantics:pass, marker-semantics:pass, data-mark-semantics:pass |
| backend:rough | backend-registration-svg-smoke@1 | svg | png via canonical-secured-svg-rasterizer (directly tested: false) | draw-node-determinism:pass, draw-node-semantics:pass, document-determinism:pass, single-svg-document:pass, finite-serialization:pass, output-security:pass, document-semantics:pass, container-semantics:pass, shape-semantics:pass, text-semantics:pass, connector-semantics:pass, marker-semantics:pass, data-mark-semantics:pass |

### Backend primitive claims

| Backend | Primitive | Feature | Operation | Realization | Evidence |
|---|---|---|---|---|---|
| backend:default | document | identity | serialize | native | src/__tests__/svg-equivalence.test.ts |
| backend:default | document | resources | serialize | native | src/__tests__/renderer-security.test.ts |
| backend:default | document | interaction | accessibility | native | src/__tests__/svg-a11y-conformance.test.ts |
| backend:default | text | geometry | render | native | src/__tests__/svg-equivalence.test.ts |
| backend:default | text | paint | render | native | src/__tests__/svg-equivalence.test.ts |
| backend:default | text | labels | accessibility | native | src/__tests__/svg-a11y-conformance.test.ts |
| backend:default | text | identity | serialize | native | src/__tests__/svg-equivalence.test.ts |
| backend:default | shape | geometry | render | native | src/__tests__/svg-equivalence.test.ts |
| backend:default | shape | paint | render | native | src/__tests__/svg-equivalence.test.ts |
| backend:default | shape | identity | serialize | native | src/__tests__/scene-transform.test.ts |
| backend:default | container | geometry | render | native | src/__tests__/svg-equivalence.test.ts |
| backend:default | container | paint | render | native | src/__tests__/svg-equivalence.test.ts |
| backend:default | container | identity | serialize | native | src/__tests__/scene-transform.test.ts |
| backend:default | connector | geometry | render | native | src/__tests__/scene-connector-contract.test.ts |
| backend:default | connector | stroke | render | native | src/__tests__/scene-connector-contract.test.ts |
| backend:default | connector | topology | render | native | src/__tests__/scene-connector-contract.test.ts |
| backend:default | connector | closedness | render | native | src/__tests__/scene-connector-contract.test.ts |
| backend:default | connector | stroke-opacity | render | native | src/__tests__/scene-connector-contract.test.ts |
| backend:default | connector | stroke-cap | render | native | src/__tests__/scene-connector-contract.test.ts |
| backend:default | connector | stroke-join | render | native | src/__tests__/scene-connector-contract.test.ts |
| backend:default | connector | stroke-miter | render | native | src/__tests__/scene-connector-contract.test.ts |
| backend:default | connector | dash-array | render | native | src/__tests__/scene-connector-contract.test.ts |
| backend:default | connector | dash-offset | render | native | src/__tests__/scene-connector-contract.test.ts |
| backend:default | connector | dash-restart | render | native | src/__tests__/scene-connector-contract.test.ts |
| backend:default | connector | path-length | render | native | src/__tests__/scene-connector-contract.test.ts |
| backend:default | connector | paint-order | render | native | src/__tests__/scene-connector-contract.test.ts |
| backend:default | connector | non-scaling-stroke | render | native | src/__tests__/scene-connector-contract.test.ts |
| backend:default | connector | marker-orientation | render | native | src/__tests__/scene-connector-contract.test.ts |
| backend:default | connector | relation | accessibility | native | src/__tests__/accessibility-relation-palette.test.ts |
| backend:default | connector | markers | render | native | src/__tests__/scene-connector-contract.test.ts |
| backend:default | connector | interaction | hit-test | native | src/__tests__/scene-connector-contract.test.ts |
| backend:default | connector | identity | serialize | native | src/__tests__/scene-connector-contract.test.ts |
| backend:default | marker | geometry | render | native | src/__tests__/scene-connector-contract.test.ts |
| backend:default | marker | paint | render | native | src/__tests__/scene-connector-contract.test.ts |
| backend:default | marker | identity | serialize | native | src/__tests__/scene-connector-contract.test.ts |
| backend:default | data-mark | geometry | render | native | src/__tests__/svg-equivalence.test.ts |
| backend:default | data-mark | paint | render | native | src/__tests__/svg-equivalence.test.ts |
| backend:default | data-mark | identity | serialize | native | src/__tests__/svg-equivalence.test.ts |
| backend:hybrid | document | identity | serialize | native | src/__tests__/styled-backend-paint.test.ts |
| backend:hybrid | document | resources | serialize | native | src/__tests__/renderer-security.test.ts |
| backend:hybrid | document | interaction | accessibility | native | src/__tests__/svg-a11y-conformance.test.ts |
| backend:hybrid | text | geometry | render | native | src/__tests__/styled-backend-paint.test.ts |
| backend:hybrid | text | paint | render | native | src/__tests__/styled-backend-paint.test.ts |
| backend:hybrid | text | labels | accessibility | native | src/__tests__/svg-a11y-conformance.test.ts |
| backend:hybrid | text | identity | serialize | native | src/__tests__/styled-backend-paint.test.ts |
| backend:hybrid | shape | geometry | render | emulated | src/__tests__/styled-backend-paint.test.ts |
| backend:hybrid | shape | paint | render | emulated | src/__tests__/styled-backend-paint.test.ts |
| backend:hybrid | shape | identity | serialize | native | src/__tests__/scene-transform.test.ts |
| backend:hybrid | container | geometry | render | emulated | src/__tests__/styled-backend-paint.test.ts |
| backend:hybrid | container | paint | render | emulated | src/__tests__/styled-backend-paint.test.ts |
| backend:hybrid | container | identity | serialize | native | src/__tests__/scene-transform.test.ts |
| backend:hybrid | connector | geometry | render | emulated | src/__tests__/scene-connector-contract.test.ts |
| backend:hybrid | connector | stroke | render | emulated | src/__tests__/scene-connector-contract.test.ts |
| backend:hybrid | connector | topology | render | emulated | src/__tests__/scene-connector-contract.test.ts |
| backend:hybrid | connector | closedness | render | lossy | src/__tests__/scene-connector-contract.test.ts |
| backend:hybrid | connector | stroke-opacity | render | emulated | src/__tests__/scene-connector-contract.test.ts |
| backend:hybrid | connector | stroke-cap | render | lossy | src/__tests__/scene-connector-contract.test.ts |
| backend:hybrid | connector | stroke-join | render | lossy | src/__tests__/scene-connector-contract.test.ts |
| backend:hybrid | connector | stroke-miter | render | lossy | src/__tests__/scene-connector-contract.test.ts |
| backend:hybrid | connector | dash-array | render | emulated | src/__tests__/scene-connector-contract.test.ts |
| backend:hybrid | connector | dash-offset | render | emulated | src/__tests__/scene-connector-contract.test.ts |
| backend:hybrid | connector | dash-restart | render | lossy | src/__tests__/scene-connector-contract.test.ts |
| backend:hybrid | connector | path-length | render | lossy | src/__tests__/scene-connector-contract.test.ts |
| backend:hybrid | connector | paint-order | render | emulated | src/__tests__/scene-connector-contract.test.ts |
| backend:hybrid | connector | non-scaling-stroke | render | lossy | src/__tests__/scene-connector-contract.test.ts |
| backend:hybrid | connector | marker-orientation | render | projected | src/__tests__/scene-connector-contract.test.ts |
| backend:hybrid | connector | relation | accessibility | native | src/__tests__/accessibility-relation-palette.test.ts |
| backend:hybrid | connector | markers | render | projected | src/__tests__/scene-connector-contract.test.ts |
| backend:hybrid | connector | interaction | hit-test | native | src/__tests__/scene-connector-contract.test.ts |
| backend:hybrid | connector | identity | serialize | native | src/__tests__/scene-connector-contract.test.ts |
| backend:hybrid | marker | geometry | render | projected | src/__tests__/scene-connector-contract.test.ts |
| backend:hybrid | marker | paint | render | projected | src/__tests__/scene-connector-contract.test.ts |
| backend:hybrid | marker | identity | serialize | native | src/__tests__/scene-connector-contract.test.ts |
| backend:hybrid | data-mark | geometry | render | emulated | src/__tests__/styled-backend-paint.test.ts |
| backend:hybrid | data-mark | paint | render | emulated | src/__tests__/styled-backend-paint.test.ts |
| backend:hybrid | data-mark | identity | serialize | native | src/__tests__/styled-backend-paint.test.ts |
| backend:rough | document | identity | serialize | native | src/__tests__/styled-backend-paint.test.ts |
| backend:rough | document | resources | serialize | native | src/__tests__/renderer-security.test.ts |
| backend:rough | document | interaction | accessibility | native | src/__tests__/svg-a11y-conformance.test.ts |
| backend:rough | text | geometry | render | native | src/__tests__/styled-backend-paint.test.ts |
| backend:rough | text | paint | render | native | src/__tests__/styled-backend-paint.test.ts |
| backend:rough | text | labels | accessibility | native | src/__tests__/svg-a11y-conformance.test.ts |
| backend:rough | text | identity | serialize | native | src/__tests__/styled-backend-paint.test.ts |
| backend:rough | shape | geometry | render | emulated | src/__tests__/styled-backend-paint.test.ts |
| backend:rough | shape | paint | render | emulated | src/__tests__/styled-backend-paint.test.ts |
| backend:rough | shape | identity | serialize | native | src/__tests__/scene-transform.test.ts |
| backend:rough | container | geometry | render | emulated | src/__tests__/styled-backend-paint.test.ts |
| backend:rough | container | paint | render | emulated | src/__tests__/styled-backend-paint.test.ts |
| backend:rough | container | identity | serialize | native | src/__tests__/scene-transform.test.ts |
| backend:rough | connector | geometry | render | emulated | src/__tests__/scene-connector-contract.test.ts |
| backend:rough | connector | stroke | render | emulated | src/__tests__/scene-connector-contract.test.ts |
| backend:rough | connector | topology | render | emulated | src/__tests__/scene-connector-contract.test.ts |
| backend:rough | connector | closedness | render | lossy | src/__tests__/scene-connector-contract.test.ts |
| backend:rough | connector | stroke-opacity | render | emulated | src/__tests__/scene-connector-contract.test.ts |
| backend:rough | connector | stroke-cap | render | emulated | src/__tests__/scene-connector-contract.test.ts |
| backend:rough | connector | stroke-join | render | emulated | src/__tests__/scene-connector-contract.test.ts |
| backend:rough | connector | stroke-miter | render | emulated | src/__tests__/scene-connector-contract.test.ts |
| backend:rough | connector | dash-array | render | emulated | src/__tests__/scene-connector-contract.test.ts |
| backend:rough | connector | dash-offset | render | emulated | src/__tests__/scene-connector-contract.test.ts |
| backend:rough | connector | dash-restart | render | lossy | src/__tests__/scene-connector-contract.test.ts |
| backend:rough | connector | path-length | render | lossy | src/__tests__/scene-connector-contract.test.ts |
| backend:rough | connector | paint-order | render | emulated | src/__tests__/scene-connector-contract.test.ts |
| backend:rough | connector | non-scaling-stroke | render | emulated | src/__tests__/scene-connector-contract.test.ts |
| backend:rough | connector | marker-orientation | render | projected | src/__tests__/scene-connector-contract.test.ts |
| backend:rough | connector | relation | accessibility | native | src/__tests__/accessibility-relation-palette.test.ts |
| backend:rough | connector | markers | render | projected | src/__tests__/scene-connector-contract.test.ts |
| backend:rough | connector | interaction | hit-test | native | src/__tests__/scene-connector-contract.test.ts |
| backend:rough | connector | identity | serialize | native | src/__tests__/scene-connector-contract.test.ts |
| backend:rough | marker | geometry | render | projected | src/__tests__/scene-connector-contract.test.ts |
| backend:rough | marker | paint | render | projected | src/__tests__/scene-connector-contract.test.ts |
| backend:rough | marker | identity | serialize | native | src/__tests__/scene-connector-contract.test.ts |
| backend:rough | data-mark | geometry | render | emulated | src/__tests__/styled-backend-paint.test.ts |
| backend:rough | data-mark | paint | render | emulated | src/__tests__/styled-backend-paint.test.ts |
| backend:rough | data-mark | identity | serialize | native | src/__tests__/styled-backend-paint.test.ts |

## Output matrix

This matrix covers render outputs only; hosted non-render tools such as `mutate` and `build` remain in the MCP tool registry.

| Output | Availability | Library | CLI | Code Mode | Local MCP | Hosted MCP | Editor | Website build | Security | Color | Terminal | Evidence |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| svg | public | direct: renderMermaidSVG | direct: am render (--format svg) | direct: mermaid.renderMermaidSVGWithReceipt | indirect: execute (mermaid.renderMermaidSVGWithReceipt) | direct: render_svg | direct: diagram preview / Save SVG (renderMermaidSVGWithReceipt) | direct: website build-time renderMermaidSVG (embedded examples and diagram assets) | enforced | srgb | not-applicable | output-security@2, render-contract@1 |
| png | public | direct: renderMermaidPNG | direct: am render (--format png) | unavailable: none — PNG rasterization is a host tool, not a sandbox SDK method | direct: render_png | direct: render_png | direct: Save PNG / Copy PNG (renderMermaidPNGInBrowserWithReceipt) | unavailable: none — The site build copies curated PNG assets but exposes no PNG render adapter | enforced | srgb | not-applicable | output-security@2, output-color-profile@1, png-output-policy@1, render-contract@1 |
| ascii | public | direct: renderMermaidASCII (useAscii: true) | direct: am render (--format ascii) | direct: mermaid.renderMermaidASCIIWithReceipt (useAscii: true) | indirect: execute (mermaid.renderMermaidASCIIWithReceipt({ useAscii: true })) | direct: render_ascii (useAscii: true) | direct: ASCII canvas tab (renderMermaidASCII({ useAscii: true })) | unavailable: none — The site build emits one Unicode diagram asset but no 7-bit ASCII output | enforced | terminal-projected | projected | terminal-style@1, terminal-output-policy@1, terminal-control-sanitization, render-contract@1 |
| unicode | public | direct: renderMermaidASCII (useAscii: false (default)) | direct: am render (--format unicode) | direct: mermaid.renderMermaidASCIIWithReceipt (useAscii: false (default)) | indirect: execute (mermaid.renderMermaidASCIIWithReceipt({ useAscii: false })) | direct: render_ascii (useAscii: false (default)) | direct: Unicode canvas tab (renderMermaidASCII({ useAscii: false })) | direct: website build-time renderMermaidASCII (diagrams/workflow.txt; useAscii: false) | enforced | terminal-projected | projected | terminal-style@1, terminal-output-policy@1, terminal-control-sanitization, render-contract@1 |
| html | public | projected: renderMermaidASCII (colorMode: 'html') | unavailable: none — HTML text is not a standalone CLI format | projected: mermaid.renderMermaidASCIIWithReceipt (colorMode: 'html' (terminal projection; not a standalone CLI format)) | indirect: execute (mermaid.renderMermaidASCIIWithReceipt({ colorMode: 'html' })) | indirect: execute (mermaid.renderMermaidASCIIWithReceipt({ colorMode: 'html' })) | unavailable: none — The editor exposes diagram, Unicode and ASCII canvas tabs only | unavailable: none — The site does not emit terminal-HTML diagram artifacts | enforced | terminal-projected | projected | terminal-style@1, terminal-output-policy@1, terminal-control-sanitization, html-text-escaping, render-contract@1 |
| layout | public | direct: layoutMermaid | direct: am render (--format json) | direct: mermaid.layoutMermaidWithReceipt | indirect: execute (mermaid.layoutMermaidWithReceipt) | indirect: execute (mermaid.layoutMermaidWithReceipt) | indirect: verification panel (verifyMermaid(source).layout (consumed, not exported)) | unavailable: none — Website verification consumes layout internally but publishes no layout artifact | not-applicable | not-applicable | not-applicable | positioned-artifact@1, render-contract@1 |

### Output transport evidence

| Output | Product | State | Entry point | Evidence |
|---|---|---|---|---|
| svg | library | direct | direct: renderMermaidSVG | src/index.ts |
| svg | cli | direct | direct: am render (--format svg) | src/cli/index.ts |
| svg | codeMode | direct | direct: mermaid.renderMermaidSVGWithReceipt | src/mcp/facade.ts, src/mcp/sdk-decl.ts |
| svg | localMcp | indirect | indirect: execute (mermaid.renderMermaidSVGWithReceipt) | src/mcp/server.ts, src/mcp/facade.ts |
| svg | hostedMcp | direct | direct: render_svg | src/mcp/hosted-server.ts |
| svg | editor | direct | direct: diagram preview / Save SVG (renderMermaidSVGWithReceipt) | editor/js/rendering.js, editor/js/export.js |
| svg | website | direct | direct: website build-time renderMermaidSVG (embedded examples and diagram assets) | website/build.ts |
| png | library | direct | direct: renderMermaidPNG | src/agent/png.ts |
| png | cli | direct | direct: am render (--format png) | src/cli/index.ts |
| png | codeMode | unavailable | unavailable: none — PNG rasterization is a host tool, not a sandbox SDK method | src/mcp/sdk-decl.ts, src/mcp/facade.ts |
| png | localMcp | direct | direct: render_png | src/mcp/server.ts |
| png | hostedMcp | direct | direct: render_png | src/mcp/hosted-server.ts |
| png | editor | direct | direct: Save PNG / Copy PNG (renderMermaidPNGInBrowserWithReceipt) | editor/js/export.js, src/browser-png.ts |
| png | website | unavailable | unavailable: none — The site build copies curated PNG assets but exposes no PNG render adapter | website/build.ts |
| ascii | library | direct | direct: renderMermaidASCII (useAscii: true) | src/ascii/index.ts |
| ascii | cli | direct | direct: am render (--format ascii) | src/cli/index.ts |
| ascii | codeMode | direct | direct: mermaid.renderMermaidASCIIWithReceipt (useAscii: true) | src/mcp/facade.ts, src/mcp/sdk-decl.ts |
| ascii | localMcp | indirect | indirect: execute (mermaid.renderMermaidASCIIWithReceipt({ useAscii: true })) | src/mcp/server.ts, src/mcp/facade.ts |
| ascii | hostedMcp | direct | direct: render_ascii (useAscii: true) | src/mcp/hosted-server.ts |
| ascii | editor | direct | direct: ASCII canvas tab (renderMermaidASCII({ useAscii: true })) | editor/js/rendering.js, editor/html/right-panel.html |
| ascii | website | unavailable | unavailable: none — The site build emits one Unicode diagram asset but no 7-bit ASCII output | website/build.ts |
| unicode | library | direct | direct: renderMermaidASCII (useAscii: false (default)) | src/ascii/index.ts |
| unicode | cli | direct | direct: am render (--format unicode) | src/cli/index.ts |
| unicode | codeMode | direct | direct: mermaid.renderMermaidASCIIWithReceipt (useAscii: false (default)) | src/mcp/facade.ts, src/mcp/sdk-decl.ts |
| unicode | localMcp | indirect | indirect: execute (mermaid.renderMermaidASCIIWithReceipt({ useAscii: false })) | src/mcp/server.ts, src/mcp/facade.ts |
| unicode | hostedMcp | direct | direct: render_ascii (useAscii: false (default)) | src/mcp/hosted-server.ts |
| unicode | editor | direct | direct: Unicode canvas tab (renderMermaidASCII({ useAscii: false })) | editor/js/rendering.js, editor/html/right-panel.html |
| unicode | website | direct | direct: website build-time renderMermaidASCII (diagrams/workflow.txt; useAscii: false) | website/build.ts |
| html | library | projected | projected: renderMermaidASCII (colorMode: 'html') | src/ascii/index.ts |
| html | cli | unavailable | unavailable: none — HTML text is not a standalone CLI format | src/cli/index.ts |
| html | codeMode | projected | projected: mermaid.renderMermaidASCIIWithReceipt (colorMode: 'html' (terminal projection; not a standalone CLI format)) | src/mcp/facade.ts, src/mcp/sdk-decl.ts |
| html | localMcp | indirect | indirect: execute (mermaid.renderMermaidASCIIWithReceipt({ colorMode: 'html' })) | src/mcp/server.ts, src/mcp/facade.ts |
| html | hostedMcp | indirect | indirect: execute (mermaid.renderMermaidASCIIWithReceipt({ colorMode: 'html' })) | src/mcp/hosted-server.ts, src/mcp/facade.ts |
| html | editor | unavailable | unavailable: none — The editor exposes diagram, Unicode and ASCII canvas tabs only | editor/js/buttons.js, editor/html/right-panel.html |
| html | website | unavailable | unavailable: none — The site does not emit terminal-HTML diagram artifacts | website/build.ts |
| layout | library | direct | direct: layoutMermaid | src/agent/core.ts |
| layout | cli | direct | direct: am render (--format json) | src/cli/index.ts |
| layout | codeMode | direct | direct: mermaid.layoutMermaidWithReceipt | src/mcp/facade.ts, src/mcp/sdk-decl.ts |
| layout | localMcp | indirect | indirect: execute (mermaid.layoutMermaidWithReceipt) | src/mcp/server.ts, src/mcp/facade.ts |
| layout | hostedMcp | indirect | indirect: execute (mermaid.layoutMermaidWithReceipt) | src/mcp/hosted-server.ts, src/mcp/facade.ts |
| layout | editor | indirect | indirect: verification panel (verifyMermaid(source).layout (consumed, not exported)) | editor/js/rendering.js |
| layout | website | unavailable | unavailable: none — Website verification consumes layout internally but publishes no layout artifact | website/build.ts |

## Installed resource matrix

| Resource | Version | Path | Media type | Bytes | Required | Network | License | SHA-256 |
|---|---|---|---|---:|---|---|---|---|
| resource:font/inter-regular.ttf | 1.0.0 | assets/fonts/Inter-Regular.ttf | font/ttf | 324820 | true | forbidden | OFL-1.1 (assets/fonts/FONT-LICENSES.md) | 1b08e7fc267a5c7e1d614100f604b83e7e8a0be241f0f288faa2b3ac93a683ba |
| resource:font/inter-medium.ttf | 1.0.0 | assets/fonts/Inter-Medium.ttf | font/ttf | 325304 | true | forbidden | OFL-1.1 (assets/fonts/FONT-LICENSES.md) | 8c883f63b2c4157d997319f2c8bc6995ed4357ef371940d31ca159004a4aae63 |
| resource:font/inter-semibold.ttf | 1.0.0 | assets/fonts/Inter-SemiBold.ttf | font/ttf | 326048 | true | forbidden | OFL-1.1 (assets/fonts/FONT-LICENSES.md) | e7a1aaf7eda9f2fad4131725fa556265ec75ca7b2d756260173a040363e8d4f7 |
| resource:font/inter-bold.ttf | 1.0.0 | assets/fonts/Inter-Bold.ttf | font/ttf | 326468 | true | forbidden | OFL-1.1 (assets/fonts/FONT-LICENSES.md) | b37284b5701b6b168dfc770aa1a4ac492106422fd3ba76bc7641e37434e8019c |
| resource:font/caveat.ttf | 1.0.0 | assets/fonts/Caveat.ttf | font/ttf | 403648 | true | forbidden | OFL-1.1 (assets/fonts/FONT-LICENSES.md) | 0bdb6b660482d31531b3945849fba5916b3ef8695da7024a9e6b9ee3c4157988 |
| resource:font/ebgaramond.ttf | 1.0.0 | assets/fonts/EBGaramond.ttf | font/ttf | 851176 | true | forbidden | OFL-1.1 (assets/fonts/FONT-LICENSES.md) | ef9512f92f6d579e5dc75af59a5a4b1b8b47d2eda89e00b954d44520e5369027 |
| resource:font/architectsdaughter.ttf | 1.0.0 | assets/fonts/ArchitectsDaughter.ttf | font/ttf | 43352 | true | forbidden | OFL-1.1 (assets/fonts/FONT-LICENSES.md) | 6159718a08898e34bc1cb7354086141a5f9a70b73e54dbec27ead0d59a697359 |
| resource:font/sharetechmono.ttf | 1.0.0 | assets/fonts/ShareTechMono.ttf | font/ttf | 43272 | true | forbidden | OFL-1.1 (assets/fonts/FONT-LICENSES.md) | 9ceab1f87414829af259c0f537573ae03ef7dd3147c0b27a36a1a0beb6732677 |
| resource:font/dejavusans.ttf | 1.0.0 | assets/fonts/DejaVuSans.ttf | font/ttf | 759720 | true | forbidden | Bitstream-Vera (assets/fonts/FONT-LICENSES.md) | ae7b7855e115a5966d8b1b3f80f254ccc117ec86f9965e202ee2940453837280 |
| resource:font/dejavusans-bold.ttf | 1.0.0 | assets/fonts/DejaVuSans-Bold.ttf | font/ttf | 708920 | true | forbidden | Bitstream-Vera (assets/fonts/FONT-LICENSES.md) | 5c1247acef7f2b8522a31742c76d6adcb5569bacc0be7ceaa4dc39dd252ce895 |

## Family matrix

| Family | Support | Registration | Headers | Detect | Preserve | Parse | Serialize | Mutate | Verify | Layout | Scene | SVG | Terminal |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| flowchart | partial-native | flowchart | flowchart (native), graph (native), flowchart-elk (unsupported) | native | native | native | native | native | native | native | native | native | native |
| swimlane | unsupported | — | swimlane-beta (unsupported) | diagnosed | source-preserved | absent | absent | absent | absent | absent | absent | absent | absent |
| sequence | native | sequence | sequenceDiagram (native) | native | native | native | native | native | native | native | native | native | native |
| class | partial-native | class | classDiagram (native), classDiagram-v2 (unsupported) | native | native | native | native | native | native | native | native | native | native |
| state | native | state | stateDiagram (native), stateDiagram-v2 (native) | native | native | native | native | native | native | native | native | native | native |
| er | native | er | erDiagram (native) | native | native | native | native | native | native | native | native | native | native |
| journey | native | journey | journey (native) | native | native | native | native | native | native | native | native | native | native |
| gantt | native | gantt | gantt (native) | native | native | native | native | native | native | native | native | native | native |
| pie | native | pie | pie (native) | native | native | native | native | native | native | native | native | native | native |
| quadrant | native | quadrant | quadrantChart (native) | native | native | native | native | native | native | native | native | native | native |
| requirement | unsupported | — | requirementDiagram (unsupported), requirement (unsupported) | diagnosed | source-preserved | absent | absent | absent | absent | absent | absent | absent | absent |
| gitgraph | native | gitgraph | gitGraph (native) | native | native | native | native | native | native | native | native | native | native |
| c4 | inventory-only | — | C4Context (inventory-only), C4Container (inventory-only), C4Component (inventory-only), C4Dynamic (inventory-only), C4Deployment (inventory-only) | diagnosed | source-preserved | absent | absent | absent | absent | absent | absent | absent | absent |
| mindmap | native | mindmap | mindmap (native) | native | native | native | native | native | native | native | native | native | native |
| timeline | native | timeline | timeline (native) | native | native | native | native | native | native | native | native | native | native |
| zenuml | unsupported | — | zenuml (unsupported) | diagnosed | source-preserved | absent | absent | absent | absent | absent | absent | absent | absent |
| sankey | unsupported | — | sankey (unsupported), sankey-beta (unsupported) | diagnosed | source-preserved | absent | absent | absent | absent | absent | absent | absent | absent |
| xychart | native | xychart | xychart (native), xychart-beta (native) | native | native | native | native | native | native | native | native | native | native |
| block | unsupported | — | block (unsupported), block-beta (unsupported) | diagnosed | source-preserved | absent | absent | absent | absent | absent | absent | absent | absent |
| packet | unsupported | — | packet (unsupported), packet-beta (unsupported) | diagnosed | source-preserved | absent | absent | absent | absent | absent | absent | absent | absent |
| kanban | unsupported | — | kanban (unsupported) | diagnosed | source-preserved | absent | absent | absent | absent | absent | absent | absent | absent |
| architecture | partial-native | architecture | architecture (unsupported), architecture-beta (native) | native | native | native | native | native | native | native | native | native | native |
| radar | unsupported | — | radar-beta (unsupported) | diagnosed | source-preserved | absent | absent | absent | absent | absent | absent | absent | absent |
| eventmodeling | unsupported | — | eventmodeling (unsupported) | diagnosed | source-preserved | absent | absent | absent | absent | absent | absent | absent | absent |
| treemap | unsupported | — | treemap (unsupported), treemap-beta (unsupported) | diagnosed | source-preserved | absent | absent | absent | absent | absent | absent | absent | absent |
| venn | unsupported | — | venn-beta (unsupported) | diagnosed | source-preserved | absent | absent | absent | absent | absent | absent | absent | absent |
| ishikawa | unsupported | — | ishikawa (unsupported), ishikawa-beta (unsupported) | diagnosed | source-preserved | absent | absent | absent | absent | absent | absent | absent | absent |
| wardley | unsupported | — | wardley-beta (unsupported) | diagnosed | source-preserved | absent | absent | absent | absent | absent | absent | absent | absent |
| cynefin | unsupported | — | cynefin-beta (unsupported) | diagnosed | source-preserved | absent | absent | absent | absent | absent | absent | absent | absent |
| treeview | unsupported | — | treeView-beta (unsupported) | diagnosed | source-preserved | absent | absent | absent | absent | absent | absent | absent | absent |
| railroad | unsupported | — | railroad-beta (unsupported), railroad-ebnf-beta (unsupported), railroad-abnf-beta (unsupported), railroad-peg-beta (unsupported) | diagnosed | source-preserved | absent | absent | absent | absent | absent | absent | absent | absent |

## Scene declarations

Primitives: document, text, shape, container, connector, marker, data-mark.

Operations: measure, layout, bounds, hit-test, render, accessibility, terminal-project, serialize.

Features: geometry, paint, stroke, transform, identity, relation, labels, markers, resources, interaction, topology, closedness, stroke-opacity, stroke-cap, stroke-join, stroke-miter, dash-array, dash-offset, dash-restart, path-length, paint-order, non-scaling-stroke, marker-orientation.

Realizations: native, emulated, projected, lossy, unsupported.

| Role | Applicable marks | DOM identity | Relation | Sketch | Text halo |
|---|---|---|---|---|---|
| activation | shape | true | false | shape | false |
| actor | shape, group | true | false | shape | false |
| actor-pill | shape | false | false | shape | false |
| attribute | text | true | false | none | true |
| axis | shape, connector, text, group, raw, document, prelude | false | false | none | true |
| bar | shape | true | false | shape | false |
| block | shape, connector, text, group, raw, document, prelude | true | false | shape | false |
| cardinality | shape, text | true | false | none | true |
| chrome | shape, connector, text, group, raw, document, prelude | false | false | none | false |
| class-box | shape, group | true | false | shape | false |
| defs | raw, document | false | false | none | false |
| edge | connector | true | true | connector | false |
| edge-label | text, group | false | false | none | false |
| entity | shape, group | true | false | shape | false |
| event | shape, group | true | false | shape | false |
| grid | shape, connector, text, group, raw, document, prelude | false | false | none | false |
| group | shape, group | true | false | shape | false |
| group-header | shape, connector, text, group, raw, document, prelude | false | false | shape | true |
| icon | text, raw | false | false | none | false |
| junction | shape, group | true | false | none | false |
| label | text | false | false | none | true |
| legend | shape, text, group | false | false | none | true |
| lifeline | connector | false | false | connector | false |
| marker-line | shape, connector, text, group, raw, document, prelude | false | false | none | false |
| member | text | true | false | none | true |
| message | connector, group | true | true | connector | false |
| milestone | shape | true | false | shape | false |
| node | shape, group | true | false | shape | false |
| note | shape, group | true | false | shape | false |
| period | shape, group | true | false | shape | false |
| pie-slice | shape | true | false | shape | false |
| plate | shape | true | false | shape | false |
| point | shape | true | false | none | false |
| prelude | prelude | false | false | none | false |
| rail | shape, connector, text, group, raw, document, prelude | false | false | connector | false |
| relationship | connector | true | true | connector | false |
| score | shape, connector, text, group, raw, document, prelude | false | false | none | false |
| section | shape, connector, text, group, raw, document, prelude | true | false | shape | true |
| series | connector | true | false | connector | false |
| service | shape, group | true | false | shape | false |
| task | shape, connector, text, group, raw, document, prelude | true | false | shape | false |
| title | shape, connector, text, group, raw, document, prelude | true | false | none | false |

## Upstream semantic inventory

| Dimension | Entries |
|---|---:|
| syntax features and accounted divergences | 1814 |
| official syntax examples | 754 |
| config key paths | 535 |
| theme variables | 271 |

| Source | Kind | Path | Upstream revision | SHA-256 |
|---|---|---|---|---|
| config-types | config-schema | dist/config.type.d.ts | 5e3c88ea6d937a89078a5e8f1b2a6fd0ea391a5c | be369beb8545de3e1d35c387d7ce0f328fb672f7c347e6540617a40d1b7244c0 |
| docs-corpus | examples | eval/mermaid-docs-corpus/corpus.json | package/artifact pin | 386ca3d59906f7fea553d2746024c86bb52d7715d117067f6dffb8d6aa1116b5 |
| docs-showcase | examples | eval/mermaid-doc-showcase/manifest.json | f3dea58385fd5c7dd1f4e9c9c1876751ae6943cc | 9bc893f9d035e149f1a0296e312011c21e3e41955caf557f5f6affecae8759f5 |
| gantt-cases | syntax-features | eval/mermaid-gantt-bench/cases.json | package/artifact pin | d6fb967db1954bb5ee357cca62a72a67170d733acbfac5a1002134eacdc7fd39 |
| gantt-exclusions | syntax-features | eval/mermaid-gantt-bench/exclusions.json | package/artifact pin | e65628b7fe8f67d7b88b045d750ee506a11058dd9ca2477d6202702f5958dcd0 |
| mindmap-gitgraph-blocks | syntax-features | eval/mermaid-upstream-suite-bench/mindmap-gitgraph-f3dea583.json | f3dea58385fd5c7dd1f4e9c9c1876751ae6943cc | fdbc9471590ad525cf707f445937906bb97a9c75f19b274b3e384a56dbd811e2 |
| official-doc:architecture | official-doc | skills/agentic-mermaid-diagram-workflow/references/upstream/architecture.md | 5e3c88ea6d937a89078a5e8f1b2a6fd0ea391a5c | b79c518fd0a9661157731b99091e987a8010ffa9522a179f30099236699ca8ad |
| official-doc:block | official-doc | skills/agentic-mermaid-diagram-workflow/references/upstream/block.md | 5e3c88ea6d937a89078a5e8f1b2a6fd0ea391a5c | 803a2975a94d25e1bcb41ff60d9d9653514e2a833df360c36382cca804809e7f |
| official-doc:c4 | official-doc | skills/agentic-mermaid-diagram-workflow/references/upstream/c4.md | 5e3c88ea6d937a89078a5e8f1b2a6fd0ea391a5c | f12badd3ae2c972a3b6cc5a882f03f34249997a2b48ee66ad5e98bb40309dff4 |
| official-doc:class | official-doc | skills/agentic-mermaid-diagram-workflow/references/upstream/classDiagram.md | 5e3c88ea6d937a89078a5e8f1b2a6fd0ea391a5c | 178370ab11242580ee431c1f9ba14810a8617a7a6b0473a4eee8fb465a037087 |
| official-doc:cynefin | official-doc | skills/agentic-mermaid-diagram-workflow/references/upstream/cynefin.md | 5e3c88ea6d937a89078a5e8f1b2a6fd0ea391a5c | fc8d2718505fe027c367b6dd063f261dfcbc6e5ade73efa1678d9f46d925cca1 |
| official-doc:er | official-doc | skills/agentic-mermaid-diagram-workflow/references/upstream/entityRelationshipDiagram.md | 5e3c88ea6d937a89078a5e8f1b2a6fd0ea391a5c | 6dae5e32f9048d944b336d2edfb093b11aba45e775d02d0cf4979f51a5d1d931 |
| official-doc:eventmodeling | official-doc | skills/agentic-mermaid-diagram-workflow/references/upstream/eventmodeling.md | 5e3c88ea6d937a89078a5e8f1b2a6fd0ea391a5c | 87a44dbb80ff96d9cbaba5c81a237555f5503c87d01e9027556aa73a276e6421 |
| official-doc:flowchart | official-doc | skills/agentic-mermaid-diagram-workflow/references/upstream/flowchart.md | 5e3c88ea6d937a89078a5e8f1b2a6fd0ea391a5c | b93d95e801310da61a2b68db2612f86c050defc53bed5f13c4cb3504d80706f9 |
| official-doc:gantt | official-doc | skills/agentic-mermaid-diagram-workflow/references/upstream/gantt.md | 5e3c88ea6d937a89078a5e8f1b2a6fd0ea391a5c | 8f77fca811ebc1978fa094bf3a464d7ffc7520ac30b05cf86534ab1d673a9448 |
| official-doc:gitgraph | official-doc | skills/agentic-mermaid-diagram-workflow/references/upstream/gitgraph.md | 5e3c88ea6d937a89078a5e8f1b2a6fd0ea391a5c | e59433a1aa25d19e4cd841e749c968b099f2c90f07a37e844ae795f53c0b027d |
| official-doc:ishikawa | official-doc | skills/agentic-mermaid-diagram-workflow/references/upstream/ishikawa.md | 5e3c88ea6d937a89078a5e8f1b2a6fd0ea391a5c | 146435981aae5e448262be2a54640bdcac3a61d46b7c0cbd9d49aaf35d6a5889 |
| official-doc:journey | official-doc | skills/agentic-mermaid-diagram-workflow/references/upstream/userJourney.md | 5e3c88ea6d937a89078a5e8f1b2a6fd0ea391a5c | 6dd8531973c855733938f9df064c0f5d4a402978bae250e5b0f143f2500a0df9 |
| official-doc:kanban | official-doc | skills/agentic-mermaid-diagram-workflow/references/upstream/kanban.md | 5e3c88ea6d937a89078a5e8f1b2a6fd0ea391a5c | 77a3966aee10b313694178ef835818b42da5c7e358ac3073d14a05c5850771c2 |
| official-doc:mindmap | official-doc | skills/agentic-mermaid-diagram-workflow/references/upstream/mindmap.md | 5e3c88ea6d937a89078a5e8f1b2a6fd0ea391a5c | 69d0338a34563fd3d29230d138e3960bac64f8a9df761b0bc8baaf0326884a3c |
| official-doc:packet | official-doc | skills/agentic-mermaid-diagram-workflow/references/upstream/packet.md | 5e3c88ea6d937a89078a5e8f1b2a6fd0ea391a5c | 7644f30c54c2c69800f3b93cddc3e623376d45cb6b8f8ca84bcbb943a490a4a8 |
| official-doc:pie | official-doc | skills/agentic-mermaid-diagram-workflow/references/upstream/pie.md | 5e3c88ea6d937a89078a5e8f1b2a6fd0ea391a5c | 0e21ba69d9946c98aec1846f22f6c699414f8cd49d4e50a3753714bf4c48aa1d |
| official-doc:quadrant | official-doc | skills/agentic-mermaid-diagram-workflow/references/upstream/quadrantChart.md | 5e3c88ea6d937a89078a5e8f1b2a6fd0ea391a5c | 6beef7a8950f651aafc83295051398e1ca08715e89ac261efcb3e2daed4d2cab |
| official-doc:radar | official-doc | skills/agentic-mermaid-diagram-workflow/references/upstream/radar.md | 5e3c88ea6d937a89078a5e8f1b2a6fd0ea391a5c | fc8f477b64ff2ffea8cd0a1e553df3e05cc04bf9512a4860cd441344c4c0a267 |
| official-doc:railroad | official-doc | skills/agentic-mermaid-diagram-workflow/references/upstream/railroad.md | 5e3c88ea6d937a89078a5e8f1b2a6fd0ea391a5c | 24e70804e588b2a8e0dd6253dbd275390ed5b8810b8c4a4701aec1c0109b760e |
| official-doc:requirement | official-doc | skills/agentic-mermaid-diagram-workflow/references/upstream/requirementDiagram.md | 5e3c88ea6d937a89078a5e8f1b2a6fd0ea391a5c | 61b0028ecb5ca2f5e00da081955e80c0d819f0dfe875b9185660fb1677dfe650 |
| official-doc:sankey | official-doc | skills/agentic-mermaid-diagram-workflow/references/upstream/sankey.md | 5e3c88ea6d937a89078a5e8f1b2a6fd0ea391a5c | 26f097e48cc1d2289b52043d756201df6298dbcd8c7abf8678b24f3332547502 |
| official-doc:sequence | official-doc | skills/agentic-mermaid-diagram-workflow/references/upstream/sequenceDiagram.md | 5e3c88ea6d937a89078a5e8f1b2a6fd0ea391a5c | 5d7d5e93d5f40f9a50d1819302c050d40a299a710c7de92691f5c263c391f8d0 |
| official-doc:state | official-doc | skills/agentic-mermaid-diagram-workflow/references/upstream/stateDiagram.md | 5e3c88ea6d937a89078a5e8f1b2a6fd0ea391a5c | 881747c2df82dca4b7b286566f931859e9f0e275ef0a3dbae517c26a0bcca004 |
| official-doc:swimlane | official-doc | skills/agentic-mermaid-diagram-workflow/references/upstream/swimlanes.md | 5e3c88ea6d937a89078a5e8f1b2a6fd0ea391a5c | d4c80462f1b91dc865112b3345cf158236530a144f6245248a60afe8a25718c0 |
| official-doc:timeline | official-doc | skills/agentic-mermaid-diagram-workflow/references/upstream/timeline.md | 5e3c88ea6d937a89078a5e8f1b2a6fd0ea391a5c | 16a407d5468b307dc4481bf56f130d8b88b2b5913b8409194205e8fffcd1b41e |
| official-doc:treemap | official-doc | skills/agentic-mermaid-diagram-workflow/references/upstream/treemap.md | 5e3c88ea6d937a89078a5e8f1b2a6fd0ea391a5c | 9754cf6a29e373ff9f5c43ea2b03e3e7330c4f0bc0056c51aa174b92eefa443e |
| official-doc:treeview | official-doc | skills/agentic-mermaid-diagram-workflow/references/upstream/treeView.md | 5e3c88ea6d937a89078a5e8f1b2a6fd0ea391a5c | c3d6bc4111a1d80e305bd5b69555a8804fefdfbcc6f6be978c4b02877c33fc5c |
| official-doc:venn | official-doc | skills/agentic-mermaid-diagram-workflow/references/upstream/venn.md | 5e3c88ea6d937a89078a5e8f1b2a6fd0ea391a5c | 01deb071e281243e05a872ed875cc1c17c8c9cdbbf2e70aac4fca5c3c7d55aa0 |
| official-doc:wardley | official-doc | skills/agentic-mermaid-diagram-workflow/references/upstream/wardley.md | 5e3c88ea6d937a89078a5e8f1b2a6fd0ea391a5c | 1a346388c7e84d1566650c383f43dbf769590c7d22e81cc4ac86235749677118 |
| official-doc:xychart | official-doc | skills/agentic-mermaid-diagram-workflow/references/upstream/xyChart.md | 5e3c88ea6d937a89078a5e8f1b2a6fd0ea391a5c | ecb54b3639e6009e860a1ae65135620faacac3f4f882468cf4c440103da06438 |
| official-doc:zenuml | official-doc | skills/agentic-mermaid-diagram-workflow/references/upstream/zenuml.md | 5e3c88ea6d937a89078a5e8f1b2a6fd0ea391a5c | 2db6da951451717f3de2f22370bb4a0c89a826970f71969bce8586891a61e4c8 |
| suite-accounting | accounting | eval/mermaid-upstream-suite-bench/manifest.json | a2d9686451df7c4644a3eeca20535bbd4c5776b0 | e440b5eba8fefc6ed596a7467917f052e407341bbfbd5ce30482e6361ab27b28 |
| suite-cases | syntax-features | eval/mermaid-upstream-suite-bench/cases.json | a2d9686451df7c4644a3eeca20535bbd4c5776b0 | 3604ae245e4e60306a0d8f5f60327d83bcdad5679a434e602508577f52175b92 |
| suite-exclusions | syntax-features | eval/mermaid-upstream-suite-bench/exclusions.json | a2d9686451df7c4644a3eeca20535bbd4c5776b0 | 19d3666825df7c6e726d55415f3464939b5813af6e1096922281fa60ade94103 |
| theme-types | theme-schema | dist/themes/theme-base.d.ts | 5e3c88ea6d937a89078a5e8f1b2a6fd0ea391a5c | e3a9a77cae42bafb5eb4ef9d34757cddbf077e40a817aece1f2ef59d47b65aa0 |

## Forward compatibility

| Case | Diagnostic | Classification | Source preserved |
|---|---|---|---|
| unknownHeader | UNKNOWN_HEADER | unknown | true |
| unsupportedHeader | UNSUPPORTED_FAMILY | unsupported | true |
| inventoryOnlyHeader | UNSUPPORTED_FAMILY | inventory-only | true |

## Existing evidence systems

| System | Authority | Freshness gate |
|---|---|---|
| characterization | docs/layout-characterization/README.md | src/__tests__/characterization-generated-artifacts.test.ts |
| citizenship | docs/contributing/diagram-family-citizenship.matrix.json | src/__tests__/diagram-family-citizenship.test.ts |
| style | src/scene/style-registry.ts | src/__tests__/styled-output.test.ts |
| backend | src/scene/backend.ts | src/__tests__/styled-backend-paint.test.ts |

## Retired authorities

| Retired authority | Replacement | Evidence |
|---|---|---|
| declarative-style-backend-selection | trusted host-only backend policy | src/scene/backend.ts, src/__tests__/extension-registries.test.ts |
| unchecked-extension-map-overwrite | shared ExtensionIdentity collision contracts | src/shared/extension-identity.ts, src/__tests__/extension-registries.test.ts |
| closed-family-identity | namespaced FamilyId descriptor registry | src/agent/families.ts, src/__tests__/extension-registries.test.ts |
| parallel-family-header-switches | family descriptor registry plus pinned upstream manifest | src/family-detection.ts, src/__tests__/upstream-family-manifest.test.ts |
| png-shared-option-forwarding | ResolvedRenderRequest shared-field waist | src/render-contract.ts, src/__tests__/section-a-render-contract.test.ts |
| surface-specific-svg-strip-pass | shared reject-and-verify OutputSecurityPolicy | src/output-security.ts, src/__tests__/section-a-render-contract.test.ts |
| editor-svg-innerhtml-insertion | strict XML parsing and node insertion | editor/js/rendering.js, src/__tests__/section-a-render-contract.test.ts |
| manual-style-spec-schema-and-field-table | immutable StyleSpec field descriptors with generated projections | src/scene/style-spec.ts, src/__tests__/style-spec-authority.test.ts |
| copied-style-discovery-menus | knownStyleDescriptors discovery projection | src/scene/style-registry.ts, src/__tests__/style-spec-authority.test.ts |
| manual-render-option-schemas-and-doc-table | shared RenderOptions field descriptors | src/render-contract.ts, src/__tests__/render-options-authority.test.ts |
| manual-sdk-family-declarations | FamilyDescriptor-generated SDK projection | src/mcp/sdk-decl.ts, src/__tests__/agent-doc-sync.test.ts |
| independent-family-positioning-projections | one positioned artifact with projectPositioned views | src/agent/families.ts, src/__tests__/positioned-artifact-convergence.test.ts |
| family-local-connector-marker-xml | typed connector terminals and marker resources | src/scene/ir.ts, src/__tests__/scene-connector-contract.test.ts |
| dormant-positioned-additions-pipeline | no extension seam until the Section B4 evidence gate passes | docs/project/brand-primitives-plan.md, src/__tests__/positioned-artifact-convergence.test.ts |
| verified-path-resource-consumption | immutable verified resource byte snapshots and truthful provenance | src/node-resource-resolver.ts, src/__tests__/resource-manifest-integrity.test.ts |
