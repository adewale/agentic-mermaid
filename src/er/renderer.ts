import { ErLabelWorkLimitError } from './errors.ts'
export { ErLabelWorkLimitError } from './errors.ts'
import { sceneLowering, type DrawingFactory, type DrawingDocument } from '../scene/drawing.ts'
import { prepareDisplayText, resolveLabelContent } from '../shared/display-text.ts'
import { erHeaderBlock, erRelationshipBlock, erAttributeBlocks, erGroupBlock, erEmptyAttributeBlock } from './layout.ts'
import type { PositionedErDiagram, PositionedErEntity, PositionedErRelationship, PositionedErGroup, ErAttribute, Cardinality } from './types.ts'
import type { RenderContext, Point } from '../types.ts'
import { svgOpenTag, buildStyleBlock, buildShadowDefs, type DiagramColors } from '../theme.ts'
import { inkOnNodeFill } from '../color-resolver.ts'
import { FONT_SIZES, FONT_WEIGHTS, STROKE_WIDTHS, resolveRenderStyle, diagramTitleFields } from '../styles.ts'
import type { RenderStyleDefaults, ResolvedRenderStyle } from '../styles.ts'
import { ER_STYLE_DEFAULTS, erCommentColumnWidth, erCommentText } from './layout.ts'
import { buildAccessibilityAttrs } from '../shared/svg-a11y.ts'
import { breakLineTags, escapeAttr, escapeDisplayAttr, escapeXml as escapeXmlUtil } from '../multiline-utils.ts'
import { sanitizeDisplayLines } from '../shared/text-controls.ts'
import { topRoundedRectPath } from '../scene/svg-writer.ts'
import type { Geometry, MarkAttributes, MarkPaint, SceneOwner } from '../scene/ir.ts'
import { hashId } from '../scene/seed.ts'
import { DefaultBackend } from '../scene/backend.ts'
import { projectRoundedConnectorPath } from '../scene/connector-geometry.ts'
import { resolveRoleStyle, type InternalStyleFace } from '../scene/style-registry.ts'

// ============================================================================
// ER diagram SVG renderer
//
// The positioned diagram is first lowered to a SceneGraph (SPEC §3.1): every
// visual mark becomes a scene node carrying semantic fields (role, geometry,
// paint, channels, stable id). renderErSvg() uses DefaultBackend serialization of that scene.
//
// All colors use CSS custom properties (var(--_xxx)) from the theme system.
//
// Render order:
//   1. Relationship lines (behind boxes)
//   2. Entity boxes (header + attribute rows)
//   3. Cardinality markers (crow's foot notation)
//   4. Relationship labels
// ============================================================================


/** Font sizes specific to ER diagrams (weights belong to the prepared
 * attribute blocks). */
const ER_FONT = {
  attrSize: 11,
  keySize: 9,
} as const

/** One piece of a compound glyph: its geometry and its own paint. */
interface ShapePiece {
  geometry: Geometry
  paint: MarkPaint
}

/**
 * Render a positioned ER diagram as an SVG string.
 *
 * @param colors - DiagramColors with bg/fg and optional enrichment variables.
 * @param transparent - If true, renders with transparent background.
 */
export function renderErSvg(
  ctx: RenderContext<PositionedErDiagram>,
): string {
  return DefaultBackend.render(lowerErScene(ctx), { seed: 0 })
}

/**
 * Lower a positioned ER diagram to the SceneGraph IR in canonical mark order.
 */
