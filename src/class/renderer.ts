import { inkOnNodeFill } from '../color-resolver.ts'
import { escapeAttr, escapeDisplayAttr, escapeXml as escapeXmlUtil } from '../multiline-utils.ts'
import { DefaultBackend } from '../scene/backend.ts'
import { projectRoundedConnectorPath } from '../scene/connector-geometry.ts'
import { type DrawingDocument, type DrawingFactory, sceneLowering } from '../scene/drawing.ts'
import type { ConnectorDirection, MarkAttributes, MarkerDescriptor, TextMark } from '../scene/ir.ts'
import { arrowheadDirection } from '../shared/relation-direction.ts'
import { serializeMarkerResources } from '../scene/marker-resources.ts'
import { hashId } from '../scene/seed.ts'
import { topRoundedRectPath } from '../scene/svg-writer.ts'
import { prepareDisplayText, resolveLabelContent } from '../shared/display-text.ts'
import { type PixelTextBlock, preparePixelText } from '../shared/prepared-text.ts'
import { buildAccessibilityAttrs } from '../shared/svg-a11y.ts'
import { sanitizeDisplayLines } from '../shared/text-controls.ts'
import type { RenderStyleDefaults, ResolvedRenderStyle } from '../styles.ts'
import { diagramTitleFields, FONT_SIZES, FONT_WEIGHTS, resolveRenderStyle, STROKE_WIDTHS } from '../styles.ts'
import { buildShadowDefs, buildStyleBlock, type DiagramColors, svgOpenTag } from '../theme.ts'
import type { RenderContext } from '../types.ts'
import { CLASS_STYLE_DEFAULTS, CLS, classAnnotationBlock, classMemberBlock, classTextBlock } from './layout.ts'
import { classRelationshipLineStyle } from './parser.ts'
import { classRelationshipTerminalClearance, classCaptionAnchor, classCardinalityAnchor, classMarkerResources, getMarkerDefId, RELATION_LABEL_HALO_WIDTH, RELATION_LABEL_OFFSET_Y } from './relationship-paint.ts'
import { decodeClassText, memberToString } from './text.ts'
import type { ClassMember, PositionedClassDiagram, PositionedClassNamespace, PositionedClassNode, PositionedClassNote, PositionedClassRelationship } from './types.ts'

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

/** Font sizes specific to class diagrams (weights belong to the prepared
 * member and annotation blocks). */
const CLS_FONT = {
  memberSize: 11,
  annotationSize: 10,
} as const

type HighlightRun = NonNullable<TextMark['spans']>[number]

/** Highlight runs stand in for a line the writer emits as plain characters:
 * one untracked, unstyled line of printable ASCII whose runs spell the block.
 * Any other line carries its own positioned fragments and is drawn in the
 * member's single ink. */
function highlightRuns(block: PixelTextBlock, spans: readonly HighlightRun[]): Pick<TextMark, 'spans'> {
  const line = block.lineBlocks.length === 1 ? block.lineBlocks[0]! : undefined
  const plain = !!line && !line.fragments && block.letterSpacing === 0 && /^[\x20-\x7e]*$/.test(block.text) && line.runs.every(run => !run.bold && !run.italic && !run.underline && !run.strikethrough) && spans.map(span => span.text).join('') === block.text
  return plain ? { spans } : {}
}

/**
 * Render a positioned class diagram as an SVG string.
 *
 * @param colors - DiagramColors with bg/fg and optional enrichment variables.
 * @param transparent - If true, renders with transparent background.
 */
export function renderClassSvg(ctx: RenderContext<PositionedClassDiagram>): string {
  return DefaultBackend.render(lowerClassScene(ctx), { seed: 0 })
}

/**
 * Lower a positioned class diagram to the SceneGraph IR in canonical mark order.
 */
