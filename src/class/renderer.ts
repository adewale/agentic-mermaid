import type { PositionedClassDiagram, PositionedClassNode, PositionedClassNamespace, PositionedClassRelationship, PositionedClassNote, ClassMember, RelationshipType } from './types.ts'
import type { RenderContext } from '../types.ts'
import { svgOpenTag, buildStyleBlock, buildShadowDefs } from '../theme.ts'
import { FONT_SIZES, FONT_WEIGHTS, STROKE_WIDTHS, TEXT_BASELINE_SHIFT, applyTextTransform, resolveRenderStyle } from '../styles.ts'
import type { RenderStyleDefaults, ResolvedRenderStyle } from '../styles.ts'
import { CLS, CLASS_STYLE_DEFAULTS } from './layout.ts'
import { buildAccessibilityAttrs } from '../shared/svg-a11y.ts'
import { renderMultilineText, escapeAttr, escapeXml as escapeXmlUtil } from '../multiline-utils.ts'
import { topRoundedRectPath } from '../svg-paths.ts'
import type { MarkerDescriptor, SceneDoc, SceneNode } from '../scene/ir.ts'
import { hashId } from '../scene/seed.ts'
import * as marks from '../scene/marks.ts'
import { DefaultBackend } from '../scene/backend.ts'
import { serializeMarkerResources } from '../scene/marker-resources.ts'
import { projectRoundedConnectorPath } from '../scene/connector-geometry.ts'

// ============================================================================
// Class diagram SVG renderer
//
// The positioned diagram is first lowered to a SceneGraph (SPEC §3.1): every
// visual mark becomes a scene node carrying semantic fields (role, geometry,
// paint, stable id). renderClassSvg() uses DefaultBackend serialization of that scene.
//
// All colors use CSS custom properties (var(--_xxx)) from the theme system.
//
// Render order:
//   1. Relationship lines (behind boxes)
//   2. Class boxes (header + attributes + methods compartments)
//   3. Relationship endpoint markers (diamonds, triangles)
//   4. Labels and cardinality
// ============================================================================


/** Font sizes specific to class diagrams */
const CLS_FONT = {
  memberSize: 11,
  memberWeight: 400,
  annotationSize: 10,
  annotationWeight: 500,
} as const

/**
 * Render a positioned class diagram as an SVG string.
 *
 * @param colors - DiagramColors with bg/fg and optional enrichment variables.
 * @param transparent - If true, renders with transparent background.
 */
export function renderClassSvg(
  ctx: RenderContext<PositionedClassDiagram>,
): string {
  return DefaultBackend.render(lowerClassScene(ctx), { seed: 0 })
}

/**
 * Lower a positioned class diagram to the SceneGraph IR in canonical mark order.
 */
export function lowerClassScene(
  ctx: RenderContext<PositionedClassDiagram>,
): SceneDoc {
  const { positioned: diagram, colors, resolved } = ctx
  const options = resolved.renderOptions
  const font = colors.font ?? 'Inter'
  const transparent = options.transparent ?? false
  const parts: SceneNode[] = []
  const style = resolveRenderStyle(options, CLASS_STYLE_DEFAULTS, resolved.styleFace)
  const uid = `class-${hashId(diagram.width, diagram.height, diagram.classes.length, diagram.relationships.length)}`
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
  const markerResources = classMarkerResources(style)
  defsParts.push(serializeMarkerResources(markerResources))
  const shadowDefs = buildShadowDefs(colors)
  if (shadowDefs) defsParts.push(shadowDefs)
  defsParts.push('</defs>')
  parts.push(marks.definitions({ id: 'defs', markerResources }, defsParts.join('\n')))

  if (diagram.accessibilityTitle) {
    parts.push(marks.documentContent({ id: 'title', role: 'chrome' }, `<title id="${titleId}">${escapeXml(diagram.accessibilityTitle)}</title>`))
  }
  if (diagram.accessibilityDescription) {
    parts.push(marks.documentContent({ id: 'desc', role: 'chrome' }, `<desc id="${descId}">${escapeXml(diagram.accessibilityDescription)}</desc>`))
  }

  // 0. Namespace boxes (behind everything, parent-first so children draw on
  // top). Only namespaced diagrams add marks here, so namespace-free output
  // stays byte-identical to previous releases.
  for (const ns of diagram.namespaces) {
    parts.push(renderNamespaceBox(ns, style))
  }

  // 1. Relationship lines (rendered behind boxes)
  const relOccurrence = new Map<string, number>()
  for (const rel of diagram.relationships) {
    const pairKey = `${rel.from}->${rel.to}`
    const k = relOccurrence.get(pairKey) ?? 0
    relOccurrence.set(pairKey, k + 1)
    parts.push(renderRelationship(rel, style, `rel:${pairKey}#${k}`))
  }

  // 2. Class boxes
  for (const cls of diagram.classes) {
    parts.push(renderClassBox(cls, style, options.security !== 'strict'))
  }

  // 2b. Endpoint markers must sit above class surfaces. SVG paints a marker
  // with its connector, so the relationship pass behind boxes lets the later
  // node fill erase the marker tip/base. Repaint only the marker attachment on
  // an invisible carrier; the semantic connector and its line remain behind.
  diagram.relationships.forEach((rel, index) => {
    parts.push(renderRelationshipMarkerOverlay(rel, style, index))
  })

  // 3. Notes are first-class UML marks; anchored notes include a connector.
  for (let index = 0; index < diagram.notes.length; index++) parts.push(renderClassNote(diagram.notes[index]!, style, index))

  // 4. Relationship labels and cardinality
  const labelOccurrence = new Map<string, number>()
  for (const rel of diagram.relationships) {
    const pairKey = `${rel.from}->${rel.to}`
    const k = labelOccurrence.get(pairKey) ?? 0
    labelOccurrence.set(pairKey, k + 1)
    parts.push(...renderRelationshipLabels(rel, style, `${pairKey}#${k}`))
  }

  parts.push(marks.documentClose())

  return { family: 'class', width: diagram.width, height: diagram.height, colors, transparent, parts }
}

