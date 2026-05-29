import type { PositionedSequenceDiagram, PositionedActor, Lifeline, PositionedMessage, Activation, PositionedBlock, PositionedNote } from './types.ts'
import type { RenderOptions } from '../types.ts'
import type { DiagramColors } from '../theme.ts'
import { svgOpenTag, buildStyleBlock, buildShadowDefs } from '../theme.ts'
import { FONT_SIZES, FONT_WEIGHTS, STROKE_WIDTHS, ARROW_HEAD, estimateTextWidth, TEXT_BASELINE_SHIFT, resolveRenderStyle } from '../styles.ts'
import type { RenderStyleDefaults, ResolvedRenderStyle } from '../styles.ts'
import { renderMultilineText, escapeXml as escapeXmlUtil } from '../multiline-utils.ts'


const SEQUENCE_STYLE_DEFAULTS: RenderStyleDefaults = {
  nodeLabelFontSize: FONT_SIZES.nodeLabel,
  edgeLabelFontSize: FONT_SIZES.edgeLabel,
  groupHeaderFontSize: FONT_SIZES.edgeLabel,
  nodeLabelFontWeight: FONT_WEIGHTS.nodeLabel,
  edgeLabelFontWeight: FONT_WEIGHTS.edgeLabel,
  groupHeaderFontWeight: FONT_WEIGHTS.groupHeader,
  nodePaddingX: 16,
  nodePaddingY: 6,
  nodeCornerRadius: 4,
  nodeLineWidth: STROKE_WIDTHS.outerBox,
  edgeLineWidth: STROKE_WIDTHS.connector,
  groupCornerRadius: 0,
  groupPaddingX: 10,
  groupPaddingY: 8,
  groupLabelPaddingX: 6,
  groupLineWidth: STROKE_WIDTHS.outerBox,
}

// ============================================================================
// Sequence diagram SVG renderer
//
// Renders a positioned sequence diagram to SVG string.
// All colors use CSS custom properties (var(--_xxx)) from the theme system.
//
// Render order (back to front):
//   1. Block backgrounds (loop/alt/opt)
//   2. Lifelines (dashed vertical lines)
//   3. Activation boxes
//   4. Messages (arrows with labels)
//   5. Notes
//   6. Actor boxes (at top)
// ============================================================================

/**
 * Render a positioned sequence diagram as an SVG string.
 *
 * @param colors - DiagramColors with bg/fg and optional enrichment variables.
 * @param transparent - If true, renders with transparent background.
 */
export function renderSequenceSvg(
  diagram: PositionedSequenceDiagram,
  colors: DiagramColors,
  font: string = 'Inter',
  transparent: boolean = false,
  options: RenderOptions = {},
): string {
  const parts: string[] = []
  const style = resolveRenderStyle(options, SEQUENCE_STYLE_DEFAULTS)
  const uid = `seq-${hashAccessibility(diagram.width, diagram.height, diagram.actors.length, diagram.messages.length)}`
  const titleId = `${uid}-title`
  const descId = `${uid}-desc`
  const rootAttrs = buildAccessibilityAttrs(diagram.accessibilityTitle, diagram.accessibilityDescription, titleId, descId)

  // SVG root with CSS variables + style block + defs
  parts.push(svgOpenTag(diagram.width, diagram.height, colors, transparent, rootAttrs))
  parts.push(buildStyleBlock(font, false, colors.shadow, colors.embedFontImport))
  parts.push('<defs>')

  // Arrow marker definitions
  parts.push(arrowMarkerDefs())
  const shadowDefs = buildShadowDefs(colors)
  if (shadowDefs) parts.push(shadowDefs)
  parts.push('</defs>')

  if (diagram.accessibilityTitle) {
    parts.push(`<title id="${titleId}">${escapeXml(diagram.accessibilityTitle)}</title>`)
  }
  if (diagram.accessibilityDescription) {
    parts.push(`<desc id="${descId}">${escapeXml(diagram.accessibilityDescription)}</desc>`)
  }

  // 1. Block backgrounds (loop/alt/opt rectangles)
  for (const block of diagram.blocks) {
    parts.push(renderBlock(block, style))
  }

  // 2. Lifelines (dashed vertical lines from actor to bottom)
  for (const lifeline of diagram.lifelines) {
    parts.push(renderLifeline(lifeline, style))
  }

  // 3. Activation boxes
  for (const activation of diagram.activations) {
    parts.push(renderActivation(activation))
  }

  // 4. Messages (horizontal arrows with labels)
  for (const message of diagram.messages) {
    parts.push(renderMessage(message, style))
  }

  // 5. Notes
  for (const note of diagram.notes) {
    parts.push(renderNote(note, style))
  }

  // 6. Actor boxes at top (rendered last so they're on top)
  for (const actor of diagram.actors) {
    parts.push(renderActor(actor, style))
  }

  parts.push('</svg>')
  return parts.join('\n')
}

