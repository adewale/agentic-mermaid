// Conservative, runtime-neutral CSS font-family validation for values that
// enter both an SVG style attribute and a <style> block. This is an injection-
// safety grammar, not a complete CSS font parser.

// Space and tab are the only whitespace: XML forbids some \s characters and a
// line break cannot sit inside a quoted CSS family name.
const SAFE_FONT_CHARS_RE = /^[a-z0-9_,'(). \t-]+$/i

/** Requote family names with single quotes, the only quote the grammar
 * writes: `"Open Sans", Arial` (Mermaid's own default form) becomes
 * `'Open Sans', Arial`. Every quote must close, and a name holding the other
 * quote character has no single-quoted spelling, so both are refused. */
function singleQuotedFamilies(font: string): string | undefined {
  if (!font.includes('"') && !font.includes("'")) return font
  let out = ''
  for (let index = 0; index < font.length; index++) {
    const char = font[index]!
    if (char !== '"' && char !== "'") {
      out += char
      continue
    }
    const end = font.indexOf(char, index + 1)
    if (end < 0) return undefined
    const name = font.slice(index + 1, end)
    if (name.includes('"') || name.includes("'")) return undefined
    out += `'${name}'`
    index = end
  }
  return out
}

/** Return a trimmed non-fetching CSS font-family value, or undefined.
 * Double-quoted family names come back single-quoted. */
export function safeCssFontFamily(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const font = singleQuotedFamilies(value.trim())
  if (font === undefined || font.length === 0 || font.length > 256 || !SAFE_FONT_CHARS_RE.test(font)) return undefined

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
