// Pure positioned-artifact projection shared by graphical and agent adapters.
import type { PositionedRadarChart } from '../radar/types.ts'
import type { FamilyPositionedProjectionContext, FamilyPositionedView } from '../agent/families.ts'
import type { RenderedLayoutGroup, RenderedLayoutNode } from '../agent/types.ts'
import { f, canvasOf, retainedLabelGeometry } from './geometry.ts'

export function projectRadarPositioned({ positioned }: FamilyPositionedProjectionContext<PositionedRadarChart>): FamilyPositionedView {
  // The positioned chart carries the exact resolved typography it was laid
  // out with, including named Style-face metrics.
  const nodes: RenderedLayoutNode[] = []
  // Concentric graticule rings are the (member-less) grouping frames.
  const groups: RenderedLayoutGroup[] = positioned.rings.map((ring, index) => ({
    id: `ring:${index}`,
    x: f(positioned.cx - ring.r),
    y: f(positioned.cy - ring.r),
    w: f(ring.r * 2),
    h: f(ring.r * 2),
    members: [],
  }))

  positioned.axes.forEach((axis, index) => {
    const width = Math.max(8, axis.block?.width ?? axis.labelWidth)
    const height = axis.block?.height ?? 0
    const x = axis.anchor === 'start' ? axis.labelX : axis.anchor === 'end' ? axis.labelX - width : axis.labelX - width / 2
    nodes.push({
      id: `axis#${index}:${axis.id}`,
      x: f(x),
      y: f(axis.labelY - height / 2),
      w: f(width),
      h: f(height),
      shape: 'rectangle',
      label: axis.label,
      role: 'labelled-mark',
      ...retainedLabelGeometry(axis.block, axis.labelX, axis.labelY, canvasOf(positioned), axis.anchor),
    })
  })

  positioned.tickLabels.forEach((tick, index) => {
    const width = tick.block?.width ?? tick.w
    const height = tick.block?.height ?? tick.h
    nodes.push({
      id: `tick:${index}`,
      x: f(tick.x - width / 2),
      y: f(tick.y - height / 2),
      w: f(width),
      h: f(height),
      shape: 'rectangle',
      label: tick.text,
      role: 'labelled-mark',
      ...retainedLabelGeometry(tick.block, tick.x, tick.y, canvasOf(positioned)),
    })
  })

  const curveIdCounts = new Map<string, number>()
  for (const curve of positioned.curves) curveIdCounts.set(curve.id, (curveIdCounts.get(curve.id) ?? 0) + 1)
  const curveIdOccurrences = new Map<string, number>()
  positioned.curves.forEach(curve => {
    const occurrence = curveIdOccurrences.get(curve.id) ?? 0
    curveIdOccurrences.set(curve.id, occurrence + 1)
    const identity = (curveIdCounts.get(curve.id) ?? 0) > 1 ? `${curve.id}#${occurrence}` : curve.id
    curve.vertices.forEach((vertex, vertexIndex) => {
      nodes.push({ id: `dot:${identity}:${vertexIndex}`, x: f(vertex.x - 3), y: f(vertex.y - 3), w: f(6), h: f(6), shape: 'circle', role: 'mark' })
    })
  })

  for (const [index, item] of positioned.legend.entries()) {
    nodes.push({
      id: `legend-swatch#${index}`,
      x: f(item.x),
      y: f(item.y),
      w: f(item.swatchSize),
      h: f(item.swatchSize),
      shape: 'rectangle',
      role: 'mark',
    })
    // Legend labels wrap to a budget, so project the wrapped extent (widest
    // line × line count), not the full single-line label — the public view must
    // match the rendered legend.
    const width = Math.max(8, item.block?.width ?? 0)
    const height = item.block?.height ?? 0
    nodes.push({
      id: `legend-label#${index}`,
      x: f(item.textX),
      y: f(item.textY - height / 2),
      w: f(width),
      h: f(height),
      shape: 'rectangle',
      label: item.lines.join(' '),
      role: 'labelled-mark',
      ...retainedLabelGeometry(item.block, item.textX, item.textY, canvasOf(positioned), 'start'),
    })
  }

  if (positioned.title) {
    const width = positioned.title.block?.width ?? 0
    const height = positioned.title.block?.height ?? 0
    nodes.push({
      id: 'title',
      x: f(positioned.title.x - width / 2),
      y: f(positioned.title.y - height / 2),
      w: f(width),
      h: f(height),
      shape: 'rectangle',
      label: positioned.title.text,
      role: 'labelled-mark',
      ...retainedLabelGeometry(positioned.title.block, positioned.title.x, positioned.title.y, canvasOf(positioned)),
    })
  }

  return { version: 1, nodes, edges: [], groups, bounds: { w: f(positioned.width), h: f(positioned.height) } }
}
