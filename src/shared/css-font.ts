// Conservative, runtime-neutral CSS font-family validation for values that
// enter both an SVG style attribute and a <style> block. This is an injection-
// safety grammar, not a complete CSS font parser.

const SAFE_FONT_CHARS_RE = /^[a-z0-9_,'().\s-]+$/i

/** Return a trimmed non-fetching CSS font-family value, or undefined. */
export function safeCssFontFamily(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const font = value.trim()
  if (font.length === 0 || font.length > 256 || !SAFE_FONT_CHARS_RE.test(font)) return undefined

  let depth = 0
  for (const char of font) {
    if (char === '(') depth++
    else if (char === ')') {
      depth--
      if (depth < 0) return undefined
    }
  }
  if (depth !== 0) return undefined

  // Custom-property fallback is the only useful function in a family list.
  // Fetching/executable functions and stray function spellings are rejected.
  for (const match of font.matchAll(/([a-z][a-z0-9-]*)\s*\(/gi)) {
    if (match[1]!.toLowerCase() !== 'var') return undefined
  }
  if (/\b(?:url|expression|import)\b/i.test(font)) return undefined
  return font
}

export function isSafeCssFontFamily(value: string): boolean {
  return safeCssFontFamily(value) !== undefined
}

export function requireSafeCssFontFamily(value: string): string {
  const safe = safeCssFontFamily(value)
  if (safe === undefined) throw new Error('font family must be a safe non-fetching CSS family or var() fallback')
  return safe
}
