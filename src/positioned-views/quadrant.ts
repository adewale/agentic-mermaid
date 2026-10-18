// Pure positioned-artifact projection shared by graphical and agent adapters.
import type { PositionedQuadrantChart } from '../quadrant/types.ts'
import type { FamilyPositionedProjectionContext, FamilyPositionedView } from '../agent/families.ts'
import type { RenderedLayoutGroup, RenderedLayoutNode } from '../agent/types.ts'
import { f, elementCertificates, canvasOf, labelRect, toFinite } from './geometry.ts'

export function projectQuadrantPositioned({ positioned, options }: FamilyPositionedProjectionContext<PositionedQuadrantChart>): FamilyPositionedView {
  const nodes: RenderedLayoutNode[] = positioned.points.map((p, i) => ({
    id: `point#${i}:${p.label}`,
    x: f(p.cx - p.radius),
    y: f(p.cy - p.radius),
    w: f(p.radius * 2),
    h: f(p.radius * 2),
    shape: 'circle',
    label: p.label,
    role: 'labelled-mark' as const,
    labelVisibility: p.labelHidden ? 'hidden' : 'visible',
    labelBounds: p.labelBox ? { x: toFinite(p.labelBox.x0), y: toFinite(p.labelBox.y0), w: toFinite(p.labelBox.x1 - p.labelBox.x0), h: toFinite(p.labelBox.y1 - p.labelBox.y0) } : undefined,
    labelContainer: labelRect(canvasOf(positioned)),
    dataPosition: { x: toFinite(p.nx), y: toFinite(p.ny) },
  }))
  const groups: RenderedLayoutGroup[] = positioned.regions.map(r => ({
    id: `quadrant#${r.number}`,
    x: f(r.x),
    y: f(r.y),
    w: f(r.width),
    h: f(r.height),
    members: positioned.points
      .map((point, index) => ({ point, index }))
      .filter(({ point }) => r.number === (point.nx >= 0.5 ? (point.ny >= 0.5 ? 1 : 4) : point.ny >= 0.5 ? 2 : 3))
      .map(({ point, index }) => `point#${index}:${point.label}`),
    label: r.label,
  }))
  const layout: FamilyPositionedView = { version: 1, nodes, edges: [], groups, bounds: { w: f(positioned.width), h: f(positioned.height) } }
  if (options.debug) layout.certificates = elementCertificates('quadrant', layout, 'plot-contained')
  return layout
}
