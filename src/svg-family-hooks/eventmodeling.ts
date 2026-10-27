import { layoutResult, positionedView, scene, type BrowserSvgFamilyHooks } from '../browser-lazy/family.ts'
import { parseEventModeling } from '../eventmodeling/parser.ts'
import { layoutEventModeling } from '../eventmodeling/layout.ts'
import { lowerEventModelingScene } from '../eventmodeling/renderer.ts'
import { retainedLabelGeometry, retainedLabelBounds, canvasOf, labelRect, f } from '../positioned-views/geometry.ts'
import type { PositionedEventModeling } from '../eventmodeling/layout.ts'
import type { FamilyPositionedProjectionContext, FamilyPositionedView } from '../agent/family-registry.ts'
export function projectEventModelingPositioned({ positioned: p }: FamilyPositionedProjectionContext<PositionedEventModeling>): FamilyPositionedView {
  return {
    version: 1, bounds: { w: f(p.width), h: f(p.height) },
    nodes: p.frames.map(item => ({ id: item.frame.id, x: f(item.x), y: f(item.y), w: f(item.width), h: f(item.height), shape: 'rectangle', label: item.label, parentId: `lane:${item.lane}`, ...retainedLabelGeometry(item.block, item.x + item.width / 2, item.y + item.height / 2, item) })),
    edges: p.relations.map(edge => ({ id: edge.id, from: edge.from, to: edge.to, path: edge.points.map(point => [f(point.x), f(point.y)]) })),
    groups: p.lanes.map(lane => ({ id: `lane:${lane.id}`, label: lane.label, x: f(8), y: f(lane.y), w: f(p.width - 16), h: f(lane.height), members: p.frames.filter(item => item.lane === lane.id).map(item => item.frame.id) })),
    labels: p.title ? [{ id: 'title', text: p.title.text, bounds: retainedLabelBounds(p.title.block, p.title.x, p.title.y), container: labelRect(canvasOf(p)) }] : [],
  }
}
export const EVENTMODELING_SVG_HOOKS = {
  layout: ctx => {
    const body = parseEventModeling(ctx.source.authoredFamilyBody ?? ctx.source.familyBody)
    body.title ??= typeof ctx.source.frontmatter.title === 'string' ? ctx.source.frontmatter.title : undefined
    return layoutResult(layoutEventModeling(body, ctx.renderOptions, ctx.styleFace))
  },
  projectPositioned: positionedView(projectEventModelingPositioned), lowerScene: scene(lowerEventModelingScene),
} satisfies BrowserSvgFamilyHooks
