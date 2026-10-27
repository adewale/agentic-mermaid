import type { AsciiContext } from '../agent/family-registry.ts'
import { parseEventModeling, eventModelingLane, eventModelingRelations, eventModelingSpecificationLines } from '../eventmodeling/parser.ts'
import { TerminalDocument } from './terminal-document.ts'
import { terminalArtifact } from './terminal-artifact.ts'
import { wrapText } from './wrap.ts'
export function renderEventModelingTerminal(ctx: AsciiContext) {
  const body = parseEventModeling(ctx.source.authoredFamilyBody ?? ctx.source.familyBody), document = new TerminalDocument()
  document.report({ code: 'TERMINAL_FAMILY_PROJECTION', feature: 'eventmodeling.timeline', message: 'Timeline columns and swimlanes are projected as ordered frames with explicit incoming frame IDs; terminal cells do not encode elapsed time.' })
  const line = (text: string, id: string) => {
    const prefix = /^\[\d+\] /.exec(text)?.[0] ?? ''
    const width = ctx.options.targetWidth === undefined ? undefined : Math.max(1, ctx.options.targetWidth - prefix.length)
    for (const [index, value] of wrapText(text.slice(prefix.length), width).entries()) document.line([
      ...(prefix ? [{ text: index ? ' '.repeat(prefix.length) : prefix, kind: 'surface' as const, owner: { id, kind: 'node' as const } }] : []),
      { text: value, role: 'text', owner: { id, kind: 'node' } },
    ])
  }
  if (body.title ?? ctx.config.title) line((body.title ?? ctx.config.title)!, 'title')
  const relations = eventModelingRelations(body)
  for (const frame of body.frames) {
    line(`[${frame.id}] ${frame.entityType} ${frame.entity} — ${eventModelingLane(frame)}`, frame.id)
    const incoming = relations.filter(edge => edge.to === frame.id)
    if (incoming.length) line(`  ${incoming.map(edge => edge.from).join(', ')} ${ctx.config.useAscii ? '->' : '→'} ${frame.id}`, frame.id)
    const data = frame.data ?? body.data.find(item => item.id === frame.dataReference)?.value
    if (data) for (const row of data.text.split('\n')) line(`  ${row}`, frame.id)
    for (const note of body.notes.filter(note => note.frame === frame.id)) line(`  Note: ${note.text}`, frame.id)
    for (const spec of body.specifications.filter(spec => spec.frame === frame.id)) for (const text of eventModelingSpecificationLines(spec)) line(`  ${text}`, frame.id)
  }
  return terminalArtifact(document, { colorMode: ctx.colorMode, theme: ctx.theme })
}
