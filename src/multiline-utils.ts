// ============================================================================
// Multi-line Text Rendering Utilities
//
// Shared utilities for rendering multi-line text in SVG using <tspan> elements.
// Supports inline formatting: <b>, <i>, <u>, <s> mapped to SVG attributes.
// Used across all diagram types (flowcharts, state, sequence, class, ER).
// ============================================================================

import { LINE_HEIGHT_RATIO } from './text-metrics.ts'
import { formatSvgNumber } from './shared/svg-number.ts'
import { HAS_FORMAT_TAGS } from './shared/inline-format.ts'
import { prepareDisplayText, type DisplayRun, type DisplayTextInput } from './shared/display-text.ts'
import type { PixelTextBlock } from './shared/prepared-text.ts'
import { sanitizeDisplayLines } from './shared/text-controls.ts'

/**
 * Normalize label text: strip surrounding quotes, convert <br> tags and
 * literal \n sequences to newline characters. Strips unsupported HTML tags
 * but preserves formatting tags (<b>, <i>, <u>, <s>) for SVG rendering, and
 * maps markdown-lite emphasis (`**b**`, `*i*`, `~~s~~`) to those tags.
 */
export function normalizeBrTags(label: string, escapedLineBreaks = true): string {
  return normalizeMarkdownEmphasis(normalizePlainLabel(label, escapedLineBreaks))
}

/** Shared markdown-lite emphasis, without a family's quoting or line grammar. */
export function normalizeMarkdownEmphasis(label: string): string {
  return label
    // Markdown formatting → HTML tags (order matters: ** before *)
    .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
    .replace(/(?<!\*)\*([^\s*](?:[^*]*[^\s*])?)\*(?!\*)/g, '<i>$1</i>')
    .replace(/~~(.+?)~~/g, '<s>$1</s>')
}

/**
 * normalizeBrTags without the markdown-lite emphasis: `*` and `~` stay
 * literal. Flowchart plain labels use it, because upstream formats emphasis
 * only inside markdown strings ("`…`"). `escapedLineBreaks: false` keeps a
 * `\n` sequence literal, as upstream's markdown strings do (since 11.13).
 */
export function normalizePlainLabel(label: string, escapedLineBreaks = true): string {
  // Strip surrounding double quotes (Mermaid uses them for special chars in labels)
  const unquoted = label.startsWith('"') && label.endsWith('"') ? label.slice(1, -1) : label
  const broken = breakLineTags(unquoted)
  return (escapedLineBreaks ? broken.replace(/\\n/g, '\n') : broken)
    .replace(/<\/?(?:sub|sup|small|mark)\s*>/gi, '')
}

/** Upstream's line-break spellings (`common.lineBreakRegex`): `<br>`, `<br/>`,
 * `<br />`, in any case. */
const LINE_BREAK_TAG = /<br\s*\/?>/gi

/**
 * Turn every `<br>` spelling into a newline and leave all other text as
 * written. The one line-break rule: the label normalizers use it, and so do
 * contexts that are otherwise literal (Gantt section titles).
 */
export function breakLineTags(text: string): string {
  return text.replace(LINE_BREAK_TAG, '\n')
}

/**
 * How a context displays a normalized label. In both, `\n` breaks the line
 * and tag-like text other than the formatting tags (`a<c>d`) is text.
 * - `formatted`: the formatting tags (<b>/<strong>, <i>/<em>, <u>, <s>/<del>)
 *   style runs and are not text (renderMultilineText's default).
 * - `literal`: every character is text, formatting tags included (Pie,
 *   Timeline, Gantt, XYChart and GitGraph draw labels as written).
 */
export type LabelDisplay = 'formatted' | 'literal'

/**
 * The characters a normalized label shows, one `\n` per line break. This is
 * the one display interpretation of label text: SVG text, ASCII/Unicode
 * cells, the ASCII meta `projectedText`, label metrics and the Scene fidelity
 * check all read labels through it, so they cannot disagree about which tags
 * are formatting and which are text.
 */
