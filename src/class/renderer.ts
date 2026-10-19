import type { ClassMember, PositionedClassDiagram, PositionedClassNamespace, PositionedClassNode, PositionedClassNote, PositionedClassRelationship, RelationshipType } from './types.ts';
import { inkOnNodeFill } from '../color-resolver.ts'
import { escapeAttr, escapeDisplayAttr } from '../multiline-utils.ts';
import { DefaultBackend } from '../scene/backend.ts'
import { projectRoundedConnectorPath } from '../scene/connector-geometry.ts'
import type { MarkAttributes, MarkerDescriptor, SceneDoc, SceneNode, TextMark } from '../scene/ir.ts'

import * as marks from '../scene/marks.ts'
import { hashId } from '../scene/seed.ts'
import { topRoundedRectPath } from '../scene/svg-writer.ts'
import { prepareDisplayText, resolveLabelContent } from '../shared/display-text.ts'
import { type PixelTextBlock, preparePixelText } from '../shared/prepared-text.ts'
import { buildAccessibilityAttrs } from '../shared/svg-a11y.ts'
import { sanitizeDisplayLines } from '../shared/text-controls.ts'
import type { ResolvedRenderStyle } from '../styles.ts';
import { diagramTitleMark, resolveRenderStyle, STROKE_WIDTHS } from '../styles.ts';
import { type DiagramColors } from '../theme.ts';
import type { RenderContext } from '../types.ts'
import { classInterfaceMarker } from './interface-occurrences.ts'
import { CLASS_STYLE_DEFAULTS, classAnnotationBlock, classMemberBlock, classTextBlock } from './layout.ts';
import { classRelationshipLineStyle } from './parser.ts'
import { decodeClassText, memberToString } from './text.ts'







import { snapshotSvgEmissionRecipe, svgValue as v, type SvgAttribute, type SvgEmissionRecipe, type SvgTextEmission } from '../scene/svg-emission.ts'






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