// ============================================================================
// Marker definitions
// ============================================================================

/**
 * Marker definitions for class relationship endpoints.
 * Each relationship type has a distinct marker:
 *   - inheritance: hollow triangle
 *   - composition: filled diamond
 *   - aggregation: hollow diamond
 *   - association: open arrow (simple >)
 *   - dependency: open arrow (simple >)
 *   - realization: hollow triangle (same as inheritance)
 *
 * Uses var(--_arrow) for fill/stroke and var(--bg) for hollow marker fills.
 */
function classMarkerResources(style: ResolvedRenderStyle): readonly MarkerDescriptor[] {
  const edgeColor = style.edgeStrokeColor ?? 'var(--_arrow)'
  const triangle = [{ x: 0, y: 0 }, { x: 12, y: 5 }, { x: 0, y: 10 }]
  const diamond = [{ x: 7, y: 1 }, { x: 13, y: 6 }, { x: 7, y: 11 }, { x: 1, y: 6 }]
  return [
    { id: 'cls-inherit', shape: 'triangle', size: { width: 12, height: 10 }, ref: { x: 12, y: 5 }, orient: 'auto-start-reverse', overflow: 'visible', geometry: { kind: 'polygon', points: triangle }, paint: { fill: 'var(--bg)', stroke: edgeColor, strokeWidth: '1.5' } },
    { id: 'cls-composition', shape: 'diamond', size: { width: 14, height: 12 }, viewBox: { x: 0, y: 0, width: 14, height: 12 }, ref: { x: 13, y: 6 }, orient: 'auto-start-reverse', overflow: 'hidden', geometry: { kind: 'polygon', points: diamond }, paint: { fill: edgeColor, stroke: edgeColor, strokeWidth: '1' } },
    { id: 'cls-aggregation', shape: 'diamond-open', size: { width: 14, height: 12 }, viewBox: { x: 0, y: 0, width: 14, height: 12 }, ref: { x: 13, y: 6 }, orient: 'auto-start-reverse', overflow: 'hidden', geometry: { kind: 'polygon', points: diamond }, paint: { fill: 'var(--bg)', stroke: edgeColor, strokeWidth: '1.5' } },
    { id: 'cls-arrow', shape: 'open-arrow', size: { width: 8, height: 6 }, ref: { x: 8, y: 3 }, orient: 'auto-start-reverse', overflow: 'visible', geometry: { kind: 'polyline', points: [{ x: 0, y: 0 }, { x: 8, y: 3 }, { x: 0, y: 6 }] }, paint: { fill: 'none', stroke: edgeColor, strokeWidth: '1.5' } },
    { id: 'cls-lollipop', shape: 'circle', size: { width: 14, height: 14 }, viewBox: { x: 0, y: 0, width: 14, height: 14 }, ref: { x: 12, y: 7 }, orient: 'auto-start-reverse', overflow: 'hidden', geometry: { kind: 'circle', cx: 7, cy: 7, r: 5 }, paint: { fill: 'var(--bg)', stroke: edgeColor, strokeWidth: '1.5' } },
  ]
}

// ============================================================================
// Namespace box rendering (ELK compound groups — flowchart subgraph pattern)
// ============================================================================

/**
 * Render a namespace box: outer rect, header band, and the namespace label.
 * Wrapped in <g class="namespace"> with semantic data attributes. Coordinates
 * are absolute (the layout flattens compound nesting), so children need no
 * recursive transform here — nested boxes simply draw after their parents.
 */
