// ============================================================================
// Multi-line Text Rendering Utilities
//
// Shared utilities for rendering multi-line text in SVG using <tspan> elements.
// Supports inline formatting: <b>, <i>, <u>, <s> mapped to SVG attributes.
// Used across all diagram types (flowcharts, state, sequence, class, ER).
// ============================================================================

import { LINE_HEIGHT_RATIO } from './text-metrics.ts'
import { HAS_FORMAT_TAGS, parseInlineFormatting, plainTextFromInlineFormatting } from './shared/inline-format.ts'

/**
 * Normalize label text: strip surrounding quotes, convert <br> tags and
 * literal \n sequences to newline characters. Strips unsupported HTML tags
 * but preserves formatting tags (<b>, <i>, <u>, <s>) for SVG rendering, and
 * maps markdown-lite emphasis (`**b**`, `*i*`, `~~s~~`) to those tags.
 */
export function normalizeBrTags(label: string, escapedLineBreaks = true): string {
  return normalizePlainLabel(label, escapedLineBreaks)
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
export function displayText(label: string, display: LabelDisplay = 'formatted'): string {
  return display === 'literal' ? label : plainTextFromInlineFormatting(label)
}

/**
 * Escape special XML characters in text content.
 */
export function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/**
 * Escape text for use inside a double-quoted XML attribute. The escape set is
 * the same one escapeXml uses — a superset of what attributes strictly need —
 * so element text and attribute values stay consistent everywhere.
 */
export function escapeAttr(text: string): string {
  return escapeXml(text)
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

  const segments = parseInlineFormatting(line)
  if (segments.length === 0) return ''

  // If all segments are unstyled, just escape
  const allPlain = segments.every(s => !s.bold && !s.italic && !s.underline && !s.strikethrough)
  if (allPlain) return segments.map(s => escapeXml(s.text)).join('')

  return segments.map(seg => {
    const escaped = escapeXml(seg.text)
    if (!seg.bold && !seg.italic && !seg.underline && !seg.strikethrough) return escaped

    const attrs: string[] = []
    if (seg.bold) attrs.push('font-weight="bold"')
    if (seg.italic) attrs.push('font-style="italic"')
    // SVG text-decoration can combine values
    const deco: string[] = []
    if (seg.underline) deco.push('underline')
    if (seg.strikethrough) deco.push('line-through')
    if (deco.length) attrs.push(`text-decoration="${deco.join(' ')}"`)

    return `<tspan ${attrs.join(' ')}>${escaped}</tspan>`
  }).join('')
}

// ============================================================================
// Multi-line text rendering
// ============================================================================

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
  text: string,
  cx: number,
  cy: number,
  fontSize: number,
  attrs: string,
  baselineShift: number = 0.35,
  literalText = false,
): string {
  const lines = text.split('\n')
  const renderLine = (line: string) => renderDisplayLine(line, literalText ? 'literal' : 'formatted')

  // Single line — simple text element
  if (lines.length === 1) {
    const dy = fontSize * baselineShift
    return `<text x="${cx}" y="${cy}" ${attrs} dy="${dy}">${renderLine(text)}</text>`
  }

  // Multi-line — use tspan elements with vertical centering
  const lineHeight = fontSize * LINE_HEIGHT_RATIO
  // First line dy: shift up by (n-1)/2 line heights, then add baseline shift
  const firstDy = -((lines.length - 1) / 2) * lineHeight + fontSize * baselineShift

  const tspans = lines.map((line, i) => {
    const dy = i === 0 ? firstDy : lineHeight
    return `<tspan x="${cx}" dy="${dy}">${renderLine(line)}</tspan>`
  }).join('')

  return `<text x="${cx}" y="${cy}" ${attrs}>${tspans}</text>`
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
  text: string,
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
