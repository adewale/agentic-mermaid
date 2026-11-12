import { sceneLowering, type DrawingFactory, type DrawingDocument } from '../scene/drawing.ts'
import type { PositionedSequenceDiagram, PositionedActor, Lifeline, PositionedMessage, Activation, PositionedBlock, PositionedBlockHeader, PositionedNote, PositionedBoxGroup, LifelineCross, SequenceBounds } from './types.ts'
import { boxColorToHex } from './colors.ts'
import { contrastTextColor, toneOnFill } from '../color-resolver.ts'
import { compositeCssColor, legibleInk, toHex, tryParseCssColor, wcagContrastRatio } from '../shared/color-math.ts'
import type { RenderContext } from '../types.ts'
import { svgOpenTag, buildStyleBlock, buildShadowDefs, resolvedColorValue, type DiagramColors } from '../theme.ts'
import { FONT_SIZES, FONT_WEIGHTS, STROKE_WIDTHS, ARROW_HEAD, TEXT_BASELINE_SHIFT, applyTextTransform, resolveRenderStyle, diagramTitleFields } from '../styles.ts'
import type { RenderStyleDefaults, ResolvedRenderStyle } from '../styles.ts'
import { SEQUENCE_STYLE_DEFAULTS } from './layout.ts'
import { buildAccessibilityAttrs } from '../shared/svg-a11y.ts'
import { escapeAttr, escapeDisplayAttr, escapeXml } from '../multiline-utils.ts'
import type { Geometry, MarkerDescriptor } from '../scene/ir.ts'
import { hashId } from '../scene/seed.ts'
import { DefaultBackend } from '../scene/backend.ts'
import { serializeMarkerResources } from '../scene/marker-resources.ts'
import { resolveRoleStyle, type InternalStyleFace } from '../scene/style-registry.ts'
import { messageLabelOcclusion, type VisibleSpan } from './label-occlusion.ts'
import { semanticChildId } from '../scene/identity.ts'
import { arrowheadDirection } from '../shared/relation-direction.ts'


// ============================================================================
// Sequence diagram SVG renderer
//
// Renders a positioned sequence diagram to SVG string.
// The diagram is first lowered to a SceneGraph (SPEC §3.1): every visual mark
// becomes a scene node carrying semantic fields (role, geometry, paint,
// channels, stable id). renderSequenceSvg() uses DefaultBackend serialization of that scene.
//
// All colors use CSS custom properties (var(--_xxx)) from the theme system.
//
// Render order (back to front):
//   0. Box group frames (`box … end` backgrounds + titles)
//   1. Block backgrounds (loop/alt/opt)
//   2. Lifelines (dashed vertical lines)
//   3. Activation boxes
//   4. Messages (arrows with labels)
//   5. Notes (then destroy crosses)
//   6. Actor boxes (at top)
// ============================================================================

/**
 * Render a positioned sequence diagram as an SVG string.
 *
 * @param colors - DiagramColors with bg/fg and optional enrichment variables.
 * @param transparent - If true, renders with transparent background.
 */
export function renderSequenceSvg(
  ctx: RenderContext<PositionedSequenceDiagram>,
): string {
  return DefaultBackend.render(lowerSequenceScene(ctx), { seed: 0 })
}

/**
 * Draw a positioned sequence diagram in canonical mark order.
 */
