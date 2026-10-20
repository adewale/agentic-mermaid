// Pure positioned-artifact projection shared by graphical and agent adapters.
import type { PositionedXYChart } from '../xychart/types.ts'
import type { FamilyPositionedProjectionContext, FamilyPositionedView } from '../agent/families.ts'
import type { RenderedLayoutGroup, RenderedLayoutLabel, RenderedLayoutNode } from '../agent/types.ts'
import type { PixelTextBlock } from '../shared/prepared-text.ts'
import { LEGEND_SWATCH_GAP, LEGEND_SWATCH_SIZE } from '../xychart/layout.ts'
import { rotateBoxBounds } from '../shared/transformed-bounds.ts'
import { f, fSpan, elementCertificates, retainedLabelBounds, labelRect, canvasOf } from './geometry.ts'

export function projectXyChartPositioned({ positioned, options }: FamilyPositionedProjectionContext<PositionedXYChart>): FamilyPositionedView {
  const nodes: RenderedLayoutNode[] = []
  const labels: RenderedLayoutLabel[] = []
  const container = labelRect(canvasOf(positioned))
  const text = (id: string, value: string, block: PixelTextBlock | undefined, x: number, y: number, anchor: 'start' | 'middle' | 'end' = 'middle', rotate = 0): void => {
    if (!value) return
    let bounds = retainedLabelBounds(block, x, y, anchor)
    if (bounds && rotate) {
      const rotated = rotateBoxBounds({ x0: bounds.x, y0: bounds.y, x1: bounds.x + bounds.w, y1: bounds.y + bounds.h }, { x, y }, rotate)
      bounds = labelRect({ x: rotated.x0, y: rotated.y0, width: rotated.x1 - rotated.x0, height: rotated.y1 - rotated.y0 })
    }
    labels.push({ id, text: value, ...(bounds ? { bounds } : {}), container })
  }
  // Bars are the primary boxes.
  const barPointIndices = new Map<number, number>()
  positioned.bars.forEach(b => {
    const pointIndex = barPointIndices.get(b.seriesIndex) ?? 0
    barPointIndices.set(b.seriesIndex, pointIndex + 1)
    nodes.push({ id: `bar#${b.seriesIndex}:pt#${pointIndex}`, x: f(b.x), y: f(b.y), w: fSpan(b.x, b.width), h: fSpan(b.y, b.height), shape: 'rectangle', label: b.label, role: 'labelled-mark', labelVisibility: 'semantic' })
  })
  // Line series points become small marker boxes so line-only charts are
  // still measured (whitespace/legibility care about node area).
  positioned.lines.forEach(ln => {
    ln.points.forEach((p, pi) => {
      // These are measurement footprints, not renderer-owned point circles.
      // A point clamps into the plot, so its footprint is the part of the
      // marker box inside the plot, without inventing geometry past it.
      const plot = positioned.plotArea
      const x = Math.max(plot.x, Math.min(plot.x + plot.width, p.x - 3)), y = Math.max(plot.y, Math.min(plot.y + plot.height, p.y - 3))
      const right = Math.max(x, Math.min(plot.x + plot.width, p.x + 3)), bottom = Math.max(y, Math.min(plot.y + plot.height, p.y + 3))
      nodes.push({ id: `line#${ln.seriesIndex}:pt#${pi}`, x: f(x), y: f(y), w: fSpan(x, right - x), h: fSpan(y, bottom - y), shape: 'circle', label: p.label, role: p.label ? 'labelled-mark' : 'mark', labelVisibility: 'semantic' })
      if (p.textLabel !== undefined) {
        const at = p.textPosition
        text(`point-label:${ln.seriesIndex}:${pi}`, p.textBlock?.text ?? p.textLabel, at ? p.textBlock : undefined, at?.x ?? p.x, at?.y ?? p.y, at?.anchor ?? 'middle')
      }
    })
  })
  if (positioned.title) {
    const title = positioned.title
    text('title', title.block?.text ?? title.text, title.block, title.x, title.y)
  }
  for (const [name, axis] of [['x', positioned.xAxis], ['y', positioned.yAxis]] as const) {
    if (axis.title) {
      const title = axis.title
      text(`axis:${name}:title`, title.block?.text ?? title.text, title.block, title.x, title.y, 'middle', title.rotate)
    }
    axis.ticks.forEach((tick, index) => text(`axis:${name}:label:${index}`, tick.block?.text ?? tick.label, tick.block, tick.labelX, tick.labelY, tick.textAnchor))
  }
  for (const item of positioned.legend) {
    text(`legend:label:${item.colorIndex}`, item.block?.text ?? item.label, item.block,
      item.x + LEGEND_SWATCH_SIZE + LEGEND_SWATCH_GAP, item.y + Math.max(LEGEND_SWATCH_SIZE, item.block?.height ?? 0) / 2, 'start')
  }
  positioned.dataLabels.forEach((label, index) => {
    const centerY = label.dominantBaseline === 'hanging' ? label.y + (label.block?.height ?? 0) / 2
      : label.dominantBaseline === 'middle' ? label.y : label.y - label.fontSize * 0.35
    text(`data-label:${index}`, label.block?.text ?? label.text, label.block, label.x, centerY, label.anchor)
  })
  // Plot area is the single group (the chart's content frame).
  const groups: RenderedLayoutGroup[] = [
    {
      id: 'plot',
      x: f(positioned.plotArea.x),
      y: f(positioned.plotArea.y),
      w: fSpan(positioned.plotArea.x, positioned.plotArea.width),
      h: fSpan(positioned.plotArea.y, positioned.plotArea.height),
      members: nodes.filter(node => node.x + node.w / 2 >= positioned.plotArea.x && node.x + node.w / 2 <= positioned.plotArea.x + positioned.plotArea.width && node.y + node.h / 2 >= positioned.plotArea.y && node.y + node.h / 2 <= positioned.plotArea.y + positioned.plotArea.height).map(node => node.id),
    },
  ]
  const layout: FamilyPositionedView = { version: 1, nodes, edges: [], groups, bounds: { w: f(positioned.width), h: f(positioned.height) }, labels }
  if (options.debug) layout.certificates = elementCertificates('xychart', layout, 'plot-contained', groups[0], 'center')
  return layout
}
