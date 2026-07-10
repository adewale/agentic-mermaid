// ============================================================================
// Quadrant point styling — ONE grammar, ONE resolution site.
//
// Upstream contract (merged mermaid-js/mermaid#5173, documented at
// mermaid.js.org/syntax/quadrantChart):
//   direct styles   `Label: [x, y] radius: 12, color: #ff3300,
//                    stroke-color: #10f0f0, stroke-width: 5px`
//   class styles    `classDef class1 color: #109060, radius : 10`
//   application     `Label:::class1: [x, y]`
//   precedence      direct > class > theme/config defaults.
//
// This module is consumed by the renderer parser (loud errors), the agent
// body (null → opaque fallback), the layout (radius geometry), and the SVG
// renderer (paint) — so the style grammar and the precedence rule cannot
// drift between surfaces.
//
// Value validation is deliberately strict (the family's loud-error policy):
//   radius        a non-negative number
//   stroke-width  a non-negative number with an optional px suffix
//   color / stroke-color
//                 a conservative CSS-color charset (hex, named, rgb()/hsl()
//                 functional forms); characters that could escape an SVG
//                 style attribute (quotes, semicolons, braces, angle
//                 brackets) are rejected.
// ============================================================================

import { isSafeCssColor } from '../shared/css-color.ts'

/** Typed per-point style properties (upstream's documented set). */
export interface QuadrantPointStyle {
  radius?: number
  color?: string
  strokeColor?: string
  strokeWidth?: string
  /** Unknown-but-safe `key: value` entries, verbatim in source order.
   *  Upstream's jison grammar accepts any entry and applies only the four
   *  properties above; these round-trip losslessly, never render, and are
   *  named by verify's quadrant_style_property diagnostic. */
  extra?: string[]
}

/** classDef table: class name → style, in source order. */
export type QuadrantClassDefs = Record<string, QuadrantPointStyle>

export type StyleParseResult =
  | { ok: true; style: QuadrantPointStyle | undefined }
  | { ok: false; error: string }