function renderNamespaceBox(ns: PositionedClassNamespace, style: ResolvedRenderStyle): SceneNode {
  const children: Array<{ node: SceneNode; indent: number }> = []
  const open =
    `<g class="namespace" data-id="${escapeAttr(ns.id)}" data-label="${escapeAttr(ns.label)}"${ns.parentId ? ` data-parent-id="${escapeAttr(ns.parentId)}"` : ''}>`

  // Outer rectangle
  const rectFill = style.groupFillColor ?? 'var(--_group-fill)'
  const rectStroke = style.groupBorderColor ?? 'var(--_node-stroke)'
  children.push({
    indent: 2,
    node: marks.shape({
      id: `namespace-rect:${ns.id}`,
      role: 'group',
      geometry: { kind: 'rect', x: ns.x, y: ns.y, width: ns.width, height: ns.height, rx: style.groupCornerRadius, ry: style.groupCornerRadius },
      paint: { fill: rectFill, stroke: rectStroke, strokeWidth: String(style.groupLineWidth) },
    },
      `<rect x="${ns.x}" y="${ns.y}" width="${ns.width}" height="${ns.height}" ` +
      `rx="${style.groupCornerRadius}" ry="${style.groupCornerRadius}" fill="${escapeAttr(rectFill)}" stroke="${escapeAttr(rectStroke)}" stroke-width="${style.groupLineWidth}" />`),
  })

  // Header band
  const headerFill = style.groupHeaderFillColor ?? 'var(--_group-hdr)'
  const headerPath = topRoundedRectPath(ns.x, ns.y, ns.width, ns.headerHeight, style.groupCornerRadius)
  children.push({
    indent: 2,
    node: marks.shape({
      id: `namespace-header:${ns.id}`,
      role: 'group-header',
      geometry: { kind: 'path', d: headerPath },
      paint: { fill: headerFill, stroke: rectStroke, strokeWidth: String(style.groupLineWidth) },
    },
      `<path d="${headerPath}" ` +
      `fill="${escapeAttr(headerFill)}" stroke="${escapeAttr(rectStroke)}" stroke-width="${style.groupLineWidth}" />`),
  })

  // Header label (display label when given, else the segment name)
  const headerText = applyTextTransform(ns.label, style.groupTextTransform)
  const headerTextColor = style.groupTextColor ?? 'var(--_text-sec)'
  children.push({
    indent: 2,
    node: marks.text({
      id: `namespace-label:${ns.id}`,
      role: 'group-header',
      text: headerText,
      x: ns.x + style.groupLabelPaddingX,
      y: ns.y + ns.headerHeight / 2,
      fontSize: style.groupHeaderFontSize,
      anchor: 'start',
      paint: { fill: headerTextColor },
    }, renderMultilineText(
      headerText,
      ns.x + style.groupLabelPaddingX,
      ns.y + ns.headerHeight / 2,
      style.groupHeaderFontSize,
      `font-size="${style.groupHeaderFontSize}" font-weight="${style.groupHeaderFontWeight}"${style.groupFont ? ` font-family="${escapeAttr(style.groupFont)}"` : ''}${style.groupLetterSpacing !== 0 ? ` letter-spacing="${style.groupLetterSpacing}"` : ''} fill="${escapeAttr(headerTextColor)}"`
    )),
  })

  return marks.group({
    id: `namespace:${ns.id}`,
    role: 'group',
    open,
    close: '</g>',
    children,
  })
}

// ============================================================================
// Class box rendering
// ============================================================================

/**
 * Render a class box with 3 compartments: header, attributes, methods.
 * Wrapped in <g class="class-node"> with semantic data attributes.
 */