export function lowerErDrawing<T>(
  marks: DrawingFactory<T>,
  ctx: RenderContext<PositionedErDiagram>,
): DrawingDocument<T> {
  const { positioned: diagram, colors, resolved } = ctx
  const options = resolved.renderOptions
  const font = colors.font ?? 'Inter'
  const transparent = options.transparent ?? false
  const parts: T[] = []
  const style = resolveRenderStyle(options, ER_STYLE_DEFAULTS, resolved.styleFace)
  const uid = `er-${hashId(diagram.width, diagram.height, diagram.entities.length, diagram.relationships.length)}`
  const titleId = `${uid}-title`
  const descId = `${uid}-desc`
  const rootAttrs = buildAccessibilityAttrs(diagram.accessibilityTitle, diagram.accessibilityDescription, titleId, descId)

  // SVG root with CSS variables + style block (with mono font) + defs
  parts.push(marks.documentOpen(
    {
      id: 'prelude',
      width: diagram.width,
      height: diagram.height,
      colors,
      transparent,
      font,
      hasMonoFont: true,
    },
    svgOpenTag(diagram.width, diagram.height, colors, transparent, rootAttrs) + '\n' +
    buildStyleBlock(font, true, colors.shadow, colors.embedFontImport),
  ))
  const defsParts: string[] = []
  defsParts.push('<defs>')
  const shadowDefs = buildShadowDefs(colors)
  if (shadowDefs) defsParts.push(shadowDefs)
  defsParts.push('</defs>')
  parts.push(marks.definitions({ id: 'defs' }, defsParts.join('\n')))

  if (diagram.accessibilityTitle) {
    parts.push(marks.documentContent({ id: 'acc-title', role: 'chrome', nonPaint: 'accessibility' },
      `<title id="${titleId}">${escapeXml(diagram.accessibilityTitle)}</title>`))
  }
  if (diagram.accessibilityDescription) {
    parts.push(marks.documentContent({ id: 'acc-desc', role: 'chrome', nonPaint: 'accessibility' },
      `<desc id="${descId}">${escapeXml(diagram.accessibilityDescription)}</desc>`))
  }

  // The diagram's frontmatter title, in the band layout reserved above.
  if (diagram.title) parts.push(marks.text(diagramTitleFields(diagram.title, style)))

  // 0. ER subgraph frames, parent-first and behind relationships/entities.
  for (const group of diagram.groups) parts.push(renderErGroup(marks, group, style))

  // 1. Relationship lines
  const lineOccurrence = new Map<string, number>()
  const groupIds = new Set(diagram.groups.map(group => group.id))
  const endpointOwner = (id: string): SceneOwner => ({ id, role: groupIds.has(id) ? 'group' : 'entity' })
  for (const rel of diagram.relationships) {
    const pairKey = `${rel.entity1}-${rel.entity2}`
    const k = lineOccurrence.get(pairKey) ?? 0
    lineOccurrence.set(pairKey, k + 1)
    parts.push(renderRelationshipLine(marks, rel, style, resolved.styleFace, `rel:${pairKey}#${k}`, endpointOwner))
  }

  // 2. Entity boxes
  for (const entity of diagram.entities) {
    parts.push(renderEntityBox(marks, entity, style, colors))
  }

  // 3. Cardinality markers at relationship endpoints
  const cardOccurrence = new Map<string, number>()
  for (const rel of diagram.relationships) {
    const pairKey = `${rel.entity1}-${rel.entity2}`
    const k = cardOccurrence.get(pairKey) ?? 0
    cardOccurrence.set(pairKey, k + 1)
    parts.push(...renderCardinality(marks, rel, style, `card:${pairKey}#${k}`))
  }

  // 4. Relationship labels — positions are collision-separated first: two
  // relationships between the same entity pair both put their labels at the
  // route midpoint otherwise (2026-07 overlap audit: 15% of fuzzed ER
  // diagrams print relationship labels on top of each other).
  const labelPos = separateRelationshipLabels(diagram, style, resolved.styleFace)
  const labelOccurrence = new Map<string, number>()
  for (const rel of diagram.relationships) {
    const pairKey = `${rel.entity1}-${rel.entity2}`
    const k = labelOccurrence.get(pairKey) ?? 0
    labelOccurrence.set(pairKey, k + 1)
    parts.push(...renderRelationshipLabel(marks, rel, style, resolved.styleFace, `rel-label:${pairKey}#${k}`, labelPos.get(rel)))
  }

  parts.push(marks.documentClose())

  return { family: 'er', width: diagram.width, height: diagram.height, colors, transparent, parts }
}

function renderErGroup<T>(marks: DrawingFactory<T>, group: PositionedErGroup, style: ResolvedRenderStyle): T {
  const stroke = style.groupBorderColor ?? 'var(--_node-stroke)'
  const fill = style.groupFillColor ?? 'var(--_group-fill)'
  const headerFill = style.groupHeaderFillColor ?? 'var(--_group-hdr)'
  const text = style.groupTextColor ?? 'var(--_text)'
  const block = group.labelBlock ?? erGroupBlock(resolveLabelContent(group.label, group.labelContent), style)
  return marks.group({
    id: `er-group:${group.id}`, role: 'group',
    open: `<g class="er-subgraph" data-id="${escapeAttr(group.id)}" data-label="${escapeDisplayAttr(group.label)}"${group.parentId ? ` data-parent-id="${escapeAttr(group.parentId)}"` : ''}>`,
    close: '</g>', children: [
      { node: marks.shape({ id: `er-group:${group.id}:box`, role: 'group', geometry: { kind: 'rect', x: group.x, y: group.y, width: group.width, height: group.height, rx: 6, ry: 6 }, paint: { fill, stroke, strokeWidth: '1.5' } }), indent: 2 },
      { node: marks.shape({ id: `er-group:${group.id}:header`, role: 'group-header', geometry: { kind: 'rect', x: group.x, y: group.y, width: group.width, height: group.headerHeight, rx: 6, ry: 6 }, paint: { fill: headerFill, stroke: 'none' } }), indent: 2 },
      { node: marks.text({ id: `er-group:${group.id}:label`, role: 'label', text: block.text, block, x: group.x + 10, y: group.y + group.headerHeight / 2, fontSize: block.fontSize, anchor: 'start', paint: { fill: text } }), indent: 2 },
    ],
  })
}

// ============================================================================
// Entity box rendering
// ============================================================================

/**
 * Render an entity box with header and attribute rows.
 * Wrapped in <g class="entity"> with semantic data attributes.
 */
