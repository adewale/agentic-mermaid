import type { PositionedSequenceDiagram, PositionedActor, Lifeline, PositionedMessage, Activation, PositionedBlock, PositionedNote, PositionedBoxGroup, LifelineCross } from './types.ts'
import { boxColorToHex } from './colors.ts'
import { contrastTextColor } from '../color-resolver.ts'
import { wcagContrastRatio } from '../shared/color-math.ts'
import type { RenderContext } from '../types.ts'
import { svgOpenTag, buildStyleBlock, buildShadowDefs } from '../theme.ts'
import { FONT_SIZES, FONT_WEIGHTS, STROKE_WIDTHS, ARROW_HEAD, estimateTextWidth, TEXT_BASELINE_SHIFT, applyTextTransform, resolveRenderStyle } from '../styles.ts'
import type { RenderStyleDefaults, ResolvedRenderStyle } from '../styles.ts'
import { SEQUENCE_STYLE_DEFAULTS } from './layout.ts'
import { buildAccessibilityAttrs } from '../shared/svg-a11y.ts'
import { renderMultilineText, escapeAttr, escapeXml as escapeXmlUtil } from '../multiline-utils.ts'
import type { MarkerDescriptor, MarkerRef, SceneDoc, SceneNode } from '../scene/ir.ts'
import { hashId } from '../scene/seed.ts'
import * as marks from '../scene/marks.ts'
import { DefaultBackend } from '../scene/backend.ts'
import { serializeMarkerResources } from '../scene/marker-resources.ts'
import { resolveRoleStyle, type InternalStyleFace } from '../scene/style-registry.ts'


// ============================================================================
// Sequence diagram SVG renderer
//
// Renders a positioned sequence diagram to SVG string.
// The diagram is first lowered to a SceneGraph (SPEC §3.1): every visual mark
// becomes a scene node carrying semantic fields (role, geometry, paint,
// channels, stable id) plus its exact crisp serialization, built here from
// the same inputs. renderSequenceSvg() is DefaultBackend serialization of
// that scene, so the default path stays byte-identical to the historical
// string renderer (corpus-gated by svg-equivalence.test.ts).
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
 * Lower a positioned sequence diagram to the SceneGraph IR. Mark order
 * matches the historical parts[] order exactly; DefaultBackend joins crisps
 * with '\n'.
 */