export function lowerSequenceDrawing<T>(
  marks: DrawingFactory<T>,
  ctx: RenderContext<PositionedSequenceDiagram>,
): DrawingDocument<T> {
  const { positioned: diagram, colors, resolved } = ctx
  const options = resolved.renderOptions
  const font = colors.font ?? 'Inter'
  const transparent = options.transparent ?? false
  const parts: T[] = []
  const style = resolveRenderStyle(options, SEQUENCE_STYLE_DEFAULTS, resolved.styleFace)
  const uid = `seq-${hashId(diagram.width, diagram.height, diagram.actors.length, diagram.messages.length)}`
  const titleId = `${uid}-title`
  const descId = `${uid}-desc`
  const rootAttrs = buildAccessibilityAttrs(diagram.accessibilityTitle, diagram.accessibilityDescription, titleId, descId)

  // SVG root with CSS variables + style block + defs
  parts.push(marks.documentOpen(
    {
      id: 'prelude',
      width: diagram.width,
      height: diagram.height,
      colors,
      transparent,
      font,
      hasMonoFont: false,
    },
    svgOpenTag(diagram.width, diagram.height, colors, transparent, rootAttrs) + '\n' +
    buildStyleBlock(font, false, colors.shadow, colors.embedFontImport),
  ))
  const defsParts: string[] = []
  defsParts.push('<defs>')

  // Arrow marker definitions
  const markerResources = sequenceMarkerResources(style)
  defsParts.push(serializeMarkerResources(markerResources))
  const shadowDefs = buildShadowDefs(colors)
  if (shadowDefs) defsParts.push(shadowDefs)
  defsParts.push('</defs>')
  parts.push(marks.definitions({ id: 'defs', markerResources }, defsParts.join('\n')))

  if (diagram.accessibilityTitle) {
    parts.push(marks.documentContent({ id: 'a11y-title', role: 'chrome', nonPaint: 'accessibility' },
      `<title id="${titleId}">${escapeXml(diagram.accessibilityTitle)}</title>`))
  }
  if (diagram.accessibilityDescription) {
    parts.push(marks.documentContent({ id: 'a11y-desc', role: 'chrome', nonPaint: 'accessibility' },
      `<desc id="${descId}">${escapeXml(diagram.accessibilityDescription)}</desc>`))
  }

  // Completed nested blocks arrive inner-first; with a rect among them, paint
  // enclosing backgrounds first so translucent rects remain visible.
  const hasRect = diagram.blocks.some(block => block.type === 'rect')
  const backgroundOrder = hasRect
    ? [...diagram.blocks].reverse().sort((a, b) => b.width * b.height - a.width * a.height)
    : diagram.blocks
  const inkAt = surfaceInk(diagram.boxes, backgroundOrder, style, colors)

  // The diagram's title, in the band layout reserved above the participants.
  if (diagram.title) parts.push(marks.text(diagramTitleFields(diagram.title, style)))

  // 0. Box group frames (behind everything, including block backgrounds)
  const boxOccurrence = new Map<string, number>()
  for (const box of diagram.boxes) {
    const boxKey = box.label ?? ''
    const k = boxOccurrence.get(boxKey) ?? 0
    boxOccurrence.set(boxKey, k + 1)
    parts.push(renderBoxGroup(marks, box, style, `box:${boxKey}#${k}`))
  }

  // 1. Block backgrounds, in backgroundOrder.
  const blockOccurrence = new Map<string, number>()
  const blockSceneIds = new Map<PositionedBlock, string>()
  for (const block of diagram.blocks) {
    const k = blockOccurrence.get(block.type) ?? 0
    blockOccurrence.set(block.type, k + 1)
    blockSceneIds.set(block, block.id ?? `block:${block.type}#${k}`)
  }
  for (const block of backgroundOrder) {
    parts.push(renderBlock(marks, block, style, blockSceneIds.get(block)!, hasRect ? 'background' : 'all'))
  }
  // A nested opaque rect must not overpaint its parent's frame or else/and
  // divider. Keep decorations above every block fill, but below lifelines.
  // Keep the old single-group lowering for diagrams without rects so their
  // SVG bytes and Scene grouping stay unchanged.
  if (hasRect) {
    for (const block of backgroundOrder) {
      if (block.type !== 'rect') parts.push(renderBlock(marks, block, style, blockSceneIds.get(block)!, 'frame'))
    }
    for (const block of diagram.blocks) {
      if (block.dividers.length > 0) parts.push(renderBlock(marks, block, style, blockSceneIds.get(block)!, 'dividers'))
    }
  }

  // 2. Lifelines (dashed vertical lines from actor to bottom)
  const visibleSpans = messageLabelOcclusion(diagram.messages)
  const externalActors = new Set(diagram.actors.filter(actor => actor.external).map(actor => actor.id))
  for (const lifeline of diagram.lifelines) {
    if (externalActors.has(lifeline.actorId)) continue
    const width = Math.max(0.75, style.lineWidth * 0.75)
    parts.push(renderLifeline(marks, lifeline, style, visibleSpans({
      x: lifeline.x - width / 2, y: lifeline.topY,
      width, height: lifeline.bottomY - lifeline.topY,
    }, 'x')))
  }

  // 3. Activation boxes
  const activationOccurrence = new Map<string, number>()
  for (const activation of diagram.activations) {
    const k = activationOccurrence.get(activation.actorId) ?? 0
    activationOccurrence.set(activation.actorId, k + 1)
    parts.push(renderActivation(marks, activation, style, `activation:${activation.actorId}#${k}`, visibleSpans({
      x: activation.x - STROKE_WIDTHS.innerBox / 2, y: activation.topY,
      width: activation.width + STROKE_WIDTHS.innerBox, height: activation.bottomY - activation.topY,
    }, 'y')))
  }

  // 3a. Paint fragment header tabs above lifelines and activation bars. The
  // outer fragment and dividers remain behind lifelines, while the opaque tab
  // protects its label from a dashed actor line or an activation bar passing
  // through the text.
  const blockHeaderOccurrence = new Map<string, number>()
  for (const block of diagram.blocks) {
    const k = blockHeaderOccurrence.get(block.type) ?? 0
    blockHeaderOccurrence.set(block.type, k + 1)
    if (block.type !== 'rect' && block.header) parts.push(renderBlockHeader(marks, block.header, style, blockSceneIds.get(block)!))
  }

  // 3b. Fragment section labels, above the lifelines and activation bars that
  //     cross a fragment's left edge.
  const dividerLabelOccurrence = new Map<string, number>()
  for (const block of diagram.blocks) {
    const k = dividerLabelOccurrence.get(block.type) ?? 0
    dividerLabelOccurrence.set(block.type, k + 1)
    if (block.dividers.some(divider => divider.label)) parts.push(renderBlockDividerLabels(marks, block, style, blockSceneIds.get(block)!, inkAt))
  }

  // 4. Messages (horizontal arrows with labels)
  const messageOccurrence = new Map<string, number>()
  for (const message of diagram.messages) {
    const pairKey = `${message.from}->${message.to}`
    const k = messageOccurrence.get(pairKey) ?? 0
    messageOccurrence.set(pairKey, k + 1)
    parts.push(renderMessage(marks, message, style, message.id ?? `message:${pairKey}#${k}`, inkAt, markerResources))
  }

  // 5. Notes
  const noteOccurrence = new Map<string, number>()
  for (const note of diagram.notes) {
    const noteKey = `${(note.actors ?? []).join(',')}@${note.position ?? 'over'}`
    const k = noteOccurrence.get(noteKey) ?? 0
    noteOccurrence.set(noteKey, k + 1)
    parts.push(renderNote(marks, note, style, colors, note.id ?? `note:${noteKey}#${k}`))
  }

  // 5b. Destroy crosses (X where a destroyed lifeline ends) — drawn above
  //     messages/lifelines so the cross stays legible.
  for (const cross of diagram.destructions) {
    parts.push(renderDestroyCross(marks, cross, style))
  }

  // 6. Actor boxes at top (rendered last so they're on top)
  for (const actor of diagram.actors) {
    if (actor.external) continue
    parts.push(renderActor(marks, actor, style, colors, resolved.styleFace, options.security !== 'strict', inkAt))
  }

  parts.push(marks.documentClose())

  return { family: 'sequence', width: diagram.width, height: diagram.height, colors, transparent, parts }
}

/** Paint for text centered at a point. Text over an authored `box` color is
 * drawn on that color, not the page: its ink must read on the box, and a halo
 * of the box color carries that surface under any glyphs that overhang the
 * box's edge (a fragment wider than the box starts its labels outside it). */
interface SurfaceText { ink: string; halo?: string }
/** The box a label's glyphs cover, centered on (x, y). */
interface TextArea { x: number; y: number; width: number; height: number }
type SurfaceInk = (area: TextArea, ink: string) => SurfaceText

/** Paint for a SurfaceText halo, or nothing when the text needs none. */
function haloPaint(paint: SurfaceText): { stroke?: string; strokeWidth?: string; strokeLinejoin?: 'round'; paintOrder?: string } {
  return paint.halo ? { stroke: paint.halo, strokeWidth: '3', strokeLinejoin: 'round', paintOrder: 'stroke' } : {}
}

/** Center-based area from a top-left `SequenceBounds` box. */
function areaFromBounds(bounds: SequenceBounds): TextArea {
  return {
    x: bounds.x + bounds.width / 2,
    y: bounds.y + bounds.height / 2,
    width: bounds.width,
    height: bounds.height,
  }
}