function renderClassBox(cls: PositionedClassNode, style: ResolvedRenderStyle, includeInteraction: boolean): SceneNode {
  const { x, y, width, height, headerHeight, attrHeight } = cls
  const children: Array<{ node: SceneNode; indent: number }> = []

  // Semantic wrapper with class metadata
  // data-id: class identifier
  // data-label: class name
  // data-annotation: stereotype (interface, abstract, etc.)
  const annotationAttr = cls.annotation ? ` data-annotation="${escapeAttr(cls.annotation)}"` : ''
  const classAttr = cls.className ? ` ${escapeAttr(cls.className)}` : ''
  const dataClass = cls.className ? ` data-class="${escapeAttr(cls.className)}"` : ''
  const interaction = includeInteraction && cls.href ? ` data-href="${escapeAttr(cls.href)}" role="link" tabindex="0"` : ''
  const open =
    `<g class="class-node${classAttr}" data-id="${escapeAttr(cls.id)}" data-label="${escapeAttr(cls.label)}"${annotationAttr}${dataClass}${interaction}>`

  // classDef then inline style are merged by layout for backend parity.
  const local = cls.inlineStyle ?? {}
  const boxFill = local.fill ?? style.nodeFillColor ?? 'var(--_node-fill)'
  const boxStroke = local.stroke ?? style.nodeBorderColor ?? 'var(--_node-stroke)'
  const parsedStrokeWidth = Number.parseFloat(local['stroke-width'] ?? '')
  const boxStrokeWidth = Number.isFinite(parsedStrokeWidth) && parsedStrokeWidth > 0 ? parsedStrokeWidth : style.nodeLineWidth
  children.push({
    indent: 2,
    node: marks.shape({
      id: `class:${cls.id}:box`,
      role: 'class-box',
      geometry: { kind: 'rect', x, y, width, height, rx: style.cornerRadius ?? 0, ry: style.cornerRadius ?? 0 },
      paint: { fill: boxFill, stroke: boxStroke, strokeWidth: String(boxStrokeWidth) },
    },
      `<rect x="${x}" y="${y}" width="${width}" height="${height}" ` +
      `rx="${style.cornerRadius ?? 0}" ry="${style.cornerRadius ?? 0}" fill="${escapeAttr(boxFill)}" stroke="${escapeAttr(boxStroke)}" stroke-width="${boxStrokeWidth}" />`),
  })

  // Header background
  const headerFill = local.fill ?? style.groupHeaderFillColor ?? 'var(--_group-hdr)'
  const headerPath = topRoundedRectPath(x, y, width, headerHeight, style.cornerRadius ?? 0)
  children.push({
    indent: 2,
    node: marks.shape({
      id: `class:${cls.id}:header`,
      role: 'group-header',
      geometry: { kind: 'path', d: headerPath },
      paint: { fill: headerFill, stroke: boxStroke, strokeWidth: String(boxStrokeWidth) },
    },
      `<path d="${headerPath}" ` +
      `fill="${escapeAttr(headerFill)}" stroke="${escapeAttr(boxStroke)}" stroke-width="${boxStrokeWidth}" />`),
  })

  // Annotation (<<interface>>, <<abstract>>, etc.)
  let nameY = y + headerHeight / 2
  if (cls.annotation) {
    const annotY = y + 12
    const annotColor = local.color ?? style.nodeTextColor ?? 'var(--_text-muted)'
    children.push({
      indent: 2,
      node: marks.text({
        id: `class:${cls.id}:annotation`,
        role: 'label',
        text: `<<${cls.annotation}>>`,
        x: x + width / 2,
        y: annotY,
        fontSize: CLS_FONT.annotationSize,
        anchor: 'middle',
        paint: { fill: annotColor },
      },
        `<text x="${x + width / 2}" y="${annotY}" text-anchor="middle" dy="${TEXT_BASELINE_SHIFT}" ` +
        `font-size="${CLS_FONT.annotationSize}" font-weight="${CLS_FONT.annotationWeight}" ` +
        `font-style="italic" fill="${escapeAttr(annotColor)}">&lt;&lt;${escapeXml(cls.annotation)}&gt;&gt;</text>`),
    })
    nameY = y + headerHeight / 2 + 6
  }

  // Class name (supports multi-line via <br> tags)
  const nameColor = local.color ?? style.nodeTextColor ?? 'var(--_text)'
  const label = applyTextTransform(cls.label, style.nodeTextTransform)
  children.push({
    indent: 2,
    node: marks.text({
      id: `class:${cls.id}:name`,
      role: 'label',
      text: label,
      x: x + width / 2,
      y: nameY,
      fontSize: style.nodeLabelFontSize,
      anchor: 'middle',
      paint: { fill: nameColor },
    }, renderMultilineText(
      label,
      x + width / 2,
      nameY,
      style.nodeLabelFontSize,
      `text-anchor="middle" font-size="${style.nodeLabelFontSize}" font-weight="${style.nodeLabelFontWeight}"${letterAttr(style.nodeLetterSpacing)} fill="${escapeAttr(nameColor)}"`
    )),
  })

  // Divider line between header and attributes
  const attrTop = y + headerHeight
  children.push({ indent: 2, node: renderDivider(cls.id, 'attrs', x, attrTop, width, style) })

  // Attributes
  const memberRowH = 20
  for (let i = 0; i < cls.attributes.length; i++) {
    const member = cls.attributes[i]!
    const memberY = attrTop + 4 + i * memberRowH + memberRowH / 2
    children.push({ indent: 2, node: renderMember(member, x + style.nodePaddingX, memberY, style, `member:${cls.id}:${member.name}`) })
  }

  // Divider line between attributes and methods
  const methodTop = attrTop + attrHeight
  children.push({ indent: 2, node: renderDivider(cls.id, 'methods', x, methodTop, width, style) })

  // Methods
  for (let i = 0; i < cls.methods.length; i++) {
    const member = cls.methods[i]!
    const memberY = methodTop + 4 + i * memberRowH + memberRowH / 2
    children.push({ indent: 2, node: renderMember(member, x + style.nodePaddingX, memberY, style, `member:${cls.id}:${member.name}`) })
  }

  return marks.group({
    id: `class:${cls.id}`,
    role: 'class-box',
    open,
    close: '</g>',
    children,
  })
}