export function lowerSequenceScene(
  ctx: RenderContext<PositionedSequenceDiagram>,
): SceneDoc {
  const { positioned: diagram, colors, resolved } = ctx
  const options = resolved.renderOptions
  const font = colors.font ?? 'Inter'
  const transparent = options.transparent ?? false
  const parts: SceneNode[] = []
  const style = resolveRenderStyle(options, SEQUENCE_STYLE_DEFAULTS, resolved.styleFace)
  const uid = `seq-${hashId(diagram.width, diagram.height, diagram.actors.length, diagram.messages.length)}`
  const titleId = `${uid}-title`
  const descId = `${uid}-desc`
  const rootAttrs = buildAccessibilityAttrs(diagram.accessibilityTitle, diagram.accessibilityDescription, titleId, descId)

  // SVG root with CSS variables + style block + defs
  parts.push(marks.prelude(
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
    parts.push(marks.raw({ id: 'a11y-title', role: 'chrome' },
      `<title id="${titleId}">${escapeXml(diagram.accessibilityTitle)}</title>`))
  }
  if (diagram.accessibilityDescription) {
    parts.push(marks.raw({ id: 'a11y-desc', role: 'chrome' },
      `<desc id="${descId}">${escapeXml(diagram.accessibilityDescription)}</desc>`))
  }

  // 0. Box group frames (behind everything, including block backgrounds)
  const boxOccurrence = new Map<string, number>()
  for (const box of diagram.boxes) {
    const boxKey = box.label ?? ''
    const k = boxOccurrence.get(boxKey) ?? 0
    boxOccurrence.set(boxKey, k + 1)
    parts.push(renderBoxGroup(box, style, `box:${boxKey}#${k}`))
  }

  // 1. Block backgrounds (loop/alt/opt rectangles)
  const blockOccurrence = new Map<string, number>()
  for (const block of diagram.blocks) {
    const k = blockOccurrence.get(block.type) ?? 0
    blockOccurrence.set(block.type, k + 1)
    parts.push(renderBlock(block, style, `block:${block.type}#${k}`))
  }

  // 2. Lifelines (dashed vertical lines from actor to bottom)
  for (const lifeline of diagram.lifelines) {
    parts.push(renderLifeline(lifeline, style))
  }

  // 3. Activation boxes
  const activationOccurrence = new Map<string, number>()
  for (const activation of diagram.activations) {
    const k = activationOccurrence.get(activation.actorId) ?? 0
    activationOccurrence.set(activation.actorId, k + 1)
    parts.push(renderActivation(activation, style, `activation:${activation.actorId}#${k}`))
  }

  // 4. Messages (horizontal arrows with labels)
  const messageOccurrence = new Map<string, number>()
  for (const message of diagram.messages) {
    const pairKey = `${message.from}->${message.to}`
    const k = messageOccurrence.get(pairKey) ?? 0
    messageOccurrence.set(pairKey, k + 1)
    parts.push(renderMessage(message, style, `message:${pairKey}#${k}`))
  }

  // 5. Notes
  const noteOccurrence = new Map<string, number>()
  for (const note of diagram.notes) {
    const noteKey = `${(note.actors ?? []).join(',')}@${note.position ?? 'over'}`
    const k = noteOccurrence.get(noteKey) ?? 0
    noteOccurrence.set(noteKey, k + 1)
    parts.push(renderNote(note, style, `note:${noteKey}#${k}`))
  }

  // 5b. Destroy crosses (X where a destroyed lifeline ends) — drawn above
  //     messages/lifelines so the cross stays legible.
  for (const cross of diagram.destructions) {
    parts.push(renderDestroyCross(cross, style))
  }

  // 6. Actor boxes at top (rendered last so they're on top)
  for (const actor of diagram.actors) {
    parts.push(renderActor(actor, style, resolved.styleFace))
  }

  parts.push(marks.documentClose())

  return { family: 'sequence', width: diagram.width, height: diagram.height, colors, parts }
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
    { ...base, id: 'seq-arrow-half-top', shape: 'open-arrow', ref: { x: w, y: h / 2 }, geometry: { kind: 'path', d: `M0 0 L${w} ${h / 2}` }, paint: { fill: 'none', stroke: edgeColor, strokeWidth: '1' } },
    { ...base, id: 'seq-arrow-half-bottom', shape: 'open-arrow', ref: { x: w, y: h / 2 }, geometry: { kind: 'path', d: `M0 ${h} L${w} ${h / 2}` }, paint: { fill: 'none', stroke: edgeColor, strokeWidth: '1' } },
  ] satisfies readonly MarkerDescriptor[]
}

function sequenceMarkerFor(style: ResolvedRenderStyle, head: PositionedMessage['endHead']): MarkerRef | undefined {
  if (head === 'none') return undefined
  const id = head === 'filled' ? 'seq-arrow'
    : head === 'cross' ? 'seq-arrow-cross'
      : head === 'half-top' ? 'seq-arrow-half-top'
        : head === 'half-bottom' ? 'seq-arrow-half-bottom'
          : 'seq-arrow-open'
  return sequenceMarkerResources(style).find(marker => marker.id === id)
}

// ============================================================================
// Component renderers
// ============================================================================

/**
 * Render an actor box (participant = rectangle, actor = stick figure).
 * Wrapped in <g class="actor"> with semantic data attributes.
 */
