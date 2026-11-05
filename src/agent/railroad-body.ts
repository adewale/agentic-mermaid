import { ownExistingBodyTitle } from './body-title-meta.ts'
import { withParserObservation } from '../shared/parser-observation.ts'
import { mapObservedSource } from './source-map-spans.ts'
import { railroadRuleId, walkRailroadOwners } from '../railroad/identity.ts'
import { unknownOpMessage } from './mutation-ops.ts'
import type { FamilyOperations } from './families.ts'
import type { DiagramBody, MutationError, ParseError, Result } from './types.ts'
import { err, ok } from './types.ts'
import { parseRailroad } from '../railroad/parser.ts'
import { renderRailroad } from '../railroad/source.ts'
import type { RailroadBody, RailroadMutationOp } from '../railroad/types.ts'

export function parseRailroadBody(source: string, opaqueSource = source): Result<RailroadBody | Extract<DiagramBody, { kind: 'opaque' }>, ParseError[]> {
  try { const body = parseRailroad(source); renderRailroad(body); return ok(body) }
  catch { return ok({ kind: 'opaque', family: 'railroad', source: opaqueSource }) }
}
export function mutateRailroad(body: RailroadBody, op: RailroadMutationOp): Result<RailroadBody, MutationError> {
  const draft = structuredClone(body)
  try {
    switch (op.kind) {
      case 'set_title': if (op.title === null) delete draft.title; else draft.title = op.title; break
      case 'add_rule': {
        const index = op.index ?? draft.rules.length
        if (!Number.isInteger(index) || index < 0 || index > draft.rules.length) throw new Error('Rule insertion index is out of range')
        draft.rules.splice(index, 0, { name: op.name, definition: structuredClone(op.definition) }); break
      }
      case 'replace_rule':
      case 'remove_rule': {
        if (!Number.isInteger(op.index) || !draft.rules[op.index]) throw new Error('Rule index is out of range')
        if (op.kind === 'remove_rule') draft.rules.splice(op.index, 1)
        else draft.rules[op.index] = { name: op.name ?? draft.rules[op.index]!.name, definition: structuredClone(op.definition) }
        break
      }
      default: return err({ code: 'INVALID_OP', message: unknownOpMessage('railroad', op) })
    }
    return ok(parseRailroad(renderRailroad(draft)))
  } catch (error) { return err({ code: 'INVALID_OP', message: error instanceof Error ? error.message : String(error) }) }
}
/** Labels follow the owned expression tree so grammar notation never enters prose checks. */
function railroadLabels(body: RailroadBody): Array<{ text: string; target: string }> {
  const labels: Array<{ text: string; target: string }> = []
  body.rules.forEach((rule, index) => {
    const id = railroadRuleId(index, rule.name)
    labels.push({ text: rule.name, target: id })
    walkRailroadOwners(rule.definition, `${id}/expression`, (node, target) => {
      if (node.type === 'terminal') labels.push({ text: node.value, target })
      else if (node.type === 'nonterminal') labels.push({ text: node.name, target })
      else if (node.type === 'special') labels.push({ text: node.text, target })
      else if (node.type === 'any') labels.push({ text: 'any character', target })
    })
  })
  return labels
}
export const RAILROAD_SOURCE_HOOKS = {
  bodyMeta: ownExistingBodyTitle('railroad'),
  renderSource: () => 'canonical',
  extractLabels: source => { try { return railroadLabels(parseRailroad(source)) } catch { return [] } },
  parse: ctx => {
    const result = parseRailroadBody(ctx.source.familyBody, ctx.opaqueSource)
    if (result.ok && result.value.kind === 'railroad' && result.value.title === undefined && typeof ctx.source.frontmatter.title === 'string') result.value.title = ctx.source.frontmatter.title
    return result
  },
  serialize: body => { if (body.kind !== 'railroad') throw new Error(`Railroad serializer received ${body.kind}`); return renderRailroad(body) },
  buildSourceMap: (body, source, context) => mapObservedSource(source, context, (text, record) => {
    if (body.kind !== 'railroad') return
    withParserObservation('railroad', event => {
      if (event.unit !== 'mutation' || event.kind !== 'add-rule' || event.source?.offset === undefined || event.source.endOffset === undefined) return
      const value = event.value as unknown as { index: number; rule: RailroadBody['rules'][number] }
      const id = railroadRuleId(value.index, value.rule.name), start = event.source.offset, end = event.source.endOffset
      // Every rendered expression belongs to this actual authored production.
      // Repeated names remain distinct and multiline productions retain their
      // full source owner, rather than guessing at tokens in their spelling.
      record('groups', id, start, end); record('labels', `group:${id}`, start, end)
      record('groups', `rails:${id}`, start, end)
      walkRailroadOwners(value.rule.definition, `${id}/expression`, (node, owner) => {
        if (node.type === 'terminal' || node.type === 'nonterminal' || node.type === 'special' || node.type === 'any') {
          record('nodes', owner, start, end); record('labels', `node:${owner}`, start, end)
        }
        if (node.type === 'choice' && node.ordered) record('labels', `${owner}/order`, start, end)
        if (node.type === 'repetition') record('labels', `${owner}/count`, start, end)
      })
    }, () => parseRailroad(text), { mutations: ['add-rule'] })
  }),
} satisfies Pick<FamilyOperations, 'bodyMeta' | 'renderSource' | 'parse' | 'serialize' | 'mutate' | 'buildSourceMap' | 'extractLabels'>

export const RAILROAD_MUTATION_HOOKS: Pick<FamilyOperations, 'mutate'> = {
  mutate: (body, op) => body.kind === 'railroad' ? mutateRailroad(body, op as RailroadMutationOp) : err({ code: 'INVALID_OP', message: 'Railroad source needs a native grammar expression model for typed edits' }),
}
