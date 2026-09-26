import { safeCssPaint } from './css-color.ts'
import { syntaxError } from './syntax-error.ts'

/** Split CSS-like Mermaid style pairs without splitting functional color commas. */
function splitTopLevelCommas(value: string): string[] {
  const out: string[] = []
  let depth = 0
  let start = 0
  let escaped = false
  for (let index = 0; index < value.length; index++) {
    const char = value[index]
    if (escaped) { escaped = false; continue }
    if (char === '\\') { escaped = true; continue }
    if (char === '(') depth++
    else if (char === ')') depth = Math.max(0, depth - 1)
    else if (char === ',' && depth === 0) { out.push(value.slice(start, index)); start = index + 1 }
  }
  out.push(value.slice(start))
  return out.map(part => part.replace(/\\,/g, ','))
}

/** Parse Mermaid's `key:value,key:value` paint grammar. */
export function parseStyleProps(source: string): Record<string, string> {
  const cleaned = source.replace(/;\s*$/, '')
  const props: Record<string, string> = {}
  for (const pair of splitTopLevelCommas(cleaned)) {
    const colon = pair.indexOf(':')
    if (colon <= 0) continue
    const key = pair.slice(0, colon).trim()
    const value = pair.slice(colon + 1).trim()
    if (key && value) props[key] = value
  }
  return props
}

/** Authored style properties that become a fill, a stroke or text ink. */
const PAINT_PROPERTIES = ['fill', 'stroke', 'color'] as const

export interface StylePaint { property: string; value: string }

/** The first paint in an authored style that is not a CSS color the scene can
 *  draw (a malformed hex such as `#12345`, `url(…)`, or injected markup). */
export function unsafeStylePaint(style: Readonly<Record<string, string>>): StylePaint | undefined {
  for (const property of PAINT_PROPERTIES) {
    const value = style[property]
    if (value !== undefined && safeCssPaint(value) === undefined) return { property, value }
  }
  return undefined
}

/** Name the paint, the colors that are accepted and a corrected example, so an
 *  agent can fix the style from the message alone. `directive` prefixes the
 *  example when the style came from source, e.g. `style A`. */
export function unsafeStylePaintError(subject: string, paint: StylePaint, directive?: string): Error {
  return syntaxError({
    what: `${subject}: ${paint.property} ${JSON.stringify(paint.value)} is not a CSS color`,
    expectedForm: 'a color name, #RGB, #RGBA, #RRGGBB, #RRGGBBAA, rgb(), rgba(), hsl(), hsla() or var(--name)',
    example: `${directive ? `${directive} ` : ''}${paint.property}:#f96`,
  })
}

/** An authored `style`, `classDef` or `linkStyle` record on its way to layout,
 *  refused when it paints with something other than a CSS color. The error
 *  names the directive, the property and the value; scene validation, which
 *  still backs this check, can only name a scene path. */
export function checkedAuthoredStyle<T extends Readonly<Record<string, string>> | undefined>(style: T, directive: string): T {
  const paint = style && unsafeStylePaint(style)
  if (paint) throw unsafeStylePaintError(directive, paint, directive)
  return style
}

export type MutableStyleParseResult =
  | { ok: true; value: Record<string, string> }
  | { ok: false; reason: 'NOT_STRING' | 'MULTILINE' | 'EMPTY' }
  | { ok: false; reason: 'UNSAFE_PAINT'; paint: StylePaint }

/**
 * Validate a typed-mutation style before it reaches line-oriented Mermaid
 * serialization. Source parsers still consume one already-delimited line via
 * `parseStyleProps`; mutation callers must additionally reject CR/LF so style
 * values cannot inject a new node/entity/class statement. A fill, stroke or
 * text color the scene could not draw is refused here too, when the diagram is
 * built, instead of failing the render later.
 */
export function parseMutableStyleProps(source: unknown): MutableStyleParseResult {
  if (typeof source !== 'string') return { ok: false, reason: 'NOT_STRING' }
  if (/[\r\n]/.test(source)) return { ok: false, reason: 'MULTILINE' }
  const value = parseStyleProps(source)
  if (Object.keys(value).length === 0) return { ok: false, reason: 'EMPTY' }
  const paint = unsafeStylePaint(value)
  return paint ? { ok: false, reason: 'UNSAFE_PAINT', paint } : { ok: true, value }
}

export function serializeStyleProps(style: Record<string, string>): string {
  return Object.entries(style).map(([key, value]) => `${key}:${value}`).join(',')
}
