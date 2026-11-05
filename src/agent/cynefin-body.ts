import { parseCynefin } from '../cynefin/parser.ts'
import { CYNEFIN_DOMAINS, type CynefinBody, type CynefinMutationOp, type DomainName } from '../cynefin/types.ts'
import { sameSourceMeaning } from './source-mutation.ts'
import { nativeAccessibilityText } from './accessibility-envelope.ts'
import { accessibilityFields } from '../shared/accessibility-directives.ts'
import { readAuthoredGrammarAccessibility } from '../shared/grammar-text.ts'
import { assertDiagramWorkLimit } from '../shared/diagram-limits.ts'
import type { FamilyOperations } from './families.ts'
import { err, ok, type LayoutWarning, type MutationError, type Result } from './types.ts'
export { CYNEFIN_OP_SCHEMAS, CYNEFIN_OP_KINDS } from '../cynefin/ops.ts'

export function parseCynefinBody(source: string): CynefinBody {
  const ast = parseCynefin(source), domains = new Map<DomainName, CynefinBody['domains'][number]>()
  if (new Set(ast.domains.map(block => block.domain)).size !== ast.domains.length) throw new Error('Cynefin repeated domain declarations would discard earlier items in pinned Mermaid; the authored source is preserved, but rendering is refused')
  if (ast.transitions.some(transition => transition.from === transition.to)) throw new Error('Cynefin self transitions would discard their labels in pinned Mermaid; the authored source is preserved, but rendering is refused')
  for (const block of ast.domains) domains.set(block.domain, { name: block.domain, items: block.items.map(item => ({ label: item.label })) })
  const body: CynefinBody = { kind: 'cynefin', title: ast.title || undefined, accessibilityTitle: ast.accTitle?.trimStart(), accessibilityDescription: ast.accDescr?.replace(/\n\s+/g, '\n'),
    domains: [...domains.values()], transitions: ast.transitions.map(transition => ({ from: transition.from, to: transition.to, label: transition.label || undefined })) }
  assertDiagramWorkLimit('nodes', body.domains.reduce((sum, domain) => sum + domain.items.length, 5))
  assertDiagramWorkLimit('edges', body.transitions.length)
  return body
}
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
    if (transition.from === transition.to) throw new Error('Cynefin self transitions are not drawn by pinned Mermaid; retain their authored source')
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
      default: throw new Error('Unknown Cynefin operation')
    }
    const actual = parseCynefinBody(renderCynefin(next))
    if (!sameSourceMeaning(actual, next)) throw new Error('Cynefin edit cannot retain the complete requested domain semantics')
    return ok(next)
  } catch (error) { return err({ code: 'INVALID_OP', message: error instanceof Error ? error.message : String(error) }) }
}
export function verifyCynefin(body: CynefinBody): LayoutWarning[] { try { renderCynefin(body); return [] } catch (error) { return [{ code: 'UNSUPPORTED_SYNTAX', syntax: 'cynefin_model', message: String(error) }] } }
export const CYNEFIN_SOURCE_HOOKS: FamilyOperations = {
  parse: ctx => {
    try {
      const body = parseCynefinBody(ctx.source.authoredFamilyBody ?? ctx.source.familyBody), accessibility = readAuthoredGrammarAccessibility(ctx.meta.accessibility)
      Object.assign(body, accessibilityFields(accessibility)); ctx.meta.accessibility = accessibility
      if (body.title === undefined && typeof ctx.source.frontmatter.title === 'string') body.title = ctx.source.frontmatter.title
      if (!sameSourceMeaning(parseCynefinBody(renderCynefin(body)), body)) throw new Error('Cynefin source has no complete typed spelling')
      return ok(body)
    } catch { return ok({ kind: 'opaque', family: 'cynefin', source: ctx.opaqueSource }) }
  },
  serialize: body => { if (body.kind !== 'cynefin') throw new Error('Expected Cynefin body'); return renderCynefin(body) },
  renderSource: () => 'serialized',
  mutate: (body, op) => body.kind === 'cynefin' ? mutateCynefin(body, op as CynefinMutationOp) : err({ code: 'INVALID_OP', message: 'Expected Cynefin body' }),
  verify: body => body.kind === 'cynefin' ? verifyCynefin(body) : [],
  extractLabels: source => { try { return parseCynefinBody(source).domains.flatMap(block => block.items.map((item, index) => ({ text: item.label, target: `${block.name}:${index}` }))) } catch { return [] } },
}
