import type { FamilyOperations } from './family-registry.ts'
import { parseEventModeling } from '../eventmodeling/parser.ts'
import { mutateEventModeling, serializeEventModeling } from '../eventmodeling/body.ts'
import { err, ok } from './types.ts'
export const EVENTMODELING_AGENT_HOOKS: FamilyOperations = {
  parse: ctx => {
    try {
      const body = parseEventModeling(ctx.source.familyBody)
      if (body.title === undefined && typeof ctx.source.frontmatter.title === 'string') body.title = ctx.source.frontmatter.title
      return ok(body)
    } catch {
      return ok({ kind: 'opaque', family: 'eventmodeling', source: ctx.opaqueSource })
    }
  },
  serialize: body => {
    if (body.kind !== 'eventmodeling') throw Error('Expected Event Modeling body')
    return serializeEventModeling(body)
  },
  mutate: (body, op) => (body.kind === 'eventmodeling' ? mutateEventModeling(body, op as never) : err({ code: 'UNSUPPORTED_FAMILY', message: 'Unmodeled Event Modeling source remains preserved' })),
  renderSource: () => 'serialized',
  extractLabels: source => {
    try {
      return parseEventModeling(source).frames.map(frame => ({ text: frame.entity, target: frame.id }))
    } catch {
      return []
    }
  },
  buildSourceMap: (body, source) => {
    const map = { nodes: new Map(), edges: new Map(), groups: new Map(), labels: new Map() }
    if (body.kind !== 'eventmodeling') return map
    source.split('\n').forEach((line, index) => {
      const match = line.match(/^\s*(?:tf|timeframe|rf|resetframe)\s+(\d{1,3})\s+\w+\s+(\S+)/)
      if (match) {
        const at = { line: index + 1, col: line.indexOf(match[1]!) + 1 }
        map.nodes.set(match[1], at)
        map.labels.set(`node:${match[1]}`, at)
      }
    })
    return map
  },
  verify: body => (body.kind === 'eventmodeling' && !body.frames.length ? [{ code: 'EMPTY_DIAGRAM' }] : []),
}