function surfaceInk(
  boxes: readonly PositionedBoxGroup[],
  blocksInPaintOrder: readonly PositionedBlock[],
  style: ResolvedRenderStyle,
  colors: DiagramColors,
): SurfaceInk {
  // Surfaces in paint order, each as the color a reader sees: authored box
  // colors, then block backgrounds (rects, and fragments a look fills),
  // composited over whatever lies beneath them.
  interface Surface { x: number; y: number; width: number; height: number; hex: string; authored: boolean }
  const contains = (surface: Surface, x: number, y: number) =>
    x >= surface.x && x <= surface.x + surface.width && y >= surface.y && y <= surface.y + surface.height
  const surfaces: Surface[] = boxes.flatMap(box => {
    const hex = box.color && box.color.toLowerCase() !== 'transparent' ? boxColorToHex(box.color) : undefined
    return hex ? [{ x: box.x, y: box.y, width: box.width, height: box.height, hex, authored: true }] : []
  })
  const page = resolvedColorValue('var(--bg)', colors) ?? '#ffffff'
  for (const block of blocksInPaintOrder) {
    const paint = blockBackground(block, style)
    const concrete = paint === undefined ? undefined : resolvedColorValue(paint, colors) ?? paint
    const parsed = concrete === undefined ? null : tryParseCssColor(concrete)
    if (!parsed || parsed[3] === 0) continue
    const cx = block.x + block.width / 2
    const cy = block.y + block.height / 2
    const beneath = surfaces.findLast(surface => contains(surface, cx, cy))?.hex ?? page
    const rgb = compositeCssColor(concrete!, beneath)
    if (!rgb) continue
    // A rect is a colored band whose edge a label can overhang, like a box.
    surfaces.push({ x: block.x, y: block.y, width: block.width, height: block.height, hex: toHex(...rgb), authored: block.type === 'rect' })
  }
  const overlaps = (surface: Surface, area: TextArea) =>
    area.x - area.width / 2 < surface.x + surface.width && area.x + area.width / 2 > surface.x
    && area.y - area.height / 2 < surface.y + surface.height && area.y + area.height / 2 > surface.y
  const within = (surface: Surface, area: TextArea) =>
    contains(surface, area.x - area.width / 2, area.y - area.height / 2) && contains(surface, area.x + area.width / 2, area.y + area.height / 2)
  return (area, ink) => {
    const index = surfaces.findLastIndex(surface => contains(surface, area.x, area.y))
    const surface = surfaces[index]
    // Glyphs that reach past the surface under the label's center onto
    // another one are carried by a halo of the center's surface.
    const straddles = (surface !== undefined && !within(surface, area))
      || surfaces.some((other, otherIndex) => otherIndex > index && other.hex !== surface?.hex && overlaps(other, area))
    if (!surface) return straddles ? { ink, halo: 'var(--bg)' } : { ink }
    const resolved = resolvedColorValue(ink, colors)
    const legible = resolved ? legibleInk(resolved, surface.hex) : contrastTextColor(surface.hex) ?? ink
    // An authored box can differ enough from the page that a glyph
    // overhanging its edge would be lost, so its text always carries it.
    return surface.authored || straddles ? { ink: legible, halo: surface.hex } : { ink: legible }
  }
}

// ============================================================================
// Arrow marker definitions
// ============================================================================

function sequenceMarkerResources(style: ResolvedRenderStyle): readonly MarkerDescriptor[] {
  const w = ARROW_HEAD.width
  const h = ARROW_HEAD.height
  const edgeColor = style.edgeStrokeColor ?? 'var(--_arrow)'
  const base = { size: { width: w, height: h }, orient: 'auto-start-reverse' as const }
  const arrowPoints = [{ x: 0, y: 0 }, { x: w, y: h / 2 }, { x: 0, y: h }]
  return [
    { ...base, id: 'seq-arrow', shape: 'arrow', ref: { x: w, y: h / 2 }, geometry: { kind: 'polygon', points: arrowPoints }, paint: { fill: edgeColor } },
    { ...base, id: 'seq-arrow-open', shape: 'open-arrow', ref: { x: w, y: h / 2 }, geometry: { kind: 'polyline', points: arrowPoints }, paint: { fill: 'none', stroke: edgeColor, strokeWidth: '1' } },
    { ...base, id: 'seq-arrow-cross', shape: 'cross', ref: { x: w / 2, y: h / 2 }, orient: 'auto', geometry: { kind: 'path', d: `M1 1 L${w - 1} ${h - 1} M1 ${h - 1} L${w - 1} 1` }, paint: { fill: 'none', stroke: edgeColor, strokeWidth: '1.5' } },
    { ...base, id: 'seq-arrow-half-top', shape: 'arrow', ref: { x: w, y: h / 2 }, geometry: { kind: 'polygon', points: [{ x: 0, y: 0 }, { x: w, y: h / 2 }, { x: 0, y: h / 2 }] }, paint: { fill: edgeColor } },
    { ...base, id: 'seq-arrow-half-bottom', shape: 'arrow', ref: { x: w, y: h / 2 }, geometry: { kind: 'polygon', points: [{ x: 0, y: h / 2 }, { x: w, y: h / 2 }, { x: 0, y: h }] }, paint: { fill: edgeColor } },
    { ...base, id: 'seq-arrow-stick-top', shape: 'open-arrow', ref: { x: w, y: h / 2 }, geometry: { kind: 'path', d: `M0 0 L${w} ${h / 2}` }, paint: { fill: 'none', stroke: edgeColor, strokeWidth: '1.5' } },
    { ...base, id: 'seq-arrow-stick-bottom', shape: 'open-arrow', ref: { x: w, y: h / 2 }, geometry: { kind: 'path', d: `M0 ${h} L${w} ${h / 2}` }, paint: { fill: 'none', stroke: edgeColor, strokeWidth: '1.5' } },
  ] satisfies readonly MarkerDescriptor[]
}

function sequenceMarkerFor(markerResources: readonly MarkerDescriptor[], head: PositionedMessage['endHead']): MarkerDescriptor | undefined {
  if (head === 'none') return undefined
  const id = head === 'filled' ? 'seq-arrow'
    : head === 'cross' ? 'seq-arrow-cross'
      : head === 'half-top' ? 'seq-arrow-half-top'
        : head === 'half-bottom' ? 'seq-arrow-half-bottom'
          : head === 'stick-top' ? 'seq-arrow-stick-top'
            : head === 'stick-bottom' ? 'seq-arrow-stick-bottom'
          : 'seq-arrow-open'
  return markerResources.find(marker => marker.id === id)
}

// ============================================================================
// Component renderers
// ============================================================================

/**
 * Render an actor box (participant = rectangle, actor = stick figure).
 * Wrapped in <g class="actor"> with semantic data attributes.
 */
