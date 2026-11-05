import { withParserObservation } from '../shared/parser-observation.ts'
import { mapObservedSource } from './source-map-spans.ts'
import { ownBodyAccessibility } from './accessibility-envelope.ts'
import { unknownOpMessage } from './mutation-ops.ts'
import { parseCynefinBody } from '../cynefin/body.ts'
import { CYNEFIN_DOMAINS, type CynefinBody, type CynefinMutationOp, type DomainName } from '../cynefin/types.ts'
import { sameSourceMeaning } from './source-mutation.ts'
import { nativeAccessibilityText } from './accessibility-envelope.ts'
import { accessibilityFields } from '../shared/accessibility-directives.ts'
import { readAuthoredGrammarAccessibility } from '../shared/grammar-text.ts'
import type { FamilyOperations } from './families.ts'
import { err, ok, type LayoutWarning, type MutationError, type Result } from './types.ts'
export { CYNEFIN_OP_SCHEMAS, CYNEFIN_OP_KINDS } from '../cynefin/ops.ts'

export { parseCynefinBody } from '../cynefin/body.ts'

function domain(value: string): asserts value is DomainName { if (!CYNEFIN_DOMAINS.includes(value as DomainName)) throw new Error(`Unknown Cynefin domain ${value}`) }
export function renderCynefin(body: CynefinBody): string {
  const lines = ['cynefin-beta']
  const quoted = (value: string): string => JSON.stringify(value).replace(/%%\{/g, '\\%\\%{')
  if (body.title !== undefined) {
    if (!body.title.trim() || /[\r\n]/.test(body.title) || body.title.includes('%%{')) throw new Error('Cynefin title must be nonempty single-line text without directive openers')
    lines.push(`title ${body.title}`)
  }
  if (body.accessibilityTitle !== undefined) lines.push(`accTitle: ${nativeAccessibilityText(body.accessibilityTitle).replace(/\n/g, ' ')}`)
  if (body.accessibilityDescription !== undefined) {
    const text = nativeAccessibilityText(body.accessibilityDescription)
    if (text.includes('}')) throw new Error('Cynefin accessibility description cannot contain a closing block delimiter')
    lines.push(text.includes('\n') ? `accDescr {\n${text}\n}` : `accDescr: ${text}`)
  }
  const seen = new Set<DomainName>()
  for (const block of body.domains) {
    domain(block.name)
    if (seen.has(block.name)) throw new Error('Cynefin domain identities must be unique')
    seen.add(block.name); lines.push(block.name)
    for (const item of block.items) lines.push(`  ${quoted(item.label)}`)
  }
  for (const transition of body.transitions) {
    domain(transition.from); domain(transition.to)
    lines.push(`${transition.from} --> ${transition.to}${transition.label !== undefined ? `: ${quoted(transition.label)}` : ''}`)
  }
  return lines.join('\n') + '\n'
}
export function mutateCynefin(body: CynefinBody, op: CynefinMutationOp): Result<CynefinBody, MutationError> {
  try {
    const next = structuredClone(body)
    switch (op.kind) {
      case 'set_title': next.title = op.title ?? undefined; break
      case 'set_accessibility_title': next.accessibilityTitle = op.title == null ? undefined : nativeAccessibilityText(op.title); break
      case 'set_accessibility_description': next.accessibilityDescription = op.description == null ? undefined : nativeAccessibilityText(op.description); break
      case 'add_item': {
        domain(op.domain)
        let block = next.domains.find(block => block.name === op.domain)
        if (!block) { block = { name: op.domain, items: [] }; next.domains.push(block) }
        block.items.push({ label: op.label }); break
      }
      case 'set_item':
      case 'remove_item': {
        domain(op.domain)
        const block = next.domains.find(block => block.name === op.domain)
        if (!block || !Number.isInteger(op.index) || !block.items[op.index]) throw new Error('Cynefin item index was not found in that domain')
        if (op.kind === 'set_item') block.items[op.index]!.label = op.label
        else block.items.splice(op.index, 1)
        break
      }
      case 'add_transition': domain(op.from); domain(op.to); next.transitions.push({ from: op.from, to: op.to, label: op.label }); break
      case 'remove_transition':
        if (!Number.isInteger(op.index) || !next.transitions[op.index]) throw new Error('Cynefin transition index was not found')
        next.transitions.splice(op.index, 1); break
      default: return err({ code: 'INVALID_OP', message: unknownOpMessage('cynefin', op) })
    }
    const actual = parseCynefinBody(renderCynefin(next))
    if (!sameSourceMeaning(actual, next)) throw new Error('Cynefin edit cannot retain the complete requested domain semantics')
    return ok(next)
  } catch (error) { return err({ code: 'INVALID_OP', message: error instanceof Error ? error.message : String(error) }) }
}
export function verifyCynefin(body: CynefinBody): LayoutWarning[] { try { renderCynefin(body); return [] } catch (error) { return [{ code: 'UNSUPPORTED_SYNTAX', syntax: 'cynefin_model', message: String(error) }] } }
export const CYNEFIN_SOURCE_HOOKS: FamilyOperations = {
  bodyAccessibility: ownBodyAccessibility('cynefin'),
  parse: ctx => {
    try {
      const body = parseCynefinBody(ctx.source.authoredFamilyBody ?? ctx.source.familyBody), accessibility = readAuthoredGrammarAccessibility(ctx.meta.accessibility)
      Object.assign(body, accessibilityFields(accessibility)); ctx.meta.accessibility = accessibility
      if (body.title === undefined && typeof ctx.source.frontmatter.title === 'string') body.title = ctx.source.frontmatter.title
      if (!sameSourceMeaning(parseCynefinBody(renderCynefin(body)), body)) throw new Error('Cynefin source has no complete typed spelling')
      return ok(body)
    } catch { return ok({ kind: 'opaque', family: 'cynefin', source: ctx.opaqueSource }) }
  },
  buildSourceMap: (body, source, context) => mapObservedSource(source, context, (text, record) => {
    if (body.kind !== 'cynefin') return
    let transition = 0
    withParserObservation('cynefin', event => {
      if (event.unit !== 'mutation' || event.source?.offset === undefined || event.source.endOffset === undefined) return
      const add = (kind: 'nodes' | 'edges' | 'groups' | 'labels', id: string) => record(kind, id, event.source!.offset!, event.source!.endOffset!)
      if (event.kind === 'add-item') {
        const value = event.value as unknown as { domain: DomainName; index: number }
        const id = `${value.domain}:${value.index}`
        add('nodes', id); add('labels', `node:${id}`)
      } else if (event.kind === 'add-domain') {
        const value = event.value as unknown as { domain: DomainName }
        add('groups', value.domain); add('labels', `heading:${value.domain}`)
      } else if (event.kind === 'add-transition') {
        const id = `transition:${transition++}`, value = event.value as unknown as CynefinBody['transitions'][number]
        add('edges', id)
        if (value.label !== undefined) add('labels', id)
      } else if (event.kind === 'set-title') add('labels', 'title')
    }, () => parseCynefinBody(text), { mutations: ['add-item', 'add-domain', 'add-transition', 'set-title'] })
  }),
  serialize: body => { if (body.kind !== 'cynefin') throw new Error('Expected Cynefin body'); return renderCynefin(body) },
  renderSource: () => 'serialized',
  verify: body => body.kind === 'cynefin' ? verifyCynefin(body) : [],
  extractLabels: source => { try { return parseCynefinBody(source).domains.flatMap(block => block.items.map((item, index) => ({ text: item.label, target: `${block.name}:${index}` }))) } catch { return [] } },
}

export const CYNEFIN_MUTATION_HOOKS: Pick<FamilyOperations, 'mutate'> = {
  mutate: (body, op) => body.kind === 'cynefin' ? mutateCynefin(body, op as CynefinMutationOp) : err({ code: 'INVALID_OP', message: 'Expected Cynefin body' }),
}
