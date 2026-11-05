import type { FamilyOperations } from './families.ts'
import type { DiagramBody, MutationError, ParseError, Result } from './types.ts'
import { err, ok } from './types.ts'
import { parseRailroad } from '../railroad/parser.ts'
import { renderRailroad } from '../railroad/source.ts'
import type { RailroadBody, RailroadMutationOp } from '../railroad/types.ts'

export function parseRailroadBody(source: string, opaqueSource = source): Result<RailroadBody | Extract<DiagramBody, { kind: 'opaque' }>, ParseError[]> {
  try { return ok(parseRailroad(source)) }
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
      default: return err({ code: 'INVALID_OP', message: 'Unknown Railroad mutation operation' })
    }
    return ok(parseRailroad(renderRailroad(draft)))
  } catch (error) { return err({ code: 'INVALID_OP', message: error instanceof Error ? error.message : String(error) }) }
}
export const RAILROAD_SOURCE_HOOKS = {
  renderSource: () => 'canonical',
  parse: ctx => parseRailroadBody(ctx.source.familyBody, ctx.opaqueSource),
  serialize: body => { if (body.kind !== 'railroad') throw new Error(`Railroad serializer received ${body.kind}`); return renderRailroad(body) },
  mutate: (body, op) => body.kind === 'railroad' ? mutateRailroad(body, op as RailroadMutationOp) : err({ code: 'INVALID_OP', message: 'Railroad source needs a native grammar expression model for typed edits' }),
  buildSourceMap: (body, source) => {
    const result = { nodes: new Map(), edges: new Map(), groups: new Map(), labels: new Map() }
    if (body.kind === 'railroad') source.split(/\r?\n/).forEach((line, index) => {
      const name = line.match(/^\s*([A-Za-z_][\w-]*)\s*(?:=|<-|::=)/)?.[1]
      if (name && !result.nodes.has(name)) result.nodes.set(name, { line: index + 1, col: line.indexOf(name) + 1 })
    })
    return result
  },
} satisfies Pick<FamilyOperations, 'renderSource' | 'parse' | 'serialize' | 'mutate' | 'buildSourceMap'>