function renderActor(
  actor: PositionedActor,
  style: ResolvedRenderStyle,
  styleFace: Readonly<InternalStyleFace> | undefined,
): SceneNode {
  const { id, x, y, width, height, label, type } = actor
  const children: Array<{ node: SceneNode; indent: number }> = []
  const roleStyle = resolveRoleStyle(styleFace, 'actor', { category: id }, { includeFallback: false })
  const fontSize = roleStyle?.fontSize ?? style.nodeLabelFontSize
  const fontWeight = roleStyle?.fontWeight ?? style.nodeLabelFontWeight
  const letterSpacing = roleStyle?.letterSpacing ?? style.nodeLetterSpacing
  const textTransform = roleStyle?.textTransform ?? style.nodeTextTransform
  const lineWidth = roleStyle?.lineWidth ?? style.nodeLineWidth
  const rawFillColor = roleStyle?.fillColor ?? style.nodeFillColor ?? 'var(--_node-fill)'
  const rawBorderColor = roleStyle?.borderColor ?? style.nodeBorderColor ?? 'var(--_node-stroke)'
  const rawTextColor = roleStyle?.textColor ?? style.nodeTextColor ?? 'var(--_text)'

  // Semantic wrapper with actor metadata
  const menu = actor.links ? ` data-links="${escapeAttr(JSON.stringify(actor.links))}" role="link" tabindex="0"` : ''
  const open =
    `<g class="actor" data-id="${escapeAttr(id)}" data-label="${escapeAttr(label)}" data-type="${type}"${menu}>`

  const displayLabel = applyTextTransform(label, textTransform)
  const labelAttrs =
    `font-size="${fontSize}" text-anchor="middle" font-weight="${fontWeight}"${letterAttr(letterSpacing)} fill="${escapeAttr(rawTextColor)}"`

  if (type === 'actor') {
    // Circle-person icon: outer circle + head circle + shoulders arc.
    // Defined in a 24×24 coordinate space, scaled to 90% of the actor box height
    // and centered both horizontally and vertically within the box.
    // Stroke width is inverse-scaled so the visual thickness matches STROKE_WIDTHS.outerBox.
    const s = (height / 24) * 0.9
    const tx = x - 12 * s            // center icon horizontally on actor.x
    const ty = y + (height - 24 * s) / 2  // center icon vertically in actor box
    const sw = lineWidth / s  // compensate for scale transform
    const iconStroke = escapeAttr(roleStyle?.borderColor ?? style.edgeStrokeColor ?? 'var(--_line)')

    // The figure lives inside a <g transform=...> wrapper, which the shape
    // geometry contract can't express — kept as a raw icon mark.
    children.push({
      indent: 2,
      node: marks.raw({ id: `actor:${id}:icon`, role: 'icon', channels: { category: id } },
        `<g transform="translate(${tx},${ty}) scale(${s})">` +
        // Outer circle
        `\n  <path d="M21 12C21 16.9706 16.9706 21 12 21C7.02944 21 3 16.9706 3 12C3 7.02944 7.02944 3 12 3C16.9706 3 21 7.02944 21 12Z" fill="none" stroke="${iconStroke}" stroke-width="${sw}" />` +
        // Head
        `\n  <path d="M15 10C15 11.6569 13.6569 13 12 13C10.3431 13 9 11.6569 9 10C9 8.34315 10.3431 7 12 7C13.6569 7 15 8.34315 15 10Z" fill="none" stroke="${iconStroke}" stroke-width="${sw}" />` +
        // Shoulders
        `\n  <path d="M5.62842 18.3563C7.08963 17.0398 9.39997 16 12 16C14.6 16 16.9104 17.0398 18.3716 18.3563" fill="none" stroke="${iconStroke}" stroke-width="${sw}" />` +
        `\n</g>`),
    })
    // Label below the icon (supports multi-line)
    children.push({
      indent: 2,
      node: marks.text({
        id: `actor:${id}:label`,
        role: 'label',
        text: displayLabel,
        x,
        y: y + height + 14,
        fontSize,
        anchor: 'middle',
        paint: { fill: rawTextColor },
        channels: { category: id },
      }, renderMultilineText(displayLabel, x, y + height + 14, fontSize, labelAttrs)),
    })
  } else if (type !== 'participant') {
    const rawStroke = escapeAttr(roleStyle?.borderColor ?? style.edgeStrokeColor ?? 'var(--_line)')
    const rawFill = escapeAttr(rawFillColor)
    const left = x - width / 2
    const top = y + 2
    const w = width
    const h = Math.max(24, height - 4)
    const glyph = type === 'database'
      ? `<ellipse cx="${x}" cy="${top + 5}" rx="${w / 2}" ry="5"/><path d="M${left} ${top + 5}V${top + h - 5}A${w / 2} 5 0 0 0 ${left + w} ${top + h - 5}V${top + 5}"/><ellipse cx="${x}" cy="${top + h - 5}" rx="${w / 2}" ry="5"/>`
      : type === 'collections'
        ? `<rect x="${left + 6}" y="${top}" width="${w - 6}" height="${h - 6}"/><rect x="${left}" y="${top + 6}" width="${w - 6}" height="${h - 6}"/>`
        : type === 'queue'
          ? `<rect x="${left}" y="${top}" width="${w}" height="${h}" rx="${h / 2}"/><line x1="${left + 8}" y1="${top + h / 2}" x2="${left + w - 8}" y2="${top + h / 2}"/>`
          : type === 'entity'
            ? `<circle cx="${x}" cy="${top + h / 2 - 3}" r="${Math.min(w, h) / 2 - 3}"/><line x1="${left + 5}" y1="${top + h}" x2="${left + w - 5}" y2="${top + h}"/>`
            : type === 'boundary'
              ? `<circle cx="${x + 3}" cy="${top + h / 2}" r="${Math.min(w, h) / 2 - 3}"/><line x1="${left + 3}" y1="${top + 2}" x2="${left + 3}" y2="${top + h - 2}"/>`
              : type === 'control'
                ? `<circle cx="${x}" cy="${top + h / 2}" r="${Math.min(w, h) / 2 - 3}"/><path d="M${x - 4} ${top + 4}L${x + 4} ${top}L${x + 2} ${top + 8}"/>`
                : `<circle cx="${x}" cy="${top + h / 2}" r="${Math.min(w, h) / 2 - 3}"/>`
    children.push({ indent: 2, node: marks.raw({ id: `actor:${id}:icon`, role: 'icon', channels: { category: id } },
      `<g class="sequence-actor-glyph sequence-actor-${type}" fill="${rawFill}" stroke="${rawStroke}" stroke-width="${lineWidth}">${glyph}</g>`) })
    children.push({ indent: 2, node: marks.text({
      id: `actor:${id}:label`, role: 'label', text: displayLabel, x, y: y + height + 14,
      fontSize, anchor: 'middle', paint: { fill: rawTextColor }, channels: { category: id },
    }, renderMultilineText(displayLabel, x, y + height + 14, fontSize, labelAttrs)) })
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
      },
        `<rect x="${boxX}" y="${y}" width="${width}" height="${height}" rx="${radius}" ry="${radius}" ` +
        `fill="${escapeAttr(rawFill)}" stroke="${escapeAttr(rawStroke)}" stroke-width="${lineWidth}" />`),
    })
    children.push({
      indent: 2,
      node: marks.text({
        id: `actor:${id}:label`,
        role: 'label',
        text: displayLabel,
        x,
        y: y + height / 2,
        fontSize,
        anchor: 'middle',
        paint: { fill: rawTextColor },
        channels: { category: id },
      }, renderMultilineText(displayLabel, x, y + height / 2, fontSize, labelAttrs)),
    })
  }

  if (actor.links) children.push({ indent: 2, node: marks.text({
    id: `actor:${id}:menu`, role: 'icon', text: '⋯', x: x + width / 2 - 7, y: y + 10,
    fontSize: 10, anchor: 'middle', paint: { fill: rawTextColor }, channels: { category: id },
  }, `<text class="sequence-actor-menu" x="${x + width / 2 - 7}" y="${y + 10}" text-anchor="middle" font-size="10" fill="${escapeAttr(rawTextColor)}">⋯</text>`) })

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
function renderLifeline(lifeline: Lifeline, style: ResolvedRenderStyle): SceneNode {
  const rawStroke = style.edgeStrokeColor ?? 'var(--_line)'
  const strokeWidth = Math.max(0.75, style.lineWidth * 0.75)
  return marks.connector({
    id: `lifeline:${lifeline.actorId}`,
    role: 'lifeline',
    geometry: { kind: 'line', x1: lifeline.x, y1: lifeline.topY, x2: lifeline.x, y2: lifeline.bottomY },
    lineStyle: 'dashed',
    paint: { stroke: rawStroke, strokeWidth: String(strokeWidth), strokeDasharray: '6 4' },
  },
    `<line class="lifeline" data-actor="${escapeAttr(lifeline.actorId)}" ` +
    `x1="${lifeline.x}" y1="${lifeline.topY}" x2="${lifeline.x}" y2="${lifeline.bottomY}" ` +
    `stroke="${escapeAttr(rawStroke)}" stroke-width="${strokeWidth}" stroke-dasharray="6 4" />`)
}