const attr = (name: SvgAttribute['name'], value: SvgAttribute['value']): SvgAttribute => ({ name, value })
const RECT_EMISSION = snapshotSvgEmissionRecipe({ kind: 'primitive', attributes: [
  ...(['x', 'y', 'width', 'height', 'rx', 'ry'] as const).map(field => attr(field, v.geometry(field))),
  attr('fill', v.paint('fill')), attr('stroke', v.paint('stroke')), attr('stroke-width', v.paint('strokeWidth')),
] })
const PATH_EMISSION = snapshotSvgEmissionRecipe({ kind: 'primitive', attributes: [
  attr('d', v.geometry('d')), attr('fill', v.paint('fill')), attr('stroke', v.paint('stroke')), attr('stroke-width', v.paint('strokeWidth')),
] })
const DIVIDER_EMISSION = snapshotSvgEmissionRecipe({ kind: 'primitive', attributes: [
  ...(['x1', 'y1', 'x2', 'y2'] as const).map(field => attr(field, v.geometry(field))),
  attr('stroke', v.paint('stroke')), attr('stroke-width', v.paint('strokeWidth')),
] })
const EMPTY_EMISSION = snapshotSvgEmissionRecipe({ kind: 'sequence', children: [] })
const RELATION_TEXT_EMISSION = snapshotSvgEmissionRecipe({ kind: 'text', layout: 'multiline', attributes: [
  attr('font-size', v.text('fontSize')), attr('text-anchor', v.text('anchor')), attr('font-weight', v.text('fontWeight')),
  { ...attr('letter-spacing', v.text('letterSpacing')), omit: 'zero' }, attr('fill', v.paint('fill')),
  attr('stroke', v.paint('stroke')), attr('stroke-width', v.paint('strokeWidth')), attr('stroke-linejoin', v.paint('strokeLinejoin')),
  attr('paint-order', v.paint('paintOrder')),
] })
const NAME_TEXT_EMISSION = snapshotSvgEmissionRecipe({ kind: 'text', layout: 'multiline', attributes: [
  attr('text-anchor', v.text('anchor')), attr('font-size', v.text('fontSize')), attr('font-weight', v.text('fontWeight')),
  { ...attr('letter-spacing', v.text('letterSpacing')), omit: 'zero' }, attr('fill', v.paint('fill')),
] })
const ANNOTATION_TEXT_EMISSION = snapshotSvgEmissionRecipe({ kind: 'text', layout: 'multiline', attributes: [
  attr('text-anchor', v.text('anchor')), attr('font-size', v.text('fontSize')), attr('font-weight', v.text('fontWeight')),
  attr('font-style', v.meta('italic')), attr('fill', v.paint('fill')),
] })
const MEMBER_EMISSIONS = Array.from({ length: 4 }, (_, mask) => snapshotSvgEmissionRecipe({ kind: 'text', layout: 'multiline', attributes: [
  attr('class', v.meta('mono')), attr('font-size', v.text('fontSize')), attr('font-weight', v.text('fontWeight')), attr('fill', v.paint('fill')),
  ...(mask & 1 ? [attr('font-style', v.meta('italic'))] : []),
  ...(mask & 2 ? [attr('text-decoration', v.meta('underline'))] : []),
], tailAttributes: [attr('data-id', v.identity('id')), attr('data-role', v.identity('role'))] }) as SvgTextEmission)

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
export function lowerClassScene(ctx: RenderContext<PositionedClassDiagram>): SceneDoc {
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
    { kind: 'prelude', width: diagram.width, height: diagram.height, colors, transparent, font, hasMonoFont: true,
      attributes: Object.entries(rootAttrs).map(([name, value]) => attr(name as SvgAttribute['name'], v.meta(value))),
      children: [{ kind: 'sharedStyle' }],
    },
  ))
  const markerResources = classMarkerResources(style)
  parts.push(marks.definitions({ id: 'defs', markerResources }, {
    kind: 'resources', resources: ['markers', ...(colors.shadow ? [{ kind: 'shadow' as const, colors }] : [])],
  }))

  if (diagram.accessibilityTitle) {
    parts.push(marks.documentContent({ id: 'title', role: 'chrome', nonPaint: 'accessibility' }, { kind: 'documentText', element: 'title', domId: titleId, text: diagram.accessibilityTitle }))
  }
  if (diagram.accessibilityDescription) {
    parts.push(marks.documentContent({ id: 'desc', role: 'chrome', nonPaint: 'accessibility' }, { kind: 'documentText', element: 'desc', domId: descId, text: diagram.accessibilityDescription }))
  }

  // The diagram's frontmatter title, in the band layout reserved above.
  if (diagram.title) parts.push(diagramTitleMark(diagram.title, style))

  // 0. Namespace boxes (behind everything, parent-first so children draw on
  // top). Only namespaced diagrams add marks here, so namespace-free output
  // stays byte-identical to previous releases.
  for (const ns of diagram.namespaces) {
    parts.push(renderNamespaceBox(ns, style))
  }

  // 1. Relationship lines (rendered behind boxes)
  const relOccurrence = new Map<string, number>()
  const relationshipEmissions = new Map<string, SvgEmissionRecipe>()
  for (const rel of diagram.relationships) {
    const pairKey = `${rel.from}->${rel.to}`
    const k = relOccurrence.get(pairKey) ?? 0
    relOccurrence.set(pairKey, k + 1)
    parts.push(renderRelationship(rel, style, `rel:${pairKey}#${k}`, markerResources, relationshipEmissions))
  }

  // 2. Class boxes
  // Equal lexical member profiles can serve different text/positions/IDs.
  // Share only immutable presentation data within this one lowering; retain
  // at most128 keys and never cache a rendered mark or request across calls.
  const memberEmissions = new Map<string, SvgTextEmission>()
  for (const cls of diagram.classes) {
    parts.push(renderClassBox(cls, style, options.security !== 'strict', colors, memberEmissions))
  }

  // 2b. Endpoint markers must sit above class surfaces. SVG paints a marker
  // with its connector, so the relationship pass behind boxes lets the later
  // node fill erase the marker tip/base. Repaint only the marker attachment on
  // an invisible carrier; the semantic connector and its line remain behind.
  const overlayOccurrence = new Map<string, number>()
  const overlayEmissions = new Map<string, SvgEmissionRecipe>()
  diagram.relationships.forEach((rel, index) => {
    const pairKey = `${rel.from}->${rel.to}`
    const occurrence = overlayOccurrence.get(pairKey) ?? 0
    overlayOccurrence.set(pairKey, occurrence + 1)
    const overlay = renderRelationshipMarkerOverlay(rel, style, index, `rel:${pairKey}#${occurrence}`, markerResources, overlayEmissions)
    if (overlay) parts.push(overlay)
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
  const triangle = [
    { x: 0, y: 0 },
    { x: 12, y: 5 },
    { x: 0, y: 10 },
  ]
  const diamond = [
    { x: 7, y: 1 },
    { x: 13, y: 6 },
    { x: 7, y: 11 },
    { x: 1, y: 6 },
  ]
  return [
    { id: 'cls-inherit', shape: 'triangle', size: { width: 12, height: 10 }, ref: { x: 12, y: 5 }, orient: 'auto-start-reverse', overflow: 'visible', geometry: { kind: 'polygon', points: triangle }, paint: { fill: 'var(--bg)', stroke: edgeColor, strokeWidth: '1.5' } },
    { id: 'cls-composition', shape: 'diamond', size: { width: 14, height: 12 }, viewBox: { x: 0, y: 0, width: 14, height: 12 }, ref: { x: 13, y: 6 }, orient: 'auto-start-reverse', overflow: 'hidden', geometry: { kind: 'polygon', points: diamond }, paint: { fill: edgeColor, stroke: edgeColor, strokeWidth: '1' } },
    {
      id: 'cls-aggregation',
      shape: 'diamond-open',
      size: { width: 14, height: 12 },
      viewBox: { x: 0, y: 0, width: 14, height: 12 },
      ref: { x: 13, y: 6 },
      orient: 'auto-start-reverse',
      overflow: 'hidden',
      geometry: { kind: 'polygon', points: diamond },
      paint: { fill: 'var(--bg)', stroke: edgeColor, strokeWidth: '1.5' },
    },
    {
      id: 'cls-arrow',
      shape: 'open-arrow',
      size: { width: 8, height: 6 },
      ref: { x: 8, y: 3 },
      orient: 'auto-start-reverse',
      overflow: 'visible',
      geometry: {
        kind: 'polyline',
        points: [
          { x: 0, y: 0 },
          { x: 8, y: 3 },
          { x: 0, y: 6 },
        ],
      },
      paint: { fill: 'none', stroke: edgeColor, strokeWidth: '1.5' },
    },
    classInterfaceMarker(edgeColor),
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
  const emission = { kind: 'group' as const, attributes: [attr('class', v.meta('namespace')), attr('data-id', v.meta(ns.id)),
    { ...attr('data-label', v.meta(ns.label)), display: true }, ...(ns.parentId ? [attr('data-parent-id', v.meta(ns.parentId))] : [])] }

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
    }, RECT_EMISSION),
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
    }, PATH_EMISSION),
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
    }, { kind: 'text', layout: 'multiline', attributes: [
      attr('font-size', v.text('fontSize')), attr('font-weight', v.text('fontWeight')),
      ...(style.groupFont ? [attr('font-family', v.meta(style.groupFont))] : []),
      { ...attr('letter-spacing', v.text('letterSpacing')), omit: 'zero' }, attr('fill', v.paint('fill')),
    ] }),
  })

  return marks.group({
    id: `namespace:${ns.id}`,
    role: 'group',
    emission,
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
function renderClassBox(cls: PositionedClassNode, style: ResolvedRenderStyle, includeInteraction: boolean, colors: DiagramColors, memberEmissions: Map<string, SvgTextEmission>): SceneNode {
  const { x, y, width, height, headerHeight, attrHeight } = cls
  const children: Array<{ node: SceneNode; indent: number }> = []
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
  const emission = { kind: 'group' as const, attributes: [
    attr('class', v.meta(`class-node${cls.className ? ` ${cls.className}` : ''}`)), attr('data-id', v.meta(cls.id)),
    { ...attr('data-label', v.meta(cls.label)), display: true },
    ...(cls.annotation !== undefined ? [attr('data-annotation', v.meta(cls.annotation))] : []),
    ...(cls.className ? [attr('data-class', v.meta(cls.className))] : []),
    ...(includeInteraction && cls.href ? [attr('data-href', v.meta(cls.href)), attr('role', v.meta('link')), attr('tabindex', v.meta('0'))] : []),
  ] }

  if (includeInteraction && cls.href && cls.tooltip !== undefined) {
    children.push({
      indent: 2,
      node: marks.documentContent({ id: `class:${cls.id}:tooltip`, role: 'chrome', nonPaint: 'interaction-metadata' },
        { kind: 'documentText', element: 'title', text: cls.tooltip }),
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
      paint: { fill: boxFill, stroke: boxStroke, strokeWidth: String(boxStrokeWidth) },
    }, RECT_EMISSION),
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
    }, PATH_EMISSION),
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
      },
        ANNOTATION_TEXT_EMISSION),
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
    }, NAME_TEXT_EMISSION),
  })

  // Divider line between header and attributes
  const attrTop = y + headerHeight
  children.push({ indent: 2, node: renderDivider(cls.id, 'attrs', x, attrTop, width, style) })

  // Attributes
  const memberRowH = 20
  for (let i = 0; i < cls.attributes.length; i++) {
    const member = cls.attributes[i]!
    const memberY = attrTop + 4 + i * memberRowH + memberRowH / 2
    children.push({ indent: 2, node: renderMember(member, x + style.nodePaddingX, memberY, style, `member:${cls.id}:${member.name}`, ink, memberEmissions, cls.attributeBlocks?.[i]) })
  }

  // Divider line between attributes and methods
  const methodTop = attrTop + attrHeight
  children.push({ indent: 2, node: renderDivider(cls.id, 'methods', x, methodTop, width, style) })

  // Methods
  for (let i = 0; i < cls.methods.length; i++) {
    const member = cls.methods[i]!
    const memberY = methodTop + 4 + i * memberRowH + memberRowH / 2
    children.push({ indent: 2, node: renderMember(member, x + style.nodePaddingX, memberY, style, `member:${cls.id}:${member.name}`, ink, memberEmissions, cls.methodBlocks?.[i]) })
  }

  return marks.group({
    id: `class:${cls.id}`,
    role: 'class-box',
    emission,
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
  }, DIVIDER_EMISSION)
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
function renderMember(member: ClassMember, x: number, y: number, style: ResolvedRenderStyle, sceneId: string, ink: (tone: string) => string, memberEmissions: Map<string, SvgTextEmission>, prepared?: PixelTextBlock): SceneNode {
  const block = prepared ?? classMemberBlock(member)
  const plain = memberToString(member)
  const textInk = ink(style.nodeTextColor ?? 'var(--_text-sec)')
  const profile = Number(!!member.isAbstract) | (Number(!!member.isStatic) << 1)
  const spans: NonNullable<SvgTextEmission['spans']>[number][] = []
  const nativeSpans: HighlightRun[] = []
  let offset = 0
  const span = (length: number, fill: string) => {
    nativeSpans.push({ text: plain.slice(offset, offset + length), fill })
    spans.push({ start: offset, end: offset + length, attributes: [attr('fill', v.meta(fill))] })
    offset += length
  }
  if (!member.isMethod && member.sourceText) {
    if (member.visibility && plain.startsWith(member.visibility)) span(1, ink('var(--_text-faint)'))
    span(plain.length - offset, textInk)
  } else {
    if (member.visibility) span(member.visibility.length + 1, ink('var(--_text-muted)'))
    const displayName = member.isMethod ? `${member.name}(${member.params || ''})` : member.name
    span(decodeClassText(displayName).length, textInk)
    if (member.type) { span(2, ink('var(--_text-faint)')); span(decodeClassText(member.type).length, ink('var(--_text-muted)')) }
  }
  const highlighted = highlightRuns(block, nativeSpans)
  const emissionSpans = highlighted.spans ? spans : undefined
  const key = JSON.stringify([profile, emissionSpans])
  let emission = memberEmissions.get(key)
  if (!emission) {
    emission = snapshotSvgEmissionRecipe({ ...MEMBER_EMISSIONS[profile]!, ...(emissionSpans ? { spans: emissionSpans } : {}) }) as SvgTextEmission
    if (memberEmissions.size < 128) memberEmissions.set(key, emission)
  }
  return marks.text({ id: sceneId, role: 'member', text: plain, block, x, y, fontSize: CLS_FONT.memberSize,
    anchor: 'start', paint: { fill: textInk }, ...highlighted,
    ...(member.isAbstract ? { fontStyle: 'italic' as const } : {}), ...(member.isStatic ? { textDecoration: 'underline' as const } : {}) ,
    attributes: { className: 'mono' },
  }, emission)
}

