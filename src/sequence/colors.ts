// ============================================================================
// Sequence box colors.
//
// `box Aqua Team A` — upstream treats the first word after `box` as a color
// when it IS one, otherwise as label text, with `box transparent Aqua` as the
// documented escape hatch. Detecting that requires the CSS named-color
// keyword table, which also gives us a hex value so the box title ink can be
// WCAG-guarded against explicit fills (journey precedent).
// ============================================================================

import { tryParseCssColor, tryParseHex, toHex } from '../shared/color-math.ts'
import { safeCssColor } from '../shared/css-color.ts'
import { CSS_NAMED_COLORS } from '../shared/css-named-colors.ts'

/** True when `word` is a CSS color a `box` header can start with: a named
 *  keyword, `transparent`, #hex, or an rgb()/rgba()/hsl()/hsla() function.
 *  Like Mermaid's `CSS.supports` check, a word that only looks like a color
 *  (`#12345`, `rgb(x)`) is not one, so it stays part of the title. Unlike a
 *  browser, out-of-range channels (`rgb(300,0,0)`) are not clamped into one. */
export function isCssColorToken(word: string): boolean {
  const w = word.toLowerCase()
  if (w === 'transparent' || w in CSS_NAMED_COLORS) return true
  if (!/^(?:#|(?:rgb|rgba|hsl|hsla)\()/i.test(word)) return false
  return tryParseCssColor(word) !== null
}

/** Rect arguments become SVG background paint, never fragment labels. Admit
 * the documented rgb()/rgba() spellings plus safe concrete color keywords;
 * reject ambiguous or malformed CSS instead of displaying it as a label. */
export function sequenceRectColor(argument: string): string | undefined {
  const color = safeCssColor(argument)
  if (!color) return undefined
  const lower = color.toLowerCase()
  if (lower === 'transparent' || Object.hasOwn(CSS_NAMED_COLORS, lower)) return color

  const rgb = /^rgb\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*\)$/i.exec(color)
  if (rgb && rgb.slice(1).every(channel => Number(channel) <= 255)) return color

  const rgba = /^rgba\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(0(?:\.\d+)?|\.\d+|1(?:\.0+)?)\s*\)$/i.exec(color)
  if (rgba && rgba.slice(1, 4).every(channel => Number(channel) <= 255)) return color
  return undefined
}

/** Resolve a box color to #rrggbb where possible (named keyword, #hex,
 *  rgb()/rgba()). Returns null for transparent/hsl()/unresolvable paints —
 *  callers fall back to theme-derived inks there (journey precedent: only
 *  guard contrast when the ground color is concretely known). */
export function boxColorToHex(color: string): string | null {
  const named = CSS_NAMED_COLORS[color.toLowerCase()]
  if (named) return named
  const hexRgb = tryParseHex(color)
  if (hexRgb) return toHex(hexRgb[0], hexRgb[1], hexRgb[2])
  const rgb = color.match(/^rgba?\(\s*(\d{1,3})\s*[, ]\s*(\d{1,3})\s*[, ]\s*(\d{1,3})/i)
  if (rgb) return toHex(
    Math.min(255, Number.parseInt(rgb[1]!, 10)),
    Math.min(255, Number.parseInt(rgb[2]!, 10)),
    Math.min(255, Number.parseInt(rgb[3]!, 10)),
  )
  return null
}