function renderActor<T>(
  marks: DrawingFactory<T>,
  actor: PositionedActor,
  style: ResolvedRenderStyle,
  colors: DiagramColors,
  styleFace: Readonly<InternalStyleFace> | undefined,
  includeInteraction: boolean,
  inkAt: SurfaceInk,
): T {
  const { id, x, y, width, height, label, type } = actor
  const children: Array<{ node: T; indent: number }> = []
  const roleStyle = resolveRoleStyle(styleFace, 'actor', { category: id }, { includeFallback: false })
  const fontSize = roleStyle?.fontSize ?? style.nodeLabelFontSize
  const fontWeight = roleStyle?.fontWeight ?? style.nodeLabelFontWeight
  const letterSpacing = roleStyle?.letterSpacing ?? style.nodeLetterSpacing
  const textTransform = roleStyle?.textTransform ?? style.nodeTextTransform
  const lineWidth = roleStyle?.lineWidth ?? style.nodeLineWidth
  const rawFillColor = roleStyle?.fillColor ?? style.nodeFillColor ?? 'var(--_node-fill)'
  const rawBorderColor = roleStyle?.borderColor ?? style.nodeBorderColor ?? 'var(--_node-stroke)'
  const rawTextColor = roleStyle?.textColor ?? style.nodeTextColor ?? 'var(--_text)'
  // A participant's label sits on its box, whose fill a custom surface can put
  // far from the page the theme tones are repaired against.
  const boxTextColor = roleStyle?.textColor ?? style.nodeTextColor ?? toneOnFill('var(--_text)', rawFillColor, colors)

  // Semantic wrapper with actor metadata
  const menu = includeInteraction && actor.links
    ? ` data-links="${escapeAttr(JSON.stringify(actor.links))}" role="link" tabindex="0"`
    : ''
  const open =
    `<g class="actor" data-id="${escapeAttr(id)}" data-label="${escapeDisplayAttr(label)}" data-type="${type}"${menu}>`

  const { text: displayLabel, x: labelX, y: labelY, bounds: labelBounds } = actor.labelPosition
  // Icon participants label below the glyph, on whatever the column shows.
  const below = inkAt(areaFromBounds(labelBounds), rawTextColor)

  if (type === 'actor') {
    // Circle-person icon: outer circle + head circle + shoulders arc.
    // Defined in a 24×24 coordinate space, scaled to 90% of the actor box height
    // and centered both horizontally and vertically within the box.
    // Stroke width is inverse-scaled so the visual thickness matches STROKE_WIDTHS.outerBox.
    const s = (height / 24) * 0.9
    const tx = x - 12 * s            // center icon horizontally on actor.x
    const ty = y + (height - 24 * s) / 2  // center icon vertically in actor box
    const sw = lineWidth / s  // compensate for scale transform

    children.push({
      indent: 2,
      node: marks.pathArtwork({ id: `actor:${id}:icon`, owner: { id, role: 'actor' }, channels: { category: id },
        open: `<g transform="translate(${tx},${ty}) scale(${s})">`,
        transform: { kind: 'matrix', a: s, b: 0, c: 0, d: s, e: tx, f: ty },
        paint: { fill: 'none', stroke: roleStyle?.borderColor ?? style.edgeStrokeColor ?? 'var(--_line)', strokeWidth: String(sw) },
        join: '\n', indent: 2,
        paths: [
          'M21 12C21 16.9706 16.9706 21 12 21C7.02944 21 3 16.9706 3 12C3 7.02944 7.02944 3 12 3C16.9706 3 21 7.02944 21 12Z',
          'M15 10C15 11.6569 13.6569 13 12 13C10.3431 13 9 11.6569 9 10C9 8.34315 10.3431 7 12 7C13.6569 7 15 8.34315 15 10Z',
          'M5.62842 18.3563C7.08963 17.0398 9.39997 16 12 16C14.6 16 16.9104 17.0398 18.3716 18.3563',
        ],
      }),
    })
    // Label below the icon (supports multi-line)
    children.push({
      indent: 2,
      node: marks.text({
        id: `actor:${id}:label`,
        role: 'label',
        text: displayLabel,
        block: actor.labelPosition.block,
        x: labelX,
        y: labelY,
        fontSize,
        fontWeight,
        letterSpacing,
        anchor: 'middle',
        paint: { fill: below.ink, ...haloPaint(below) },
        channels: { category: id },
      }),
    })
  } else if (type !== 'participant') {
    const left = x - width / 2
    const top = y + 2
    const w = width
    const h = Math.max(24, height - 4)
    const glyphs: T[] = []
    const owner = { id, role: 'actor' as const }
    const paint = { fill: rawFillColor, stroke: roleStyle?.borderColor ?? style.edgeStrokeColor ?? 'var(--_line)', strokeWidth: String(lineWidth) }
    // Each glyph piece carries the paint; the group holds the hook classes.
    const add = (geometry: Geometry): void => {
      glyphs.push(marks.shape({ id: semanticChildId(`actor:${id}:icon`, 'part', glyphs.length), role: 'icon', owner, geometry, paint }))
    }
    const path = (d: string): void => add({ kind: 'path', d })
    const circle = (cx: number, cy: number, r: number): void => add({ kind: 'circle', cx, cy, r })
    const line = (x1: number, y1: number, x2: number, y2: number): void => add({ kind: 'line', x1, y1, x2, y2 })
    const rect = (x: number, y: number, width: number, height: number, rx?: number): void => add({ kind: 'rect', x, y, width, height, ...(rx === undefined ? {} : { rx }) })
    if (type === 'database') {
      add({ kind: 'ellipse', cx: x, cy: top + 5, rx: w / 2, ry: 5 })
      path(`M${left} ${top + 5}V${top + h - 5}A${w / 2} 5 0 0 0 ${left + w} ${top + h - 5}V${top + 5}`)
      add({ kind: 'ellipse', cx: x, cy: top + h - 5, rx: w / 2, ry: 5 })
    } else if (type === 'collections') {
      rect(left + 6, top, w - 6, h - 6)
      rect(left, top + 6, w - 6, h - 6)
    } else if (type === 'queue') {
      rect(left, top, w, h, h / 2)
      line(left + 8, top + h / 2, left + w - 8, top + h / 2)
    } else if (type === 'entity') {
      circle(x, top + h / 2 - 3, Math.min(w, h) / 2 - 3)
      line(left + 5, top + h, left + w - 5, top + h)
    } else if (type === 'boundary') {
      circle(x + 3, top + h / 2, Math.min(w, h) / 2 - 3)
      line(left + 3, top + 2, left + 3, top + h - 2)
    } else if (type === 'control') {
      circle(x, top + h / 2, Math.min(w, h) / 2 - 3)
      path(`M${x - 4} ${top + 4}L${x + 4} ${top}L${x + 2} ${top + 8}`)
    } else circle(x, top + h / 2, Math.min(w, h) / 2 - 3)
    children.push({ indent: 2, node: marks.group({ id: `actor:${id}:icon`, role: 'icon', owner, channels: { category: id },
      open: `<g class="sequence-actor-glyph sequence-actor-${type}">`,
      close: '</g>', join: '', children: glyphs.map(node => ({ node, indent: 0 })),
    }) })
    children.push({ indent: 2, node: marks.text({
      id: `actor:${id}:label`, role: 'label', text: displayLabel, block: actor.labelPosition.block, x: labelX, y: labelY,
      fontSize, fontWeight, letterSpacing, anchor: 'middle', paint: { fill: below.ink, ...haloPaint(below) }, channels: { category: id },
    }) })
  } else {
    // Participant: rectangle box with label (supports multi-line)
    const boxX = x - width / 2
    const rawFill = rawFillColor
    const rawStroke = rawBorderColor
    const radius = roleStyle?.cornerRadius ?? style.cornerRadius ?? 4
    children.push({
      indent: 2,
      node: marks.shape({
        id: `actor:${id}:box`,
        role: 'actor',
        geometry: { kind: 'rect', x: boxX, y, width, height, rx: radius, ry: radius },
        paint: { fill: rawFill, stroke: rawStroke, strokeWidth: String(lineWidth) },
        channels: { category: id },
      }),
    })
    children.push({
      indent: 2,
      node: marks.text({
        id: `actor:${id}:label`,
        role: 'label',
        text: displayLabel,
        block: actor.labelPosition.block,
        x: labelX,
        y: labelY,
        fontSize,
        fontWeight,
        letterSpacing,
        anchor: 'middle',
        paint: { fill: boxTextColor },
        channels: { category: id },
      }),
    })
  }

  const menuColor = type === 'participant' ? boxTextColor : rawTextColor
  if (actor.links) children.push({ indent: 2, node: marks.text({
    id: `actor:${id}:menu`, role: 'icon', text: '⋯', block: actor.menuBlock, x: x + width / 2 - 7, y: y + 10,
    fontSize: 10, anchor: 'middle', paint: { fill: menuColor }, channels: { category: id },
    baselineShift: 0, attributes: { className: 'sequence-actor-menu' },
  }) })

  return marks.group({
    id: `actor:${id}`,
    role: 'actor',
    open,
    close: '</g>',
    children,
    channels: { category: id },
  })
}