function renderClassNote(note: PositionedClassNote, style: ResolvedRenderStyle, index: number): SceneNode {
  const stroke = style.groupBorderColor ?? 'var(--_node-stroke)'
  const fill = style.groupFillColor ?? 'var(--_group-hdr)'
  const text = style.groupTextColor ?? 'var(--_text)'
  const noteBlock = note.textBlock ?? preparePixelText(resolveLabelContent(note.text, note.textContent), { fontSize: 12, fontWeight: 400 })
  const children: Array<{ node: SceneNode; indent: number }> = []
  if (note.targetX !== undefined && note.targetY !== undefined) {
    children.push({ node: marks.connector({
      id: `class-note:${index}:connector`, role: 'relationship',
      geometry: { kind: 'line', x1: note.targetX, y1: note.targetY, x2: note.noteX ?? note.x, y2: note.noteY ?? note.y + note.height / 2 },
      lineStyle: 'dashed', paint: { stroke, strokeWidth: '1', strokeDasharray: '4 3' },
      ...(note.for ? { endpoints: { from: note.for, to: `class-note:${index}`, start: { owner: { id: note.for, role: 'class-box' } }, end: { owner: { id: `class-note:${index}`, role: 'note' } } } } : {}),

      attributes: { className: 'class-note-connector' },
    }, { kind: 'primitive', attributes: [attr('class', v.meta('class-note-connector')),
      ...(['x1', 'y1', 'x2', 'y2'] as const).map(field => attr(field, v.geometry(field))),
      attr('stroke', v.paint('stroke')), attr('stroke-width', v.paint('strokeWidth')), attr('stroke-dasharray', v.paint('strokeDasharray'))] }), indent: 2 })
  }
  children.push({ node: marks.shape({
    id: `class-note:${index}:box`, role: 'note',
    geometry: { kind: 'rect', x: note.x, y: note.y, width: note.width, height: note.height, rx: 2, ry: 2 },
    paint: { fill, stroke, strokeWidth: '1' },
  }, { kind: 'primitive', attributes: [...(['x', 'y', 'width', 'height', 'rx'] as const).map(field => attr(field, v.geometry(field))),
    attr('fill', v.paint('fill')), attr('stroke', v.paint('stroke'))] }), indent: 2 })
  children.push({ node: marks.text({
    id: `class-note:${index}:label`, role: 'label', text: note.text, block: noteBlock,
    x: note.x + note.width / 2, y: note.y + note.height / 2, fontSize: 12, anchor: 'middle', paint: { fill: text },
  }, { kind: 'text', layout: 'multiline', attributes: [attr('text-anchor', v.text('anchor')), attr('font-size', v.text('fontSize')), attr('fill', v.paint('fill'))] }), indent: 2 })
  return marks.group({
    id: `class-note:${index}`, role: 'note',
    emission: { kind: 'group', attributes: [attr('class', v.meta('class-note')), attr('data-note-index', v.meta(index)),
      ...(note.for ? [attr('data-for', v.meta(note.for))] : [])] }, children,
  })
}