const CLASS_NAME_RE = /^[A-Za-z_][\w-]*$/
const RADIUS_RE = /^\d+(?:\.\d+)?$/
const STROKE_WIDTH_RE = /^\d+(?:\.\d+)?(?:px)?$/
const SAFE_EXTRA_VALUE_RE = /^[#\w][\w#(),.%+\s/~-]*$/

/** Split style entries at commas outside CSS function parentheses. */
function splitTopLevelEntries(value: string): string[] | null {
  const entries: string[] = []
  let start = 0
  let depth = 0
  for (let i = 0; i < value.length; i++) {
    const char = value[i]!
    if (char === '(') depth++
    else if (char === ')') {
      depth--
      if (depth < 0) return null
    } else if (char === ',' && depth === 0) {
      entries.push(value.slice(start, i))
      start = i + 1
    }
  }
  if (depth !== 0) return null
  entries.push(value.slice(start))
  return entries
}

/**
 * Parse a comma-separated `key: value` style tail (the text after a point's
 * coordinates, or after a classDef's name). An empty tail is valid and yields
 * no style. Unknown keys and malformed values return an error message — the
 * caller decides whether to throw (renderer parser) or fall back to opaque
 * (agent body).
 */
export function parsePointStyleEntries(tail: string): StyleParseResult {
  const trimmed = tail.trim()
  if (trimmed.length === 0) return { ok: true, style: undefined }
  const style: QuadrantPointStyle = {}
  let any = false
  const parts = splitTopLevelEntries(trimmed)
  if (!parts) return { ok: false, error: 'style functions have unbalanced parentheses' }
  for (const part of parts) {
    const entry = part.trim()
    if (!entry) continue
    const m = entry.match(/^([a-z][\w-]*)\s*:\s*(.+)$/i)
    if (!m) return { ok: false, error: `malformed style entry "${entry}" (expected key: value)` }
    const key = m[1]!.toLowerCase()
    const value = m[2]!.trim()
    switch (key) {
      case 'radius': {
        if (!RADIUS_RE.test(value)) return { ok: false, error: `radius must be a non-negative number, got "${value}"` }
        style.radius = Number.parseFloat(value)
        break
      }
      case 'color': {
        if (!isSafeCssColor(value)) return { ok: false, error: `color has unsupported characters or syntax: "${value}"` }
        style.color = value
        break
      }
      case 'stroke-color': {
        if (!isSafeCssColor(value)) return { ok: false, error: `stroke-color has unsupported characters or syntax: "${value}"` }
        style.strokeColor = value
        break
      }
      case 'stroke-width': {
        if (!STROKE_WIDTH_RE.test(value)) return { ok: false, error: `stroke-width must be a number with optional px suffix, got "${value}"` }
        style.strokeWidth = value
        break
      }
      default: {
        // Upstream accepts any `key: value` entry and applies only the four
        // known properties (its parser suite pins `classDef constructor
        // fill:#ff0000`). Safe values are preserved verbatim and stay inert;
        // unsafe characters remain a hard error (the value would land in a
        // style="" attribute on serialize).
        if (!SAFE_EXTRA_VALUE_RE.test(value)) return { ok: false, error: `style property "${key}" has unsupported characters: "${value}"` }
        style.extra = style.extra ?? []
        style.extra.push(`${key}: ${value}`)
        break
      }
    }
    any = true
  }
  return { ok: true, style: any ? style : undefined }
}

export type ClassDefParseResult =
  | { ok: true; name: string; style: QuadrantPointStyle }
  | { ok: false; error: string }

/**
 * Parse the tail of a `classDef <name> <styles>` line (everything after the
 * `classDef` keyword). A classDef with no valid style entries is an error —
 * upstream always carries at least one property.
 */
export function parseClassDefTail(tail: string): ClassDefParseResult {
  const m = tail.trim().match(/^([A-Za-z_][\w-]*)\s+(.+)$/)
  if (!m) return { ok: false, error: `expected "classDef <name> <styles>", got "classDef ${tail.trim()}"` }
  const name = m[1]!
  const parsed = parsePointStyleEntries(m[2]!)
  if (!parsed.ok) return { ok: false, error: `classDef ${name}: ${parsed.error}` }
  if (!parsed.style) return { ok: false, error: `classDef ${name} has no style entries` }
  return { ok: true, name, style: parsed.style }
}

/** Validate a `:::className` class name. */
export function isValidPointClassName(name: string): boolean {
  return CLASS_NAME_RE.test(name)
}

const POINT_CLASS_SUFFIX_RE = /\s*:::\s*([A-Za-z_][\w-]*)\s*$/

/**
 * Split an optional `:::className` suffix off a point label. A suffix whose
 * class name is not a valid identifier stays part of the label (matching the
 * renderer parser), so both surfaces agree on what is a class.
 */
export function splitPointClassSuffix(label: string): { label: string; className?: string } {
  const m = label.match(POINT_CLASS_SUFFIX_RE)
  if (!m) return { label }
  return { label: label.slice(0, m.index).trim(), className: m[1]! }
}

/** Resolved visual for one point after precedence is applied. */
export interface ResolvedPointVisual {
  radius: number
  /** Fill override; undefined = theme default. */
  fill?: string
  /** Stroke override; undefined = theme default. */
  stroke?: string
  /** Stroke width override (may carry a px suffix); undefined = theme default. */
  strokeWidth?: string
}

/**
 * THE resolution site: direct styles > class styles > defaults. A point
 * referencing an undefined class resolves to defaults (upstream parity); the
 * class name itself still renders as an SVG CSS class so nothing is lost.
 */
export function resolvePointVisual(
  point: { className?: string; style?: QuadrantPointStyle },
  classDefs: QuadrantClassDefs | undefined,
  defaults: { radius: number },
): ResolvedPointVisual {
  // Own-key guard: `constructor`/`toString` are legal class names, and a
  // plain-object table would otherwise leak Object.prototype members.
  const cls = point.className && classDefs && Object.hasOwn(classDefs, point.className)
    ? classDefs[point.className]
    : undefined
  const resolved: ResolvedPointVisual = {
    radius: point.style?.radius ?? cls?.radius ?? defaults.radius,
  }
  const fill = point.style?.color ?? cls?.color
  const stroke = point.style?.strokeColor ?? cls?.strokeColor
  const strokeWidth = point.style?.strokeWidth ?? cls?.strokeWidth
  if (fill !== undefined) resolved.fill = fill
  if (stroke !== undefined) resolved.stroke = stroke
  if (strokeWidth !== undefined) resolved.strokeWidth = strokeWidth
  return resolved
}

/**
 * Canonical serialization of a style — fixed key order (radius, color,
 * stroke-color, stroke-width) so serialize → parse → serialize is stable.
 * Returns '' for an empty style.
 */
export function renderPointStyleEntries(style: QuadrantPointStyle | undefined): string {
  if (!style) return ''
  const entries: string[] = []
  if (style.radius !== undefined) entries.push(`radius: ${style.radius}`)
  if (style.color !== undefined) entries.push(`color: ${style.color}`)
  if (style.strokeColor !== undefined) entries.push(`stroke-color: ${style.strokeColor}`)
  if (style.strokeWidth !== undefined) entries.push(`stroke-width: ${style.strokeWidth}`)
  if (style.extra !== undefined) entries.push(...style.extra)
  return entries.join(', ')
}