/**
 * Render a lifeline (dashed vertical line from actor to bottom).
 * Includes data-actor to link to its actor.
 */
function renderLifeline<T>(marks: DrawingFactory<T>, lifeline: Lifeline, style: ResolvedRenderStyle, spans: VisibleSpan[]): T {
  const rawStroke = style.edgeStrokeColor ?? 'var(--_line)'
  const strokeWidth = Math.max(0.75, style.lineWidth * 0.75)
  const owner = `lifeline:${lifeline.actorId}`
  if (spans.length !== 1 || spans[0]!.top !== lifeline.topY || spans[0]!.bottom !== lifeline.bottomY) {
    return marks.group({
      id: owner, role: 'lifeline',
      open: `<g class="lifeline" data-actor="${escapeAttr(lifeline.actorId)}">`, close: '</g>',
      children: spans.map(span => {
        // A new contour restarts its dash pattern; carry the original phase
        // through the gap rather than accumulating a timing shift below it.
        const offset = (span.top - lifeline.topY) % 10
        return { indent: 2, node: marks.connector({
          id: span.after ? semanticChildId(owner, 'after', span.after) : semanticChildId(owner, 'start'), role: 'lifeline',
          geometry: { kind: 'line', x1: lifeline.x, y1: span.top, x2: lifeline.x, y2: span.bottom },
          lineStyle: 'dashed',
          paint: { stroke: rawStroke, strokeWidth: String(strokeWidth), strokeDasharray: '6 4', strokeDashoffset: String(offset) },
        }) }
      }),
    })
  }
  return marks.connector({
    id: owner,
    role: 'lifeline',
    geometry: { kind: 'line', x1: lifeline.x, y1: lifeline.topY, x2: lifeline.x, y2: lifeline.bottomY },
    lineStyle: 'dashed',
    paint: { stroke: rawStroke, strokeWidth: String(strokeWidth), strokeDasharray: '6 4' },
    attributes: { className: 'lifeline', data: { actor: lifeline.actorId } },
  })
}

/**
 * Render an activation box (narrow filled rectangle on lifeline).
 * Includes data-actor to link to its actor.
 */
function renderActivation<T>(marks: DrawingFactory<T>, activation: Activation, style: ResolvedRenderStyle, sceneId: string, spans: VisibleSpan[]): T {
  const rawFill = style.nodeFillColor ?? 'var(--_node-fill)'
  const rawStroke = style.nodeBorderColor ?? 'var(--_node-stroke)'
  if (spans.length !== 1 || spans[0]!.top !== activation.topY || spans[0]!.bottom !== activation.bottomY) {
    const children: Array<{ node: T; indent: number }> = []
    const fills: string[] = []
    const borders: string[] = []
    for (const span of spans) {
      fills.push(`M ${activation.x} ${span.top} h ${activation.width} V ${span.bottom} h ${-activation.width} Z`)
      // Only the original border survives. Capping each piece would invent
      // extra activation starts/ends at every label's knockout boundary.
      const edges = [
        { x1: activation.x, y1: span.top, x2: activation.x, y2: span.bottom },
        { x1: activation.x + activation.width, y1: span.top, x2: activation.x + activation.width, y2: span.bottom },
        ...(span.top === activation.topY ? [{ x1: activation.x, y1: span.top, x2: activation.x + activation.width, y2: span.top }] : []),
        ...(span.bottom === activation.bottomY ? [{ x1: activation.x, y1: span.bottom, x2: activation.x + activation.width, y2: span.bottom }] : []),
      ]
      for (const edge of edges) {
        borders.push(`M ${edge.x1} ${edge.y1} L ${edge.x2} ${edge.y2}`)
      }
    }
    if (fills.length) {
      // One path per paint keeps both Scene admission and emitted SVG bounded;
      // each fill contour is closed, each border contour remains independent.
      const fillPath = fills.join(' ')
      const borderPath = borders.join(' ')
      children.push({ indent: 2, node: marks.shape({
        id: semanticChildId(sceneId, 'fill'), role: 'activation', surfaceFragment: true,
        geometry: { kind: 'path', d: fillPath }, paint: { fill: rawFill, stroke: 'none' },
      }) })
      children.push({ indent: 2, node: marks.shape({
        id: semanticChildId(sceneId, 'border'), role: 'activation',
        geometry: { kind: 'path', d: borderPath },
        paint: { fill: 'none', stroke: rawStroke, strokeWidth: String(STROKE_WIDTHS.innerBox) },
      }) })
    }
    return marks.group({
      id: sceneId, role: 'activation',
      open: `<g class="activation" data-actor="${escapeAttr(activation.actorId)}">`, close: '</g>', children,
    })
  }
  return marks.shape({
    id: sceneId,
    role: 'activation',
    geometry: { kind: 'rect', x: activation.x, y: activation.topY, width: activation.width, height: activation.bottomY - activation.topY },
    paint: { fill: rawFill, stroke: rawStroke, strokeWidth: String(STROKE_WIDTHS.innerBox) },
    attributes: { className: 'activation', data: { actor: activation.actorId } },
  })
}