/** Compartment divider line (header/attributes and attributes/methods). */
function renderDivider(clsId: string, which: 'attrs' | 'methods', x: number, lineY: number, width: number, style: ResolvedRenderStyle): SceneNode {
  const stroke = style.nodeBorderColor ?? 'var(--_node-stroke)'
  const strokeWidth = Math.min(style.nodeLineWidth, STROKE_WIDTHS.innerBox)
  return marks.shape({
    id: `class:${clsId}:divider:${which}`,
    role: 'chrome',
    geometry: { kind: 'line', x1: x, y1: lineY, x2: x + width, y2: lineY },
    paint: { stroke, strokeWidth: String(strokeWidth) },
  },
    `<line x1="${x}" y1="${lineY}" x2="${x + width}" y2="${lineY}" ` +
    `stroke="${escapeAttr(stroke)}" stroke-width="${strokeWidth}" />`)
}

/**
 * Render a single class member with syntax highlighting.
 * Uses <tspan> elements to color each part of the member differently:
 *   - visibility symbol (+/-/#/~) → textFaint
 *   - member name (incl. parens for methods) → textSecondary
 *   - colon separator → textFaint
 *   - type annotation → textMuted
 */
function renderMember(member: ClassMember, x: number, y: number, style: ResolvedRenderStyle, sceneId: string): SceneNode {
  const fontStyle = member.isAbstract ? ' font-style="italic"' : ''
  const decoration = member.isStatic ? ' text-decoration="underline"' : ''

  // Build tspan parts for syntax-highlighted member text
  const spans: string[] = []

  if (member.visibility) {
    spans.push(`<tspan fill="var(--_text-faint)">${escapeXml(member.visibility)} </tspan>`)
  }

  // Add parentheses for methods to distinguish from attributes, including parameters if present
  const displayName = member.isMethod
    ? `${member.name}(${member.params || ''})`
    : member.name
  spans.push(`<tspan fill="${escapeAttr(style.nodeTextColor ?? 'var(--_text-sec)')}">${escapeXml(displayName)}</tspan>`)

  if (member.type) {
    spans.push(`<tspan fill="var(--_text-faint)">: </tspan>`)
    spans.push(`<tspan fill="var(--_text-muted)">${escapeXml(member.type)}</tspan>`)
  }

  // Plain signature string (the tspan structure lives in the crisp)
  const plain =
    `${member.visibility ? `${member.visibility} ` : ''}${displayName}${member.type ? `: ${member.type}` : ''}`

  return marks.text({
    id: sceneId,
    role: 'member',
    text: plain,
    x,
    y,
    fontSize: CLS_FONT.memberSize,
    anchor: 'start',
    paint: { fill: style.nodeTextColor ?? 'var(--_text-sec)' },
  },
    `<text x="${x}" y="${y}" class="mono" dy="${TEXT_BASELINE_SHIFT}" ` +
    `font-size="${CLS_FONT.memberSize}" font-weight="${CLS_FONT.memberWeight}"${fontStyle}${decoration}>` +
    `${spans.join('')}</text>`)
}

