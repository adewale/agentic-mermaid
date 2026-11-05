import { preparePixelText } from '../shared/prepared-text.ts'
import { diagramTitleBand, positionDiagramTitle, resolveRenderStyle } from '../styles.ts'
import type { RenderOptions } from '../types.ts'
import type { InternalStyleFace } from '../scene/style-registry.ts'
import type { WardleyBody, PositionedWardley, WardleyPlacedText } from './types.ts'

/** Wardley positions encode visibility and evolution; measuring labels never
 * changes their coordinate domain or their dependency endpoints. */
export function layoutWardley(body: WardleyBody, options: Readonly<RenderOptions> = {}, styleFace?: InternalStyleFace): PositionedWardley {
  const style = resolveRenderStyle(options, undefined, styleFace), pad = options.padding ?? 32
  const titleBand = diagramTitleBand(body.title, style)
  const plot = { x: pad + 64, y: pad + (titleBand?.height ?? 0) + 24, width: Math.max(240, (body.size?.width ?? 800) - 2 * pad - 64), height: Math.max(180, (body.size?.height ?? 500) - 2 * pad - 72) }
  const measure = (text: string) => preparePixelText(text, { display: 'literal', fontSize: style.nodeLabelFontSize, fontWeight: style.nodeLabelFontWeight, maxWidth: 220, fontFamily: options.font })
  const x = (value: number) => plot.x + value / 100 * plot.width, y = (value: number) => plot.y + (1 - value / 100) * plot.height
  const label = (id: string, text: string, px: number, py: number): WardleyPlacedText => ({ id, text, x: px, y: py, block: measure(text) })
  const nodes = body.nodes.map(node => ({ ...label(node.id, node.label, x(node.x!), y(node.y!)), node }))
  const byId = new Map(nodes.map(node => [node.id, node]))
  const labels: WardleyPlacedText[] = [label('axis:visibility', body.axes.yLabel ?? 'Visibility', pad, plot.y - 12), label('axis:evolution', body.axes.xLabel ?? 'Evolution', plot.x + plot.width / 2, plot.y + plot.height + 48)]
  const stages = body.axes.stages ?? ['Genesis', 'Custom built', 'Product', 'Commodity']
  stages.forEach((stage, index) => {
    const left = index === 0 ? 0 : body.axes.stageBoundaries?.[index - 1] ?? index / stages.length
    const right = body.axes.stageBoundaries?.[index] ?? (index + 1) / stages.length
    labels.push(label(`stage:${index}`, stage, x((left + right) * 50), plot.y + plot.height + 20))
  })
  body.notes.forEach((note, index) => labels.push(label(`note:${index}`, note.text, x(note.x), y(note.y))))
  body.annotations.forEach((annotation, index) => annotation.coordinates.forEach((at, coordinate) => labels.push(label(`annotation:${index}:${coordinate}`, `[${annotation.number}] ${annotation.text ?? ''}`, x(at.x), y(at.y)))))
  body.accelerators.forEach((force, index) => labels.push(label(`accelerator:${index}`, `${force.name} >>`, x(force.x), y(force.y))))
  body.deaccelerators.forEach((force, index) => labels.push(label(`deaccelerator:${index}`, `${force.name} <<`, x(force.x), y(force.y))))
  const edges: PositionedWardley['edges'] = body.links.map((link, index) => {
    const from = byId.get(link.source), to = byId.get(link.target)
    if (!from || !to) throw new Error('Wardley dependency has no positioned endpoint')
    return { id: `dependency:${index}`, from: link.source, to: link.target, points: [{ x: from.x, y: from.y }, { x: to.x, y: to.y }], flow: link.flow, dashed: link.dashed,
      ...(link.label !== undefined ? { label: label(`dependency-label:${index}`, link.label, (from.x + to.x) / 2, (from.y + to.y) / 2) } : {}) }
  })
  for (const [index, trend] of body.trends.entries()) {
    const from = byId.get(trend.nodeId)
    if (!from) throw new Error('Wardley evolution has no positioned component')
    edges.push({ id: `evolve:${index}`, from: trend.nodeId, to: trend.nodeId, points: [{ x: from.x, y: from.y }, { x: x(trend.targetX), y: y(trend.targetY) }], dashed: true, flow: 'forward', trend: true })
  }
  const pipelines = body.pipelines.map(pipeline => {
    const members = pipeline.componentIds.map(id => byId.get(id)!)
    const left = Math.min(...members.map(member => member.x)), right = Math.max(...members.map(member => member.x))
    return { id: `pipeline:${pipeline.nodeId}`, members: [...pipeline.componentIds], x: left - 12, y: byId.get(pipeline.nodeId)!.y - 12, width: Math.max(24, right - left + 24), height: 24 }
  })
  // Label retention may grow the canvas beyond an authored plot size; it
  // never compresses the authored coordinate domain or clips content.
  let width = plot.x + plot.width + pad, height = plot.y + plot.height + 64 + pad
  for (const item of [...labels, ...edges.flatMap(edge => edge.label ? [edge.label] : []), ...nodes.map(node => ({ ...node, x: node.x + (node.node.labelOffsetX ?? 14), y: node.y + (node.node.labelOffsetY ?? -14) }))]) {
    width = Math.max(width, item.x + item.block.width / 2 + pad)
    height = Math.max(height, item.y + item.block.height / 2 + pad)
  }
  width = Math.max(width, (titleBand?.width ?? 0) + 2 * pad)
  return { width, height, plot, body, nodes, labels, edges, pipelines, options, ...(titleBand ? { title: positionDiagramTitle(titleBand, width, pad) } : {}) }
}