/**
 * Render a message arrow with label.
 * Wrapped in <g class="message"> with presentation metadata. The child
 * ConnectorMark is the sole authority for relation endpoints.
 */
function renderMessage<T>(
  marks: DrawingFactory<T>,
  msg: PositionedMessage,
  style: ResolvedRenderStyle,
  sceneId: string,
  inkAt: SurfaceInk,
  markerResources: readonly MarkerDescriptor[],
): T {
  const children: Array<{ node: T; indent: number }> = []
  const startMarker = sequenceMarkerFor(markerResources, msg.startHead)
  const endMarker = sequenceMarkerFor(markerResources, msg.endHead)
  const rawStroke = style.edgeStrokeColor ?? 'var(--_line)'
  const rawTextColor = style.edgeTextColor ?? 'var(--_text-muted)'
  const { text: displayLabel, x: labelX, y: labelY, bounds: labelBounds } = msg.labelPosition
  const linePaint = {
    stroke: rawStroke,
    strokeWidth: String(style.lineWidth),
    ...(msg.lineStyle === 'dashed' ? { strokeDasharray: '6 4' } : {}),
  }
  const connectorSemantics = {
    endpoints: { from: msg.from, to: msg.to },
    relationship: {
      kind: 'sequence-message',
      direction: msg.isSelf ? 'self' : arrowheadDirection(startMarker !== undefined, endMarker !== undefined),
    },
    route: { ownership: 'layout' },
    labels: msg.label ? [{ text: msg.label, ...(msg.labelContent ? { textContent: msg.labelContent } : {}) }] : [],
  } as const

  // Semantic wrapper with message metadata
  const open =
    `<g class="message" data-label="${escapeDisplayAttr(msg.label)}" data-line-style="${msg.lineStyle}" ` +
    `data-start-head="${msg.startHead}" data-end-head="${msg.endHead}" data-central-start="${msg.centralStart}" data-central-end="${msg.centralEnd}" data-self="${msg.isSelf}"${msg.parentId === undefined ? '' : ` data-parent-id="${escapeAttr(msg.parentId)}"`}>`

  if (msg.isSelf) {
    // Self-message: curved loop going right and back
    children.push({
      indent: 2,
      node: marks.connector({
        id: `${sceneId}:line`,
        role: 'message',
        geometry: {
          kind: 'polyline',
          points: msg.points,
        },
        lineStyle: msg.lineStyle,
        paint: linePaint,
        markers: { ...(startMarker ? { start: startMarker } : {}), mid: [], ...(endMarker ? { end: endMarker } : {}) },
        ...connectorSemantics,
      }),
    })
    // Label to the right of the loop (supports multi-line)
    const loopPaint = inkAt(areaFromBounds(labelBounds), rawTextColor)
    children.push({
      indent: 2,
      node: marks.text({
        id: `${sceneId}:label`,
        role: 'label',
        text: displayLabel,
        block: msg.labelPosition.block,
        x: labelX,
        y: labelY,
        fontSize: style.edgeLabelFontSize,
        fontWeight: style.edgeLabelFontWeight,
        letterSpacing: style.edgeLetterSpacing,
        anchor: 'start',
        paint: { fill: loopPaint.ink, ...haloPaint(loopPaint) },
      }),
    })
  } else {
    // Normal message: horizontal arrow
    const p0 = msg.points[0]!
    const p1 = msg.points[msg.points.length - 1]!
    children.push({
      indent: 2,
      node: marks.connector({
        id: `${sceneId}:line`,
        role: 'message',
        geometry: { kind: 'line', x1: p0.x, y1: p0.y, x2: p1.x, y2: p1.y },
        lineStyle: msg.lineStyle,
        paint: linePaint,
        markers: { ...(startMarker ? { start: startMarker } : {}), mid: [], ...(endMarker ? { end: endMarker } : {}) },
        ...connectorSemantics,
      }),
    })
    // Label above the arrow, centered (supports multi-line)
    const labelPaint = inkAt(areaFromBounds(labelBounds), rawTextColor)
    children.push({
      indent: 2,
      node: marks.text({
        id: `${sceneId}:label`,
        role: 'label',
        text: displayLabel,
        block: msg.labelPosition.block,
        x: labelX,
        y: labelY,
        fontSize: style.edgeLabelFontSize,
        fontWeight: style.edgeLabelFontWeight,
        letterSpacing: style.edgeLetterSpacing,
        anchor: 'middle',
        paint: { fill: labelPaint.ink, ...haloPaint(labelPaint) },
      }),
    })
  }

  if (msg.centralStart) children.push({ indent: 2, node: marks.shape({
    id: `${sceneId}:central-start`, role: 'chrome', geometry: { kind: 'circle', cx: msg.x1, cy: msg.y, r: 4 },
    paint: { fill: 'var(--bg)', stroke: rawStroke, strokeWidth: '1.5' },
    attributes: { className: 'sequence-central-connection', data: { side: 'start' } },
  }) })
  if (msg.centralEnd) children.push({ indent: 2, node: marks.shape({
    id: `${sceneId}:central-end`, role: 'chrome', geometry: { kind: 'circle', cx: msg.x2, cy: msg.y, r: 4 },
    paint: { fill: 'var(--bg)', stroke: rawStroke, strokeWidth: '1.5' },
    attributes: { className: 'sequence-central-connection', data: { side: 'end' } },
  }) })

  return marks.group({
    id: sceneId,
    role: 'message',
    open,
    close: '</g>',
    children,
  })
}