function renderClassNote(note: PositionedClassNote, style: ResolvedRenderStyle, index: number): SceneNode {
  const stroke = style.groupBorderColor ?? 'var(--_node-stroke)'
  const fill = style.groupFillColor ?? 'var(--_group-hdr)'
  const text = style.groupTextColor ?? 'var(--_text)'
  const children: Array<{ node: SceneNode; indent: number }> = []
  if (note.targetX !== undefined && note.targetY !== undefined) {
    children.push({ node: marks.connector({
      id: `class-note:${index}:connector`, role: 'relationship',
      geometry: { kind: 'line', x1: note.targetX, y1: note.targetY, x2: note.noteX ?? note.x, y2: note.noteY ?? note.y + note.height / 2 },
      lineStyle: 'dashed', paint: { stroke, strokeWidth: '1', strokeDasharray: '4 3' },
    }, `<line class="class-note-connector" x1="${note.targetX}" y1="${note.targetY}" x2="${note.noteX ?? note.x}" y2="${note.noteY ?? note.y + note.height / 2}" stroke="${escapeAttr(stroke)}" stroke-width="1" stroke-dasharray="4 3" />`), indent: 2 })
  }
  children.push({ node: marks.shape({
    id: `class-note:${index}:box`, role: 'note',
    geometry: { kind: 'rect', x: note.x, y: note.y, width: note.width, height: note.height, rx: 2, ry: 2 },
    paint: { fill, stroke, strokeWidth: '1' },
  }, `<rect x="${note.x}" y="${note.y}" width="${note.width}" height="${note.height}" rx="2" fill="${escapeAttr(fill)}" stroke="${escapeAttr(stroke)}" />`), indent: 2 })
  children.push({ node: marks.text({
    id: `class-note:${index}:label`, role: 'label', text: note.text,
    x: note.x + note.width / 2, y: note.y + note.height / 2, fontSize: 12, anchor: 'middle', paint: { fill: text },
  }, renderMultilineText(note.text, note.x + note.width / 2, note.y + note.height / 2, 12, `text-anchor="middle" fill="${escapeAttr(text)}"`)), indent: 2 })
  return marks.group({
    id: `class-note:${index}`, role: 'note',
    open: `<g class="class-note" data-note-index="${index}"${note.for ? ` data-for="${escapeAttr(note.for)}"` : ''}>`,
    close: '</g>', children,
  })
}

// ============================================================================
// Relationship rendering
// ============================================================================

/**
 * Render a relationship line with appropriate markers and semantic attributes.
 * Includes data-* attributes for programmatic inspection.
 */
function renderRelationship(rel: PositionedClassRelationship, style: ResolvedRenderStyle, sceneId: string): SceneNode {
  if (rel.points.length < 2) {
    // Degenerate relationship — draws nothing (crisp '', like the old '' part).
    return marks.connector({
      id: sceneId,
      role: 'relationship',
      geometry: { kind: 'polyline', points: rel.points },
      lineStyle: 'invisible',
      paint: {},
      endpoints: { from: rel.from, to: rel.to },
      relationship: { kind: rel.type },
      labels: rel.label ? [{ text: rel.label, ...(rel.labelPosition ? { anchor: rel.labelPosition } : {}) }] : [],
    }, '')
  }

  const pathData = rel.points.map(p => `${p.x},${p.y}`).join(' ')
  const isDashed = rel.type === 'dependency' || rel.type === 'realization'
  const dashArray = isDashed ? ' stroke-dasharray="6 4"' : ''
  const lineStyle = isDashed ? 'dashed' : 'solid'

  const startType = rel.markerAt === 'from' || rel.markerAt === 'both' ? rel.fromType ?? rel.type : undefined
  const endType = rel.markerAt === 'to' || rel.markerAt === 'both' ? rel.toType ?? rel.type : undefined
  const startId = startType ? getMarkerDefId(startType) : null
  const endId = endType ? getMarkerDefId(endType) : null
  const markerResources = classMarkerResources(style)
  const startMarker: MarkerDescriptor | undefined = startId ? markerResources.find(marker => marker.id === startId) : undefined
  const endMarker: MarkerDescriptor | undefined = endId ? markerResources.find(marker => marker.id === endId) : undefined
  const markers = `${startId ? ` marker-start="url(#${startId})"` : ''}${endId ? ` marker-end="url(#${endId})"` : ''}`

  // Build semantic data attributes for relationship inspection:
  // - class="class-relationship": CSS targeting
  // - data-from/data-to: source and target class IDs
  // - data-type: relationship type (inheritance, composition, etc.)
  // - data-marker-at: which end has the marker (from/to)
  // - data-from-cardinality/data-to-cardinality: multiplicity if present
  // - data-label: relationship label if present
  const dataAttrs = [
    'class="class-relationship"',
    `data-from="${escapeAttr(rel.from)}"`,
    `data-to="${escapeAttr(rel.to)}"`,
    `data-type="${rel.type}"`,
    `data-relation-type="${rel.type}"`,
    `data-marker-at="${rel.markerAt}"`,
  ]
  if (rel.label) {
    dataAttrs.push(`data-label="${escapeAttr(rel.label)}"`)
  }
  if (rel.fromCardinality) {
    dataAttrs.push(`data-from-cardinality="${escapeAttr(rel.fromCardinality)}"`)
  }
  if (rel.toCardinality) {
    dataAttrs.push(`data-to-cardinality="${escapeAttr(rel.toCardinality)}"`)
  }

  const strokeColor = style.edgeStrokeColor ?? 'var(--_line)'
  const paint = {
    stroke: strokeColor,
    strokeWidth: String(style.lineWidth),
    ...(isDashed ? { strokeDasharray: '6 4' } : {}),
  }
  const connectorSemantics = {
    endpoints: { from: rel.from, to: rel.to },
    relationship: { kind: rel.type },
    route: {
      ownership: 'layout',
      bendRadius: style.edgeBendRadius,
      labelAnchors: rel.labelPosition ? [rel.labelPosition] : [],
    },
    labels: rel.label ? [{ text: rel.label, ...(rel.labelPosition ? { anchor: rel.labelPosition } : {}) }] : [],
  } as const

  if (style.edgeBendRadius > 0 && rel.points.length > 2) {
    const projection = projectRoundedConnectorPath(rel.points, style.edgeBendRadius, {
      metric: 'manhattan',
      precision: 3,
    })
    return marks.connector({
      id: sceneId,
      role: 'relationship',
      geometry: projection.geometry,
      lineStyle,
      paint,
      markers: { ...(startMarker ? { start: startMarker } : {}), mid: [], ...(endMarker ? { end: endMarker } : {}) },
      ...connectorSemantics,
      route: { ...connectorSemantics.route, contours: projection.contours },
    },
      `<path ${dataAttrs.join(' ')} d="${projection.geometry.d}" fill="none" stroke="${escapeAttr(strokeColor)}" ` +
      `stroke-width="${style.lineWidth}"${dashArray}${markers} />`)
  }

  return marks.connector({
    id: sceneId,
    role: 'relationship',
    geometry: { kind: 'polyline', points: rel.points },
    lineStyle,
    paint,
    markers: { ...(startMarker ? { start: startMarker } : {}), mid: [], ...(endMarker ? { end: endMarker } : {}) },
    ...connectorSemantics,
  },
    `<polyline ${dataAttrs.join(' ')} points="${pathData}" fill="none" stroke="${escapeAttr(strokeColor)}" ` +
    `stroke-width="${style.lineWidth}"${dashArray}${markers} />`)
}