/**
 * Render an activation box (narrow filled rectangle on lifeline).
 * Includes data-actor to link to its actor.
 */
function renderActivation(activation: Activation, style: ResolvedRenderStyle, sceneId: string): SceneNode {
  const rawFill = style.nodeFillColor ?? 'var(--_node-fill)'
  const rawStroke = style.nodeBorderColor ?? 'var(--_node-stroke)'
  return marks.shape({
    id: sceneId,
    role: 'activation',
    geometry: { kind: 'rect', x: activation.x, y: activation.topY, width: activation.width, height: activation.bottomY - activation.topY },
    paint: { fill: rawFill, stroke: rawStroke, strokeWidth: String(STROKE_WIDTHS.innerBox) },
  },
    `<rect class="activation" data-actor="${escapeAttr(activation.actorId)}" ` +
    `x="${activation.x}" y="${activation.topY}" width="${activation.width}" height="${activation.bottomY - activation.topY}" ` +
    `fill="${escapeAttr(rawFill)}" stroke="${escapeAttr(rawStroke)}" stroke-width="${STROKE_WIDTHS.innerBox}" />`)
}

/**
 * Render a message arrow with label.
 * Wrapped in <g class="message"> with semantic data attributes.
 */
function renderMessage(msg: PositionedMessage, style: ResolvedRenderStyle, sceneId: string): SceneNode {
  const children: Array<{ node: SceneNode; indent: number }> = []
  const dashArray = msg.lineStyle === 'dashed' ? ' stroke-dasharray="6 4"' : ''
  const startMarker = sequenceMarkerFor(style, msg.startHead)
  const endMarker = sequenceMarkerFor(style, msg.endHead)
  const markerAttrs = `${startMarker ? ` marker-start="url(#${startMarker.id})"` : ''}${endMarker ? ` marker-end="url(#${endMarker.id})"` : ''}`
  const rawStroke = style.edgeStrokeColor ?? 'var(--_line)'
  const rawTextColor = style.edgeTextColor ?? 'var(--_text-muted)'
  const displayLabel = applyTextTransform(msg.label, style.edgeTextTransform)
  const linePaint = {
    stroke: rawStroke,
    strokeWidth: String(style.lineWidth),
    ...(msg.lineStyle === 'dashed' ? { strokeDasharray: '6 4' } : {}),
  }
  const connectorSemantics = {
    endpoints: { from: msg.from, to: msg.to },
    relationship: {
      kind: 'sequence-message',
      direction: msg.isSelf ? 'self'
        : startMarker && endMarker ? 'bidirectional'
          : startMarker ? 'reverse' : endMarker ? 'forward' : 'undirected',
    },
    route: { ownership: 'layout' },
    labels: msg.label ? [{ text: msg.label }] : [],
    // The message wrapper is the public relation identity because it owns the
    // connector, label, and optional central-connection marks as one message.
    projectEndpointIdentityToSvg: false,
  } as const

  // Semantic wrapper with message metadata
  const open =
    `<g class="message" data-from="${escapeAttr(msg.from)}" data-to="${escapeAttr(msg.to)}" ` +
    `data-label="${escapeAttr(msg.label)}" data-line-style="${msg.lineStyle}" ` +
    `data-start-head="${msg.startHead}" data-end-head="${msg.endHead}" data-central-start="${msg.centralStart}" data-central-end="${msg.centralEnd}" data-self="${msg.isSelf}">`

  if (msg.isSelf) {
    // Self-message: curved loop going right and back
    // Loop dimensions - loopH is fixed, loopW provides minimum clearance
    const loopW = 30
    const loopH = 20
    const labelPadding = 8 // Space between loop and label
    children.push({
      indent: 2,
      node: marks.connector({
        id: `${sceneId}:line`,
        role: 'message',
        geometry: {
          kind: 'polyline',
          points: [
            { x: msg.x1, y: msg.y },
            { x: msg.x1 + loopW, y: msg.y },
            { x: msg.x1 + loopW, y: msg.y + loopH },
            { x: msg.x2, y: msg.y + loopH },
          ],
        },
        lineStyle: msg.lineStyle,
        paint: linePaint,
        ...(startMarker ? { startMarker } : {}),
        ...(endMarker ? { endMarker } : {}),
        ...connectorSemantics,
      },
        `<polyline points="${msg.x1},${msg.y} ${msg.x1 + loopW},${msg.y} ${msg.x1 + loopW},${msg.y + loopH} ${msg.x2},${msg.y + loopH}" ` +
        `fill="none" stroke="${escapeAttr(rawStroke)}" stroke-width="${style.lineWidth}"${dashArray}${markerAttrs} />`),
    })
    // Label to the right of the loop (supports multi-line)
    children.push({
      indent: 2,
      node: marks.text({
        id: `${sceneId}:label`,
        role: 'label',
        text: displayLabel,
        x: msg.x1 + loopW + labelPadding,
        y: msg.y + loopH / 2,
        fontSize: style.edgeLabelFontSize,
        anchor: 'start',
        paint: { fill: rawTextColor },
      }, renderMultilineText(displayLabel, msg.x1 + loopW + labelPadding, msg.y + loopH / 2, style.edgeLabelFontSize,
        `font-size="${style.edgeLabelFontSize}" text-anchor="start" font-weight="${style.edgeLabelFontWeight}"${letterAttr(style.edgeLetterSpacing)} fill="${escapeAttr(rawTextColor)}"`)),
    })
  } else {
    // Normal message: horizontal arrow
    children.push({
      indent: 2,
      node: marks.connector({
        id: `${sceneId}:line`,
        role: 'message',
        geometry: { kind: 'line', x1: msg.x1, y1: msg.y, x2: msg.x2, y2: msg.y },
        lineStyle: msg.lineStyle,
        paint: linePaint,
        ...(startMarker ? { startMarker } : {}),
        ...(endMarker ? { endMarker } : {}),
        ...connectorSemantics,
      },
        `<line x1="${msg.x1}" y1="${msg.y}" x2="${msg.x2}" y2="${msg.y}" ` +
        `stroke="${escapeAttr(rawStroke)}" stroke-width="${style.lineWidth}"${dashArray}${markerAttrs} />`),
    })
    // Label above the arrow, centered (supports multi-line)
    const midX = (msg.x1 + msg.x2) / 2
    children.push({
      indent: 2,
      node: marks.text({
        id: `${sceneId}:label`,
        role: 'label',
        text: displayLabel,
        x: midX,
        y: msg.y - 10,
        fontSize: style.edgeLabelFontSize,
        anchor: 'middle',
        paint: { fill: rawTextColor },
      }, renderMultilineText(displayLabel, midX, msg.y - 10, style.edgeLabelFontSize,
        `font-size="${style.edgeLabelFontSize}" text-anchor="middle" font-weight="${style.edgeLabelFontWeight}"${letterAttr(style.edgeLetterSpacing)} fill="${escapeAttr(rawTextColor)}"`)),
    })
  }

  if (msg.centralStart) children.push({ indent: 2, node: marks.shape({
    id: `${sceneId}:central-start`, role: 'chrome', geometry: { kind: 'circle', cx: msg.x1, cy: msg.y, r: 4 },
    paint: { fill: 'var(--bg)', stroke: rawStroke, strokeWidth: '1.5' },
  }, `<circle class="sequence-central-connection" data-side="start" cx="${msg.x1}" cy="${msg.y}" r="4" fill="var(--bg)" stroke="${escapeAttr(rawStroke)}" stroke-width="1.5" />`) })
  if (msg.centralEnd) children.push({ indent: 2, node: marks.shape({
    id: `${sceneId}:central-end`, role: 'chrome', geometry: { kind: 'circle', cx: msg.x2, cy: msg.y, r: 4 },
    paint: { fill: 'var(--bg)', stroke: rawStroke, strokeWidth: '1.5' },
  }, `<circle class="sequence-central-connection" data-side="end" cx="${msg.x2}" cy="${msg.y}" r="4" fill="var(--bg)" stroke="${escapeAttr(rawStroke)}" stroke-width="1.5" />`) })

  return marks.group({
    id: sceneId,
    role: 'message',
    open,
    close: '</g>',
    children,
  })
}