/** A block's background paint: a rect's authored color (Mermaid's translucent
 * gray when it names none), or the fill a look gives every fragment. */
function blockBackground(block: PositionedBlock, style: ResolvedRenderStyle): string | undefined {
  return block.type === 'rect'
    ? (block.color ?? style.groupFillColor ?? 'rgba(128, 128, 128, 0.5)')
    : style.groupFillColor
}

/**
 * Render a block background (loop/alt/opt).
 * Wrapped in <g class="block"> with semantic data attributes.
 */
function renderBlock<T>(marks: DrawingFactory<T>, block: PositionedBlock, style: ResolvedRenderStyle, sceneId: string, part: 'all' | 'background' | 'frame' | 'dividers' = 'all'): T {
  const children: Array<{ node: T; indent: number }> = []

  // Semantic wrapper with block metadata
  const labelAttr = block.label ? ` data-label="${escapeDisplayAttr(block.label)}"` : ''
  const open = part === 'dividers'
    ? `<g class="sequence-block-divider-overlay" data-owner="${escapeAttr(sceneId)}">`
    : part === 'frame'
      ? `<g class="sequence-block-frame-overlay" data-owner="${escapeAttr(sceneId)}">`
      : `<g class="block" data-type="${escapeAttr(block.type)}"${labelAttr}${block.parentId === undefined ? '' : ` data-parent-id="${escapeAttr(block.parentId)}"`}>`

  // Outer rectangle
  const rawFill = blockBackground(block, style) ?? 'none'
  const rawStroke = block.type === 'rect' ? 'none' : (style.groupBorderColor ?? 'var(--_node-stroke)')
  const fill = part === 'frame' ? 'none' : rawFill
  const stroke = part === 'background' ? 'none' : rawStroke
  if (part !== 'dividers') children.push({
    indent: 2,
    node: marks.shape({
      id: part === 'frame' ? `${sceneId}:frame` : `${sceneId}:rect`,
      role: 'block',
      geometry: { kind: 'rect', x: block.x, y: block.y, width: block.width, height: block.height, rx: style.groupCornerRadius, ry: style.groupCornerRadius },
      paint: { fill, stroke, strokeWidth: String(style.groupLineWidth) },
    }),
  })

  // Divider lines (for alt/else, par/and); their labels are drawn later, above
  // lifelines and activations (renderBlockDividerLabels).
  const rawDividerStroke = style.edgeStrokeColor ?? 'var(--_line)'
  let dividerIndex = 0
  for (const divider of part === 'background' || part === 'frame' || block.type === 'par_over' ? [] : block.dividers) {
    const dividerId = `${sceneId}:divider#${dividerIndex}`
    dividerIndex++
    const dividerStrokeWidth = Math.max(0.75, style.lineWidth * 0.75)
    children.push({
      indent: 2,
      node: marks.connector({
        id: dividerId,
        role: 'block',
        geometry: { kind: 'line', x1: block.x, y1: divider.y, x2: block.x + block.width, y2: divider.y },
        lineStyle: 'dashed',
        paint: { stroke: rawDividerStroke, strokeWidth: String(dividerStrokeWidth), strokeDasharray: '6 4' },
      }),
    })
  }

  return marks.group({
    id: part === 'dividers' ? `${sceneId}:divider-overlay` : part === 'frame' ? `${sceneId}:frame-overlay` : sceneId,
    role: 'block',
    open,
    close: '</g>',
    children,
  })
}

/**
 * Render a fragment's section labels (`else …`, `and …`). They are drawn above
 * lifelines and activation bars, which cross a fragment's left edge, with a
 * halo in the surface beneath them so neither hides the text.
 */
function renderBlockDividerLabels<T>(marks: DrawingFactory<T>, block: PositionedBlock, style: ResolvedRenderStyle, sceneId: string, inkAt: SurfaceInk): T {
  const rawDividerText = style.edgeTextColor ?? 'var(--_text-muted)'
  const children: Array<{ node: T; indent: number }> = []
  block.dividers.forEach((divider, dividerIndex) => {
    if (!divider.label || !divider.labelPosition) return
    const { text: label, x: labelX, y: labelY, bounds } = divider.labelPosition
    const surface = inkAt(areaFromBounds(bounds), rawDividerText)
    const labelPaint = { ink: surface.ink, halo: surface.halo ?? style.groupFillColor ?? 'var(--bg)' }
    children.push({
      indent: 2,
      node: marks.text({
        id: `${sceneId}:divider#${dividerIndex}:label`,
        role: 'label',
        text: label,
        block: divider.labelPosition.block,
        x: labelX,
        y: labelY,
        fontSize: style.edgeLabelFontSize,
        fontWeight: style.edgeLabelFontWeight,
        letterSpacing: style.edgeLetterSpacing,
        anchor: 'start',
        paint: { fill: labelPaint.ink, ...haloPaint(labelPaint) },
      }),
    })
  })
  return marks.group({
    id: `${sceneId}:divider-labels`,
    role: 'block',
    open: `<g class="sequence-block-divider-labels" pointer-events="none">`,
    close: '</g>',
    children,
  })
}

function renderBlockHeader<T>(marks: DrawingFactory<T>, header: PositionedBlockHeader, style: ResolvedRenderStyle, sceneId: string): T {
  const { x: tabX, y: tabY, width: tabWidth, height: tabHeight, label } = header
  const { text: labelText, x: labelX, y: labelY } = label
  const fill = style.groupHeaderFillColor ?? 'var(--_group-hdr)'
  const stroke = style.groupBorderColor ?? 'var(--_node-stroke)'
  const text = style.groupTextColor ?? 'var(--_text-sec)'
  return marks.group({
    id: `${sceneId}:header-overlay`,
    role: 'block',
    open: `<g class="sequence-block-header-overlay" pointer-events="none" aria-hidden="true">`,
    close: '</g>',
    children: [
      {
        indent: 0,
        node: marks.shape({
          id: `${sceneId}:tab`,
          role: 'block',
          geometry: { kind: 'rect', x: tabX, y: tabY, width: tabWidth, height: tabHeight },
          paint: { fill, stroke, strokeWidth: String(style.groupLineWidth) },
        }),
      },
      {
        indent: 0,
        node: marks.text({
          id: `${sceneId}:label`,
          role: 'label',
          text: labelText,
          block: label.block,
          x: labelX,
          y: labelY,
          fontSize: style.groupHeaderFontSize,
          fontWeight: style.groupHeaderFontWeight,
          letterSpacing: style.groupLetterSpacing,
          anchor: 'start',
          paint: { fill: text },
        }),
      },
    ],
  })
}