export function lowerClassDrawing<T>(marks: DrawingFactory<T>, ctx: RenderContext<PositionedClassDiagram>): DrawingDocument<T> {
  const { positioned: diagram, colors, resolved } = ctx
  const options = resolved.renderOptions
  const font = colors.font ?? 'Inter'
  const transparent = options.transparent ?? false
  const parts: T[] = []
  const style = resolveRenderStyle(options, CLASS_STYLE_DEFAULTS, resolved.styleFace)
  const uid = `class-${hashId(diagram.width, diagram.height, diagram.classes.length, diagram.relationships.length)}`
  const titleId = `${uid}-title`
  const descId = `${uid}-desc`
  const rootAttrs = buildAccessibilityAttrs(diagram.accessibilityTitle, diagram.accessibilityDescription, titleId, descId)

  // SVG root with CSS variables + style block (with mono font) + defs
  parts.push(
    marks.documentOpen(
      {
        id: 'prelude',
        width: diagram.width,
        height: diagram.height,
        colors,
        transparent,
        font,
        hasMonoFont: true,
      },
      svgOpenTag(diagram.width, diagram.height, colors, transparent, rootAttrs) + '\n' + buildStyleBlock(font, true, colors.shadow, colors.embedFontImport),
    ),
  )
  const defsParts: string[] = []
  defsParts.push('<defs>')
  const markerResources = classMarkerResources(style)
  defsParts.push(serializeMarkerResources(markerResources))
  const shadowDefs = buildShadowDefs(colors)
  if (shadowDefs) defsParts.push(shadowDefs)
  defsParts.push('</defs>')
  parts.push(marks.definitions({ id: 'defs', markerResources }, defsParts.join('\n')))

  if (diagram.accessibilityTitle) {
    parts.push(marks.documentContent({ id: 'title', role: 'chrome', nonPaint: 'accessibility' }, `<title id="${titleId}">${escapeXml(diagram.accessibilityTitle)}</title>`))
  }
  if (diagram.accessibilityDescription) {
    parts.push(marks.documentContent({ id: 'desc', role: 'chrome', nonPaint: 'accessibility' }, `<desc id="${descId}">${escapeXml(diagram.accessibilityDescription)}</desc>`))
  }

  // The diagram's frontmatter title, in the band layout reserved above.
  if (diagram.title) parts.push(marks.text(diagramTitleFields(diagram.title, style)))

  // 0. Namespace boxes (behind everything, parent-first so children draw on
  // top). Only namespaced diagrams add marks here, so namespace-free output
  // stays byte-identical to previous releases.
  for (const ns of diagram.namespaces) {
    parts.push(renderNamespaceBox(marks, ns, style))
  }

  // 1. Relationship lines (rendered behind boxes)
  const relOccurrence = new Map<string, number>()
  for (const rel of diagram.relationships) {
    const pairKey = `${rel.from}->${rel.to}`
    const k = relOccurrence.get(pairKey) ?? 0
    relOccurrence.set(pairKey, k + 1)
    parts.push(renderRelationship(marks, rel, style, `rel:${pairKey}#${k}`, markerResources))
  }

  // 2. Class boxes
  for (const cls of diagram.classes) {
    parts.push(renderClassBox(marks, cls, style, options.security !== 'strict', colors))
  }

  // 2b. Endpoint markers must sit above class surfaces. SVG paints a marker
  // with its connector, so the relationship pass behind boxes lets the later
  // node fill erase the marker tip/base. Repaint only the marker attachment on
  // an invisible carrier; the semantic connector and its line remain behind.
  const overlayOccurrence = new Map<string, number>()
  diagram.relationships.forEach((rel, index) => {
    const pairKey = `${rel.from}->${rel.to}`
    const occurrence = overlayOccurrence.get(pairKey) ?? 0
    overlayOccurrence.set(pairKey, occurrence + 1)
    const overlay = renderRelationshipMarkerOverlay(marks, rel, style, index, `rel:${pairKey}#${occurrence}`, markerResources)
    if (overlay) parts.push(overlay)
  })

  // 3. Notes are first-class UML marks; anchored notes include a connector.
  for (let index = 0; index < diagram.notes.length; index++) parts.push(renderClassNote(marks, diagram.notes[index]!, style, index))

  // 4. Relationship labels and cardinality
  const labelOccurrence = new Map<string, number>()
  for (const rel of diagram.relationships) {
    const pairKey = `${rel.from}->${rel.to}`
    const k = labelOccurrence.get(pairKey) ?? 0
    labelOccurrence.set(pairKey, k + 1)
    parts.push(...renderRelationshipLabels(marks, rel, style, `${pairKey}#${k}`))
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

// ============================================================================
// Namespace box rendering (ELK compound groups — flowchart subgraph pattern)
// ============================================================================

/**
 * Render a namespace box: outer rect, header band, and the namespace label.
 * Wrapped in <g class="namespace"> with semantic data attributes. Coordinates
 * are absolute (the layout flattens compound nesting), so children need no
 * recursive transform here — nested boxes simply draw after their parents.
 */
function renderNamespaceBox<T>(marks: DrawingFactory<T>, ns: PositionedClassNamespace, style: ResolvedRenderStyle): T {
  const children: Array<{ node: T; indent: number }> = []
  const open = `<g class="namespace" data-id="${escapeAttr(ns.id)}" data-label="${escapeDisplayAttr(ns.label)}"${ns.parentId ? ` data-parent-id="${escapeAttr(ns.parentId)}"` : ''}>`

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
    }),
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
    }),
  })

  // Header label (display label when given, else the segment name), wrapped
  // by layout when it is wider than the namespace.
  const headerBlock = ns.labelBlock ?? classTextBlock(resolveLabelContent(ns.label, ns.labelContent), style, 'group', ns.width - 2 * style.groupLabelPaddingX)
  const headerText = headerBlock.text
  const headerTextColor = style.groupTextColor ?? 'var(--_text-sec)'
  children.push({
    indent: 2,
    node: marks.text({
      id: `namespace-label:${ns.id}`,
      role: 'group-header',
      text: headerText,
      block: headerBlock,
      x: ns.x + style.groupLabelPaddingX,
      y: ns.y + ns.headerHeight / 2,
      fontSize: style.groupHeaderFontSize,
      anchor: 'start',
      paint: { fill: headerTextColor },
    }),
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
function renderClassBox<T>(marks: DrawingFactory<T>, cls: PositionedClassNode, style: ResolvedRenderStyle, includeInteraction: boolean, colors: DiagramColors): T {
  const { x, y, width, height, headerHeight, attrHeight } = cls
  const children: Array<{ node: T; indent: number }> = []
  if (cls.isInterface) {
    const block = cls.labelBlock ?? classTextBlock(resolveLabelContent(cls.label, cls.labelContent), style, 'node')
    return marks.group({
      id: `class:${cls.id}`,
      role: 'class-box',
      open: `<g class="class-interface" data-id="${escapeAttr(cls.id)}" data-label="${escapeDisplayAttr(cls.label)}" data-interface="true">`,
      close: '</g>',
      children: [{ indent: 2, node: marks.text({ id: `class:${cls.id}:name`, role: 'label', text: block.text, block, x: x + width / 2, y: y + headerHeight / 2, fontSize: block.fontSize, anchor: 'middle', paint: { fill: style.nodeTextColor ?? 'var(--_text)' } }) }],
    })
  }

  // Semantic wrapper with class metadata
  // data-id: class identifier
  // data-label: class name
  // data-annotation: stereotype (interface, abstract, etc.)
  const annotationAttr = cls.annotation !== undefined ? ` data-annotation="${escapeAttr(cls.annotation)}"` : ''
  const classAttr = cls.className ? ` ${escapeAttr(cls.className)}` : ''
  const dataClass = cls.className ? ` data-class="${escapeAttr(cls.className)}"` : ''
  const interaction = includeInteraction && cls.href ? ` data-href="${escapeAttr(cls.href)}" role="link" tabindex="0"` : ''
  const open = `<g class="class-node${classAttr}" data-id="${escapeAttr(cls.id)}" data-label="${escapeDisplayAttr(cls.label)}"${annotationAttr}${dataClass}${interaction}>`

  if (includeInteraction && cls.href && cls.tooltip !== undefined) {
    children.push({
      indent: 2,
      node: marks.documentContent({ id: `class:${cls.id}:tooltip`, role: 'chrome', nonPaint: 'interaction-metadata' }, `<title>${escapeXmlUtil(cls.tooltip)}</title>`),
    })
  }

  // classDef then inline style are merged by layout for backend parity.
  const local = cls.inlineStyle ?? {}
  // Every text in the box sits on its fill: the author's, or else the header
  // band's (annotation, name) or the node fill (members). A Style that sets the
  // text color owns it on its own fills.
  const styleText = style.nodeTextColor !== undefined
  const headerInk = inkOnNodeFill(cls.inlineStyle, colors, styleText ? undefined : (style.groupHeaderFillColor ?? 'var(--_group-hdr)'))
  const ink = inkOnNodeFill(cls.inlineStyle, colors, styleText ? undefined : (style.nodeFillColor ?? 'var(--_node-fill)'))
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
      paint: { fill: boxFill, stroke: boxStroke, strokeWidth: String(boxStrokeWidth), ...(local['stroke-dasharray'] !== undefined ? { strokeDasharray: local['stroke-dasharray'] } : {}) },
    }),
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
      paint: { fill: headerFill, stroke: boxStroke, strokeWidth: String(boxStrokeWidth), ...(local['stroke-dasharray'] !== undefined ? { strokeDasharray: local['stroke-dasharray'] } : {}) },
    }),
  })

  // Annotation (<<interface>>, <<abstract>>, etc.)
  let nameY = y + headerHeight / 2
  if (cls.annotation !== undefined) {
    const annotationBlock = cls.annotationBlock ?? classAnnotationBlock(cls.annotation)
    const annotY = y + 12
    const annotColor = headerInk(style.nodeTextColor ?? 'var(--_text-muted)')
    children.push({
      indent: 2,
      node: marks.text({
        id: `class:${cls.id}:annotation`,
        role: 'label',
        text: `<<${cls.annotation}>>`,
        block: annotationBlock,
        x: x + width / 2,
        y: annotY,
        fontSize: CLS_FONT.annotationSize,
        fontStyle: 'italic',
        anchor: 'middle',
        paint: { fill: annotColor },
      }),
    })
    nameY = y + headerHeight / 2 + 6
  }

  // Class name (supports multi-line via <br> tags)
  const nameColor = headerInk(style.nodeTextColor ?? 'var(--_text)')
  const labelBlock = cls.labelBlock ?? classTextBlock(resolveLabelContent(cls.label, cls.labelContent), style, 'node')
  const label = labelBlock.text
  children.push({
    indent: 2,
    node: marks.text({
      id: `class:${cls.id}:name`,
      role: 'label',
      text: label,
      block: labelBlock,
      x: x + width / 2,
      y: nameY,
      fontSize: style.nodeLabelFontSize,
      anchor: 'middle',
      paint: { fill: nameColor },
    }),
  })

  // Divider line between header and attributes
  const attrTop = y + headerHeight
  children.push({ indent: 2, node: renderDivider(marks, cls.id, 'attrs', x, attrTop, width, style, local['stroke-dasharray']) })

  // Attributes
  const memberRowH = 20
  for (let i = 0; i < cls.attributes.length; i++) {
    const member = cls.attributes[i]!
    const memberY = attrTop + 4 + i * memberRowH + memberRowH / 2
    children.push({ indent: 2, node: renderMember(marks, member, x + style.nodePaddingX, memberY, style, `member:${cls.id}:${member.name}`, ink, cls.attributeBlocks?.[i]) })
  }

  // Divider line between attributes and methods
  const methodTop = attrTop + attrHeight
  children.push({ indent: 2, node: renderDivider(marks, cls.id, 'methods', x, methodTop, width, style, local['stroke-dasharray']) })

  // Methods
  for (let i = 0; i < cls.methods.length; i++) {
    const member = cls.methods[i]!
    const memberY = methodTop + 4 + i * memberRowH + memberRowH / 2
    children.push({ indent: 2, node: renderMember(marks, member, x + style.nodePaddingX, memberY, style, `member:${cls.id}:${member.name}`, ink, cls.methodBlocks?.[i]) })
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
function renderDivider<T>(marks: DrawingFactory<T>, clsId: string, which: 'attrs' | 'methods', x: number, lineY: number, width: number, style: ResolvedRenderStyle, strokeDasharray?: string): T {
  const stroke = style.nodeBorderColor ?? 'var(--_node-stroke)'
  const strokeWidth = Math.min(style.nodeLineWidth, STROKE_WIDTHS.innerBox)
  return marks.shape({
    id: `class:${clsId}:divider:${which}`,
    role: 'chrome',
    geometry: { kind: 'line', x1: x, y1: lineY, x2: x + width, y2: lineY },
    paint: { stroke, strokeWidth: String(strokeWidth), ...(strokeDasharray !== undefined ? { strokeDasharray } : {}) },
  })
}

/**
 * Render a single class member with syntax highlighting: differently painted
 * runs color each part of the member:
 *   - visibility symbol (+/-/#/~) → textMuted (it carries UML meaning)
 *   - member name (incl. parens for methods) → textSecondary
 *   - colon separator → textFaint (decoration)
 *   - type annotation → textMuted
 * Abstract members are italic and static members underlined.
 */
function renderMember<T>(marks: DrawingFactory<T>, member: ClassMember, x: number, y: number, style: ResolvedRenderStyle, sceneId: string, ink: (tone: string) => string, prepared?: PixelTextBlock): T {
  const block = prepared ?? classMemberBlock(member)
  const plain = memberToString(member)
  const nameInk = ink(style.nodeTextColor ?? 'var(--_text-sec)')
  const spans: HighlightRun[] = []

  if (!member.isMethod && member.sourceText) {
    if (member.visibility && plain.startsWith(member.visibility)) {
      spans.push({ text: member.visibility, fill: ink('var(--_text-faint)') }, { text: plain.slice(1), fill: nameInk })
    } else {
      spans.push({ text: plain, fill: nameInk })
    }
  } else {
    if (member.visibility) spans.push({ text: `${member.visibility} `, fill: ink('var(--_text-muted)') })
    // Add parentheses for methods to distinguish from attributes, including parameters if present
    const displayName = member.isMethod ? `${member.name}(${member.params || ''})` : member.name
    spans.push({ text: decodeClassText(displayName), fill: nameInk })
    if (member.type) {
      spans.push({ text: ': ', fill: ink('var(--_text-faint)') }, { text: decodeClassText(member.type), fill: ink('var(--_text-muted)') })
    }
  }

  return marks.text({
    id: sceneId,
    role: 'member',
    text: plain,
    block,
    x,
    y,
    fontSize: CLS_FONT.memberSize,
    anchor: 'start',
    paint: { fill: nameInk },
    ...(member.isAbstract ? { fontStyle: 'italic' as const } : {}),
    ...(member.isStatic ? { textDecoration: 'underline' as const } : {}),
    ...highlightRuns(block, spans),
    attributes: { className: 'mono' },
  })
}

function renderClassNote<T>(marks: DrawingFactory<T>, note: PositionedClassNote, style: ResolvedRenderStyle, index: number): T {
  const stroke = style.groupBorderColor ?? 'var(--_node-stroke)'
  const fill = style.groupFillColor ?? 'var(--_group-hdr)'
  const text = style.groupTextColor ?? 'var(--_text)'
  const noteBlock = note.textBlock ?? preparePixelText(resolveLabelContent(note.text, note.textContent), { fontSize: 12, fontWeight: 400 })
  const children: Array<{ node: T; indent: number }> = []
  if (note.targetX !== undefined && note.targetY !== undefined) {
    children.push({
      node: marks.connector({
        id: `class-note:${index}:connector`,
        role: 'relationship',
        geometry: { kind: 'line', x1: note.targetX, y1: note.targetY, x2: note.noteX ?? note.x, y2: note.noteY ?? note.y + note.height / 2 },
        lineStyle: 'dashed',
        paint: { stroke, strokeWidth: '1', strokeDasharray: '4 3' },
        ...(note.for ? { endpoints: { from: note.for, to: `class-note:${index}`, start: { owner: { id: note.for, role: 'class-box' } }, end: { owner: { id: `class-note:${index}`, role: 'note' } } } } : {}),
        attributes: { className: 'class-note-connector' },
      }),
      indent: 2,
    })
  }
  children.push({
    node: marks.shape({
      id: `class-note:${index}:box`,
      role: 'note',
      geometry: { kind: 'rect', x: note.x, y: note.y, width: note.width, height: note.height, rx: 2, ry: 2 },
      paint: { fill, stroke, strokeWidth: '1' },
    }),
    indent: 2,
  })
  children.push({
    node: marks.text({
      id: `class-note:${index}:label`,
      role: 'label',
      text: note.text,
      block: noteBlock,
      x: note.x + note.width / 2,
      y: note.y + note.height / 2,
      fontSize: 12,
      anchor: 'middle',
      paint: { fill: text },
    }),
    indent: 2,
  })
  return marks.group({
    id: `class-note:${index}`,
    role: 'note',
    open: `<g class="class-note" data-note-index="${index}"${note.for ? ` data-for="${escapeAttr(note.for)}"` : ''}>`,
    close: '</g>',
    children,
  })
}

// ============================================================================
// Relationship rendering
// ============================================================================

/** A class relationship reads toward the ends that carry its markers. */
function classRelationshipDirection(rel: PositionedClassRelationship): ConnectorDirection {
  if (rel.from === rel.to) return 'self'
  return arrowheadDirection(rel.markerAt === 'from' || rel.markerAt === 'both', rel.markerAt === 'to' || rel.markerAt === 'both')
}

function classRelationshipEndpoints(rel: PositionedClassRelationship) {
  return { from: rel.from, to: rel.to, start: { owner: { id: rel.from, role: 'class-box' as const } }, end: { owner: { id: rel.to, role: 'class-box' as const } } }
}

/**
 * Render a relationship line with appropriate markers and semantic attributes.
 * Includes data-* attributes for programmatic inspection.
 */
function renderRelationship<T>(marks: DrawingFactory<T>, rel: PositionedClassRelationship, style: ResolvedRenderStyle, sceneId: string, markerResources: readonly MarkerDescriptor[]): T {
  const labels = rel.label
    ? [
        {
          text: rel.label,
          textContent: { value: rel.label, prepared: prepareDisplayText(resolveLabelContent(rel.label, rel.labelContent)) },
          ...(rel.labelPosition ? { anchor: rel.labelPosition } : {}),
        },
      ]
    : []
  if (rel.points.length < 2) {
    // Degenerate relationship — draws nothing (an invisible connector writes '').
    return marks.connector({
      id: sceneId,
      role: 'relationship',
      geometry: { kind: 'polyline', points: rel.points },
      lineStyle: 'invisible',
      paint: {},
      endpoints: classRelationshipEndpoints(rel),
      relationship: { kind: rel.type, direction: classRelationshipDirection(rel) },
      labels,
    })
  }

  const isDashed = classRelationshipLineStyle(rel) === 'dashed'
  const lineStyle = isDashed ? 'dashed' : 'solid'

  const startType = rel.markerAt === 'from' || rel.markerAt === 'both' ? (rel.fromType ?? rel.type) : undefined
  const endType = rel.markerAt === 'to' || rel.markerAt === 'both' ? (rel.toType ?? rel.type) : undefined
  const startId = startType ? getMarkerDefId(startType) : null
  const endId = endType ? getMarkerDefId(endType) : null
  const startMarker: MarkerDescriptor | undefined = startId ? markerResources.find(marker => marker.id === startId) : undefined
  const endMarker: MarkerDescriptor | undefined = endId ? markerResources.find(marker => marker.id === endId) : undefined

  // Inspection hooks for the relationship:
  // - class="class-relationship": CSS targeting
  // - data-type: relationship type (inheritance, composition, etc.)
  // - data-marker-at: which end has the marker (from/to)
  // - data-label: relationship label if present
  // - data-from-cardinality/data-to-cardinality: multiplicity if present
  // Identity (data-from/data-to: source and target class IDs) comes from the
  // connector's typed endpoints.
  const attributes: MarkAttributes = {
    className: 'class-relationship',
    data: {
      type: rel.type,
      'relation-type': rel.type,
      'marker-at': rel.markerAt,
      ...(rel.label ? { label: sanitizeDisplayLines(rel.label) } : {}),
      ...(rel.fromCardinality ? { 'from-cardinality': rel.fromCardinality } : {}),
      ...(rel.toCardinality ? { 'to-cardinality': rel.toCardinality } : {}),
    },
  }

  const strokeColor = style.edgeStrokeColor ?? 'var(--_line)'
  const paint = {
    stroke: strokeColor,
    strokeWidth: String(style.lineWidth),
    ...(isDashed ? { strokeDasharray: '6 4' } : {}),
  }
  const connectorSemantics = {
    endpoints: classRelationshipEndpoints(rel),
    relationship: { kind: rel.type, direction: classRelationshipDirection(rel) },
    route: {
      ownership: 'layout',
      bendRadius: style.edgeBendRadius,
      labelAnchors: rel.labelPosition ? [rel.labelPosition] : [],
    },
    labels,
  } as const

  if (style.edgeBendRadius > 0 && rel.points.length > 2) {
    const projection = projectRoundedConnectorPath(rel.points, style.edgeBendRadius, {
      metric: 'manhattan',
      terminalClearance: classRelationshipTerminalClearance(rel, style),
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
      attributes,
    })
  }

  return marks.connector({
    id: sceneId,
    role: 'relationship',
    geometry: { kind: 'polyline', points: rel.points },
    lineStyle,
    paint,
    markers: { ...(startMarker ? { start: startMarker } : {}), mid: [], ...(endMarker ? { end: endMarker } : {}) },
    ...connectorSemantics,
    attributes,
  })
}

/** Marker-only carrier painted after class boxes. The connector remains the
 * semantic authority; this carrier exists only to prevent node surfaces
 * from occluding endpoint symbols. */
function renderRelationshipMarkerOverlay<T>(marks: DrawingFactory<T>, rel: PositionedClassRelationship, style: ResolvedRenderStyle, index: number, relationshipId: string, markerResources: readonly MarkerDescriptor[]): T | null {
  if (rel.points.length < 2) return null
  const startType = rel.markerAt === 'from' || rel.markerAt === 'both' ? (rel.fromType ?? rel.type) : undefined
  const endType = rel.markerAt === 'to' || rel.markerAt === 'both' ? (rel.toType ?? rel.type) : undefined
  const startId = startType ? getMarkerDefId(startType) : null
  const endId = endType ? getMarkerDefId(endType) : null
  if (!startId && !endId) return null
  const markerStart = markerResources.find(marker => marker.id === startId)
  const markerEnd = markerResources.find(marker => marker.id === endId)
  const fields = {
    id: `marker-overlay:${index}`,
    role: 'chrome' as const,
    owner: { id: relationshipId, role: 'relationship' as const },
    lineStyle: 'solid' as const,
    paint: { fill: 'none', stroke: style.edgeStrokeColor ?? 'var(--_line)', strokeWidth: String(style.lineWidth) },
    stroke: { opacity: 0 },
    endpoints: classRelationshipEndpoints(rel),
    relationship: { kind: 'marker-carrier' },
    markers: { ...(markerStart ? { start: markerStart } : {}), mid: [], ...(markerEnd ? { end: markerEnd } : {}) },
    hit: { pointerEvents: 'none' as const },
    attributes: { className: 'class-marker-overlay', ariaHidden: true as const },
  }
  if (style.edgeBendRadius > 0 && rel.points.length > 2) {
    const projection = projectRoundedConnectorPath(rel.points, style.edgeBendRadius, {
      metric: 'manhattan',
      terminalClearance: classRelationshipTerminalClearance(rel, style),
    })
    return marks.connector({ ...fields, geometry: projection.geometry, route: { contours: projection.contours } })
  }
  return marks.connector({ ...fields, geometry: { kind: 'polyline', points: rel.points } })
}

/** Map relationship type to its SVG marker definition ID */

/** Render relationship labels and cardinality text (supports multi-line).
 *  Returns one text mark per label/cardinality; when the relationship has
 *  none, a single empty mark keeps the historical '' part (blank line). */
function renderRelationshipLabels<T>(marks: DrawingFactory<T>, rel: PositionedClassRelationship, style: ResolvedRenderStyle, key: string): T[] {
  if ((!rel.label && !rel.fromCardinality && !rel.toCardinality) || rel.points.length < 2) {
    return [marks.documentContent({ id: `rel-labels:${key}`, role: 'chrome' }, '')]
  }

  const out: T[] = []
  const textColor = style.edgeTextColor ?? 'var(--_text-muted)'
  // Labels and cardinalities sit beside their edge and can touch it (or a
  // neighbor's) where routes bend; a page-colored halo keeps the line off the
  // glyphs.
  const paint = { fill: textColor, stroke: 'var(--bg)', strokeWidth: String(RELATION_LABEL_HALO_WIDTH), strokeLinejoin: 'round' as const, paintOrder: 'stroke' }

  // Label — prefer layout-computed position (collision-aware), fall back to midpoint
  if (rel.label) {
    const pos = classCaptionAnchor(rel)!
    const labelBlock = rel.labelBlock ?? classTextBlock(resolveLabelContent(rel.label, rel.labelContent), style, 'edge')
    const label = labelBlock.text
    out.push(
      marks.text({
        id: `rel-label:${key}`,
        role: 'label',
        text: label,
        block: labelBlock,
        x: pos.x,
        y: pos.y - RELATION_LABEL_OFFSET_Y,
        fontSize: style.edgeLabelFontSize,
        anchor: 'middle',
        paint,
      }),
    )
  }

  // From cardinality (near start)
  if (rel.fromCardinality) {
    const position = classCardinalityAnchor(rel, 'from')!
    const block = rel.fromCardinalityBlock ?? preparePixelText(resolveLabelContent(rel.fromCardinality, rel.fromCardinalityContent), { fontSize: style.edgeLabelFontSize, fontWeight: style.edgeLabelFontWeight, letterSpacing: style.edgeLetterSpacing })
    out.push(
      marks.text({
        id: `rel-card:${key}:from`,
        role: 'cardinality',
        text: rel.fromCardinality,
        block,
        x: position.x,
        y: position.y,
        fontSize: style.edgeLabelFontSize,
        anchor: 'middle',
        paint,
      }),
    )
  }

  // To cardinality (near end)
  if (rel.toCardinality) {
    const position = classCardinalityAnchor(rel, 'to')!
    const block = rel.toCardinalityBlock ?? preparePixelText(resolveLabelContent(rel.toCardinality, rel.toCardinalityContent), { fontSize: style.edgeLabelFontSize, fontWeight: style.edgeLabelFontWeight, letterSpacing: style.edgeLetterSpacing })
    out.push(
      marks.text({
        id: `rel-card:${key}:to`,
        role: 'cardinality',
        text: rel.toCardinality,
        block,
        x: position.x,
        y: position.y,
        fontSize: style.edgeLabelFontSize,
        anchor: 'middle',
        paint,
      }),
    )
  }

  return out
}

/** Halo behind relationship labels and cardinalities. */

// ============================================================================
// Utilities
// ============================================================================

// Use shared escapeXml from multiline-utils
const escapeXml = escapeXmlUtil

/**
 * Escape a string for use as an XML/HTML attribute value.
 * Escapes quotes and ampersands to prevent attribute injection.
 */

export const lowerClassScene = sceneLowering<PositionedClassDiagram>(lowerClassDrawing)