/**
 * Render a block background (loop/alt/opt).
 * Wrapped in <g class="block"> with semantic data attributes.
 */
function renderBlock(block: PositionedBlock, style: ResolvedRenderStyle, sceneId: string): SceneNode {
  const children: Array<{ node: SceneNode; indent: number }> = []

  // Semantic wrapper with block metadata
  const labelAttr = block.label ? ` data-label="${escapeAttr(block.label)}"` : ''
  const open =
    `<g class="block" data-type="${escapeAttr(block.type)}"${labelAttr}>`

  // Outer rectangle
  const rawFill = style.groupFillColor ?? 'none'
  const rawStroke = style.groupBorderColor ?? 'var(--_node-stroke)'
  children.push({
    indent: 2,
    node: marks.shape({
      id: `${sceneId}:rect`,
      role: 'block',
      geometry: { kind: 'rect', x: block.x, y: block.y, width: block.width, height: block.height, rx: style.groupCornerRadius, ry: style.groupCornerRadius },
      paint: { fill: rawFill, stroke: rawStroke, strokeWidth: String(style.groupLineWidth) },
    },
      `<rect x="${block.x}" y="${block.y}" width="${block.width}" height="${block.height}" ` +
      `rx="${style.groupCornerRadius}" ry="${style.groupCornerRadius}" fill="${escapeAttr(rawFill)}" stroke="${escapeAttr(rawStroke)}" stroke-width="${style.groupLineWidth}" />`),
  })

  // Type label tab (top-left corner)
  // For multi-line block labels, we use the first line for the tab but show full label
  const labelText = applyTextTransform(`${block.type}${block.label ? ` [${block.label}]` : ''}`, style.groupTextTransform)
  const firstLine = labelText.split('\n')[0]!
  const tabWidth = estimateTextWidth(firstLine, style.groupHeaderFontSize, style.groupHeaderFontWeight) + style.groupPaddingX * 2
  const tabHeight = Math.max(18, style.groupHeaderFontSize + style.groupPaddingY)

  const rawHeaderFill = style.groupHeaderFillColor ?? 'var(--_group-hdr)'
  children.push({
    indent: 2,
    node: marks.shape({
      id: `${sceneId}:tab`,
      role: 'block',
      geometry: { kind: 'rect', x: block.x, y: block.y, width: tabWidth, height: tabHeight },
      paint: { fill: rawHeaderFill, stroke: rawStroke, strokeWidth: String(style.groupLineWidth) },
    },
      `<rect x="${block.x}" y="${block.y}" width="${tabWidth}" height="${tabHeight}" ` +
      `fill="${escapeAttr(rawHeaderFill)}" stroke="${escapeAttr(rawStroke)}" stroke-width="${style.groupLineWidth}" />`),
  })
  // Block type label (supports multi-line via <br> tags)
  const rawHeaderText = style.groupTextColor ?? 'var(--_text-sec)'
  children.push({
    indent: 2,
    node: marks.text({
      id: `${sceneId}:label`,
      role: 'label',
      text: labelText,
      x: block.x + style.groupLabelPaddingX,
      y: block.y + tabHeight / 2,
      fontSize: style.groupHeaderFontSize,
      anchor: 'start',
      paint: { fill: rawHeaderText },
    }, renderMultilineText(
      labelText,
      block.x + style.groupLabelPaddingX,
      block.y + tabHeight / 2,
      style.groupHeaderFontSize,
      `font-size="${style.groupHeaderFontSize}" font-weight="${style.groupHeaderFontWeight}"${style.groupFont ? ` font-family="${escapeAttr(style.groupFont)}"` : ''}${letterAttr(style.groupLetterSpacing)} fill="${escapeAttr(rawHeaderText)}"`
    )),
  })

  // Divider lines (for alt/else, par/and)
  const rawDividerStroke = style.edgeStrokeColor ?? 'var(--_line)'
  const rawDividerText = style.edgeTextColor ?? 'var(--_text-muted)'
  let dividerIndex = 0
  for (const divider of block.dividers) {
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
      },
        `<line x1="${block.x}" y1="${divider.y}" x2="${block.x + block.width}" y2="${divider.y}" ` +
        `stroke="${escapeAttr(rawDividerStroke)}" stroke-width="${dividerStrokeWidth}" stroke-dasharray="6 4" />`),
    })
    if (divider.label) {
      const label = applyTextTransform(`[${divider.label}]`, style.edgeTextTransform)
      // Divider label supports multi-line
      children.push({
        indent: 2,
        node: marks.text({
          id: `${dividerId}:label`,
          role: 'label',
          text: label,
          x: block.x + 8,
          y: divider.y + 14,
          fontSize: style.edgeLabelFontSize,
          anchor: 'start',
          paint: { fill: rawDividerText },
        }, renderMultilineText(label, block.x + 8, divider.y + 14, style.edgeLabelFontSize,
          `font-size="${style.edgeLabelFontSize}" text-anchor="start" font-weight="${style.edgeLabelFontWeight}"${letterAttr(style.edgeLetterSpacing)} fill="${escapeAttr(rawDividerText)}"`)),
      })
    }
  }

  return marks.group({
    id: sceneId,
    role: 'block',
    open,
    close: '</g>',
    children,
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
function renderBoxGroup(box: PositionedBoxGroup, style: ResolvedRenderStyle, sceneId: string): SceneNode {
  const children: Array<{ node: SceneNode; indent: number }> = []
  const labelAttr = box.label ? ` data-label="${escapeAttr(box.label)}"` : ''
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
    },
      `<rect x="${box.x}" y="${box.y}" width="${box.width}" height="${box.height}" ` +
      `rx="${style.groupCornerRadius}" ry="${style.groupCornerRadius}" fill="${escapeAttr(fill)}" stroke="none" />`),
  })

  if (box.label) {
    const displayLabel = applyTextTransform(box.label, style.groupTextTransform)
    const ink = boxTitleInk(explicit, style)
    const titleX = box.x + box.width / 2
    const titleY = box.y + 13
    children.push({
      indent: 2,
      node: marks.text({
        id: `${sceneId}:title`,
        role: 'label',
        text: displayLabel,
        x: titleX,
        y: titleY,
        fontSize: style.groupHeaderFontSize,
        anchor: 'middle',
        paint: { fill: ink },
      }, renderMultilineText(displayLabel, titleX, titleY, style.groupHeaderFontSize,
        `font-size="${style.groupHeaderFontSize}" text-anchor="middle" font-weight="${style.groupHeaderFontWeight}"${style.groupFont ? ` font-family="${escapeAttr(style.groupFont)}"` : ''}${letterAttr(style.groupLetterSpacing)} fill="${escapeAttr(ink)}"`)),
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
function renderDestroyCross(cross: LifelineCross, style: ResolvedRenderStyle): SceneNode {
  const r = 8
  const stroke = style.edgeStrokeColor ?? 'var(--_line)'
  const strokeWidth = Math.max(1.5, style.lineWidth)
  const d = `M ${cross.x - r} ${cross.y - r} L ${cross.x + r} ${cross.y + r} M ${cross.x - r} ${cross.y + r} L ${cross.x + r} ${cross.y - r}`
  return marks.shape({
    id: `destroy:${cross.actorId}`,
    role: 'icon',
    geometry: { kind: 'path', d },
    paint: { stroke, strokeWidth: String(strokeWidth) },
    channels: { category: cross.actorId },
  },
    `<path class="destroy-cross" data-actor="${escapeAttr(cross.actorId)}" d="${d}" ` +
    `fill="none" stroke="${escapeAttr(stroke)}" stroke-width="${strokeWidth}" />`)
}

/**
 * Render a note box.
 * Wrapped in <g class="note"> with semantic data attributes.
 */
function renderNote(note: PositionedNote, style: ResolvedRenderStyle, sceneId: string): SceneNode {
  const { x, y, width: w, height: h } = note

  const actorsAttr = note.actors && note.actors.length > 0
    ? ` data-actors="${note.actors.map(escapeAttr).join(',')}"`
    : ''
  const positionAttr = note.position ? ` data-position="${escapeAttr(note.position)}"` : ''

  const rawFill = style.nodeFillColor ?? 'var(--bg)'
  const rawStroke = style.nodeBorderColor ?? 'var(--_node-stroke)'
  const rawTextColor = style.nodeTextColor ?? 'var(--_text-muted)'
  const radius = style.cornerRadius ?? 0
  const displayText = applyTextTransform(note.text, style.nodeTextTransform)

  return marks.group({
    id: sceneId,
    role: 'note',
    open: `<g class="note"${positionAttr}${actorsAttr}>`,
    close: '</g>',
    children: [
      {
        indent: 2,
        node: marks.shape({
          id: `${sceneId}:rect`,
          role: 'note',
          geometry: { kind: 'rect', x, y, width: w, height: h, rx: radius, ry: radius },
          paint: { fill: rawFill, stroke: rawStroke, strokeWidth: String(STROKE_WIDTHS.innerBox) },
        },
          `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${radius}" ry="${radius}" ` +
          `fill="${escapeAttr(rawFill)}" stroke="${escapeAttr(rawStroke)}" stroke-width="${STROKE_WIDTHS.innerBox}" />`),
      },
      {
        indent: 2,
        node: marks.text({
          id: `${sceneId}:text`,
          role: 'label',
          text: displayText,
          x: x + w / 2,
          y: y + h / 2,
          fontSize: style.nodeLabelFontSize,
          anchor: 'middle',
          paint: { fill: rawTextColor },
        }, renderMultilineText(displayText, x + w / 2, y + h / 2, style.nodeLabelFontSize,
          `font-size="${style.nodeLabelFontSize}" text-anchor="middle" font-weight="${style.nodeLabelFontWeight}"${letterAttr(style.nodeLetterSpacing)} fill="${escapeAttr(rawTextColor)}"`)),
      },
    ],
  })
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
 */