/**
 * Render a `box … end` group frame: a background rect spanning the member
 * actors and their lifelines, plus a centered title in the top band.
 *
 * Fill policy: explicit source colors ('Aqua', '#1f2a44', 'rgb(…)') are used
 * verbatim; 'transparent' renders no fill; without a color the fill derives
 * from the theme (color-mix of fg over bg), so it adapts to dark themes.
 * Title ink follows the journey precedent: when the effective fill resolves
 * to a concrete hex, the default ink is WCAG-guarded (>= 4.5:1) and flips to
 * the black/white contrast pick when it can't be proven safe.
 */
function renderBoxGroup<T>(marks: DrawingFactory<T>, box: PositionedBoxGroup, style: ResolvedRenderStyle, sceneId: string): T {
  const children: Array<{ node: T; indent: number }> = []
  const labelAttr = box.label ? ` data-label="${escapeDisplayAttr(box.label)}"` : ''
  const open = `<g class="box"${labelAttr}>`

  const explicit = box.color?.toLowerCase() === 'transparent' ? 'none' : box.color
  const fill = explicit ?? 'color-mix(in srgb, var(--fg) 5%, var(--bg))'
  children.push({
    indent: 2,
    node: marks.shape({
      id: `${sceneId}:rect`,
      role: 'group',
      geometry: { kind: 'rect', x: box.x, y: box.y, width: box.width, height: box.height, rx: style.groupCornerRadius, ry: style.groupCornerRadius },
      paint: { fill, stroke: 'none' },
    }),
  })

  if (box.label) {
    const displayLabel = box.block?.text ?? applyTextTransform(box.label, style.groupTextTransform)
    const ink = boxTitleInk(explicit, style)
    const titleX = box.x + box.width / 2
    const titleY = box.labelY ?? box.y + 13
    children.push({
      indent: 2,
      node: marks.text({
        id: `${sceneId}:title`,
        role: 'label',
        text: displayLabel,
        block: box.block,
        x: titleX,
        y: titleY,
        fontSize: style.groupHeaderFontSize,
        fontWeight: style.groupHeaderFontWeight,
        letterSpacing: style.groupLetterSpacing,
        anchor: 'middle',
        paint: { fill: ink },
      }),
    })
  }

  return marks.group({
    id: sceneId,
    role: 'group',
    open,
    close: '</g>',
    children,
  })
}

/** Title ink for a box: theme text color by default; against a concretely
 *  resolvable fill it must clear WCAG AA (4.5:1) or flip to the black/white
 *  contrast pick (journey's contrastGuardedLabelColor pattern). */
function boxTitleInk(fill: string | undefined, style: ResolvedRenderStyle): string {
  const themed = style.groupTextColor ?? 'var(--_text-sec)'
  if (!fill || fill === 'none') return themed
  const fillHex = boxColorToHex(fill)
  if (!fillHex) return themed // non-resolvable paint — theme ink passes through
  const explicit = style.groupTextColor
  if (explicit) {
    const ratio = wcagContrastRatio(explicit, fillHex)
    if (ratio !== null && ratio >= 4.5) return explicit
  }
  return contrastTextColor(fillHex) ?? themed
}

/**
 * Render the X cross ending a destroyed lifeline (`destroy` directive).
 */
function renderDestroyCross<T>(marks: DrawingFactory<T>, cross: LifelineCross, style: ResolvedRenderStyle): T {
  const r = 8
  const stroke = style.edgeStrokeColor ?? 'var(--_line)'
  const strokeWidth = Math.max(1.5, style.lineWidth)
  const d = `M ${cross.x - r} ${cross.y - r} L ${cross.x + r} ${cross.y + r} M ${cross.x - r} ${cross.y + r} L ${cross.x + r} ${cross.y - r}`
  return marks.shape({
    id: `destroy:${cross.actorId}`,
    role: 'icon',
    geometry: { kind: 'path', d },
    paint: { fill: 'none', stroke, strokeWidth: String(strokeWidth) },
    channels: { category: cross.actorId },
    attributes: { className: 'destroy-cross', data: { actor: cross.actorId } },
  })
}

/**
 * Render a note box.
 * Wrapped in <g class="note"> with semantic data attributes.
 */
function renderNote<T>(marks: DrawingFactory<T>, note: PositionedNote, style: ResolvedRenderStyle, colors: DiagramColors, sceneId: string): T {
  const { x, y, width: w, height: h } = note

  const actorsAttr = note.actors && note.actors.length > 0
    ? ` data-actors="${note.actors.map(escapeAttr).join(',')}"`
    : ''
  const positionAttr = note.position ? ` data-position="${escapeAttr(note.position)}"` : ''

  const rawFill = style.nodeFillColor ?? 'var(--bg)'
  const rawStroke = style.nodeBorderColor ?? 'var(--_node-stroke)'
  const rawTextColor = style.nodeTextColor ?? toneOnFill('var(--_text-muted)', rawFill, colors)
  const radius = style.cornerRadius ?? 0
  const displayText = note.block?.text ?? applyTextTransform(note.text, style.nodeTextTransform)

  return marks.group({
    id: sceneId,
    role: 'note',
    open: `<g class="note"${positionAttr}${actorsAttr}${note.parentId === undefined ? '' : ` data-parent-id="${escapeAttr(note.parentId)}"`}>`,
    close: '</g>',
    children: [
      {
        indent: 2,
        node: marks.shape({
          id: `${sceneId}:rect`,
          role: 'note',
          geometry: { kind: 'rect', x, y, width: w, height: h, rx: radius, ry: radius },
          paint: { fill: rawFill, stroke: rawStroke, strokeWidth: String(STROKE_WIDTHS.innerBox) },
        }),
      },
      {
        indent: 2,
        node: marks.text({
          id: `${sceneId}:text`,
          role: 'label',
          text: displayText,
          block: note.block,
          x: x + w / 2,
          y: y + h / 2,
          fontSize: style.nodeLabelFontSize,
          fontWeight: style.nodeLabelFontWeight,
          letterSpacing: style.nodeLetterSpacing,
          anchor: 'middle',
          paint: { fill: rawTextColor },
        }),
      },
    ],
  })
}

export const lowerSequenceScene = sceneLowering<PositionedSequenceDiagram>(lowerSequenceDrawing)
