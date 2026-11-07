import { ownExistingBodyTitle } from './body-title-meta.ts'
import { ownBodyAccessibility } from './accessibility-envelope.ts'
import { mermaidNumber } from '../shared/mermaid-number.ts'
import { sameSourceMeaning } from './source-mutation.ts'
import type { VennBody, VennMutationOp } from '../venn/types.ts'
import { parseVennDiagram, validateVenn, vennRegionId, vennRegionIdentities, vennStatementEnds } from '../venn/parser.ts'
import { writeGrammarText, readGrammarText, readAuthoredGrammarAccessibility } from '../shared/grammar-text.ts'
import { appendNativeAccessibilityLines, accessibilityFields } from '../shared/accessibility-directives.ts'
import { withParserObservation } from '../shared/parser-observation.ts'
import { mapObservedSource } from './source-map-spans.ts'
import { labelOverflowCollector } from './body-utils.ts'
import { unknownOpMessage } from './mutation-ops.ts'
import { nativeAccessibilityText } from './accessibility-envelope.ts'
import type { FamilyOperations } from './family-registry.ts'
import { ok, err, type LayoutWarning, type MutationError, type Result, type VerifyOptions } from './types.ts'
export { VENN_OP_SCHEMAS, VENN_OP_KINDS } from '../venn/ops.ts'

const quoted = (value: string): string => `"${writeGrammarText(value, '"[]%', undefined, '[]\r\n').replace(/\r/g, '#13;').replace(/\n/g, '#10;')}"`
export function renderVenn(body: VennBody): string {
  validateVenn(body)
  const lines = ['venn-beta']
  appendNativeAccessibilityLines(lines, body)
  if (body.title !== undefined) lines.push(`title ${writeGrammarText(body.title, '%').replace(/\r/g, '#13;').replace(/\n/g, '#10;')}`)
  for (const subset of body.subsets) lines.push(`${subset.sets.length === 1 ? 'set' : 'union'} ${subset.sets.map(quoted).join(',')}${subset.label === undefined ? '' : `[${quoted(subset.label)}]`}:${mermaidNumber(subset.size)}`)
  for (const node of body.textNodes) lines.push(`text ${node.sets.map(quoted).join(',')} ${quoted(node.id)}${node.label === undefined ? '' : `[${quoted(node.label)}]`}`)
  for (const style of body.styles) {
    const values = Object.entries(style.styles)
    if (values.some(([key, value]) => !/^[\w-]+$/.test(key) || typeof value !== 'string')) throw Error('Venn style properties must be named text values')
    if (values.length) lines.push(`style ${style.targets.map(quoted).join(',')} ${values.map(([key, value]) => `${key}:${quoted(value)}`).join(',')}`)
  }
  return lines.join('\n') + '\n'
}

export function mutateVenn(body: VennBody, op: VennMutationOp): Result<VennBody, MutationError> {
  try {
    const next = structuredClone(body)
    switch (op.kind) {
      case 'set_subset': {
        const sets = [...op.sets].sort(),
          key = vennRegionId(sets)
        const index = next.subsets.findIndex(subset => vennRegionId(subset.sets) === key)
        const value = { sets, size: op.size, ...(op.label !== undefined ? { label: op.label } : {}) }
        if (index < 0) next.subsets.push(value)
        else next.subsets[index] = value
        break
      }
      case 'remove_subset': {
        const key = vennRegionId(op.sets)
        if (!next.subsets.some(subset => vennRegionId(subset.sets) === key)) throw Error(`Venn region ${key} was not found`)
        const removed = op.sets.length === 1 ? op.sets[0] : undefined
        const refers = (sets: string[]) => removed !== undefined && sets.includes(removed)
        if (!op.cascade && (next.subsets.some(subset => subset.sets.length > 1 && refers(subset.sets)) || next.textNodes.some(node => refers(node.sets)))) throw Error('Remove dependent Venn intersections and text first, or request cascade')
        next.subsets = next.subsets.filter(subset => vennRegionId(subset.sets) !== key && !(op.cascade && refers(subset.sets)))
        next.textNodes = next.textNodes.filter(node => !(op.cascade && refers(node.sets)))
        next.styles = next.styles.filter(style => !removed || !style.targets.includes(removed))
        break
      }
      case 'rename_set': {
        if (!next.subsets.some(subset => subset.sets.length === 1 && subset.sets[0] === op.from)) throw Error(`Venn set ${op.from} was not found`)
        if (next.subsets.some(subset => subset.sets.includes(op.to)) || next.textNodes.some(node => node.id === op.to)) throw Error(`Venn identity ${op.to} already exists`)
        const rename = (sets: string[]) => sets.map(id => (id === op.from ? op.to : id)).sort()
        next.subsets.forEach(subset => {
          subset.sets = rename(subset.sets)
        })
        next.textNodes.forEach(node => {
          node.sets = rename(node.sets)
        })
        next.styles.forEach(style => {
          style.targets = rename(style.targets)
        })
        break
      }
      case 'set_text': {
        const value = { sets: [...op.sets].sort(), id: op.id, ...(op.label !== undefined ? { label: op.label } : {}) }
        const index = next.textNodes.findIndex(node => node.id === op.id)
        if (index < 0) next.textNodes.push(value)
        else next.textNodes[index] = value
        break
      }
      case 'remove_text': {
        const index = next.textNodes.findIndex(node => node.id === op.id)
        if (index < 0) throw Error(`Venn text ${op.id} was not found`)
        next.textNodes.splice(index, 1)
        next.styles = next.styles.filter(style => !style.targets.includes(op.id))
        break
      }
      case 'set_style':
        if (!op.styles || Array.isArray(op.styles)) throw Error('Venn styles require a property record')
        next.styles.push({ targets: [...op.targets].sort(), styles: { ...op.styles } })
        break
      case 'set_title':
        next.title = op.title ?? undefined
        break
      case 'set_accessibility_title':
        next.accessibilityTitle = op.title == null ? undefined : nativeAccessibilityText(op.title)
        break
      case 'set_accessibility_description':
        next.accessibilityDescription = op.description == null ? undefined : nativeAccessibilityText(op.description)
        break
      default:
        return err({ code: 'INVALID_OP', message: unknownOpMessage('venn', op) })
    }
    const reparsed = parseVennDiagram(renderVenn(next))
    if (!sameSourceMeaning(reparsed, next)) throw Error('Venn edit did not preserve its complete model')
    return ok(reparsed)
  } catch (error) {
    return err({ code: 'INVALID_OP', message: error instanceof Error ? error.message : String(error) })
  }
}