// ============================================================================
// Arrow marker definitions
// ============================================================================

function arrowMarkerDefs(): string {
  const w = ARROW_HEAD.width
  const h = ARROW_HEAD.height
  return (
    `  <marker id="seq-arrow" markerWidth="${w}" markerHeight="${h}" refX="${w}" refY="${h / 2}" orient="auto-start-reverse">` +
    `\n    <polygon points="0 0, ${w} ${h / 2}, 0 ${h}" fill="var(--_arrow)" />` +
    `\n  </marker>` +
    // Open arrow head (just lines, no fill)
    `\n  <marker id="seq-arrow-open" markerWidth="${w}" markerHeight="${h}" refX="${w}" refY="${h / 2}" orient="auto-start-reverse">` +
    `\n    <polyline points="0 0, ${w} ${h / 2}, 0 ${h}" fill="none" stroke="var(--_arrow)" stroke-width="1" />` +
    `\n  </marker>`
  )
}

// ============================================================================
// Component renderers
// ============================================================================

/**
 * Render an actor box (participant = rectangle, actor = stick figure).
 * Wrapped in <g class="actor"> with semantic data attributes.
 */
function renderActor(actor: PositionedActor, style: ResolvedRenderStyle): string {
  const { id, x, y, width, height, label, type } = actor
  const parts: string[] = []

  // Semantic wrapper with actor metadata
  parts.push(
    `<g class="actor" data-id="${escapeAttr(id)}" data-label="${escapeAttr(label)}" data-type="${type}">`
  )

  if (type === 'actor') {
    // Circle-person icon: outer circle + head circle + shoulders arc.
    // Defined in a 24×24 coordinate space, scaled to 90% of the actor box height
    // and centered both horizontally and vertically within the box.
    // Stroke width is inverse-scaled so the visual thickness matches STROKE_WIDTHS.outerBox.
    const s = (height / 24) * 0.9
    const tx = x - 12 * s            // center icon horizontally on actor.x
    const ty = y + (height - 24 * s) / 2  // center icon vertically in actor box
    const sw = style.nodeLineWidth / s  // compensate for scale transform
    const iconStroke = 'var(--_line)'      // use line color for actor icon strokes

    parts.push(
      `  <g transform="translate(${tx},${ty}) scale(${s})">` +
      // Outer circle
      `\n    <path d="M21 12C21 16.9706 16.9706 21 12 21C7.02944 21 3 16.9706 3 12C3 7.02944 7.02944 3 12 3C16.9706 3 21 7.02944 21 12Z" fill="none" stroke="${iconStroke}" stroke-width="${sw}" />` +
      // Head
      `\n    <path d="M15 10C15 11.6569 13.6569 13 12 13C10.3431 13 9 11.6569 9 10C9 8.34315 10.3431 7 12 7C13.6569 7 15 8.34315 15 10Z" fill="none" stroke="${iconStroke}" stroke-width="${sw}" />` +
      // Shoulders
      `\n    <path d="M5.62842 18.3563C7.08963 17.0398 9.39997 16 12 16C14.6 16 16.9104 17.0398 18.3716 18.3563" fill="none" stroke="${iconStroke}" stroke-width="${sw}" />` +
      `\n  </g>`
    )
    // Label below the icon (supports multi-line)
    parts.push(
      '  ' + renderMultilineText(label, x, y + height + 14, style.nodeLabelFontSize,
        `font-size="${style.nodeLabelFontSize}" text-anchor="middle" font-weight="${style.nodeLabelFontWeight}"${letterAttr(style.nodeLetterSpacing)} fill="var(--_text)"`)
    )
  } else {
    // Participant: rectangle box with label (supports multi-line)
    const boxX = x - width / 2
    parts.push(
      `  <rect x="${boxX}" y="${y}" width="${width}" height="${height}" rx="${style.cornerRadius ?? 4}" ry="${style.cornerRadius ?? 4}" ` +
      `fill="var(--_node-fill)" stroke="var(--_node-stroke)" stroke-width="${style.nodeLineWidth}" />`
    )
    parts.push(
      '  ' + renderMultilineText(label, x, y + height / 2, style.nodeLabelFontSize,
        `font-size="${style.nodeLabelFontSize}" text-anchor="middle" font-weight="${style.nodeLabelFontWeight}"${letterAttr(style.nodeLetterSpacing)} fill="var(--_text)"`)
    )
  }

  parts.push('</g>')
  return parts.join('\n')
}

