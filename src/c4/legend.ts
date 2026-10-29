import type { C4Body, C4Style, C4Shape } from './types.ts'
import { c4Appearance, effectiveC4Shape, type C4Config } from './config.ts'
import { planC4Identity } from './identity.ts'
export interface C4LegendEntry { id: string; label: string; kind: 'element' | 'relationship'; style: C4Style; shape?: C4Shape; external?: boolean }
/** Type cues remain on cards when their automatic legend is disabled. SHOW_LEGEND adds authored tag
 * definitions, whose styles and text were resolved by the shared reader. */
export function c4LegendEntries(body: C4Body, config?: C4Config): C4LegendEntry[] {
  const ids = planC4Identity(body), entries = new Map<string, C4LegendEntry>()
  for (const item of body.elements) {
    const key = `${item.external ? 'external-' : ''}${item.kind}:${item.shape}`
    const label = `${item.external ? 'External ' : ''}${item.kind[0]!.toUpperCase()}${item.kind.slice(1)}${item.shape === 'database' ? ' / Database' : item.shape === 'queue' ? ' / Queue' : ''}`
    if (!entries.has(key)) {
      const appearance = config ? c4Appearance(item, config) : undefined
      entries.set(key, { id: ids.generated(`c4:legend:${key}`, ['c4', 'legend', key]), label, kind: 'element',
        shape: effectiveC4Shape(item), external: item.external, style: { ...item.style,
          ...(appearance?.fill ? { bgColor: appearance.fill } : {}), ...(appearance?.stroke ? { borderColor: appearance.stroke } : {}) } })
    }
  }
  const types = (config?.typeLegend !== false && entries.size > 1) || body.legend?.visible ? [...entries.values()] : []
  return [...types, ...(body.legend?.visible ? body.legend.entries : [])]
}
