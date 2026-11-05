import { unknownOpMessage } from './mutation-ops.ts'
import type { FamilyOperations } from './families.ts'
import type { DiagramBody, MutationError, ParseError, Result } from './types.ts'
import { err, ok } from './types.ts'
import { parseRailroad } from '../railroad/parser.ts'
import { renderRailroad } from '../railroad/source.ts'
import type { RailroadBody, RailroadMutationOp, RailroadNode } from '../railroad/types.ts'

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
  const walk = (node: RailroadNode, target: string): void => {
    if (node.type === 'terminal') labels.push({ text: node.value, target })
    else if (node.type === 'nonterminal') labels.push({ text: node.name, target })
    else if (node.type === 'special') labels.push({ text: node.text, target })
    else if (node.type === 'sequence') node.elements.forEach((child, index) => walk(child, `${target}/${index}`))
    else if (node.type === 'choice') node.alternatives.forEach((child, index) => walk(child, `${target}/${index}`))
    else if (node.type === 'exception') { walk(node.base, `${target}/base`); walk(node.except, `${target}/except`) }
    else if (node.type !== 'any') walk(node.element, `${target}/0`)
  }
  body.rules.forEach((rule, index) => { const id = `rule#${index}:${rule.name}`; labels.push({ text: rule.name, target: id }); walk(rule.definition, `${id}/expression`) })
  return labels
}
export const RAILROAD_SOURCE_HOOKS = {
  renderSource: () => 'canonical',
  extractLabels: source => { try { return railroadLabels(parseRailroad(source)) } catch { return [] } },
  parse: ctx => parseRailroadBody(ctx.source.familyBody, ctx.opaqueSource),
  serialize: body => { if (body.kind !== 'railroad') throw new Error(`Railroad serializer received ${body.kind}`); return renderRailroad(body) },
  buildSourceMap: (body, source) => {
    const result = { nodes: new Map(), edges: new Map(), groups: new Map(), labels: new Map() }
    if (body.kind === 'railroad') source.split(/\r?\n/).forEach((line, index) => {
      const name = line.match(/^\s*([A-Za-z_][\w-]*)\s*(?:=|<-|::=)/)?.[1]
      if (name && !result.nodes.has(name)) result.nodes.set(name, { line: index + 1, col: line.indexOf(name) + 1 })
    })
    return result
  },
} satisfies Pick<FamilyOperations, 'renderSource' | 'parse' | 'serialize' | 'mutate' | 'buildSourceMap' | 'extractLabels'>

export const RAILROAD_MUTATION_HOOKS: Pick<FamilyOperations, 'mutate'> = {
  mutate: (body, op) => body.kind === 'railroad' ? mutateRailroad(body, op as RailroadMutationOp) : err({ code: 'INVALID_OP', message: 'Railroad source needs a native grammar expression model for typed edits' }),
}