// ============================================================================
// Relationship rendering
// ============================================================================

function classRelationshipEndpoints(rel: PositionedClassRelationship) {
  return { from: rel.from, to: rel.to, start: { owner: { id: rel.from, role: 'class-box' as const } }, end: { owner: { id: rel.to, role: 'class-box' as const } } }
}

/**
 * Render a relationship line with appropriate markers and semantic attributes.
 * Includes data-* attributes for programmatic inspection.
 */
function renderRelationship(rel: PositionedClassRelationship, style: ResolvedRenderStyle, sceneId: string, markerResources: readonly MarkerDescriptor[], emissions: Map<string, SvgEmissionRecipe>): SceneNode {
  const labels = rel.label ? [{
    text: rel.label,
    textContent: { value: rel.label, prepared: prepareDisplayText(resolveLabelContent(rel.label, rel.labelContent)) },
    ...(rel.labelPosition ? { anchor: rel.labelPosition } : {}),
  }] : []
  if (rel.points.length < 2) {
    // Degenerate relationship — draws nothing (an invisible connector writes '').
    return marks.connector({
      id: sceneId,
      role: 'relationship',
      geometry: { kind: 'polyline', points: rel.points },
      lineStyle: 'invisible',
      paint: {},
      attributes,
    endpoints: classRelationshipEndpoints(rel),
      relationship: { kind: rel.type },
      labels,
    }, EMPTY_EMISSION)
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
  // Preserve the original caller-visible condition/value reads before paint
  // and rounded geometry. Only descriptor capture remains at the constructor.
  const markerAt = rel.markerAt
  const hasLabel = !!rel.label
  const hasFromCardinality = !!rel.fromCardinality
  const fromCardinality = hasFromCardinality ? rel.fromCardinality : undefined
  const hasToCardinality = !!rel.toCardinality
  const toCardinality = hasToCardinality ? rel.toCardinality : undefined
  const emission = (field: 'd' | 'points'): SvgEmissionRecipe => {
    // Bound retained key text; larger or arbitrary runtime values still take
    // the unchanged full capture path, without invoking a user toJSON.
    const key = (markerAt === 'none' || markerAt === 'from' || markerAt === 'to' || markerAt === 'both')
      && (fromCardinality === undefined || typeof fromCardinality === 'string' && fromCardinality.length <= 256)
      && (toCardinality === undefined || typeof toCardinality === 'string' && toCardinality.length <= 256)
      ? JSON.stringify([field, isDashed, !!startMarker, !!endMarker, markerAt, hasLabel,
        hasFromCardinality, fromCardinality, hasToCardinality, toCardinality])
      : undefined
    const prior = key === undefined ? undefined : emissions.get(key)
    if (prior) return prior
    const dataAttrs: SvgAttribute[] = [
      attr('class', v.meta('class-relationship')), attr('data-from', v.identity('from')), attr('data-to', v.identity('to')),
      attr('data-type', v.connector('relationshipKind')), attr('data-relation-type', v.connector('relationshipKind')),
      attr('data-marker-at', v.meta(markerAt)),
      ...(hasLabel ? [{ ...attr('data-label', { source: 'connectorLabel', index: 0 }), display: true }] : []),
      ...(hasFromCardinality ? [attr('data-from-cardinality', v.meta(fromCardinality!))] : []),
      ...(hasToCardinality ? [attr('data-to-cardinality', v.meta(toCardinality!))] : []),
    ]
    const captured = snapshotSvgEmissionRecipe({ kind: 'primitive', attributes: [
      ...dataAttrs, attr(field, v.geometry(field)), attr('fill', v.paint('fill')), attr('stroke', v.paint('stroke')),
      attr('stroke-width', v.paint('strokeWidth')), ...(isDashed ? [attr('stroke-dasharray', v.paint('strokeDasharray'))] : []),
      ...(startMarker ? [attr('marker-start', { source: 'marker', position: 'start' })] : []),
      ...(endMarker ? [attr('marker-end', { source: 'marker', position: 'end' })] : []),
    ] })
    if (key !== undefined && emissions.size < 128) emissions.set(key, captured)
    return captured
  }

  const strokeColor = style.edgeStrokeColor ?? 'var(--_line)'
  const paint = {
    stroke: strokeColor,
    strokeWidth: String(style.lineWidth),
    ...(isDashed ? { strokeDasharray: '6 4' } : {}),
  }
  const connectorSemantics = {
    endpoints: classRelationshipEndpoints(rel),
    relationship: { kind: rel.type },
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
    }, emission('d'))
  }

  return marks.connector({
    id: sceneId,
    role: 'relationship',
    geometry: { kind: 'polyline', points: rel.points },
    lineStyle,
    paint,
    markers: { ...(startMarker ? { start: startMarker } : {}), mid: [], ...(endMarker ? { end: endMarker } : {}) },
    ...connectorSemantics,
  }, emission('points'))
}

