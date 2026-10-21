import { mermaidFirstLine } from './mermaid-source-wrapper.ts'
import { findUpstreamFamilyByHeader } from './upstream-family-index.ts'
import { applyOutputSecurityPolicy, type OutputSecurityMode } from './output-security.ts'
import { assertDiagramWorkLimit } from './shared/diagram-limits.ts'
import { assertFinalSvgByteBudget } from './scene/scene-validation.ts'
import { detectInstalledFamilyDescriptorFromFirstLine } from './agent/family-router.ts'

export interface ReadOnlySvgProvider {
  readonly id: string
  render(source: string): string | Promise<string>
}

export interface ReadOnlySvgOptions {
  /** Strict output security is the default. Active content is always refused. */
  readonly security?: OutputSecurityMode
}

export interface ReadOnlySvgResult {
  readonly svg: string
  readonly family: string
  readonly provider: string
  readonly capabilities: {
    readonly svg: 'read-only'
    readonly typedEditing: false
    readonly layout: false
    readonly paintCertification: false
  }
}

const capabilities: ReadOnlySvgResult['capabilities'] = Object.freeze({
  svg: 'read-only', typedEditing: false, layout: false, paintCertification: false,
})

function captureSecurity(options: ReadOnlySvgOptions): OutputSecurityMode {
  if (!options || typeof options !== 'object' || Array.isArray(options)) throw new TypeError('Read-only SVG options must be an object')
  const prototype = Object.getPrototypeOf(options)
  if (prototype !== Object.prototype && prototype !== null) throw new TypeError('Read-only SVG options must be a plain object')
  if (Reflect.ownKeys(options).some(key => key !== 'security')) throw new TypeError('Read-only SVG accepts only the security option')
  const security = options.security ?? 'strict'
  if (security !== 'default' && security !== 'strict') throw new TypeError('Read-only SVG security must be default or strict')
  return security
}

async function loadPele(): Promise<ReadOnlySvgProvider> {
  const provider = await import('pele')
  return { id: 'pele@1.6.0', render: source => provider.render(source).svg }
}

/** Create an opt-in renderer for unsupported core families. Provider loading
 * is lazy and failed loads can be retried by a later call. Native families
 * and unknown headers never reach a provider. */
export function createReadOnlySvgRenderer(loadProvider: () => ReadOnlySvgProvider | Promise<ReadOnlySvgProvider> = loadPele) {
  if (typeof loadProvider !== 'function') throw new TypeError('Read-only SVG provider loader must be a function')
  let pending: Promise<ReadOnlySvgProvider> | undefined
  const provider = (): Promise<ReadOnlySvgProvider> => pending ??= Promise.resolve().then(loadProvider).then(loaded => {
    const id = loaded?.id, render = loaded?.render
    if (typeof id !== 'string' || !id.trim() || typeof render !== 'function') {
      throw new TypeError('Read-only SVG provider must expose an id and render function')
    }
    return Object.freeze({ id, render: render.bind(loaded) })
  }).catch((error: unknown) => { pending = undefined; throw error })

  return async (source: string, options: ReadOnlySvgOptions = {}): Promise<ReadOnlySvgResult> => {
    if (typeof source !== 'string') throw new TypeError('Read-only Mermaid source must be a string')
    assertDiagramWorkLimit('sourceCharacters', source.length)
    const security = captureSecurity(options)
    const firstLine = mermaidFirstLine(source)
    const match = findUpstreamFamilyByHeader(firstLine)
    // Native aliases retain their own parser/editing guarantees. ZenUML is
    // an external first-party language requiring a separate provider.
    if (!match || match.header.agenticStatus !== 'unsupported' || match.family.id === 'zenuml'
      || match.family.headers.some(header => header.agenticStatus === 'native')
      || detectInstalledFamilyDescriptorFromFirstLine(firstLine)) {
      throw new TypeError('Read-only SVG requires an unsupported Mermaid core family; use the native renderer for supported families')
    }
    const loaded = await provider()
    const svg = await loaded.render(source)
    assertFinalSvgByteBudget(svg, 'read-only provider SVG')
    const secured = applyOutputSecurityPolicy(svg, security).svg
    assertFinalSvgByteBudget(secured, 'read-only secured SVG')
    return Object.freeze({ svg: secured, family: match.family.id, provider: loaded.id, capabilities })
  }
}

/** Optional Pele-backed read-only rendering, separate from native SVG APIs. */
export const renderReadOnlyMermaidSVG = createReadOnlySvgRenderer()
