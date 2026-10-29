import type { MarkerDescriptor } from '../scene/ir.ts'
import { sceneLowering, type DrawingFactory, type DrawingDocument } from '../scene/drawing.ts'
import type { FamilyPositionedProjectionContext, FamilyPositionedView } from '../agent/families.ts'
import { createFillInkResolver } from '../color-resolver.ts'
import { escapeAttr, escapeXml } from '../multiline-utils.ts'
import { canvasOf, f, labelRect, retainedLabelBounds, retainedLabelGeometry } from '../positioned-views/geometry.ts'
import { DefaultBackend } from '../scene/backend.ts'
import { projectRoundedConnectorPath } from '../scene/connector-geometry.ts'
import { serializeMarkerResources } from '../scene/marker-resources.ts'
import { blockMarkers as markers, blockMarkerTerminal } from './markers.ts'
import { shapeOutline } from '../shape-outline.ts'
import { diagramTitleFields } from '../styles.ts'
import { buildStyleBlock, svgOpenTag } from '../theme.ts'
import type { RenderContext } from '../types.ts'
import { arrowMask, arrowSize, blockArrowPoints } from './arrows.ts'
import { blockShapeNode } from './layout.ts'
import type { PositionedBlockDiagram } from './types.ts'

export function lowerBlockDrawing<T>(marks: DrawingFactory<T>, ctx: RenderContext<PositionedBlockDiagram>): DrawingDocument<T> {
  const { positioned: p, colors } = ctx,
    transparent = ctx.resolved.renderOptions.transparent ?? false,
    font = colors.font ?? 'Inter',
    parts: T[] = [],
    markerSet: Record<string, MarkerDescriptor> = p.style.edgeStrokeColor
      ? Object.fromEntries(Object.entries(markers).map(([key, marker]) => [key, { ...marker, paint: { ...marker.paint, ...(marker.paint?.fill === 'var(--_arrow)' ? { fill: p.style.edgeStrokeColor } : {}), ...(marker.paint?.stroke === 'var(--_arrow)' ? { stroke: p.style.edgeStrokeColor } : {}) } }]))
      : markers,
    resources = Object.values(markerSet)
  const fillInk = createFillInkResolver(colors)
  let open = svgOpenTag(p.width, p.height, colors, transparent)
  if (p.model.accessibilityTitle) open += `<title>${escapeXml(p.model.accessibilityTitle)}</title>`
  if (p.model.accessibilityDescription) open += `<desc>${escapeXml(p.model.accessibilityDescription)}</desc>`
  open += buildStyleBlock(font, false, undefined, colors.embedFontImport)
  parts.push(marks.documentOpen({ id: 'prelude', width: p.width, height: p.height, colors, transparent, font, hasMonoFont: false }, open), marks.definitions({ id: 'defs', markerResources: resources }, `<defs>${serializeMarkerResources(resources)}</defs>`))
  const lowerNode = (node: (typeof p.nodes)[number], children: T[]): T => {
    const composite = node.block.type === 'composite',
      role = composite ? 'group' : 'node',
      fill = node.style.fill ?? (composite ? p.style.groupFillColor : p.style.nodeFillColor) ?? (composite ? 'var(--_group-fill)' : 'var(--_node-fill)'),
      stroke = node.style.stroke ?? (composite ? p.style.groupBorderColor : p.style.nodeBorderColor) ?? 'var(--_node-stroke)',
      headerFill = node.style.fill ?? p.style.groupHeaderFillColor,
      ink = node.style.color ?? (composite ? p.style.groupTextColor : p.style.nodeTextColor) ?? fillInk('var(--_text)', composite ? (headerFill ?? fill) : fill)
    const outline = shapeOutline(blockShapeNode(node), { fill, stroke, strokeWidth: node.style['stroke-width'] ?? String(composite ? p.style.groupLineWidth : p.style.nodeLineWidth) }, composite ? p.style.groupCornerRadius : p.style.cornerRadius)
    const dash = node.style['stroke-dasharray']
    if (dash !== undefined) {
      outline.paint.strokeDasharray = dash
      if (outline.childPaints) outline.childPaints = outline.childPaints.map(paint => ({ ...paint, strokeDasharray: dash }))
    }
    const mask = arrowMask(node.block.directions),
      arrow = node.block.type === 'block_arrow',
      s = arrow ? arrowSize(mask, node.label.width, node.label.height) : { dx: 0, dy: 0 }
    const geometry = arrow ? { kind: 'polygon' as const, points: blockArrowPoints(mask, node.width, node.height).map(q => ({ x: q.x + node.x + node.width / 2, y: q.y + node.y + node.height / 2 })) } : outline.geometry
    const classes = [`block-${composite ? 'composite' : 'node'}`, ...(node.block.classes ?? []).filter(name => /^[\w-]+$/.test(name))]
    return marks.group({
      id: `block:${node.id}`,
      role,
      open: `<g class="${escapeAttr(classes.join(' '))}" data-id="${escapeAttr(node.id)}"${node.parentId ? ` data-parent="${escapeAttr(node.parentId)}"` : ''}>`,
      close: '</g>',
      children: [
        { indent: 2, node: marks.shape({ id: `frame:${node.id}`, role, identity: false, owner: { id: node.id, role }, geometry, paint: outline.paint, ...(outline.childPaints ? { childPaints: outline.childPaints } : {}) }) },
        ...(composite && node.label.text && p.style.groupHeaderFillColor
          ? [
              {
                indent: 2,
                node: marks.shape({
                  id: `header:${node.id}`,
                  role: 'chrome',
                  owner: { id: node.id, role },
                  geometry: { kind: 'rect', x: node.x + p.style.groupLineWidth, y: node.y + p.style.groupLineWidth, width: Math.max(0, node.width - p.style.groupLineWidth * 2), height: node.label.height + 16 - p.style.groupLineWidth, rx: Math.max(0, p.style.groupCornerRadius - p.style.groupLineWidth) },
                  paint: { fill: headerFill, stroke: 'none' },
                }),
              },
            ]
          : []),
        ...(node.label.text
          ? [
              {
                indent: 2,
                node: marks.text({
                  id: `label:${node.id}`,
                  role: 'label',
                  owner: { id: node.id, role },
                  text: node.label.text,
                  block: node.label,
                  x: node.x + node.width / 2 + s.dx,
                  y: composite ? node.y + node.label.height / 2 + 8 : node.y + node.height / 2 + s.dy,
                  fontSize: node.label.fontSize,
                  anchor: 'middle',
                  paint: { fill: ink },
                }),
              },
            ]
          : []),
        ...children.map(node => ({ node, indent: 2 })),
      ],
    })
  }
  const childrenByParent = new Map<string | undefined, T[]>()
  // Placement is parent-first. Lower in reverse so each semantic container
  // owns its painted children rather than merely overlapping sibling groups.
  for (let index = p.nodes.length - 1; index >= 0; index--) {
    const node = p.nodes[index]!
    if (node.block.type === 'space') continue
    const siblings = childrenByParent.get(node.parentId) ?? []
    siblings.push(lowerNode(node, (childrenByParent.get(node.id) ?? []).reverse()))
    childrenByParent.set(node.parentId, siblings)
  }
  parts.push(...(childrenByParent.get(undefined) ?? []).reverse())
  for (const edge of p.edges) {
    const start = markerSet[`${edge.arrowTypeStart}:start`],
      end = markerSet[`${edge.arrowTypeEnd}:end`],
      projection = p.style.edgeBendRadius > 0 && edge.points.length > 2 ? projectRoundedConnectorPath(edge.points, p.style.edgeBendRadius, { terminalClearance: { start: blockMarkerTerminal(start?.id, p.style.lineWidth, 'start'), end: blockMarkerTerminal(end?.id, p.style.lineWidth, 'end') } }) : undefined
    parts.push(
      marks.connector({
        id: edge.id,
        role: 'edge',
        geometry: projection?.geometry ?? { kind: 'polyline', points: edge.points },
        lineStyle: edge.pattern === 'dotted' ? 'dotted' : 'solid',
        paint: { fill: 'none', stroke: p.style.edgeStrokeColor ?? 'var(--_line)', strokeWidth: edge.thickness === 'thick' ? '3' : String(p.style.lineWidth), ...(edge.pattern === 'dotted' ? { strokeDasharray: '2 4' } : {}) },
        endpoints: { from: edge.start, to: edge.end },
        relationship: { kind: 'block-link' },
        markers: { ...(start ? { start } : {}), ...(end ? { end } : {}) },
        labels: edge.label ? [{ text: edge.labelBlock.text, anchor: edge.labelPosition }] : [],
        route: { ownership: 'layout', bendRadius: p.style.edgeBendRadius, labelAnchors: edge.label ? [edge.labelPosition] : [], ...(projection ? { contours: projection.contours } : {}) },
      }),
    )
  }
  for (const edge of p.edges)
    if (edge.label) {
      const b = edge.labelBlock,
        q = edge.labelPosition
      parts.push(
        marks.group({
          id: `edge-label:${edge.id}`,
          role: 'edge-label',
          open: '<g class="block-edge-label">',
          close: '</g>',
          children: [
            { indent: 2, node: marks.shape({ id: `label-bg:${edge.id}`, role: 'chrome', owner: { id: edge.id, role: 'edge' }, geometry: { kind: 'rect', x: q.x - b.width / 2 - 6, y: q.y - b.height / 2 - 4, width: b.width + 12, height: b.height + 8 }, paint: { fill: 'var(--bg)', stroke: 'none' } }) },
            { indent: 2, node: marks.text({ id: `label:${edge.id}`, role: 'edge-label', owner: { id: edge.id, role: 'edge' }, text: b.text, block: b, x: q.x, y: q.y, fontSize: b.fontSize, anchor: 'middle', paint: { fill: p.style.edgeTextColor ?? 'var(--_text)' } }) },
          ],
        }),
      )
    }

  if (p.title) parts.push(marks.text(diagramTitleFields(p.title, p.style)))
  parts.push(marks.documentClose())
  return { family: 'block', width: p.width, height: p.height, colors, transparent, parts }
}
export function renderBlockSvg(ctx: RenderContext<PositionedBlockDiagram>): string {
  return DefaultBackend.render(lowerBlockScene(ctx), { seed: 0 })
}
export function projectBlockPositioned({ positioned: p }: FamilyPositionedProjectionContext<PositionedBlockDiagram>): FamilyPositionedView {
  const textAt = (n: (typeof p.nodes)[number]) => {
    const s = n.block.type === 'block_arrow' ? arrowSize(arrowMask(n.block.directions), n.label.width, n.label.height) : { dx: 0, dy: 0 }
    return { x: n.x + n.width / 2 + s.dx, y: n.block.type === 'composite' ? n.y + n.label.height / 2 + 8 : n.y + n.height / 2 + s.dy }
  }
  const labels = p.nodes
    .filter(n => n.block.type === 'composite' && n.label.text)
    .map(n => {
      const q = textAt(n)
      return { id: `label:${n.id}`, text: n.label.text, bounds: retainedLabelBounds(n.label, q.x, q.y), container: labelRect(n) }
    })
  if (p.title) labels.push({ id: 'title', text: p.title.text, bounds: retainedLabelBounds(p.title.block, p.title.x, p.title.y), container: labelRect(canvasOf(p)) })
  return {
    version: 1,
    bounds: { w: f(p.width), h: f(p.height) },
    nodes: p.nodes
      .filter(n => !['composite', 'space'].includes(n.block.type ?? ''))
      .map(n => {
        const q = textAt(n)
        return { id: n.id, x: f(n.x), y: f(n.y), w: f(n.width), h: f(n.height), shape: blockShapeNode(n).shape, label: n.label.text, role: 'box', ...retainedLabelGeometry(n.label, q.x, q.y, n), ...(n.parentId ? { parentId: n.parentId } : {}) }
      }),
    edges: p.edges.map(e => ({ id: e.id, from: e.start!, to: e.end!, path: e.points.map(q => [f(q.x), f(q.y)]), ...(e.label ? { label: { x: f(e.labelPosition.x), y: f(e.labelPosition.y), text: e.labelBlock.text, bounds: retainedLabelBounds(e.labelBlock, e.labelPosition.x, e.labelPosition.y) } } : {}) })),
    groups: p.nodes.filter(n => n.block.type === 'composite').map(n => ({ id: n.id, x: f(n.x), y: f(n.y), w: f(n.width), h: f(n.height), label: n.block.label, members: p.nodes.filter(c => c.parentId === n.id && c.block.type !== 'space').map(c => c.id), parentId: n.parentId })),
    labels,
  }
}

export const lowerBlockScene = sceneLowering<PositionedBlockDiagram>(lowerBlockDrawing)
