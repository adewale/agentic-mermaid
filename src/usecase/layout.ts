import { layoutGraphSync } from '../layout-engine.ts'
import type { InternalStyleFace } from '../scene/style-registry.ts'
import { preparePixelText } from '../shared/prepared-text.ts'
import { resolveRenderStyle } from '../styles.ts'
import type { Point, RenderOptions } from '../types.ts'
import { projectUsecaseGraph, usecaseNodeLabel } from './graph.ts'
import type { PositionedUsecase, UsecaseBody } from './types.ts'

/** Orthogonal graph placement reserves the family envelopes. The final
 * contacts below belong to the actual ellipse, rather than its bounding box. */
export function layoutUsecaseDiagram(body: UsecaseBody, options: RenderOptions = {}, styleFace?: InternalStyleFace, title?: string): PositionedUsecase {
  const graph = projectUsecaseGraph(body),
    style = resolveRenderStyle(options, undefined, styleFace),
    nodeSizes = new Map<string, { width: number; height: number }>()
  for (const node of body.nodes) {
    const block = preparePixelText(usecaseNodeLabel(node), { fontSize: style.nodeLabelFontSize, fontWeight: style.nodeLabelFontWeight, maxWidth: 240, display: node.labelType === 'markdown' ? 'formatted' : 'literal', letterSpacing: style.nodeLetterSpacing, transform: style.nodeTextTransform, fontFamily: options.font })
    if (node.kind === 'actor') {
      const icon = node.icon ? preparePixelText(`[${node.icon}]`, { fontSize: Math.min(10, style.nodeLabelFontSize), fontWeight: style.nodeLabelFontWeight, display: 'literal' }) : undefined
      nodeSizes.set(node.id, { width: Math.max(70, block.width + 24, (icon?.width ?? 0) + 24), height: block.height + (icon ? 92 : 76) })
    } else if (node.shape === 'ellipse') {
      graph.nodes.get(node.id)!.shape = 'rectangle'
      nodeSizes.set(node.id, { width: Math.max(80, block.width * 1.5 + 32), height: Math.max(48, block.height * 1.5 + 24) })
    }
  }
  const { certification: _placementCertificate, ...positioned } = layoutGraphSync(graph, { ...options, styleFace, nodeSizes, diagramTitle: body.title ?? title })
  const ellipses = new Set(body.nodes.filter(node => node.kind === 'usecase' && node.shape === 'ellipse').map(node => node.id))
  const byId = new Map(positioned.nodes.map(node => [node.id, node]))
  const contact = (id: string, endpoint: Point, adjacent: Point) => {
    const node = byId.get(id)
    if (!node || !ellipses.has(id)) return endpoint
    const cx = node.x + node.width / 2,
      cy = node.y + node.height / 2,
      rx = node.width / 2,
      ry = node.height / 2
    if (Math.abs(endpoint.y - adjacent.y) < 0.01) {
      const dy = Math.max(-1, Math.min(1, (endpoint.y - cy) / ry))
      return { x: cx + (endpoint.x >= cx ? 1 : -1) * rx * Math.sqrt(Math.max(0, 1 - dy * dy)), y: endpoint.y }
    }
    const dx = Math.max(-1, Math.min(1, (endpoint.x - cx) / rx))
    return { x: endpoint.x, y: cy + (endpoint.y >= cy ? 1 : -1) * ry * Math.sqrt(Math.max(0, 1 - dx * dx)) }
  }
  for (const node of positioned.nodes) if (ellipses.has(node.id)) node.shape = 'ellipse'
  for (const edge of positioned.edges) {
    const points = edge.points.map(point => ({ ...point }))
    if (points.length >= 2) {
      points[0] = contact(edge.source, points[0]!, points[1]!)
      points[points.length - 1] = contact(edge.target, points.at(-1)!, points.at(-2)!)
    }
    edge.points = points
    // Placement certificates describe the rectangular envelopes, and cannot
    // certify this family's final ellipse and actor silhouettes.
    delete edge.routeCertificate
  }
  return { ...positioned, body }
}
