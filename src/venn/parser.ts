import { VennDb } from './grammar/db.ts'
import { parseVenn } from './grammar/parser.ts'
import { scanAccessibilityDirectives, requireClosedAccessibility, accessibilityFields } from '../shared/accessibility-directives.ts'
import { readGrammarText } from '../shared/grammar-text.ts'
import { assertDiagramWorkLimit } from '../shared/diagram-limits.ts'
import type { VennBody } from './types.ts'

export const isVennHeader = (line: string): boolean => /^venn-beta\s*(?:%%.*)?$/i.test(line.trim())
export const vennRegionId = (sets: readonly string[]): string => JSON.stringify([...sets].sort())

/** One identity per authored region across source maps and positioned output.
 * Generated intersections must not collide with authored set or text IDs. */
export function vennRegionIdentities(body: VennBody): Map<string, string> {
  const used = new Set([...body.subsets.filter(subset => subset.sets.length === 1).map(subset => subset.sets[0]!), ...body.textNodes.map(node => node.id)])
  const identities = new Map<string, string>()
  let next = 0
  for (const region of [...body.subsets, ...body.textNodes]) {
    const key = vennRegionId(region.sets)
    if (identities.has(key)) continue
    if (region.sets.length === 1) identities.set(key, region.sets[0]!)
    else {
      while (used.has(`venn-region-${next}`)) next++
      const id = `venn-region-${next++}`
      used.add(id)
      identities.set(key, id)
    }
  }
  return identities
}

export function parseVennDiagram(input: string | readonly string[]): VennBody {
  const lines = typeof input === 'string' ? input.split(/\r?\n/) : input
  const scanned = scanAccessibilityDirectives(lines)
  requireClosedAccessibility(scanned)
  const db = new VennDb()
  const grammarLines = lines.map(() => '')
  scanned.familyOrigins.forEach((origin, index) => {
    grammarLines[origin] = scanned.familyLines[index]!
  })
  parseVenn(grammarLines.join('\n'), db)
  assertDiagramWorkLimit('nodes', db.subsets.length + db.textNodes.length)
  const body: VennBody = {
    kind: 'venn',
    subsets: db.subsets.map(subset => ({ sets: subset.sets.map(text => readGrammarText(text, '[]\r\n')).sort(), size: subset.size, ...(subset.label !== undefined ? { label: readGrammarText(subset.label, '[]\r\n') } : {}) })),
    textNodes: db.textNodes.map(node => ({ sets: node.sets.map(text => readGrammarText(text, '[]\r\n')).sort(), id: readGrammarText(node.id, '[]\r\n'), ...(node.label !== undefined ? { label: readGrammarText(node.label, '[]\r\n') } : {}) })),
    styles: db.styles.map(style => ({ targets: style.targets.map(text => readGrammarText(text, '[]\r\n')), styles: Object.fromEntries([...style.styles].map(([key, value]) => [key, readGrammarText(value, '[]\r\n')])) })),
    ...(db.title !== undefined ? { title: readGrammarText(db.title) } : {}),
    ...accessibilityFields(scanned.accessibility),
  }
  validateVenn(body)
  return body
}

export function validateVenn(body: VennBody): void {
  assertDiagramWorkLimit('nodes', body.subsets.length + body.textNodes.length)
  assertDiagramWorkLimit(
    'edges',
    [...body.subsets, ...body.textNodes].reduce((sum, region) => sum + (region.sets.length * (region.sets.length - 1)) / 2, 0),
  )
  const known = new Set<string>(),
    regions = new Set<string>(),
    texts = new Set<string>()
  for (const subset of body.subsets) {
    if (!Array.isArray(subset.sets) || !subset.sets.length || subset.sets.some(id => typeof id !== 'string' || !id || /[\r\n]/.test(id)) || new Set(subset.sets).size !== subset.sets.length) throw Error('Venn regions require distinct nonempty single-line set identifiers')
    if (!Number.isFinite(subset.size) || subset.size < 0) throw Error('Venn sizes must be finite and nonnegative')
    const id = vennRegionId(subset.sets)
    if (regions.has(id)) throw Error(`Venn region ${id} is declared twice`)
    regions.add(id)
    if (subset.sets.length === 1) known.add(subset.sets[0]!)
    else if (subset.sets.some(set => !known.has(set))) throw Error(`Declare each set before its Venn intersection ${id}`)
    if (subset.label !== undefined && typeof subset.label !== 'string') throw Error('Venn labels must be text')
  }
  for (const text of body.textNodes) {
    if (!text.id || texts.has(text.id) || known.has(text.id)) throw Error(`Venn text identifier ${text.id} must be unique`)
    if (!text.sets.length || new Set(text.sets).size !== text.sets.length || text.sets.some(set => !known.has(set))) throw Error(`Venn text ${text.id} refers to an unknown set`)
    texts.add(text.id)
  }
  for (const style of body.styles) {
    if (!style.targets.length || style.targets.some(id => !known.has(id) && !texts.has(id))) throw Error('Venn styles must name declared sets or text')
    if (Object.entries(style.styles).some(([key, value]) => !/^[\w-]+$/.test(key) || typeof value !== 'string')) throw Error('Venn style properties must be named text values')
  }
}
