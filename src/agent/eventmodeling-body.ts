import { recordSourceMapEnds } from './source-map-spans.ts'
import { sourceLineStarts, sourcePointAt } from '../shared/source-spans.ts'
import type { SourceMap, SourceLocation } from './types.ts'
import type { FamilyOperations } from './family-registry.ts'
import { eventLanes, eventNonportableIdentifiers, eventSourceTypeProblems, parseEventModeling } from '../eventmodeling/parser.ts'
import { eventFrameText } from '../eventmodeling/layout.ts'
import { prepareDisplayText } from '../shared/display-text.ts'
import { serializeEventModeling } from '../eventmodeling/body.ts'
import { labelOverflowCollector } from './body-utils.ts'
import { ok, type LayoutWarning } from './types.ts'
export const EVENTMODELING_SOURCE_HOOKS: Omit<FamilyOperations, 'mutate'> = {
  parse: ctx => {
    try {
      const body = parseEventModeling(ctx.source.familyBody)
      if (body.title === undefined && typeof ctx.source.frontmatter.title === 'string') body.title = ctx.source.frontmatter.title
      if (eventNonportableIdentifiers(body).length) return ok({ kind: 'opaque', family: 'eventmodeling', source: ctx.opaqueSource })
      return ok(body)
    } catch {
      return ok({ kind: 'opaque', family: 'eventmodeling', source: ctx.opaqueSource })
    }
  },
  serialize: body => {
    if (body.kind !== 'eventmodeling') throw Error('Expected Event Modeling body')
    return serializeEventModeling(body, false)
  },
  renderSource: body => (body.kind === 'eventmodeling' && eventNonportableIdentifiers(body).length ? 'canonical' : 'serialized'),
  extractLabels: source => {
    try {
      return parseEventModeling(source).frames.map(frame => ({ text: frame.entity, target: frame.id }))
    } catch {
      return []
    }
  },
  buildSourceMap: (body, source) => {
    const map: SourceMap = { nodes: new Map(), edges: new Map(), groups: new Map(), labels: new Map() }
    if (body.kind !== 'eventmodeling') return map
    const ends = { nodes: new Map<string, SourceLocation>(), edges: new Map<string, SourceLocation>(), labels: new Map<string, SourceLocation>() }
    const starts = sourceLineStarts(source)
    parseEventModeling(source, event => {
      const at = sourcePointAt(starts, event.start)
      const end = sourcePointAt(starts, event.end)
      map[event.kind].set(event.id, { line: at.line, col: at.col })
      ends[event.kind].set(event.id, { line: end.line, col: end.col })
    })
    recordSourceMapEnds(map, ends)
    return map
  },
  verify: (body, options) => {
    if (body.kind !== 'eventmodeling') return []
    const frames = new Map(body.frames.map(frame => [frame.id, frame]))
    const warnings: LayoutWarning[] = [
      ...(!body.frames.length ? [{ code: 'EMPTY_DIAGRAM' as const }] : []),
      ...eventNonportableIdentifiers(body).map(id => ({ code: 'UNSUPPORTED_SYNTAX' as const, syntax: 'eventmodeling_keyword_identifier', message: `Identifier ${id} is read literally; pinned Mermaid reserves that keyword. Rename it before exporting or editing.` })),
      ...(body.accessibilityTitle !== undefined || body.accessibilityDescription !== undefined ? [{ code: 'UNSUPPORTED_SYNTAX' as const, syntax: 'eventmodeling_accessibility', message: 'Event Modeling accessibility is retained in native comments on export; pinned Mermaid does not expose these fields.' }] : []),
      ...body.frames.flatMap(frame => eventSourceTypeProblems(frame.type, frame.sources.map(id => frames.get(id)?.type)).map(problem => ({ code: 'EVENT_SOURCE_TYPE' as const, node: frame.id, source: frame.sources[problem.sourceIndex]!, message: problem.message }))),
    ]
    const overflow = labelOverflowCollector(warnings, options)
    if (body.title !== undefined) overflow('title', prepareDisplayText(body.title, 'formatted'))
    for (const lane of eventLanes(body)) overflow(lane.id, prepareDisplayText(lane.label, 'literal'))
    for (const frame of body.frames) overflow(frame.id, prepareDisplayText(eventFrameText(body, frame), 'literal'))
    return warnings
  },
}

export function eventModelingUnsupportedSyntaxWarnings(source: string): import('./types.ts').LayoutWarning[] {
  const warnings: import('./types.ts').LayoutWarning[] = []
  try {
    parseEventModeling(source, event => {
      if (event.kind === 'labels' && event.id === 'unsupported-gwt') warnings.push({ code: 'UNSUPPORTED_SYNTAX', syntax: 'eventmodeling_gwt_order', message: 'Pinned Mermaid requires one given clause, an optional when clause, then one then clause, in that order. Native reading retains the authored clause contents.' })
      if (event.kind === 'labels' && event.id === 'title') warnings.push({ code: 'UNSUPPORTED_SYNTAX', syntax: 'eventmodeling_title_statement', message: 'In-body Event Modeling titles are a native read extension. Export uses portable YAML metadata; the pinned renderer does not paint that metadata title.' })
    })
  } catch { /* Opaque syntax has its own preservation diagnostic. */ }
  return warnings
}