/** Marker-only carrier painted after class boxes. The connector remains the
 * semantic authority; this raw chrome exists only to prevent node surfaces
 * from occluding endpoint symbols. */
function renderRelationshipMarkerOverlay(
  rel: PositionedClassRelationship,
  style: ResolvedRenderStyle,
  index: number,
): SceneNode {
  if (rel.points.length < 2) return marks.documentContent({ id: `marker-overlay:${index}`, role: 'chrome' }, '')
  const startType = rel.markerAt === 'from' || rel.markerAt === 'both' ? rel.fromType ?? rel.type : undefined
  const endType = rel.markerAt === 'to' || rel.markerAt === 'both' ? rel.toType ?? rel.type : undefined
  const startId = startType ? getMarkerDefId(startType) : null
  const endId = endType ? getMarkerDefId(endType) : null
  if (!startId && !endId) return marks.documentContent({ id: `marker-overlay:${index}`, role: 'chrome' }, '')
  const markers = `${startId ? ` marker-start="url(#${startId})"` : ''}${endId ? ` marker-end="url(#${endId})"` : ''}`
  const carrierPaint = `fill="none" stroke="${escapeAttr(style.edgeStrokeColor ?? 'var(--_line)')}" stroke-width="${style.lineWidth}" stroke-opacity="0"${markers} pointer-events="none" aria-hidden="true"`
  if (style.edgeBendRadius > 0 && rel.points.length > 2) {
    const projection = projectRoundedConnectorPath(rel.points, style.edgeBendRadius, {
      metric: 'manhattan',
      precision: 3,
    })
    return marks.documentContent({ id: `marker-overlay:${index}`, role: 'chrome' },
      `<path class="class-marker-overlay" d="${projection.geometry.d}" ${carrierPaint} />`)
  }
  const points = rel.points.map(point => `${point.x},${point.y}`).join(' ')
  return marks.documentContent({ id: `marker-overlay:${index}`, role: 'chrome' },
    `<polyline class="class-marker-overlay" points="${points}" ${carrierPaint} />`)
}

/**
 * Get marker-start/marker-end attributes for a relationship type.
 * Uses `markerAt` from the parser to place the marker on the correct end:
 *   - 'from' → marker-start (prefix arrows like `<|--`, `*--`, `o--`)
 *   - 'to'   → marker-end   (suffix arrows like `..|>`, `-->`, `--*`)
 */
function getRelationshipMarkers(type: RelationshipType, markerAt: 'from' | 'to' | 'both'): string {
  const markerId = getMarkerDefId(type)
  if (!markerId) return ''

  if (markerAt === 'from') return ` marker-start="url(#${markerId})"`
  if (markerAt === 'both') return ` marker-start="url(#${markerId})" marker-end="url(#${markerId})"`
  return ` marker-end="url(#${markerId})"`
}