export function displayText(label: DisplayTextInput, display: LabelDisplay = 'formatted'): string {
  return prepareDisplayText(label, display).lines.map(runs => runs.map(run => run.text).join('')).join('\n')
}

const XML_SPECIAL = /[&<>"']/
const ATTRIBUTE_SPECIAL = /[&<>"'\t\n\r]/

/**
 * Escape special XML characters in text content.
 */
export function escapeXml(text: string): string {
  // Most values hold none of these; skip the five passes when nothing changes.
  if (typeof text === 'string' && !XML_SPECIAL.test(text)) return text
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/**
 * Escape a double-quoted XML attribute without XML whitespace normalization
 * changing its semantic value. Character references preserve authored TAB, LF
 * and CR; element text retains its separate display interpretation.
 */
export function escapeAttr(text: string): string {
  if (typeof text === 'string' && !ATTRIBUTE_SPECIAL.test(text)) return text
  return escapeXml(text).replace(/[\t\n\r]/g, character => character === '\t' ? '&#9;' : character === '\n' ? '&#10;' : '&#13;')
}

/** Display metadata follows the same inert-control interpretation as labels.
 * Semantic IDs and references must use escapeAttr directly. */
export function escapeDisplayAttr(text: string): string {
  return escapeAttr(sanitizeDisplayLines(text))
}

// ============================================================================
// Inline formatting: <b>, <i>, <u>, <s> → SVG tspan attributes
// ============================================================================

/**
 * Render one line of a label as SVG text content under its display
 * interpretation (see displayText): `formatted` applies the formatting tags as
 * tspan attributes, `literal` escapes every character as text. Returns raw SVG
 * content (no wrapping tspan — caller provides positioning).
 */
export function renderDisplayLine(line: string, display: LabelDisplay = 'formatted'): string {
  // Fast path: literal text, or no formatting tags
  if (display === 'literal' || !HAS_FORMAT_TAGS.test(line)) return escapeXml(line)

  return renderDisplayRuns(prepareDisplayText(line, display).lines[0]!)
}

/** Paint interpreted runs directly. Prepared labels never pass through a tag
 * parser again, even when their visible characters spell formatting tags. */
function displayRunAttributes(seg: DisplayRun, fontWeight = 400): string[] {
  const attrs: string[] = []
  if (seg.bold) attrs.push(`font-weight="${fontWeight > 700 ? fontWeight : 'bold'}"`)
  if (seg.italic) attrs.push('font-style="italic"')
  const deco: string[] = []
  if (seg.underline) deco.push('underline')
  if (seg.strikethrough) deco.push('line-through')
  if (deco.length) attrs.push(`text-decoration="${deco.join(' ')}"`)
  return attrs
}

function renderDisplayRuns(segments: readonly DisplayRun[], fontWeight = 400): string {
  if (segments.length === 0) return ''

  // If all segments are unstyled, just escape
  const allPlain = segments.every(s => !s.bold && !s.italic && !s.underline && !s.strikethrough)
  if (allPlain) return segments.map(s => escapeXml(s.text)).join('')

  return segments.map(seg => {
    const escaped = escapeXml(seg.text)
    if (!seg.bold && !seg.italic && !seg.underline && !seg.strikethrough) return escaped

    return `<tspan ${displayRunAttributes(seg, fontWeight).join(' ')}>${escaped}</tspan>`
  }).join('')
}

/** Tracking and fallback shaping are not uniformly included in textLength by
 * SVG rasterizers. Position these graphemes in the measured band explicitly;
 * ordinary untracked single-font runs keep their continuous shaping. */
function renderPreparedLine(block: PixelTextBlock, index: number, cx: number, anchor: string, baseline?: number): string {
  const line = block.lineBlocks[index]!
  // Keep the complete logical line in one shaping context. In particular,
  // spaces do not separate RTL words into left-to-right positioned fragments,
  // and a combining cluster may span formatting descendants.
  if (/[^\x20-\x7e]/u.test(line.runs.map(run => run.text).join(''))) {
    const center = anchor === 'start' ? cx + line.width / 2 : anchor === 'end' ? cx - line.width / 2 : cx
    return `<tspan x="${formatSvgNumber(center)}"${baseline === undefined ? '' : ` y="${formatSvgNumber(baseline)}"`} text-anchor="middle" data-text-fragment="true">${renderDisplayRuns(line.runs, block.fontWeight)}</tspan>`
  }
  if (block.letterSpacing === 0 && !line.fragments) return renderDisplayRuns(line.runs, block.fontWeight)
  if (!line.fragments) throw new TypeError('Tracked text requires retained fragment allocations')
  const origin = (anchor === 'middle' ? cx - line.width / 2 : anchor === 'end' ? cx - line.width : cx) + line.originX
  return line.fragments.map(fragment => {
    const style = displayRunAttributes(line.runs[fragment.runIndex]!, block.fontWeight)
    const whitespace = /^ | $/.test(fragment.text) ? ' xml:space="preserve"' : ''
    return `<tspan x="${formatSvgNumber(origin + fragment.x)}" text-anchor="start" letter-spacing="0" data-text-fragment="true" textLength="${formatSvgNumber(Math.max(0, fragment.width))}" lengthAdjust="spacingAndGlyphs"${whitespace}${style.length ? ` ${style.join(' ')}` : ''}>${escapeXml(fragment.text)}</tspan>`
  }).join('')
}

// ============================================================================
// Multi-line text rendering
// ============================================================================

export interface PreparedSingleLineWrite {
  readonly x: string
  readonly y: string
  readonly dy: string
  readonly textLength: string
  readonly content: string
  readonly additionalAttributes: readonly { readonly name: string; readonly value: string }[]
}

/**
 * Render a multi-line text element with proper vertical centering.
 *
 * For single-line text, returns a simple <text> element.
 * For multi-line text (containing \n), returns <text> with <tspan> children.
 * Inline formatting tags (<b>, <i>, <u>, <s>) are rendered as SVG attributes.
 *
 * @param text - The text to render (may contain \n and formatting tags)
 * @param cx - Center x coordinate
 * @param cy - Center y coordinate
 * @param fontSize - Font size in pixels
 * @param attrs - Additional SVG attributes (e.g., 'text-anchor="middle" fill="var(--_text)"')
 * @param baselineShift - Baseline shift for vertical alignment (default 0.35)
 * @returns SVG text element string
 */
export function renderMultilineText(
  text: string | PixelTextBlock,
  cx: number,
  cy: number,
  fontSize: number,
  attrs: string,
  baselineShift: number = 0.35,
  literalText = false,
  observePreparedLine?: (written: PreparedSingleLineWrite) => void,
): string {
  const block = typeof text === 'string' ? undefined : text
  const value = block ? block.text : text as string
  const lines = block ? block.lines : value.split('\n')
  const display = block?.prepared.display ?? (literalText ? 'literal' : 'formatted')
  const anchor = attrs.match(/\btext-anchor="([^"]*)"/)?.[1] ?? 'start'
  const nativeShaping = block && /[^\x20-\x7e]/u.test(block.lineBlocks.map(line => line.runs.map(run => run.text).join('')).join(''))
  const fragmented = block && (block.letterSpacing !== 0 || nativeShaping)
  const writtenAttributes: Array<{ name: string; value: string }> | undefined = observePreparedLine ? [] : undefined
  const renderLine = (line: string, index: number) => block
    ? renderPreparedLine(block, index, cx, anchor)
    : renderDisplayLine(line, display)
  if (display === 'literal' && HAS_FORMAT_TAGS.test(value) && !attrs.includes('data-literal-text=')) { attrs += ' data-literal-text="true"'; if (writtenAttributes) Object.defineProperty(writtenAttributes, writtenAttributes.length, { value: { name: 'data-literal-text', value: 'true' }, enumerable: true, writable: true, configurable: true }) }
  const visible = block ? block.lineBlocks.map(line => line.runs.map(run => run.text).join('')).join('\n') : displayText(value, display)
  if (/(?:^ | $| {2}|\t)/m.test(visible) && !attrs.includes('xml:space=')) { attrs += ' xml:space="preserve"'; if (writtenAttributes) Object.defineProperty(writtenAttributes, writtenAttributes.length, { value: { name: 'xml:space', value: 'preserve' }, enumerable: true, writable: true, configurable: true }) }
  if (block) attrs += ' data-prepared-text="true"'
  let servedAdvance: string | undefined
  const advanceAttrs = (i: number) => {
    if (!block || fragmented || block.lineBlocks[i]!.fragments) return ''
    const width = formatSvgNumber(block.lineBlocks[i]!.width)
    if (observePreparedLine && i === 0) servedAdvance = width
    return ` textLength="${width}" lengthAdjust="spacingAndGlyphs" data-font-metrics="deterministic-fit"`
  }

  // Single line — simple text element
  if (lines.length === 1) {
    const dy = fontSize * baselineShift
    if (nativeShaping) return `<text x="${formatSvgNumber(cx)}" y="${formatSvgNumber(cy)}" ${attrs}>${renderPreparedLine(block, 0, cx, anchor, cy + dy)}</text>`
    if (observePreparedLine) {
      const x = formatSvgNumber(cx), y = formatSvgNumber(cy), baseline = formatSvgNumber(dy)
      const advance = advanceAttrs(0), content = renderLine(value, 0)
      const svg = `<text x="${x}" y="${y}" ${attrs} dy="${baseline}"${advance}>${content}</text>`
      if (block && servedAdvance !== undefined) observePreparedLine({ x, y, dy: baseline, textLength: servedAdvance, content, additionalAttributes: writtenAttributes! })
      return svg
    }
    return `<text x="${formatSvgNumber(cx)}" y="${formatSvgNumber(cy)}" ${attrs} dy="${formatSvgNumber(dy)}"${advanceAttrs(0)}>${renderLine(value, 0)}</text>`
  }

  // Multi-line — use tspan elements with vertical centering
  const lineHeight = block?.lineHeight ?? fontSize * LINE_HEIGHT_RATIO
  // First line dy: shift up by (n-1)/2 line heights, then add baseline shift
  const firstDy = -((lines.length - 1) / 2) * lineHeight + fontSize * baselineShift

  const tspans = lines.map((line, i) => {
    const dy = i === 0 ? firstDy : lineHeight
    // Native RTL fragments can consume relative advances in visual order.
    // Pin every baseline independently of the fragments' visual order.
    const position = nativeShaping ? `y="${formatSvgNumber(cy + firstDy + i * lineHeight)}"` : `dy="${formatSvgNumber(dy)}"`
    return `<tspan x="${formatSvgNumber(cx)}" ${position}${advanceAttrs(i)}>${renderLine(line, i)}</tspan>`
  }).join('')

  return `<text x="${formatSvgNumber(cx)}" y="${formatSvgNumber(cy)}" ${attrs}>${tspans}</text>`
}

/**
 * Render a multi-line text element with a background rectangle (pill).
 *
 * Used for edge labels that need a background for readability.
 *
 * @param text - The text to render (may contain \n)
 * @param cx - Center x coordinate
 * @param cy - Center y coordinate
 * @param textWidth - Pre-calculated text width (max line width)
 * @param textHeight - Pre-calculated text height (lines × lineHeight)
 * @param fontSize - Font size in pixels
 * @param padding - Padding around text
 * @param textAttrs - SVG attributes for the text element
 * @param bgAttrs - SVG attributes for the background rect
 * @returns SVG elements string (rect + text)
 */
export function renderMultilineTextWithBackground(
  text: string | PixelTextBlock,
  cx: number,
  cy: number,
  textWidth: number,
  textHeight: number,
  fontSize: number,
  padding: number,
  textAttrs: string,
  bgAttrs: string
): string {
  const bgWidth = textWidth + padding * 2
  const bgHeight = textHeight + padding * 2

  const rect = `<rect x="${cx - bgWidth / 2}" y="${cy - bgHeight / 2}" ` +
    `width="${bgWidth}" height="${bgHeight}" ${bgAttrs} />`

  const textEl = renderMultilineText(text, cx, cy, fontSize, textAttrs)

  return `${rect}\n${textEl}`
}
