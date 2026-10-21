# Read-only SVG for unsupported families

The native SVG renderer and typed editing APIs retain their existing family
support. An optional read-only entry can display unsupported Mermaid core
families without claiming native editing or layout evidence:

```sh
npm install agentic-mermaid pele@1.6.0
```

```ts
import { renderReadOnlyMermaidSVG } from 'agentic-mermaid/svg/read-only'

const rendered = await renderReadOnlyMermaidSVG(`venn-beta
  set Readers
  set Authors
  union Readers,Authors["Contributors"]
`)
// rendered.svg, rendered.family, rendered.provider
// rendered.capabilities: SVG read-only; no typed editing, layout or paint proof
```

Pele loads only when this entry receives an eligible unsupported family. The
default native entry and lazy browser renderer do not import it. Core families
already supported natively, their aliases, unknown headers, inventory-only
headers and external ZenUML are refused before provider loading. Native C4
therefore retains its independent interaction identities.

The only option is `security: 'strict' | 'default'`; strict is the default.
Unknown options, including styles and strict layout requests, are rejected
rather than silently ignored. Every provider SVG passes Agentic's final byte
budget and output-security checks. Active content is always rejected; strict
mode also rejects external references. This gate does not prove semantic,
geometric or visual fidelity. Preserve authored source as the editable asset.

Hosts can supply a provider without installing Pele:

```ts
import { createReadOnlySvgRenderer } from 'agentic-mermaid/svg/read-only'

const render = createReadOnlySvgRenderer(async () => ({
  id: 'my-renderer',
  render: source => renderWithMyProvider(source),
}))
```

The loader is shared by calls to that renderer. A rejected load is retried by
the next call; provider render failures propagate. Source and security options
are captured before asynchronous work. Outputs remain subject to the same
final security and size checks regardless of provider.