/**
 * Render a lifeline (dashed vertical line from actor to bottom).
 * Includes data-actor to link to its actor.
 */
function renderLifeline(lifeline: Lifeline, style: ResolvedRenderStyle): string {
  return (
    `<line class="lifeline" data-actor="${escapeAttr(lifeline.actorId)}" ` +
    `x1="${lifeline.x}" y1="${lifeline.topY}" x2="${lifeline.x}" y2="${lifeline.bottomY}" ` +
    `stroke="var(--_line)" stroke-width="${Math.max(0.75, style.lineWidth * 0.75)}" stroke-dasharray="6 4" />`
  )
}

/**
 * Render an activation box (narrow filled rectangle on lifeline).
 * Includes data-actor to link to its actor.
 */
function renderActivation(activation: Activation): string {
  return (
    `<rect class="activation" data-actor="${escapeAttr(activation.actorId)}" ` +
    `x="${activation.x}" y="${activation.topY}" width="${activation.width}" height="${activation.bottomY - activation.topY}" ` +
    `fill="var(--_node-fill)" stroke="var(--_node-stroke)" stroke-width="${STROKE_WIDTHS.innerBox}" />`
  )
}

/**
 * Render a message arrow with label.
 * Wrapped in <g class="message"> with semantic data attributes.
 */
function renderMessage(msg: PositionedMessage, style: ResolvedRenderStyle): string {
  const parts: string[] = []
  const dashArray = msg.lineStyle === 'dashed' ? ' stroke-dasharray="6 4"' : ''
  const markerId = msg.arrowHead === 'filled' ? 'seq-arrow' : 'seq-arrow-open'

  // Semantic wrapper with message metadata
  parts.push(
    `<g class="message" data-from="${escapeAttr(msg.from)}" data-to="${escapeAttr(msg.to)}" ` +
    `data-label="${escapeAttr(msg.label)}" data-line-style="${msg.lineStyle}" ` +
    `data-arrow-head="${msg.arrowHead}" data-self="${msg.isSelf}">`
  )

  if (msg.isSelf) {
    // Self-message: curved loop going right and back
    // Loop dimensions - loopH is fixed, loopW provides minimum clearance
    const loopW = 30
    const loopH = 20
    const labelPadding = 8 // Space between loop and label
    parts.push(
      `  <polyline points="${msg.x1},${msg.y} ${msg.x1 + loopW},${msg.y} ${msg.x1 + loopW},${msg.y + loopH} ${msg.x2},${msg.y + loopH}" ` +
      `fill="none" stroke="var(--_line)" stroke-width="${style.lineWidth}"${dashArray} marker-end="url(#${markerId})" />`
    )
    // Label to the right of the loop (supports multi-line)
    parts.push(
      '  ' + renderMultilineText(msg.label, msg.x1 + loopW + labelPadding, msg.y + loopH / 2, style.edgeLabelFontSize,
        `font-size="${style.edgeLabelFontSize}" text-anchor="start" font-weight="${style.edgeLabelFontWeight}"${letterAttr(style.edgeLetterSpacing)} fill="var(--_text-muted)"`)
    )
  } else {
    // Normal message: horizontal arrow
    parts.push(
      `  <line x1="${msg.x1}" y1="${msg.y}" x2="${msg.x2}" y2="${msg.y}" ` +
      `stroke="var(--_line)" stroke-width="${style.lineWidth}"${dashArray} marker-end="url(#${markerId})" />`
    )
    // Label above the arrow, centered (supports multi-line)
    const midX = (msg.x1 + msg.x2) / 2
    parts.push(
      '  ' + renderMultilineText(msg.label, midX, msg.y - 10, style.edgeLabelFontSize,
        `font-size="${style.edgeLabelFontSize}" text-anchor="middle" font-weight="${style.edgeLabelFontWeight}"${letterAttr(style.edgeLetterSpacing)} fill="var(--_text-muted)"`)
    )
  }

  parts.push('</g>')
  return parts.join('\n')
}

/**
 * Render a block background (loop/alt/opt).
 * Wrapped in <g class="block"> with semantic data attributes.
 */
