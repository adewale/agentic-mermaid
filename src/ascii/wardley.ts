import type { AsciiContext } from '../agent/families.ts'
import { parseWardleyBody } from '../agent/wardley-body.ts'
import { TerminalDocument } from './terminal-document.ts'
import { terminalArtifact } from './terminal-artifact.ts'
import { wrapText } from './wrap.ts'
export function renderWardleyTerminal(ctx: AsciiContext) {
  const body = parseWardleyBody(ctx.source.authoredFamilyBody ?? ctx.source.familyBody), document = new TerminalDocument()
  document.report({ code: 'TERMINAL_FAMILY_PROJECTION', feature: 'wardley.coordinates', message: 'The map is projected as component coordinates, pipeline memberships and dependencies. Visibility and evolution percentages are retained.' })
  const line = (text: string, id: string, kind: 'node' | 'edge' | 'label' = 'label') => { for (const part of wrapText(text, ctx.options.targetWidth)) document.line([{ text: part, role: 'text', owner: { id, kind } }]) }
  if (body.title ?? ctx.config.title) line(body.title ?? ctx.config.title!, 'title')
  line(`Evolution: ${(body.axes.stages ?? ['Genesis', 'Custom built', 'Product', 'Commodity']).map((stage, index) => stage + (body.axes.stageBoundaries?.[index] === undefined ? '' : ` <= ${body.axes.stageBoundaries[index]! * 100}%`)).join(' | ')}`, 'axis:evolution')
  if (body.size) line(`Plot size: ${body.size.width} x ${body.size.height}`, 'plot:size')
  for (const node of body.nodes) line(`${node.label} [visibility ${node.y}%, evolution ${node.x}%]${node.inertia ? ' (inertia)' : ''}${node.sourceStrategy ? ` (${node.sourceStrategy})` : ''}`, node.id, 'node')
  for (const pipeline of body.pipelines) line(`Pipeline ${pipeline.nodeId}: ${pipeline.componentIds.join(', ')}`, `pipeline:${pipeline.nodeId}`)
  body.links.forEach((link, index) => line(`${link.source} ${link.flow === 'bidirectional' ? '<->' : link.flow === 'backward' ? '<-' : link.flow === 'forward' ? '->' : '--'} ${link.target}${link.dashed ? ' (dashed)' : ''}${link.label === undefined ? '' : `: ${link.label}`}`, `dependency:${index}`, 'edge'))
  body.trends.forEach((trend, index) => line(`Evolve ${trend.nodeId} -> ${trend.targetX}% evolution`, `evolve:${index}`, 'edge'))
  body.notes.forEach((note, index) => line(`Note [${note.y}%, ${note.x}%]: ${note.text}`, `note:${index}`))
  body.annotations.forEach((annotation, index) => line(`[${annotation.number}] ${annotation.text ?? ''} @ ${annotation.coordinates.map(at => `${at.y}%, ${at.x}%`).join('; ')}`, `annotation:${index}`))
  if (body.annotationsBox) line(`Annotation legend [${body.annotationsBox.y}%, ${body.annotationsBox.x}%]`, 'annotations-box')
  body.accelerators.forEach((force, index) => line(`Accelerator ${force.name} [${force.y}%, ${force.x}%]`, `accelerator:${index}`))
  body.deaccelerators.forEach((force, index) => line(`Deaccelerator ${force.name} [${force.y}%, ${force.x}%]`, `deaccelerator:${index}`))
  return terminalArtifact(document, { colorMode: ctx.colorMode, theme: ctx.theme })
}
