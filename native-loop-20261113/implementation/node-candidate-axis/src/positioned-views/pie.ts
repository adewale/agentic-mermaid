// Pure positioned-artifact projection shared by graphical and agent adapters.
import type { PositionedPieChart } from '../pie/types.ts'
import type { FamilyPositionedProjectionContext, FamilyPositionedView } from '../agent/families.ts'
import type { RenderedLayoutNode } from '../agent/types.ts'
import { f, elementCertificates, canvasOf, retainedLabelGeometry } from './geometry.ts'
import { formatPiePercent } from '../pie/layout.ts'

export function projectPiePositioned({ positioned, options }: FamilyPositionedProjectionContext<PositionedPieChart>): FamilyPositionedView {
  // Pie has no structural nodes/edges — the slices are angular wedges. Use
  // each slice's legend row as a label-anchored box (legend swatch top-left,
  // text measured by layout — a per-character estimate overran the canvas for
  // long labels and reported OFF_CANVAS where nothing was). This gives the
  // metrics a positive node area + legible labels to measure.
  const nodes: RenderedLayoutNode[] = positioned.legend.map((l, i) => {
    const labelText = `${l.label} (${formatPiePercent(l.fraction)})`
    const w = Math.max(l.swatchSize, l.textX - l.x + l.textWidth)
    return { id: `slice#${i}:${l.label}`, x: f(l.x), y: f(l.y), w: f(w), h: f(l.swatchSize), shape: 'rectangle', label: labelText,
      ...retainedLabelGeometry(l.block, l.textX, l.textY, canvasOf(positioned), 'start') }
  })
  const layout: FamilyPositionedView = { version: 1, nodes, edges: [], groups: [], bounds: { w: f(positioned.width), h: f(positioned.height) } }
  if (options.debug) layout.certificates = elementCertificates('pie', layout, 'legend-contained')
  return layout
}