function renderBlock(block: PositionedBlock, style: ResolvedRenderStyle): string {
  const parts: string[] = []

  // Semantic wrapper with block metadata
  const labelAttr = block.label ? ` data-label="${escapeAttr(block.label)}"` : ''
  parts.push(
    `<g class="block" data-type="${escapeAttr(block.type)}"${labelAttr}>`
  )

  // Outer rectangle
  parts.push(
    `  <rect x="${block.x}" y="${block.y}" width="${block.width}" height="${block.height}" ` +
    `rx="${style.groupCornerRadius}" ry="${style.groupCornerRadius}" fill="none" stroke="${escapeAttr(style.groupBorderColor ?? 'var(--_node-stroke)')}" stroke-width="${style.groupLineWidth}" />`
  )

  // Type label tab (top-left corner)
  // For multi-line block labels, we use the first line for the tab but show full label
  const labelText = `${block.type}${block.label ? ` [${block.label}]` : ''}`
  const firstLine = labelText.split('\n')[0]!
  const tabWidth = estimateTextWidth(firstLine, style.groupHeaderFontSize, style.groupHeaderFontWeight) + style.groupPaddingX * 2
  const tabHeight = Math.max(18, style.groupHeaderFontSize + style.groupPaddingY)

  parts.push(
    `  <rect x="${block.x}" y="${block.y}" width="${tabWidth}" height="${tabHeight}" ` +
    `fill="var(--_group-hdr)" stroke="${escapeAttr(style.groupBorderColor ?? 'var(--_node-stroke)')}" stroke-width="${style.groupLineWidth}" />`
  )
  // Block type label (supports multi-line via <br> tags)
  parts.push(
    '  ' + renderMultilineText(
      labelText,
      block.x + style.groupLabelPaddingX,
      block.y + tabHeight / 2,
      style.groupHeaderFontSize,
      `font-size="${style.groupHeaderFontSize}" font-weight="${style.groupHeaderFontWeight}"${style.groupFont ? ` font-family="${escapeAttr(style.groupFont)}"` : ''}${letterAttr(style.groupLetterSpacing)} fill="var(--_text-sec)"`
    )
  )

  // Divider lines (for alt/else, par/and)
  for (const divider of block.dividers) {
    parts.push(
      `  <line x1="${block.x}" y1="${divider.y}" x2="${block.x + block.width}" y2="${divider.y}" ` +
      `stroke="var(--_line)" stroke-width="${Math.max(0.75, style.lineWidth * 0.75)}" stroke-dasharray="6 4" />`
    )
    if (divider.label) {
      // Divider label supports multi-line
      parts.push(
        '  ' + renderMultilineText(`[${divider.label}]`, block.x + 8, divider.y + 14, style.edgeLabelFontSize,
          `font-size="${style.edgeLabelFontSize}" text-anchor="start" font-weight="${style.edgeLabelFontWeight}"${letterAttr(style.edgeLetterSpacing)} fill="var(--_text-muted)"`)
      )
    }
  }

  parts.push('</g>')
  return parts.join('\n')
}

/**
 * Render a note box.
 * Wrapped in <g class="note"> with semantic data attributes.
 */
function renderNote(note: PositionedNote, style: ResolvedRenderStyle): string {
  const { x, y, width: w, height: h } = note

  const actorsAttr = note.actors && note.actors.length > 0
    ? ` data-actors="${note.actors.map(escapeAttr).join(',')}"`
    : ''
  const positionAttr = note.position ? ` data-position="${escapeAttr(note.position)}"` : ''

  return (
    `<g class="note"${positionAttr}${actorsAttr}>` +
    `\n  <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${style.cornerRadius ?? 0}" ry="${style.cornerRadius ?? 0}" ` +
    `fill="var(--bg)" stroke="var(--_node-stroke)" stroke-width="${STROKE_WIDTHS.innerBox}" />` +
    `\n  ${renderMultilineText(note.text, x + w / 2, y + h / 2, style.nodeLabelFontSize,
      `font-size="${style.nodeLabelFontSize}" text-anchor="middle" font-weight="${style.nodeLabelFontWeight}"${letterAttr(style.nodeLetterSpacing)} fill="var(--_text-muted)"`)}` +
    `\n</g>`
  )
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
function buildAccessibilityAttrs(
  title: string | undefined,
  description: string | undefined,
  titleId: string,
  descId: string,
): Record<string, string> {
  if (!title && !description) return {}
  const attrs: Record<string, string> = { role: 'img' }
  if (title) attrs['aria-labelledby'] = titleId
  if (description) attrs['aria-describedby'] = descId
  return attrs
}

function hashAccessibility(...values: Array<string | number>): string {
  let h = 0x811c9dc5
  const text = values.join('|')
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(36)
}

function escapeAttr(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}