function renderEntityBox<T>(marks: DrawingFactory<T>, entity: PositionedErEntity, style: ResolvedRenderStyle, colors: DiagramColors): T {
  const { id, x, y, width, height, headerHeight, rowHeight, label, attributes } = entity
  const children: Array<{ node: T; indent: number }> = []

  // Semantic wrapper with entity metadata
  const classAttr = entity.className ? ` ${escapeAttr(entity.className)}` : ''
  const dataClass = entity.className ? ` data-class="${escapeAttr(entity.className)}"` : ''
  const open = `<g class="entity${classAttr}" data-id="${escapeAttr(id)}" data-label="${escapeDisplayAttr(label)}"${dataClass}>`

  // classDef then inline style are merged by layout for backend parity.
  const local = entity.inlineStyle ?? {}
  // Name and attribute text sit on the box's fill: the author's, or else the
  // header band's (name) or the node fill (attributes). A Style that sets the
  // text color owns it on its own fills.
  const styleText = style.nodeTextColor !== undefined
  const headerInk = inkOnNodeFill(entity.inlineStyle, colors, styleText ? undefined : style.groupHeaderFillColor ?? 'var(--_group-hdr)')
  const ink = inkOnNodeFill(entity.inlineStyle, colors, styleText ? undefined : style.nodeFillColor ?? 'var(--_node-fill)')
  const rectFill = local.fill ?? style.nodeFillColor ?? 'var(--_node-fill)'
  const rectStroke = local.stroke ?? style.nodeBorderColor ?? 'var(--_node-stroke)'
  const parsedStrokeWidth = Number.parseFloat(local['stroke-width'] ?? '')
  const rectStrokeWidth = Number.isFinite(parsedStrokeWidth) && parsedStrokeWidth > 0 ? parsedStrokeWidth : style.nodeLineWidth
  children.push({
    indent: 2,
    node: marks.shape({
      id: `entity-rect:${id}`,
      role: 'entity',
      geometry: { kind: 'rect', x, y, width, height, rx: style.cornerRadius ?? 0, ry: style.cornerRadius ?? 0 },
      paint: { fill: rectFill, stroke: rectStroke, strokeWidth: String(rectStrokeWidth) },
    }),
  })

  // Header background
  const headerFill = local.fill ?? style.groupHeaderFillColor ?? 'var(--_group-hdr)'
  const headerPath = topRoundedRectPath(x, y, width, headerHeight, style.cornerRadius ?? 0)
  children.push({
    indent: 2,
    node: marks.shape({
      id: `entity-header:${id}`,
      role: 'group-header',
      geometry: { kind: 'path', d: headerPath },
      paint: { fill: headerFill, stroke: rectStroke, strokeWidth: String(rectStrokeWidth) },
    }),
  })

  // Entity name (supports multi-line via <br> tags)
  const nameColor = headerInk(style.nodeTextColor ?? 'var(--_text)')
  const labelBlock = entity.labelBlock ?? erHeaderBlock(resolveLabelContent(label, entity.labelContent), style)
  const displayLabel = labelBlock.text
  children.push({
    indent: 2,
    node: marks.text({
      id: `entity-name:${id}`,
      role: 'label',
      text: displayLabel, block: labelBlock,
      x: x + width / 2,
      y: y + headerHeight / 2,
      fontSize: style.nodeLabelFontSize,
      anchor: 'middle',
      paint: { fill: nameColor },
    }),
  })

  // Divider
  const attrTop = y + headerHeight
  const dividerWidth = Math.min(style.nodeLineWidth, STROKE_WIDTHS.innerBox)
  children.push({
    indent: 2,
    node: marks.shape({
      id: `entity-divider:${id}`,
      role: 'chrome',
      geometry: { kind: 'line', x1: x, y1: attrTop, x2: x + width, y2: attrTop },
      paint: { stroke: rectStroke, strokeWidth: String(dividerWidth) },
    }),
  })

  // Attribute rows
  const commentColumn = erCommentColumnWidth(attributes)
  for (let i = 0; i < attributes.length; i++) {
    const attr = attributes[i]!
    const rowY = attrTop + i * rowHeight + rowHeight / 2
    for (const node of renderAttribute(marks, attr, id, x, rowY, width, style, ink, commentColumn, entity.attributeBlocks?.[i])) {
      children.push({ indent: 2, node })
    }
  }

  // Empty row placeholder when no attributes
  if (attributes.length === 0) {
    const emptyColor = ink(style.nodeTextColor ?? 'var(--_text-muted)')
    const block = entity.emptyAttributeBlock ?? erEmptyAttributeBlock()
    children.push({
      indent: 2,
      node: marks.text({
        id: `entity-empty:${id}`,
        role: 'attribute',
        text: block.text,
        block,
        x: x + width / 2,
        y: attrTop + rowHeight / 2,
        fontSize: ER_FONT.attrSize,
        anchor: 'middle',
        paint: { fill: emptyColor },
      }),
    })
  }

  return marks.group({
    id: `entity:${id}`,
    role: 'entity',
    open,
    close: '</g>',
    children,
  })
}

/**
 * Render a single attribute row with monospace syntax highlighting.
 * Layout: [PK badge]  type  name  (left-aligned in mono, name right-aligned)
 * Uses <tspan> elements for per-part coloring, matching the class diagram style.
 *
 * Key badge uses var(--_key-badge) for background tint.
 * Comments are shown as tooltips via SVG <title> element.
 *
 * Returns the row's scene nodes; when the attribute has a comment they are
 * wrapped in a single <g><title>…</title> group mark for tooltip support.
 */