/** Marker-only carrier painted after class boxes. The connector remains the
 * semantic authority; this carrier exists only to prevent node surfaces
 * from occluding endpoint symbols. */
function renderRelationshipMarkerOverlay(
  rel: PositionedClassRelationship,
  style: ResolvedRenderStyle,
  index: number,
  relationshipId: string,
  resources: readonly MarkerDescriptor[],
  emissions: Map<string, SvgEmissionRecipe>,
): SceneNode | null {
  if (rel.points.length < 2) return null
  const startType = rel.markerAt === 'from' || rel.markerAt === 'both' ? (rel.fromType ?? rel.type) : undefined
  const endType = rel.markerAt === 'to' || rel.markerAt === 'both' ? (rel.toType ?? rel.type) : undefined
  const startId = startType ? getMarkerDefId(startType) : null
  const endId = endType ? getMarkerDefId(endType) : null
  if (!startId && !endId) return null
  const markerStart = resources.find(marker => marker.id === startId)
  const markerEnd = resources.find(marker => marker.id === endId)
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
  const emission = (field: 'd' | 'points'): SvgEmissionRecipe => {
    const key = JSON.stringify([field, !!markerStart, !!markerEnd])
    const prior = emissions.get(key)
    if (prior) return prior
    const captured = snapshotSvgEmissionRecipe({ kind: 'primitive', attributes: [
      attr('class', v.meta('class-marker-overlay')), attr(field, v.geometry(field)), attr('fill', v.paint('fill')),
      attr('stroke', v.paint('stroke')), attr('stroke-width', v.paint('strokeWidth')), attr('stroke-opacity', v.connector('opacity')),
      ...(markerStart ? [attr('marker-start', { source: 'marker', position: 'start' })] : []),
      ...(markerEnd ? [attr('marker-end', { source: 'marker', position: 'end' })] : []),
      attr('pointer-events', v.meta('none')), attr('aria-hidden', v.meta('true')),
    ] })
    if (emissions.size < 16) emissions.set(key, captured)
    return captured
  }
  if (style.edgeBendRadius > 0 && rel.points.length > 2) {
    const projection = projectRoundedConnectorPath(rel.points, style.edgeBendRadius, {
      metric: 'manhattan',
      precision: 3,
    })
    return marks.connector({ ...fields, geometry: projection.geometry, route: { contours: projection.contours } },
      emission('d'))
  }
  return marks.connector({ ...fields, geometry: { kind: 'polyline', points: rel.points } },
    emission('points'))
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
    return [marks.documentContent({ id: `rel-labels:${key}`, role: 'chrome' }, EMPTY_EMISSION)]
  }

  const out: SceneNode[] = []
  const textColor = style.edgeTextColor ?? 'var(--_text-muted)'
  // Labels and cardinalities sit beside their edge and can touch it (or a
  // neighbor's) where routes bend; a page-colored halo keeps the line off the
  // glyphs.
  const paint = { fill: textColor, stroke: 'var(--bg)', strokeWidth: String(RELATION_LABEL_HALO_WIDTH), strokeLinejoin: 'round' as const, paintOrder: 'stroke' }

  // Label — prefer layout-computed position (collision-aware), fall back to midpoint
  if (rel.label) {
    const pos = rel.labelPosition ?? midpoint(rel.points)
    const labelBlock = rel.labelBlock ?? classTextBlock(resolveLabelContent(rel.label, rel.labelContent), style, 'edge')
    const label = labelBlock.text
    out.push(marks.text({
      id: `rel-label:${key}`,
      role: 'label',
      text: label, block: labelBlock,
      x: pos.x,
      y: pos.y - 8,
      fontSize: style.edgeLabelFontSize,
      anchor: 'middle',
      paint,
    }, RELATION_TEXT_EMISSION))
  }

  // From cardinality (near start)
  if (rel.fromCardinality) {
    const p = rel.points[0]!
    const next = rel.points[1]!
    const offset = cardinalityOffset(p, next)
    const position = rel.fromCardinalityPosition ?? { x: p.x + offset.x, y: p.y + offset.y }
    const block = rel.fromCardinalityBlock ?? preparePixelText(resolveLabelContent(rel.fromCardinality, rel.fromCardinalityContent), { fontSize: style.edgeLabelFontSize, fontWeight: style.edgeLabelFontWeight, letterSpacing: style.edgeLetterSpacing })
    out.push(marks.text({
      id: `rel-card:${key}:from`,
      role: 'cardinality',
      text: rel.fromCardinality, block,
      x: position.x,
      y: position.y,
      fontSize: style.edgeLabelFontSize,
      anchor: 'middle',
      paint,
    }, RELATION_TEXT_EMISSION))
  }

  // To cardinality (near end)
  if (rel.toCardinality) {
    const p = rel.points[rel.points.length - 1]!
    const prev = rel.points[rel.points.length - 2]!
    const offset = cardinalityOffset(p, prev)
    const position = rel.toCardinalityPosition ?? { x: p.x + offset.x, y: p.y + offset.y }
    const block = rel.toCardinalityBlock ?? preparePixelText(resolveLabelContent(rel.toCardinality, rel.toCardinalityContent), { fontSize: style.edgeLabelFontSize, fontWeight: style.edgeLabelFontWeight, letterSpacing: style.edgeLetterSpacing })
    out.push(marks.text({
      id: `rel-card:${key}:to`,
      role: 'cardinality',
      text: rel.toCardinality, block,
      x: position.x,
      y: position.y,
      fontSize: style.edgeLabelFontSize,
      anchor: 'middle',
      paint,
    }, RELATION_TEXT_EMISSION))
  }

  return out
}

/** Halo behind relationship labels and cardinalities. */
const RELATION_LABEL_HALO_WIDTH = 3

/** Get the midpoint of a point array */
function midpoint(points: Array<{ x: number; y: number }>): { x: number; y: number } {
  if (points.length === 0) return { x: 0, y: 0 }
  const mid = Math.floor(points.length / 2)
  return points[mid]!
}

/** Calculate offset for cardinality label perpendicular to edge direction */
function cardinalityOffset(from: { x: number; y: number }, to: { x: number; y: number }): { x: number; y: number } {
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

type HighlightRun = NonNullable<TextMark['spans']>[number]
function highlightRuns(block: PixelTextBlock, spans: readonly HighlightRun[]): Pick<TextMark, 'spans'> {
  const line = block.lineBlocks.length === 1 ? block.lineBlocks[0]! : undefined
  const plain = !!line && !line.fragments && block.letterSpacing === 0 && /^[\x20-\x7e]*$/.test(block.text) && line.runs.every(run => !run.bold && !run.italic && !run.underline && !run.strikethrough) && spans.map(span => span.text).join('') === block.text
  return plain ? { spans } : {}
}
