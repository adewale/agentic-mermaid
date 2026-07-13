// ============================================================================
// Runtime-neutral CSS color token validation.
//
// Color values are interpolated into SVG presentation attributes and, for a
// few families, stylesheet declarations. XML escaping protects attributes but
// is not a CSS sanitizer, so source-controlled colors must pass this grammar
// before they reach either sink.
// ============================================================================

const SIMPLE_COLOR_RE = /^(?:#[0-9a-f]{3,4}|#[0-9a-f]{6}|#[0-9a-f]{8}|[a-z][a-z0-9-]*)$/i
const SAFE_FUNCTION_CHARS_RE = /^[a-z0-9#(),.%+\-\s/]*$/i
const CSS_COLOR_FUNCTIONS = new Set([
  'color',
  'color-mix',
  'device-cmyk',
  'hsl',
  'hsla',
  'hwb',
  'lab',
  'lch',
  'oklab',
  'oklch',
  'rgb',
  'rgba',
])

/**
 * Return a trimmed, conservatively safe CSS color token, or undefined.
 *
 * This validates injection safety rather than implementing the entire CSS
 * color value grammar. Browsers may still reject a syntactically odd but safe
 * token; callers then get the normal CSS fallback. Fetching forms (`url()`),
 * executable legacy forms (`expression()`), custom-property expansion, and
 * every character capable of terminating an SVG/CSS context are rejected.
 */
export function safeCssColor(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const color = value.trim()
  if (color.length === 0 || color.length > 256) return undefined
  if (SIMPLE_COLOR_RE.test(color)) return color
  if (!SAFE_FUNCTION_CHARS_RE.test(color)) return undefined

  const firstParen = color.indexOf('(')
  if (firstParen <= 0 || !color.endsWith(')')) return undefined

  let depth = 0
  for (const char of color) {
    if (char === '(') depth++
    else if (char === ')') {
      depth--
      if (depth < 0) return undefined
    }
  }
  if (depth !== 0) return undefined

  // Every function call, including nested calls inside color-mix(), must be a
  // known non-fetching CSS color function.
  for (const match of color.matchAll(/([a-z][a-z0-9-]*)\s*\(/gi)) {
    if (!CSS_COLOR_FUNCTIONS.has(match[1]!.toLowerCase())) return undefined
  }
  const outer = color.slice(0, firstParen).trim().toLowerCase()
  return CSS_COLOR_FUNCTIONS.has(outer) ? color : undefined
}

export function isSafeCssColor(value: string): boolean {
  return safeCssColor(value) !== undefined
}

/**
 * RenderOptions additionally permits a non-fetching CSS custom-property
 * reference such as `var(--diagram-bg, #fff)`. The same character, balance,
 * and function allowlist prevents that compatibility form from becoming a
 * style/XML injection or URL-fetching channel.
 */
export function safeCssPaint(value: unknown): string | undefined {
  const direct = safeCssColor(value)
  if (direct !== undefined) return direct
  if (typeof value !== 'string') return undefined
  const paint = value.trim()
  if (paint.length === 0 || paint.length > 256 || !SAFE_FUNCTION_CHARS_RE.test(paint)) return undefined

  const firstParen = paint.indexOf('(')
  if (firstParen <= 0 || !paint.endsWith(')')) return undefined
  let depth = 0
  for (const char of paint) {
    if (char === '(') depth++
    else if (char === ')') {
      depth--
      if (depth < 0) return undefined
    }
  }
  if (depth !== 0) return undefined
  for (const match of paint.matchAll(/([a-z][a-z0-9-]*)\s*\(/gi)) {
    const fn = match[1]!.toLowerCase()
    if (fn !== 'var' && !CSS_COLOR_FUNCTIONS.has(fn)) return undefined
  }
  return paint.slice(0, firstParen).trim().toLowerCase() === 'var' ? paint : undefined
}

export function requireSafeCssPaint(value: string, field: string): string {
  const safe = safeCssPaint(value)
  if (safe === undefined) throw new Error(`${field} must be a safe non-fetching CSS color or var() reference`)
  return safe
}
