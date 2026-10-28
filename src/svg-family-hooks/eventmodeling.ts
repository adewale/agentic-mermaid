import { layoutResult, positionedView, scene, type BrowserSvgFamilyHooks } from '../browser-lazy/family.ts'
import { eventModelingStatementEnds, parseEventModeling } from '../eventmodeling/parser.ts'
import { layoutEventModeling } from '../eventmodeling/layout.ts'
import { lowerEventModelingScene } from '../eventmodeling/renderer.ts'
import { f, retainedLabelGeometry } from '../positioned-views/geometry.ts'
import type { DiagramColors } from '../theme.ts'
export const EVENTMODELING_SVG_HOOKS = {
  normalizeRequest: ctx => {
    const config = ctx.source.config.eventmodeling as Record<string, unknown> | undefined
    const padding = config?.padding
    const rowHeight = config?.rowHeight
    return { renderOptions: { ...ctx.renderOptions, ...(ctx.renderOptions.padding === undefined && typeof padding === 'number' && Number.isFinite(padding) && padding >= 0 ? { padding } : {}) }, familyConfig: { rowHeight: typeof rowHeight === 'number' && Number.isFinite(rowHeight) && rowHeight >= 0 ? rowHeight : 0 }, appearance: { family: { palette: ctx.colors } } }
  },
  statementEnds: eventModelingStatementEnds,
  layout: ctx => {
    const body = parseEventModeling(ctx.source.authoredFamilyBody ?? ctx.source.familyBody)
    if (body.title === undefined && typeof ctx.source.frontmatter.title === 'string') body.title = ctx.source.frontmatter.title
    return layoutResult(layoutEventModeling(body, ctx.renderOptions, ctx.styleFace, ctx.familyConfig?.rowHeight as number | undefined, ctx.familyAppearance?.palette as DiagramColors | undefined))
  },
  projectPositioned: positionedView<ReturnType<typeof layoutEventModeling>>(({ positioned: p }) => ({
    version: 1,
    bounds: { w: f(p.width), h: f(p.height) },
    nodes: p.nodes.map(node => ({ id: node.id, x: f(node.x), y: f(node.y), w: f(node.width), h: f(node.height), shape: 'rectangle', label: node.frame.entity, parentId: node.lane, ...retainedLabelGeometry(node.block, node.x + node.width / 2, node.y + node.height / 2, node) })),
    edges: p.edges.map(edge => ({ id: edge.id, from: edge.from, to: edge.to, path: edge.points.map(point => [f(point.x), f(point.y)]) })),
    groups: p.lanes.map(lane => ({ id: lane.id, label: lane.label, x: f(lane.x), y: f(lane.y), w: f(lane.width), h: f(lane.height), members: p.nodes.filter(node => node.lane === lane.id).map(node => node.id) })),
    labels: [],
  })),
  lowerScene: scene(lowerEventModelingScene),
} satisfies BrowserSvgFamilyHooks