function renderAttribute<T>(
  marks: DrawingFactory<T>,
  attr: ErAttribute,
  entityId: string,
  boxX: number,
  y: number,
  boxWidth: number,
  style: ResolvedRenderStyle,
  ink: (tone: string) => string,
  commentColumn: number,
  prepared?: ReturnType<typeof erAttributeBlocks>,
): T[] {
  const rowNodes: T[] = []
  const attrId = `attr:${entityId}:${attr.name}`
  const blocks = prepared ?? erAttributeBlocks(attr)
  // Key text sits on its theme-tinted badge; type and name sit on the entity fill.
  const keyTextColor = style.nodeTextColor ?? 'var(--_text-sec)'
  const attrTextColor = ink(keyTextColor)
  const attrTypeColor = ink(style.nodeTextColor ?? 'var(--_text-muted)')

  // Key badges on the left (keep proportional font — they're visual tags, not code)
  let keyWidth = 0
  if (attr.keys.length > 0) {
    const keyText = attr.keys.join(',')
    keyWidth = blocks.keys.width + 8
    const badgeX = boxX + Math.max(6, style.nodePaddingX / 2)
    rowNodes.push(marks.shape({
      id: `${attrId}:key-badge`,
      role: 'chrome',
      geometry: { kind: 'rect', x: badgeX, y: y - 7, width: keyWidth, height: 14, rx: 2, ry: 2 },
      paint: { fill: 'var(--_key-badge)' },
    }))
    rowNodes.push(marks.text({
      id: `${attrId}:key-text`,
      role: 'attribute',
      text: keyText, block: blocks.keys,
      x: badgeX + keyWidth / 2,
      y,
      fontSize: ER_FONT.keySize,
      anchor: 'middle',
      paint: { fill: keyTextColor },
    }))
  }

  // Type (left-aligned after keys, monospace with syntax highlighting)
  const typeX = boxX + Math.max(8, style.nodePaddingX / 2) + (keyWidth > 0 ? keyWidth + 6 : 0)
  rowNodes.push(marks.text({
    id: `${attrId}:type`,
    role: 'attribute',
    text: attr.type, block: blocks.type,
    x: typeX,
    y,
    fontSize: ER_FONT.attrSize,
    anchor: 'start',
    paint: { fill: attrTypeColor },
    attributes: { className: 'mono' },
  }))

  // Name (right-aligned, monospace with syntax highlighting), left of the
  // entity's comment column when any attribute carries a comment.
  const rightEdge = boxX + boxWidth - Math.max(8, style.nodePaddingX / 2)
  const nameX = rightEdge - commentColumn
  rowNodes.push(marks.text({
    id: attrId,
    role: 'attribute',
    text: attr.name, block: blocks.name,
    x: nameX,
    y,
    fontSize: ER_FONT.attrSize,
    anchor: 'end',
    paint: { fill: attrTextColor },
    attributes: { className: 'mono' },
  }))

  // Comment (right-aligned in its column, as Mermaid draws it after the name)
  if (attr.comment) {
    const comment = erCommentText(attr.comment, attr.commentContent)
    rowNodes.push(marks.text({
      id: `${attrId}:comment`,
      role: 'attribute',
      text: comment, block: blocks.comment,
      x: rightEdge,
      y,
      fontSize: ER_FONT.attrSize,
      anchor: 'end',
      paint: { fill: attrTypeColor },
    }))
  }

  // Wrap in a group if there's a comment (for tooltip support)
  const hasComment = attr.comment && attr.comment.length > 0
  if (hasComment) {
    // Line breaks become newlines for tooltip display
    const tooltipText = breakLineTags(attr.comment!)
    return [marks.group({
      id: `${attrId}:row`,
      role: 'attribute',
      open: `<g><title>${escapeXml(tooltipText)}</title>`,
      close: '</g>',
      children: rowNodes.map(node => ({ node, indent: 0 })),
    })]
  }

  return rowNodes
}

// ============================================================================
// Relationship rendering
// ============================================================================

/**
 * Render a relationship line with semantic data attributes.
 */
