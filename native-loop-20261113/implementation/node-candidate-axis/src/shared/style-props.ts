import { authoredCssPaintDescription, drawableAuthoredCssPaint } from './css-color.ts'
import { syntaxError } from './syntax-error.ts'

export type StyleDeclaration = [property: string, value: string]

export function ownStyleDeclarations(record: Readonly<Record<string, StyleDeclaration[]>> | undefined, name: string): StyleDeclaration[] | undefined {
  return record && Object.hasOwn(record, name) ? record[name] : undefined
}

/** Earlier identical declarations are dominated by their later copy. Other
 * repeats must survive: CSS priority and invalid-value fallback need them. */
export function compactStyleDeclarations(entries: readonly StyleDeclaration[]): StyleDeclaration[] {
  const seen = new Map<string, Set<string>>()
  const retained: StyleDeclaration[] = []
  for (let index = entries.length - 1; index >= 0; index--) {
    const [key, value] = entries[index]!
    let values = seen.get(key)
    if (!values) { values = new Set(); seen.set(key, values) }
    if (!values.has(value)) retained.push([key, value])
    values.add(value)
  }
  return retained.reverse()
}

export function retainedStyleDeclarations(entries: readonly StyleDeclaration[]): StyleDeclaration[] | undefined {
  const compact = compactStyleDeclarations(entries)
  return new Set(compact.map(([key]) => key)).size < compact.length ? compact : undefined
}

export function projectStyleDeclarations(entries: readonly StyleDeclaration[]): Record<string, string> {
  const ordered = new Map<string, string>()
  for (const [key, value] of entries) { ordered.delete(key); ordered.set(key, value) }
  return Object.fromEntries(ordered)
}

/** A repeated declaration takes its last position as well as its last value.
 * Keeping its first position can reverse shorthand/longhand precedence. */
export function mergeStyleProps(...styles: (Readonly<Record<string, string>> | undefined)[]): Record<string, string> {
  const entries = new Map<string, string>()
  for (const style of styles) for (const [key, value] of Object.entries(style ?? {})) {
    entries.delete(key)
    entries.set(key, value)
  }
  return Object.fromEntries(entries)
}

/** Split CSS-like Mermaid style pairs at a `,` or `;` without splitting
 *  functional color commas. Mermaid joins pairs a `;` separates into one
 *  invalid declaration (`fill:#f9fstroke:red`); ours reads them as CSS does. */
function splitStylePairs(value: string): string[] {
  const out: string[] = []
  let depth = 0
  let start = 0
  let escaped = false
  let quote = ''
  for (let index = 0; index < value.length; index++) {
    const char = value[index]
    if (escaped) { escaped = false; continue }
    if (char === '\\') { escaped = true; continue }
    if (quote) { if (char === quote) quote = ''; continue }
    if (char === '"' || char === "'") { quote = char; continue }
    if (char === '(') depth++
    else if (char === ')') depth = Math.max(0, depth - 1)
    else if ((char === ',' || char === ';') && depth === 0) { out.push(value.slice(start, index)); start = index + 1 }
  }
  out.push(value.slice(start))
  return out.map(part => part.replace(/\\,/g, ','))
}

/** Parse Mermaid's `key:value,key:value` paint grammar. */
export function parseStyleProps(source: string, options: { caseInsensitive?: boolean } = {}): Record<string, string> {
  return projectStyleDeclarations(parseStyleDeclarations(source, options))
}

export function parseStyleDeclarations(source: string, options: { caseInsensitive?: boolean } = {}): StyleDeclaration[] {
  const cleaned = source.replace(/;\s*$/, '')
  const props: StyleDeclaration[] = []
  for (const pair of splitStylePairs(cleaned)) {
    const colon = pair.indexOf(':')
    if (colon <= 0) continue
    const rawKey = pair.slice(0, colon).trim()
    const key = options.caseInsensitive ? rawKey.toLowerCase() : rawKey
    const value = pair.slice(colon + 1).trim()
    if (key && value) props.push([key, value])
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
    if (value !== undefined && drawableAuthoredCssPaint(value, property !== 'color') === undefined) return { property, value }
  }
  return undefined
}

/** Name the paint, the colors that are accepted and a corrected example, so an
 *  agent can fix the style from the message alone. `directive` prefixes the
 *  example when the style came from source, e.g. `style A`. */
export class AuthoredStyleColorError extends Error {
  readonly code = 'INVALID_STYLE_COLOR' as const
  readonly subject: string
  readonly property: string
  readonly value: string

  constructor(
    subject: string,
    property: string,
    value: string,
    directive?: string,
  ) {
    super(syntaxError({
      what: `${subject}: ${property} ${JSON.stringify(value)} is not a CSS color`,
      expectedForm: authoredCssPaintDescription(property !== 'color'),
      example: `${directive ? `${directive} ` : ''}${property}:#f96`,
    }).message)
    this.name = 'AuthoredStyleColorError'
    this.subject = subject
    this.property = property
    this.value = value
  }
}

export function unsafeStylePaintError(subject: string, paint: StylePaint, directive?: string): AuthoredStyleColorError {
  return new AuthoredStyleColorError(subject, paint.property, paint.value, directive)
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

/** Check every recorded directive, including an unused classDef, a style for
 * an undeclared node, or an out-of-range linkStyle. Checking only paint that
 * reaches a Scene would silently accept those authored mistakes. */
export function checkAllGraphAuthoredStyles(graph: {
  classDefs: ReadonlyMap<string, Readonly<Record<string, string>>>
  nodeStyles: ReadonlyMap<string, Readonly<Record<string, string>>>
  linkStyles: ReadonlyMap<number | 'default', Readonly<Record<string, string>>>
}): void {
  for (const [name, style] of graph.classDefs) checkedAuthoredStyle(style, `classDef ${name}`)
  for (const [id, style] of graph.nodeStyles) checkedAuthoredStyle(style, `style ${id}`)
  for (const [target, style] of graph.linkStyles) checkedAuthoredStyle(style, `linkStyle ${target}`)
}

export function checkAllClassLikeAuthoredStyles(
  classDefs: ReadonlyMap<string, Readonly<Record<string, string>>>,
  nodes: readonly { id: string; inlineStyle?: Readonly<Record<string, string>> }[],
): void {
  for (const [name, style] of classDefs) checkedAuthoredStyle(style, `classDef ${name}`)
  for (const node of nodes) checkedAuthoredStyle(node.inlineStyle, `style ${node.id}`)
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
