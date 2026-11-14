export { ErLabelWorkLimitError } from './errors.ts'
import { sceneLowering, type DrawingFactory, type DrawingDocument } from '../scene/drawing.ts'
import { prepareDisplayText, resolveLabelContent } from '../shared/display-text.ts'
import { erCardinalityPieces, erLabelPillGeometry } from './cardinality-geometry.ts'
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
import type { MarkAttributes, MarkPaint, SceneOwner } from '../scene/ir.ts'
import { hashId } from '../scene/seed.ts'
import { DefaultBackend } from '../scene/backend.ts'
import { projectRoundedConnectorPath } from '../scene/connector-geometry.ts'
import { resolveRoleStyle, type InternalStyleFace } from '../scene/style-registry.ts'
import { erRelationshipMidpoint as midpoint, separateRelationshipLabels, retainedErRelationshipLabels } from './label-layout.ts'
export { separateRelationshipLabels } from './label-layout.ts'

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
    const pairKey = relationshipPairKey(rel)
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
    const pairKey = relationshipPairKey(rel)
    const k = cardOccurrence.get(pairKey) ?? 0
    cardOccurrence.set(pairKey, k + 1)
    parts.push(...renderCardinality(marks, rel, style, `card:${pairKey}#${k}`, { id: `rel:${pairKey}#${k}`, role: 'relationship' }))
  }

  // 4. Relationship labels — positions are collision-separated first: two
  // relationships between the same entity pair both put their labels at the
  // route midpoint otherwise (2026-07 overlap audit: 15% of fuzzed ER
  // diagrams print relationship labels on top of each other).
  const labelPos = retainedErRelationshipLabels(diagram) ?? separateRelationshipLabels(diagram, style, resolved.styleFace)
  const labelOccurrence = new Map<string, number>()
  for (const rel of diagram.relationships) {
    const pairKey = relationshipPairKey(rel)
    const k = labelOccurrence.get(pairKey) ?? 0
    labelOccurrence.set(pairKey, k + 1)
    parts.push(...renderRelationshipLabel(marks, rel, style, resolved.styleFace, `rel-label:${pairKey}#${k}`, labelPos.get(rel)))
  }

  parts.push(marks.documentClose())

  return { family: 'er', width: diagram.width, height: diagram.height, colors, transparent, parts }
}

/** Keep established readable keys, but never merge delimiter-bearing tuples. */
function relationshipPairKey(rel: PositionedErRelationship): string {
  return /[-#:[\]",\u0000-\u001f]/.test(rel.entity1 + rel.entity2)
    ? JSON.stringify([rel.entity1, rel.entity2])
    : `${rel.entity1}-${rel.entity2}`
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
  const dasharray = local['stroke-dasharray']
  const authoredDash = dasharray === undefined ? {} : { strokeDasharray: dasharray }
  children.push({
    indent: 2,
    node: marks.shape({
      id: `entity-rect:${id}`,
      role: 'entity',
      geometry: { kind: 'rect', x, y, width, height, rx: style.cornerRadius ?? 0, ry: style.cornerRadius ?? 0 },
      paint: { fill: rectFill, stroke: rectStroke, strokeWidth: String(rectStrokeWidth), ...authoredDash },
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
      paint: { fill: headerFill, stroke: rectStroke, strokeWidth: String(rectStrokeWidth), ...authoredDash },
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
      paint: { stroke: rectStroke, strokeWidth: String(dividerWidth), ...authoredDash },
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
  const pill = marks.shape({
    id: `${sceneId}:bg`,
    role: 'chrome',
    geometry: erLabelPillGeometry(metrics, mid),
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
function renderCardinality<T>(marks: DrawingFactory<T>, rel: PositionedErRelationship, style: ResolvedRenderStyle, sceneId: string, relationship: SceneOwner): T[] {
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
    crowsFootMark(marks, p1, p2, rel.cardinality1, style, `${sceneId}:1`, relationship, rel, 'start'),
    crowsFootMark(marks, pN, pN1, rel.cardinality2, style, `${sceneId}:2`, relationship, rel, 'end'),
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
  relationship: SceneOwner,
  rel: PositionedErRelationship,
  end: 'start' | 'end',
): T {
  const paint: MarkPaint = {
    stroke: style.edgeStrokeColor ?? 'var(--_line)',
    strokeWidth: String(style.lineWidth + 0.25),
  }
  const pieces = erCardinalityPieces(point, toward, cardinality, paint)
  // The whole glyph owns one public identity. A sibling line/circle must not
  // borrow ownership from whichever keyed primitive happened to precede it.
  // Keep the leaf's existing key, paint and owner for inspection and styling.
  return marks.group({
    id: `${sceneId}:group`, role: 'cardinality', owner: relationship,
    open: `<g data-id="${escapeAttr(sceneId)}" data-owner-id="${escapeAttr(relationship.id)}" data-owner-role="${relationship.role}" data-end="${end}" data-endpoint="${escapeAttr(end === 'start' ? rel.entity1 : rel.entity2)}">`,
    close: '</g>',
    channels: { category: cardinality },
    children: [{ indent: 0, node: marks.shape({
      id: sceneId,
      role: 'cardinality',
      identity: false,
      owner: { id: sceneId, role: 'cardinality' },
      geometry: { kind: 'compound', children: pieces.map(p => p.geometry) },
      paint,
      ...(pieces.some(p => p.paint !== paint) ? { childPaints: pieces.map(p => p.paint) } : {}),
      channels: { category: cardinality },
    }) }],
  })
}

/**
 * Render a crow's foot marker at a given endpoint.
 * `point` is the endpoint, `toward` gives the direction the line comes from;
 * `stroke` paints the glyph's lines.
 */
/** Compute the arc-length midpoint of a polyline path.
 *  Walks along each segment, finds the point at exactly 50% of total path length.
 *  This ensures the label sits ON the path even for orthogonal routes with bends,
 *  unlike the naive first/last geometric center which floats in space for L/Z shapes. */


// ============================================================================
// Utilities
// ============================================================================

// Use shared escapeXml from multiline-utils
const escapeXml = escapeXmlUtil


/**
 * Escape a string for use as an XML/HTML attribute value.
 */

export const lowerErScene = sceneLowering<PositionedErDiagram>(lowerErDrawing)
