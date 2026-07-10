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

/** Typed per-point style properties (upstream's documented set). */
export interface QuadrantPointStyle {
  radius?: number
  color?: string
  strokeColor?: string
  strokeWidth?: string
}

/** classDef table: class name → style, in source order. */
export type QuadrantClassDefs = Record<string, QuadrantPointStyle>

export type StyleParseResult =
  | { ok: true; style: QuadrantPointStyle | undefined }
  | { ok: false; error: string }

const CLASS_NAME_RE = /^[A-Za-z_][\w-]*$/
const RADIUS_RE = /^\d+(?:\.\d+)?$/
const STROKE_WIDTH_RE = /^\d+(?:\.\d+)?(?:px)?$/
// Hex/named colors plus rgb()/hsl()/color-mix() functional forms. No quotes,
// semicolons, braces, or angle brackets — the value lands in a style="" attr.
const COLOR_RE = /^[#\w][\w#(),.%\s/-]*$/

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
  for (const part of trimmed.split(',')) {
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
        if (!COLOR_RE.test(value)) return { ok: false, error: `color has unsupported characters: "${value}"` }
        style.color = value
        break
      }
      case 'stroke-color': {
        if (!COLOR_RE.test(value)) return { ok: false, error: `stroke-color has unsupported characters: "${value}"` }
        style.strokeColor = value
        break
      }
      case 'stroke-width': {
        if (!STROKE_WIDTH_RE.test(value)) return { ok: false, error: `stroke-width must be a number with optional px suffix, got "${value}"` }
        style.strokeWidth = value
        break
      }
      default:
        return { ok: false, error: `unknown style property "${key}" (expected radius/color/stroke-color/stroke-width)` }
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
  const cls = point.className ? classDefs?.[point.className] : undefined
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
  return entries.join(', ')
}
