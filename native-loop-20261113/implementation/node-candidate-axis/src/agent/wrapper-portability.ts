import { mergeFrontmatterMaps, mermaidAuthoredFrontmatter, mermaidInitDirectiveLayer, type MermaidFrontmatterMap, type MermaidConfigDirectiveLayer } from '../mermaid-source.ts'
import { validateConfig, validateConfigSource } from '../shared/pinned-mermaid-config/runtime.js'
import { mergeConfigSource, configDirective } from '../shared/pinned-mermaid-config/merge.js'
import { pinnedMermaidDiagramType } from '../shared/pinned-mermaid-diagram-type.ts'
import { isOwnedFamily } from '../experimental/owned-family.ts'
import { getInstalledFamilyDescriptor } from './family-router.ts'
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
  const type = pinnedMermaidDiagramType(family ?? '')
  try {
    const code = directives.map(layer => configDirective(layer.kind, layer.payload, layer.hasArgs)).join('\n')
    if (payloads.length > 1 || (top.displayMode && payloads.length) || directives.some(layer => layer.kind !== 'init' && layer.kind !== 'wrap')) {
      validateConfigSource(authored, code, type, top)
      return { metadata: top, config: authored, directives }
    }
    // For captured, owned families the empty pinned program only validates
    // private defaults and merges to {}. Retain authored reads and directive
    // array dispatch above; metadata and unowned scopes keep the pinned path.
    if (captured && typeof type === 'string' && !Object.keys(top).length && !Object.keys(authored).length && code === '') {
      const descriptor = getInstalledFamilyDescriptor(family ?? '')
      if (descriptor && isOwnedFamily(descriptor)) return { metadata: top, config: authored, directives: [] }
    }
    // Keep the original payload through directive processing: scalars reject
    // wrap assignment, while the pinned merge ignores array own properties.
    validateConfigSource(authored, code, type, top)
    const config = mergeConfigSource(authored, code, type) as MermaidFrontmatterMap
    validateConfig(config, [], type, top)
    return { metadata: top, config, directives: [] }
  } catch (error) {
    if (error instanceof Error && error.name === 'MermaidConfigWorkLimitError') throw new Error(`Cannot export canonical Mermaid: ${error.message}; reduce the config's work before retrying. This is a validation resource limit, not a pinned syntax rejection.`)
    throw new Error(`Cannot export canonical Mermaid: pinned configuration processing rejects this value (${error instanceof Error ? error.message : String(error)}); repair the config or use verbatim wrapper mode to preserve its source`)
  }
}
