import { projectZenUMLSequence } from '../zenuml/native-sequence.ts'
import type { FamilyOperations } from './family-registry.ts'
import { ok, type SourceMap, type SourceLocation } from './types.ts'
import { sourceLineStarts, sourcePointAt } from '../shared/source-spans.ts'
import { recordSourceMapEnds } from './source-map-spans.ts'
import { preservedMermaidFamilyText } from '../mermaid-source.ts'
import { parseZenUML } from '../zenuml/native-parser.ts'
import { serializeZenUML } from '../zenuml/native-body.ts'

export const ZENUML_SOURCE_HOOKS: Omit<FamilyOperations, 'mutate'> = {
  parse: ctx => {
    try {
      const body = parseZenUML(preservedMermaidFamilyText(ctx.source))
      if (body.unsupportedSource !== undefined) return ok({ kind: 'opaque', family: 'zenuml', source: ctx.opaqueSource })
      if (body.title === undefined && typeof ctx.source.frontmatter.title === 'string') body.title = ctx.source.frontmatter.title
      return ok(body)
    } catch {
      return ok({ kind: 'opaque', family: 'zenuml', source: ctx.opaqueSource })
    }
  },
  serialize: (body, meta) => {
    if (body.kind !== 'zenuml') throw Error('Expected native ZenUML')
    return serializeZenUML(body, meta === undefined || meta.frontmatter?.title !== body.title)
  },
  extractLabels: source => {
    try {
      const model = projectZenUMLSequence(parseZenUML(source))
      return [
        ...model.actors.filter(actor => !actor.external).map(actor => ({ text: actor.label, target: actor.id })),
        ...model.messages.flatMap(message => message.id === undefined ? [] : [{ text: message.label, target: message.id }]),
      ]
    }
    catch { return [] }
  },
  buildSourceMap: (body, source) => {
    const map: SourceMap = { nodes: new Map(), edges: new Map(), groups: new Map(), labels: new Map() }
    if (body.kind !== 'zenuml') return map
    const ends = { nodes: new Map<string, SourceLocation>(), edges: new Map<string, SourceLocation>(), labels: new Map<string, SourceLocation>() }
    const starts = sourceLineStarts(source)
    try {
      parseZenUML(source, event => {
        const start = sourcePointAt(starts, event.start), end = sourcePointAt(starts, event.end)
        if (event.kind === 'nodes' && map.nodes.has(event.id)) return
        map[event.kind].set(event.id, { line: start.line, col: start.col })
        if (event.kind !== 'groups') ends[event.kind].set(event.id, { line: end.line, col: end.col })
      })
    } catch {
      // The body was read from the authored text; this map reads the
      // XML-decoded canonical text, where `&amp;'` becomes an unclosed quote.
      // Locations are optional metadata: parse stays total without them.
      return { nodes: new Map(), edges: new Map(), groups: new Map(), labels: new Map() }
    }
    recordSourceMapEnds(map, ends)
    return map
  },
  verify: body => body.kind === 'zenuml' && !projectZenUMLSequence(body).actors.some(actor => !actor.external) ? [{ code: 'EMPTY_DIAGRAM' }] : [],
}