function renderRelationshipLine<T>(
  marks: DrawingFactory<T>,
  rel: PositionedErRelationship,
  style: ResolvedRenderStyle,
  styleFace: Readonly<InternalStyleFace> | undefined,
  sceneId: string,
  endpointOwner: (id: string) => SceneOwner,
): T {
  const lineStyle = rel.identifying ? 'solid' as const : 'dashed' as const
  const channels = { category: rel.identifying ? 'identifying' : 'non-identifying' }
  const roleStyle = resolveRoleStyle(styleFace, 'relationship', channels, { includeFallback: false })
  const bendRadius = roleStyle?.bendRadius ?? style.edgeBendRadius
  const connectorSemantics = {
    endpoints: { from: rel.entity1, to: rel.entity2, start: { owner: endpointOwner(rel.entity1) }, end: { owner: endpointOwner(rel.entity2) } },
    relationship: { kind: rel.identifying ? 'identifying' : 'non-identifying' },
    route: { ownership: 'layout', bendRadius },
    labels: rel.label ? [{ text: rel.label, textContent: { value: rel.label, prepared: prepareDisplayText(resolveLabelContent(rel.label, rel.labelContent)) } }] : [],
  } as const

  // Degenerate relationships draw nothing (an invisible connector writes '',
  // keeping the part slot).
  if (rel.points.length < 2) {
    return marks.connector({
      id: sceneId,
      role: 'relationship',
      geometry: { kind: 'polyline', points: rel.points },
      lineStyle: 'invisible',
      paint: {},
      channels,
      ...connectorSemantics,
    })
  }

  // Inspection hooks for the relationship; identity (data-from/data-to)
  // comes from the connector's typed endpoints.
  const attributes: MarkAttributes = {
    className: 'er-relationship',
    data: {
      cardinality1: rel.cardinality1,
      cardinality2: rel.cardinality2,
      identifying: String(rel.identifying),
      ...(rel.label ? { label: sanitizeDisplayLines(rel.label) } : {}),
    },
  }

  const strokeColor = roleStyle?.strokeColor ?? style.edgeStrokeColor ?? 'var(--_line)'
  const lineWidth = roleStyle?.lineWidth ?? style.lineWidth
  const paint = {
    stroke: strokeColor,
    strokeWidth: String(lineWidth),
    ...(!rel.identifying ? { strokeDasharray: '6 4' } : {}),
  }

  if (bendRadius > 0 && rel.points.length > 2) {
    const projection = projectRoundedConnectorPath(rel.points, bendRadius, {
      metric: 'manhattan',
      precision: 3,
    })
    return marks.connector({
      id: sceneId,
      role: 'relationship',
      geometry: projection.geometry,
      lineStyle,
      paint,
      channels,
      ...connectorSemantics,
      route: { ...connectorSemantics.route, contours: projection.contours },
      attributes,
    })
  }

  return marks.connector({
    id: sceneId,
    role: 'relationship',
    geometry: { kind: 'polyline', points: rel.points },
    lineStyle,
    paint,
    channels,
    ...connectorSemantics,
    attributes,
  })
}

/**
 * Deterministic label separation: center-out arc positions along each
 * relationship's own polyline; the first whose pill clears every earlier pill
 * and every entity box wins; the midpoint stays when nothing clears (surfaced
 * by eval/overlap-audit rather than hidden).
 */


