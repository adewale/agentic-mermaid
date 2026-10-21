import { generatedIds } from '../shared/generated-identity.ts'
import { formatChartValue } from '../shared/chart-value-format.ts'
import type { SankeyVisualConfig } from './config.ts'
import type { SankeyDiagram } from './types.ts'

export interface SankeyLinkIdentity {
  readonly id: string
  readonly source: string
  readonly target: string
  readonly occurrence: number
}

export interface SankeyIdentityPlan {
  readonly links: readonly SankeyLinkIdentity[]
  readonly titleId?: string
}

/** Plan source identities before either pixel or cell layout. Readable names
 * are preserved when available; pair and occurrence identity never depends on
 * their delimiters. Scene marks and resources keep their own bounded IDs. */
export function sankeyIdentities(diagram: SankeyDiagram): SankeyIdentityPlan {
  const generated = generatedIds(diagram.nodes)
  const occurrences = new Map<string, Map<string, number>>()
  const links = diagram.links.map(({ source, target }) => {
    let targets = occurrences.get(source)
    if (!targets) occurrences.set(source, targets = new Map())
    const occurrence = targets.get(target) ?? 0
    targets.set(target, occurrence + 1)
    const base = `link:${source}->${target}`
    const preferred = occurrence === 0 ? base : `${base}#${occurrence}`
    return { id: generated(preferred, ['link', source, target, occurrence]), source, target, occurrence }
  })
  return { links, ...(diagram.title ? { titleId: generated('title', ['title']) } : {}) }
}

/** Display-only two-decimal rounding shared by graphical and terminal labels. */
export function formatSankeyValue(value: number, visual: SankeyVisualConfig): string {
  return `${visual.prefix}${formatChartValue(value)}${visual.suffix}`
}
