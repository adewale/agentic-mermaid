import { mergeFrontmatterMaps, mermaidAuthoredFrontmatter, mermaidInitDirectiveLayer, type MermaidFrontmatterMap, type MermaidConfigDirectiveLayer } from '../mermaid-source.ts'
import { validateConfig } from '../shared/pinned-mermaid-config/runtime.js'
import { mergeConfig } from '../shared/pinned-mermaid-config/merge.js'
import { pinnedMermaidDiagramType } from '../shared/pinned-mermaid-diagram-type.ts'
import type { ValidDiagramMeta } from './types.ts'

interface CanonicalWrapper {
  metadata: MermaidFrontmatterMap
  config: MermaidFrontmatterMap
  directives: MermaidConfigDirectiveLayer[]
}

/** Canonical output owns configuration values; verbatim output owns authored
 * bytes. Multiple init layers must stay separate: sanitize-before-merge and
 * type-preserving assignment cannot be reconstructed from the folded map. */
export function canonicalWrapperConfig(meta: ValidDiagramMeta, family?: string): CanonicalWrapper {
  const captured = meta.wrapperSource !== undefined
  const raw = captured ? mermaidAuthoredFrontmatter(meta.wrapperSource!) : mergeFrontmatterMaps({}, meta.frontmatter ?? {})
  const top: MermaidFrontmatterMap = {}
  for (const key of ['title', 'displayMode']) {
    if (raw[key] !== undefined) { top[key] = raw[key]!; delete raw[key] }
  }
  const configRoot = captured && raw.config && typeof raw.config === 'object' && !Array.isArray(raw.config) ? raw.config : {}
  if (captured) delete raw.config
  const authored = mergeFrontmatterMaps(configRoot, raw)
  const directives = meta.initDirectives.map(directive => {
    const layer = mermaidInitDirectiveLayer(directive.raw)
    if (layer === undefined) throw new Error('Cannot export canonical Mermaid: init directive payload must be a configuration object or a valid JSON no-op; repair the directive or use verbatim wrapper mode to preserve its source')
    return layer
  })
  const payloads = directives.filter(layer => layer.kind === 'init').map(layer => layer.payload)
  const wrap = directives.some(layer => layer.kind === 'wrap')
  const type = pinnedMermaidDiagramType(family ?? '')
  try {
    if (payloads.length > 1 || (top.displayMode && payloads.length)) {
      validateConfig(authored, payloads, type, top, wrap)
      return { metadata: top, config: authored, directives }
    }
    // Scalar/array init payloads are accepted no-ops. An object can be folded
    // only before the final sanitizer, retaining authored values/extensions.
    const layers = payloads.filter(payload => payload !== null && typeof payload === 'object' && !Array.isArray(payload))
    validateConfig(authored, payloads, type, top, wrap)
    const config = mergeConfig(authored, layers, type, wrap) as MermaidFrontmatterMap
    validateConfig(config, [], type, top, wrap)
    return { metadata: top, config, directives: [] }
  } catch (error) {
    if (error instanceof Error && error.name === 'MermaidConfigWorkLimitError') throw new Error(`Cannot export canonical Mermaid: ${error.message}; reduce the config's work before retrying. This is a validation resource limit, not a pinned syntax rejection.`)
    throw new Error(`Cannot export canonical Mermaid: pinned configuration processing rejects this value (${error instanceof Error ? error.message : String(error)}); repair the config or use verbatim wrapper mode to preserve its source`)
  }
}