export function separateRelationshipLabels(
  diagram: PositionedErDiagram,
  style: ResolvedRenderStyle,
  styleFace?: Readonly<InternalStyleFace>,
): Map<PositionedErRelationship, { x: number; y: number }> {
  interface Box { x0: number; y0: number; x1: number; y1: number }
  const out = new Map<PositionedErRelationship, { x: number; y: number }>()
  const intersects = (a: Box, b: Box): boolean =>
    Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0) > 0.5 && Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0) > 0.5
  const entityBoxes: Box[] = [
    ...diagram.entities.map(e => ({ x0: e.x, y0: e.y, x1: e.x + e.width, y1: e.y + e.height })),
    ...diagram.groups.map(g => ({ x0: g.x, y0: g.y, x1: g.x + g.width, y1: g.y + g.headerHeight })),
  ]
  // Crow's-foot/cardinality glyphs occupy a small zone around every route
  // endpoint. Treat those zones as reserved so a displaced relationship label
  // cannot become readable against boxes yet straddle a marker.
  const endpointBoxes: Box[] = diagram.relationships.flatMap(relationship => {
    if (relationship.points.length === 0) return []
    const endpoints = [relationship.points[0]!, relationship.points[relationship.points.length - 1]!]
    return endpoints.map(point => ({ x0: point.x - 18, y0: point.y - 18, x1: point.x + 18, y1: point.y + 18 }))
  })
  const placed: Box[] = []
  let searchWork = 0
  const charge = (count = 1) => { searchWork += count; if (searchWork > 400_000) throw new ErLabelWorkLimitError() }
  charge(entityBoxes.length + endpointBoxes.length)
  for (const rel of diagram.relationships) {
    if (!rel.label || rel.points.length < 2) continue
    const m = rel.labelBlock ?? erRelationshipBlock(rel, style, styleFace)
    // Match the public readability audit's conservative glyph-clearance box
    // (8px per side), not merely the smaller painted pill dimensions.
    const bgW = m.width + 16, bgH = m.height + 16
    const boxAt = (cx: number, cy: number): Box => ({ x0: cx - bgW / 2, y0: cy - bgH / 2, x1: cx + bgW / 2, y1: cy + bgH / 2 })
    const collides = (b: Box): boolean => {
      charge()
      return b.x0 < 0 || b.y0 < 0 || b.x1 > diagram.width || b.y1 > diagram.height
      || placed.some(o => { charge(); return intersects(b, o) }) || entityBoxes.some(o => { charge(); return intersects(b, o) }) || endpointBoxes.some(o => { charge(); return intersects(b, o) })
    }
    const pts = rel.points
    const segLens: number[] = []
    let total = 0
    for (let i = 1; i < pts.length; i++) { charge(); const l = Math.hypot(pts[i]!.x - pts[i - 1]!.x, pts[i]!.y - pts[i - 1]!.y); segLens.push(l); total += l }
    const at = (dist: number): { x: number; y: number } => {
      let d = dist
      for (let i = 0; i < segLens.length; i++) {
        charge()
        if (d <= segLens[i]! || i === segLens.length - 1) {
          const t = segLens[i]! === 0 ? 0 : Math.max(0, Math.min(1, d / segLens[i]!))
          return { x: pts[i]!.x + (pts[i + 1]!.x - pts[i]!.x) * t, y: pts[i]!.y + (pts[i + 1]!.y - pts[i]!.y) * t }
        }
        d -= segLens[i]!
      }
      return pts[pts.length - 1]!
    }
    charge(pts.length * 2)
    const mid = midpoint(pts)
    let chosen = { x: mid.x, y: mid.y }
    let chosenBox = boxAt(mid.x, mid.y)
    let needsSlot = collides(chosenBox)
    if (needsSlot) {
      for (const f of [0.4, 0.6, 0.3, 0.7, 0.25, 0.75, 0.2, 0.8, 0.15, 0.85]) {
        const q = at(total * f)
        const b = boxAt(q.x, q.y)
        if (!collides(b)) { chosen = q; chosenBox = b; needsSlot = false; break }
      }
    }
    if (needsSlot) {
      // Samples can miss a narrow clear slot. Subtract the actual occupied
      // intervals from each orthogonal segment, retaining the nearest free
      // point to the midpoint. Earlier clear placements remain unchanged.
      charge(entityBoxes.length + endpointBoxes.length + placed.length)
      const obstacles = [...entityBoxes, ...endpointBoxes, ...placed]
      let best: { point: Point; distance: number } | undefined, walked = 0
      for (let i = 1; i < pts.length; i++) {
        charge()
        const a = pts[i - 1]!, b = pts[i]!, length = segLens[i - 1]!
        const vertical = a.x === b.x, horizontal = a.y === b.y
        if (length === 0 || !vertical && !horizontal) { walked += length; continue }
        const fixed = vertical ? a.x : a.y, halfCross = (vertical ? bgW : bgH) / 2, halfMain = (vertical ? bgH : bgW) / 2
        const viewportCross = vertical ? diagram.width : diagram.height, viewportMain = vertical ? diagram.height : diagram.width
        if (fixed - halfCross < 0 || fixed + halfCross > viewportCross) { walked += length; continue }
        const lo = Math.max(Math.min(vertical ? a.y : a.x, vertical ? b.y : b.x), halfMain)
        const hi = Math.min(Math.max(vertical ? a.y : a.x, vertical ? b.y : b.x), viewportMain - halfMain)
        if (lo >= hi) { walked += length; continue }
        const forbidden: Array<[number, number]> = []
        for (const obstacle of obstacles) {
          charge()
          const crossLo = vertical ? obstacle.x0 : obstacle.y0, crossHi = vertical ? obstacle.x1 : obstacle.y1
          if (Math.min(fixed + halfCross, crossHi) - Math.max(fixed - halfCross, crossLo) <= .5) continue
          forbidden.push([(vertical ? obstacle.y0 : obstacle.x0) - halfMain + .5, (vertical ? obstacle.y1 : obstacle.x1) + halfMain - .5])
        }
        forbidden.sort((a, b) => { charge(); return a[0] - b[0] || a[1] - b[1] })
        const start = vertical ? a.y : a.x, sign = Math.sign((vertical ? b.y : b.x) - start)
        const preferred = start + sign * (total / 2 - walked)
        const consider = (from: number, to: number) => {
          charge()
          const inset = Math.max(1e-6, Number.EPSILON * Math.max(1, Math.abs(from), Math.abs(to)) * 8)
          if (to - from <= inset * 2) return
          const value = Math.max(from + inset, Math.min(to - inset, preferred))
          const distance = Math.abs(walked + Math.abs(value - start) - total / 2)
          if (!best || distance < best.distance) best = { point: vertical ? { x: fixed, y: value } : { x: value, y: fixed }, distance }
        }
        let cursor = lo
        for (const [from, to] of forbidden) {
          charge()
          if (to <= cursor) continue
          if (from > hi) break
          if (from > cursor) consider(cursor, Math.min(hi, from))
          cursor = Math.max(cursor, to)
          if (cursor >= hi) break
        }
        if (cursor < hi) consider(cursor, hi)
        walked += length
      }
      if (best && !collides(boxAt(best.point.x, best.point.y))) { chosen = best.point; chosenBox = boxAt(chosen.x, chosen.y) }
    }
    placed.push(chosenBox)
    out.set(rel, chosen)
  }
  return out
}

/** Render a relationship label at the midpoint (supports multi-line).
 *  Emits the background pill and the text as separate marks (in old part order). */
