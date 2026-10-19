import type { FamilyPositionedProjectionContext, FamilyPositionedView } from '../agent/families.ts'
import { toneOnFill } from '../color-resolver.ts'
import { escapeAttr, escapeXml } from '../multiline-utils.ts'
import { canvasOf, f, labelRect, retainedLabelBounds, retainedLabelGeometry } from '../positioned-views/geometry.ts'
import { DefaultBackend } from '../scene/backend.ts'
import type { MarkerDescriptor, SceneDoc, SceneNode } from '../scene/ir.ts'
import { serializeMarkerResources, tipAnchoredArrow } from '../scene/marker-resources.ts'
import * as marks from '../scene/marks.ts'
import { diagramTitleMark } from '../styles.ts'
import { buildStyleBlock, svgOpenTag } from '../theme.ts'
import type { RenderContext } from '../types.ts'
import type { PositionedRequirementDiagram } from './types.ts'

const arrow = tipAnchoredArrow('requirement-arrow', { width: 9, height: 7 }, 'end', { fill: 'none', stroke: 'var(--_arrow)', strokeWidth: '1' }, 'userSpaceOnUse')
const contains: MarkerDescriptor = {
  id: 'requirement-contains',
  shape: 'circle',
  size: { width: 12, height: 12 },
  ref: { x: 0, y: 6 },
  orient: 'auto',
  units: 'userSpaceOnUse',
  geometry: {
    kind: 'compound',
    children: [
      { kind: 'circle', cx: 6, cy: 6, r: 5 },
      { kind: 'path', d: 'M2 6H10M6 2V10' },
    ],
  },
  paint: { fill: 'var(--bg)', stroke: 'var(--_arrow)', strokeWidth: '1' },
}
const resources = [arrow, contains]
export function lowerRequirementScene(ctx: RenderContext<PositionedRequirementDiagram>): SceneDoc {
  const { positioned: p, colors } = ctx,
    transparent = ctx.resolved.renderOptions.transparent ?? false,
    font = colors.font ?? 'Inter',
    parts: SceneNode[] = []
  let open = svgOpenTag(p.width, p.height, colors, transparent)
  if (p.model.accessibilityTitle) open += `<title>${escapeXml(p.model.accessibilityTitle)}</title>`
  if (p.model.accessibilityDescription) open += `<desc>${escapeXml(p.model.accessibilityDescription)}</desc>`
  open += buildStyleBlock(font, false, undefined, colors.embedFontImport)
  parts.push(marks.documentOpen({ id: 'prelude', width: p.width, height: p.height, colors, transparent, font, hasMonoFont: false }, open), marks.definitions({ id: 'defs', markerResources: resources }, `<defs>${serializeMarkerResources(resources)}</defs>`))

  for (const node of p.nodes) {
    const fill = node.style.fill ?? p.style.nodeFillColor ?? 'var(--_node-fill)',
      stroke = node.style.stroke ?? p.style.nodeBorderColor ?? 'var(--_node-stroke)',
      ink = node.style.color ?? toneOnFill('var(--_text)', fill, colors)
    const children: { node: SceneNode; indent: number }[] = [
      {
        indent: 2,
        node: marks.shape({
          id: `frame:${node.id}`,
          role: 'chrome',
          owner: { id: node.id, role: 'node' },
          geometry: { kind: 'rect', x: node.x, y: node.y, width: node.width, height: node.height, rx: p.style.cornerRadius },
          paint: { fill, stroke, strokeWidth: node.style['stroke-width'] ?? String(p.style.nodeLineWidth), ...(node.style['stroke-dasharray'] !== undefined ? { strokeDasharray: node.style['stroke-dasharray'] } : {}) },
        }),
      },
      { indent: 2, node: marks.shape({ id: `separator:${node.id}`, role: 'chrome', geometry: { kind: 'line', x1: node.x, y1: node.y + node.headerHeight, x2: node.x + node.width, y2: node.y + node.headerHeight }, paint: { stroke, strokeWidth: '0.75' } }) },
      { indent: 2, node: marks.text({ id: `header:${node.id}`, role: 'label', owner: { id: node.id, role: 'node' }, text: node.header.text, block: node.header, x: node.x + node.width / 2, y: node.y + node.headerHeight / 2, fontSize: node.header.fontSize, anchor: 'middle', paint: { fill: ink } }) },
      ...node.rows.map((row, i) => ({ indent: 2, node: marks.text({ id: `field:${node.id}:${i}`, role: 'attribute', owner: { id: node.id, role: 'node' }, text: row.block.text, block: row.block, x: node.x + node.paddingX, y: node.y + row.y, fontSize: row.block.fontSize, anchor: 'start', paint: { fill: ink } }) })),
    ]
    parts.push(marks.group({ id: `node:${node.id}`, role: 'node', open: `<g class="requirement-node" data-id="${escapeAttr(node.id)}">`, close: '</g>', children }))
  }
  for (const edge of p.edges) {
    parts.push(
      marks.connector({
        id: edge.id,
        role: 'relationship',
        geometry: { kind: 'polyline', points: edge.points },
        lineStyle: edge.type === 'contains' ? 'solid' : 'dashed',
        paint: { stroke: 'var(--_line)', strokeWidth: String(p.style.lineWidth), fill: 'none' },
        endpoints: { from: edge.src, to: edge.dst },
        relationship: { kind: edge.type, direction: 'forward' },
        markers: edge.type === 'contains' ? { start: contains } : { end: arrow },
        labels: [{ text: edge.label.text, anchor: edge.labelPosition }],
        route: { ownership: 'layout', labelAnchors: [edge.labelPosition] },
      }),
    )
  }
  for (const edge of p.edges) {
    const b = edge.label,
      q = edge.labelPosition
    parts.push(
      marks.group({
        id: `edge-label:${edge.id}`,
        role: 'edge-label',
        open: '<g class="requirement-edge-label">',
        close: '</g>',
        children: [
          { indent: 2, node: marks.shape({ id: `label-bg:${edge.id}`, role: 'chrome', owner: { id: edge.id, role: 'relationship' }, geometry: { kind: 'rect', x: q.x - b.width / 2 - 6, y: q.y - b.height / 2 - 4, width: b.width + 12, height: b.height + 8 }, paint: { fill: 'var(--bg)', stroke: 'none' } }) },
          { indent: 2, node: marks.text({ id: `label:${edge.id}`, role: 'edge-label', owner: { id: edge.id, role: 'relationship' }, text: b.text, block: b, x: q.x, y: q.y, fontSize: b.fontSize, anchor: 'middle', paint: { fill: 'var(--_text)' } }) },
        ],
      }),
    )
  }

  if (p.title) parts.push(diagramTitleMark(p.title, p.style))
  parts.push(marks.documentClose())
  return { family: 'requirement', width: p.width, height: p.height, colors, transparent, parts }
}
export function renderRequirementSvg(ctx: RenderContext<PositionedRequirementDiagram>): string {
  return DefaultBackend.render(lowerRequirementScene(ctx), { seed: 0 })
}
export function projectRequirementPositioned({ positioned: p }: FamilyPositionedProjectionContext<PositionedRequirementDiagram>): FamilyPositionedView {
  const labels = p.nodes.flatMap(n => n.rows.map((row, i) => ({ id: `field:${n.id}:${i}`, text: row.block.text, bounds: retainedLabelBounds(row.block, n.x + n.paddingX, n.y + row.y, 'start'), container: labelRect(n) })))
  if (p.title) labels.push({ id: 'title', text: p.title.text, bounds: retainedLabelBounds(p.title.block, p.title.x, p.title.y), container: labelRect(canvasOf(p)) })
  return {
    version: 1,
    bounds: { w: f(p.width), h: f(p.height) },
    nodes: p.nodes.map(n => ({ id: n.id, x: f(n.x), y: f(n.y), w: f(n.width), h: f(n.height), shape: 'rectangle', label: n.header.text, role: 'box', ...retainedLabelGeometry(n.header, n.x + n.width / 2, n.y + n.headerHeight / 2, n) })),
    edges: p.edges.map(e => ({ id: e.id, from: e.src, to: e.dst, path: e.points.map(q => [f(q.x), f(q.y)]), label: { x: f(e.labelPosition.x), y: f(e.labelPosition.y), text: e.label.text, bounds: retainedLabelBounds(e.label, e.labelPosition.x, e.labelPosition.y) } })),
    groups: [],
    labels,
  }
}