export function verifyVenn(body: VennBody, options: VerifyOptions): LayoutWarning[] {
  const warnings: LayoutWarning[] = body.subsets.length ? [] : [{ code: 'EMPTY_DIAGRAM' }]
  const overflow = labelOverflowCollector(warnings, options)
  body.subsets.forEach(subset => overflow(vennRegionId(subset.sets), subset.label ?? subset.sets.join(' ∩ ')))
  body.textNodes.forEach(node => overflow(node.id, node.label ?? node.id))
  const sizes = new Map(body.subsets.filter(subset => subset.sets.length === 1).map(subset => [subset.sets[0]!, subset.size]))
  const impossible = body.subsets.filter(subset => subset.sets.length > 1 && subset.sets.some(id => subset.size > sizes.get(id)!))
  if (sizes.size > 2 || impossible.length)
    warnings.push({
      code: 'VENN_APPROXIMATION',
      message: impossible.length
        ? `Intersection values exceed a containing set: ${impossible.map(subset => subset.sets.join(' ∩ ')).join(', ')}. Circle geometry is clamped to feasible areas; the authored values remain unchanged.`
        : 'Three or more sets use approximate circle placement. Authored intersection values remain exact in the model and terminal output; the displayed overlap areas may differ.',
    })
  const supportedStyles = new Set(['fill', 'color', 'stroke', 'stroke-width', 'fill-opacity'])
  for (const style of body.styles) for (const key of Object.keys(style.styles)) if (!supportedStyles.has(key)) warnings.push({ code: 'UNSUPPORTED_SYNTAX', syntax: 'venn_style', message: `Venn style property ${key} is retained in source and the model but is not painted.` })
  return warnings
}

export const VENN_SOURCE_HOOKS: FamilyOperations = {
  canonicalSource: 'preserved',
  statementEnds: vennStatementEnds,
  bodyMeta: ownExistingBodyTitle('venn'),
  bodyAccessibility: ownBodyAccessibility('venn', 'native'),
  parse: ctx => {
    try {
      const body = parseVennDiagram(ctx.source.authoredFamilyBody ?? ctx.source.familyBody)
      const accessibility = readAuthoredGrammarAccessibility(ctx.meta.accessibility)
      Object.assign(body, accessibilityFields(accessibility))
      ctx.meta.accessibility = accessibility
      if (body.title === undefined && typeof ctx.source.frontmatter.title === 'string') body.title = ctx.source.frontmatter.title
      if (!sameSourceMeaning(parseVennDiagram(renderVenn(body)), body)) throw Error('Venn source has no complete typed spelling')
      return ok(body)
    } catch {
      return ok({ kind: 'opaque', family: 'venn', source: ctx.opaqueSource })
    }
  },
  serialize: body => {
    if (body.kind !== 'venn') throw Error('Expected Venn body')
    return renderVenn(body)
  },
  renderSource: () => 'serialized',
  verify: (body, options) => (body.kind === 'venn' ? verifyVenn(body, options) : []),
  extractLabels: source => {
    try {
      const body = parseVennDiagram(source)
      return [...body.subsets.map(subset => ({ target: vennRegionId(subset.sets), text: subset.label ?? subset.sets.join(' ∩ ') })), ...body.textNodes.map(node => ({ target: node.id, text: node.label ?? node.id }))]
    } catch {
      return []
    }
  },
  buildSourceMap: (body, source, context) => {
    if (body.kind !== 'venn') return { nodes: new Map(), edges: new Map(), groups: new Map(), labels: new Map() }
    const identities = vennRegionIdentities(body)
    // Venn owns accessibility grammar: universal space masking would change
    // a suffix's TEXT/INDENT_TEXT token. Its preserved source policy owns bytes.
    return mapObservedSource(context?.canonicalSource ?? source, context, (text, record) => withParserObservation('venn', event => {
      if (event.unit !== 'mutation' || event.source?.offset === undefined || event.source.endOffset === undefined) return
      let id: string
      if (event.kind === 'add-subset') {
        const subset = event.value as unknown as VennBody['subsets'][number]
        id = identities.get(vennRegionId(subset.sets.map(value => readGrammarText(value, '[]\r\n'))))!
      } else if (event.kind === 'add-text') {
        const node = event.value as unknown as VennBody['textNodes'][number]
        id = readGrammarText(node.id, '[]\r\n')
      } else return
      record('nodes', id, event.source.offset, event.source.endOffset)
      record('labels', `node:${id}`, event.source.offset, event.source.endOffset)
    }, () => parseVennDiagram(text), { mutations: ['add-subset', 'add-text'] }))
  },
}

export const VENN_MUTATION_HOOKS: Pick<FamilyOperations, 'mutate'> = {
  mutate: (body, op) => (body.kind === 'venn' ? mutateVenn(body, op as VennMutationOp) : err({ code: 'INVALID_OP', message: 'Unmodeled Venn source remains preserved' })),
}