function renderRelationshipLabel<T>(
  marks: DrawingFactory<T>,
  rel: PositionedErRelationship,
  style: ResolvedRenderStyle,
  styleFace: Readonly<InternalStyleFace> | undefined,
  sceneId: string,
  at?: { x: number; y: number },
): T[] {
  if (!rel.label || rel.points.length < 2) {
    return []
  }

  const channels = { category: rel.identifying ? 'identifying' : 'non-identifying' }
  const roleStyle = resolveRoleStyle(styleFace, 'relationship', channels, { includeFallback: false })
  const fontSize = roleStyle?.fontSize ?? style.edgeLabelFontSize
  const mid = at ?? midpoint(rel.points)
  const metrics = rel.labelBlock ?? erRelationshipBlock(rel, style, styleFace)
  const displayLabel = metrics.text

  // Background pill for readability
  const bgW = metrics.width + 8
  const bgH = metrics.height + 6

  const pill = marks.shape({
    id: `${sceneId}:bg`,
    role: 'chrome',
    geometry: { kind: 'rect', x: mid.x - bgW / 2, y: mid.y - bgH / 2, width: bgW, height: bgH, rx: 2, ry: 2 },
    paint: { fill: 'var(--bg)', stroke: 'var(--_inner-stroke)', strokeWidth: '0.5' },
    channels,
  })

  const labelColor = roleStyle?.textColor ?? style.edgeTextColor ?? 'var(--_text-muted)'
  const label = marks.text({
    id: sceneId,
    role: 'label',
    text: displayLabel, block: metrics,
    x: mid.x,
    y: mid.y,
    fontSize,
    anchor: 'middle',
    paint: { fill: labelColor },
    channels,
  })

  return [pill, label]
}

/**
 * Render crow's foot cardinality markers at both endpoints of a relationship.
 * One shape mark per endpoint (compound geometry of the glyph's lines/circle).
 *
 * Crow's foot notation (upstream erMarkers reference):
 *   'one':       ─║─   (two ticks: one and only one)
 *   'zero-one':  ─o│─  (circle + ONE tick)
 *   'many':      ─│<─  (one tick + crow's foot: one or more)
 *   'zero-many': ─o<─  (circle + crow's foot)
 */
function renderCardinality<T>(marks: DrawingFactory<T>, rel: PositionedErRelationship, style: ResolvedRenderStyle, sceneId: string): T[] {
  if (rel.points.length < 2) {
    // Old renderer pushed '' for degenerate relationships — keep the empty
    // slot (a compound shape with no children writes '').
    return [marks.shape({
      id: sceneId,
      role: 'cardinality',
      geometry: { kind: 'compound', children: [] },
      paint: {},
    })]
  }

  // Entity1 side (first point, direction toward second point)
  const p1 = rel.points[0]!
  const p2 = rel.points[1]!

  // Entity2 side (last point, direction toward second-to-last point)
  const pN = rel.points[rel.points.length - 1]!
  const pN1 = rel.points[rel.points.length - 2]!

  return [
    crowsFootMark(marks, p1, p2, rel.cardinality1, style, `${sceneId}:1`),
    crowsFootMark(marks, pN, pN1, rel.cardinality2, style, `${sceneId}:2`),
  ]
}

/** Build the shape mark for one crow's foot glyph from its pieces. The glyph
 * is stroked; a zero-minimum circle also fills with the page background, so
 * then each piece carries its own paint. */
function crowsFootMark<T>(
  marks: DrawingFactory<T>,
  point: { x: number; y: number },
  toward: { x: number; y: number },
  cardinality: Cardinality,
  style: ResolvedRenderStyle,
  sceneId: string,
): T {
  const paint: MarkPaint = {
    stroke: style.edgeStrokeColor ?? 'var(--_line)',
    strokeWidth: String(style.lineWidth + 0.25),
  }
  const pieces = renderCrowsFoot(point, toward, cardinality, paint)
  return marks.shape({
    id: sceneId,
    role: 'cardinality',
    geometry: { kind: 'compound', children: pieces.map(p => p.geometry) },
    paint,
    ...(pieces.some(p => p.paint !== paint) ? { childPaints: pieces.map(p => p.paint) } : {}),
    channels: { category: cardinality },
  })
}

/**
 * Render a crow's foot marker at a given endpoint.
 * `point` is the endpoint, `toward` gives the direction the line comes from;
 * `stroke` paints the glyph's lines.
 */