/** Map relationship type to its SVG marker definition ID */
function getMarkerDefId(type: RelationshipType): string | null {
  switch (type) {
    case 'inheritance':
    case 'realization':
      return 'cls-inherit'
    case 'composition':
      return 'cls-composition'
    case 'aggregation':
      return 'cls-aggregation'
    case 'association':
    case 'dependency':
      return 'cls-arrow'
    case 'lollipop':
      return 'cls-lollipop'
    default:
      return null
  }
}

/** Render relationship labels and cardinality text (supports multi-line).
 *  Returns one text mark per label/cardinality; when the relationship has
 *  none, a single empty mark keeps the historical '' part (blank line). */
function renderRelationshipLabels(rel: PositionedClassRelationship, style: ResolvedRenderStyle, key: string): SceneNode[] {
  if ((!rel.label && !rel.fromCardinality && !rel.toCardinality) || rel.points.length < 2) {
    return [marks.documentContent({ id: `rel-labels:${key}`, role: 'chrome' }, '')]
  }

  const out: SceneNode[] = []
  const textColor = style.edgeTextColor ?? 'var(--_text-muted)'
  const textAttrs =
    `font-size="${style.edgeLabelFontSize}" text-anchor="middle" font-weight="${style.edgeLabelFontWeight}"${letterAttr(style.edgeLetterSpacing)} fill="${escapeAttr(textColor)}"`

  // Label — prefer layout-computed position (collision-aware), fall back to midpoint
  if (rel.label) {
    const pos = rel.labelPosition ?? midpoint(rel.points)
    const label = applyTextTransform(rel.label, style.edgeTextTransform)
    out.push(marks.text({
      id: `rel-label:${key}`,
      role: 'label',
      text: label,
      x: pos.x,
      y: pos.y - 8,
      fontSize: style.edgeLabelFontSize,
      anchor: 'middle',
      paint: { fill: textColor },
    }, renderMultilineText(label, pos.x, pos.y - 8, style.edgeLabelFontSize, textAttrs)))
  }

  // From cardinality (near start)
  if (rel.fromCardinality) {
    const p = rel.points[0]!
    const next = rel.points[1]!
    const offset = cardinalityOffset(p, next)
    const position = rel.fromCardinalityPosition ?? { x: p.x + offset.x, y: p.y + offset.y }
    out.push(marks.text({
      id: `rel-card:${key}:from`,
      role: 'cardinality',
      text: rel.fromCardinality,
      x: position.x,
      y: position.y,
      fontSize: style.edgeLabelFontSize,
      anchor: 'middle',
      paint: { fill: textColor },
    }, renderMultilineText(rel.fromCardinality, position.x, position.y, style.edgeLabelFontSize, textAttrs)))
  }

  // To cardinality (near end)
  if (rel.toCardinality) {
    const p = rel.points[rel.points.length - 1]!
    const prev = rel.points[rel.points.length - 2]!
    const offset = cardinalityOffset(p, prev)
    const position = rel.toCardinalityPosition ?? { x: p.x + offset.x, y: p.y + offset.y }
    out.push(marks.text({
      id: `rel-card:${key}:to`,
      role: 'cardinality',
      text: rel.toCardinality,
      x: position.x,
      y: position.y,
      fontSize: style.edgeLabelFontSize,
      anchor: 'middle',
      paint: { fill: textColor },
    }, renderMultilineText(rel.toCardinality, position.x, position.y, style.edgeLabelFontSize, textAttrs)))
  }

  return out
}

/** Get the midpoint of a point array */
function midpoint(points: Array<{ x: number; y: number }>): { x: number; y: number } {
  if (points.length === 0) return { x: 0, y: 0 }
  const mid = Math.floor(points.length / 2)
  return points[mid]!
}

/** Calculate offset for cardinality label perpendicular to edge direction */
function cardinalityOffset(
  from: { x: number; y: number },
  to: { x: number; y: number }
): { x: number; y: number } {
  const dx = to.x - from.x
  const dy = to.y - from.y
  // Place label perpendicular to the edge, 14px away
  if (Math.abs(dx) > Math.abs(dy)) {
    // Mostly horizontal — offset vertically
    return { x: dx > 0 ? 14 : -14, y: -10 }
  }
  // Mostly vertical — offset horizontally
  return { x: -14, y: dy > 0 ? 14 : -14 }
}

// ============================================================================
// Utilities
// ============================================================================

function letterAttr(value: number): string {
  return value !== 0 ? ` letter-spacing="${value}"` : ''
}

// Use shared escapeXml from multiline-utils
const escapeXml = escapeXmlUtil


/**
 * Escape a string for use as an XML/HTML attribute value.
 * Escapes quotes and ampersands to prevent attribute injection.
 */