function renderCrowsFoot(
  point: { x: number; y: number },
  toward: { x: number; y: number },
  cardinality: Cardinality,
  stroke: MarkPaint,
): ShapePiece[] {
  const pieces: ShapePiece[] = []

  // Calculate direction from toward → point (unit vector)
  const dx = point.x - toward.x
  const dy = point.y - toward.y
  const len = Math.sqrt(dx * dx + dy * dy)
  if (len === 0) return []
  const ux = dx / len
  const uy = dy / len

  // Perpendicular direction
  const px = -uy
  const py = ux

  if (cardinality === 'parent') {
    const at = (back: number, side: number) => ({ x: point.x - ux * back + px * side, y: point.y - uy * back + py * side })
    return [{ geometry: { kind: 'polygon', points: [at(0, 0), at(6, 4), at(12, 0), at(6, -4)] }, paint: { fill: 'var(--bg)', ...stroke } }]
  }

  // Marker sits 4px from the endpoint, extending 12px back along the edge
  const tipX = point.x - ux * 4
  const tipY = point.y - uy * 4
  const backX = point.x - ux * 16
  const backY = point.y - uy * 16

  // Primitive vocabulary follows upstream's erMarkers reference exactly:
  //   one        = tick + tick        zero-one  = tick + circle
  //   many       = crow's foot + tick zero-many = crow's foot + circle
  // A tick is a perpendicular line; the circle marks the "zero" minimum.
  // Before this correction 'zero-one' drew TWO ticks (reading as "one and
  // only one" plus a circle) and 'many' drew no tick (one-or-more was
  // indistinguishable from a bare many).
  const hasCrowsFoot = cardinality === 'many' || cardinality === 'zero-many'
  const hasCircle = cardinality === 'zero-one' || cardinality === 'zero-many'

  /** Draw one tick (perpendicular line) centered on (cx, cy). */
  const pushTickAt = (cx: number, cy: number): void => {
    const halfW = 6
    const x1 = cx + px * halfW
    const y1 = cy + py * halfW
    const x2 = cx - px * halfW
    const y2 = cy - py * halfW
    pieces.push({ geometry: { kind: 'line', x1, y1, x2, y2 }, paint: stroke })
  }

  if (cardinality === 'one') {
    // Two ticks: one and only one. (The second tick keeps the historical
    // two-step arithmetic — (tip - 4u), not (point - 8u) — so existing `||`
    // markers stay byte-identical.)
    pushTickAt(tipX, tipY)
    pushTickAt(tipX - ux * 4, tipY - uy * 4)
  } else if (cardinality === 'zero-one') {
    // ONE tick at the tip; the circle behind it carries the "zero" minimum.
    pushTickAt(tipX, tipY)
  }

  // Crow's foot (three lines fanning out from tip)
  if (hasCrowsFoot) {
    const fanW = 7
    // Center line
    const cfTipX = tipX
    const cfTipY = tipY
    // Three lines from tip to back, fanning out
    const topX1 = cfTipX + px * fanW
    const topY1 = cfTipY + py * fanW
    pieces.push({
      // Top fan line
      geometry: { kind: 'line', x1: topX1, y1: topY1, x2: backX, y2: backY },
      paint: stroke,
    })
    pieces.push({
      // Center line
      geometry: { kind: 'line', x1: cfTipX, y1: cfTipY, x2: backX, y2: backY },
      paint: stroke,
    })
    const botX1 = cfTipX - px * fanW
    const botY1 = cfTipY - py * fanW
    pieces.push({
      // Bottom fan line
      geometry: { kind: 'line', x1: botX1, y1: botY1, x2: backX, y2: backY },
      paint: stroke,
    })
    // One-or-more: the "one" tick behind the foot (where zero-many's circle
    // sits), so `}|` and `}o` stay distinguishable at a glance.
    if (cardinality === 'many') {
      pushTickAt(point.x - ux * 20, point.y - uy * 20)
    }
  }

  // Circle (for zero variants)
  if (hasCircle) {
    const circleOffset = hasCrowsFoot ? 20 : 12
    const circleX = point.x - ux * circleOffset
    const circleY = point.y - uy * circleOffset
    pieces.push({
      geometry: { kind: 'circle', cx: circleX, cy: circleY, r: 4 },
      paint: { fill: 'var(--bg)', ...stroke },
    })
  }

  return pieces
}

/** Compute the arc-length midpoint of a polyline path.
 *  Walks along each segment, finds the point at exactly 50% of total path length.
 *  This ensures the label sits ON the path even for orthogonal routes with bends,
 *  unlike the naive first/last geometric center which floats in space for L/Z shapes. */
function midpoint(points: Array<{ x: number; y: number }>): { x: number; y: number } {
  if (points.length === 0) return { x: 0, y: 0 }
  if (points.length === 1) return points[0]!

  // Compute total path length
  let totalLen = 0
  for (let i = 1; i < points.length; i++) {
    const dx = points[i]!.x - points[i - 1]!.x
    const dy = points[i]!.y - points[i - 1]!.y
    totalLen += Math.sqrt(dx * dx + dy * dy)
  }

  if (totalLen === 0) return points[0]!

  // Walk to 50% of total length, interpolating within the segment that crosses the halfway mark
  const halfLen = totalLen / 2
  let walked = 0
  for (let i = 1; i < points.length; i++) {
    const dx = points[i]!.x - points[i - 1]!.x
    const dy = points[i]!.y - points[i - 1]!.y
    const segLen = Math.sqrt(dx * dx + dy * dy)
    if (walked + segLen >= halfLen) {
      const t = segLen > 0 ? (halfLen - walked) / segLen : 0
      return {
        x: points[i - 1]!.x + dx * t,
        y: points[i - 1]!.y + dy * t,
      }
    }
    walked += segLen
  }

  return points[points.length - 1]!
}

// ============================================================================
// Utilities
// ============================================================================

// Use shared escapeXml from multiline-utils
const escapeXml = escapeXmlUtil


/**
 * Escape a string for use as an XML/HTML attribute value.
 */

export const lowerErScene = sceneLowering<PositionedErDiagram>(lowerErDrawing)
