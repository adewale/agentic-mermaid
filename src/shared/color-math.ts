// ============================================================================
// Shared hex color math.
//
// The single home for hex parsing, hex serialization, sRGB mixing, and the
// BT.601 luma used for dark/contrast decisions. Thresholds stay at the call
// sites (theme dark-detection, ANSI brightness, contrast text) — only the
// primitives live here, so the arithmetic cannot drift between the SVG,
// ASCII, and chart color paths.
// ============================================================================

/**
 * Parse a hex color to [r, g, b]. Accepts #RGB and #RRGGBB (a longer string
 * such as #RRGGBBAA is read as its first six digits; alpha is ignored).
 * Assumes a syntactically valid color — use tryParseHex when unsure.
 */
export function parseHex(hex: string): [number, number, number] {
  const h = hex.replace('#', '')
  const full = h.length === 3
    ? h[0]! + h[0]! + h[1]! + h[1]! + h[2]! + h[2]!
    : h
  return [
    parseInt(full.slice(0, 2), 16),
    parseInt(full.slice(2, 4), 16),
    parseInt(full.slice(4, 6), 16),
  ]
}

/** Validating parse: [r, g, b] for #RGB/#RRGGBB/#RRGGBBAA, else null. */
export function tryParseHex(hex: string): [number, number, number] | null {
  if (!/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(hex)) return null
  return parseHex(hex)
}

/** Serialize r/g/b (clamped and rounded) to #rrggbb. */
export function toHex(r: number, g: number, b: number): string {
  return '#' + [r, g, b]
    .map(c => Math.round(Math.max(0, Math.min(255, c))).toString(16).padStart(2, '0'))
    .join('')
}

/**
 * Mix `pct`% of `fg` over `bg` in sRGB — replicates CSS
 * `color-mix(in srgb, fg pct%, bg)`.
 */
export function mixHex(fg: string, bg: string, pct: number): string {
  const [r1, g1, b1] = parseHex(fg)
  const [r2, g2, b2] = parseHex(bg)
  const p = pct / 100
  return toHex(
    r1 * p + r2 * (1 - p),
    g1 * p + g2 * (1 - p),
    b1 * p + b2 * (1 - p),
  )
}

/** Loose CSS hex form: #RGB, #RGBA, #RRGGBB, or #RRGGBBAA. */
export function isHexColor(s: string): boolean {
  return /^#[0-9a-fA-F]{3,8}$/.test(s)
}

/** Strict 6-digit hex form (#RRGGBB) — what the chart palettes require. */
export function isSixDigitHex(s: string): boolean {
  return /^#[0-9a-fA-F]{6}$/.test(s)
}

/**
 * Perceived brightness on a 0–255 scale (ITU-R BT.601 luma:
 * `(r·299 + g·587 + b·114) / 1000`). Callers own their thresholds.
 */
export function luma255(r: number, g: number, b: number): number {
  return (r * 299 + g * 587 + b * 114) / 1000
}

/** WCAG 2.x relative luminance of an sRGB hex color. */
export function wcagRelativeLuminance(hex: string): number | null {
  const rgb = tryParseHex(hex)
  if (!rgb) return null
  const lin = (channel: number): number => {
    const c = channel / 255
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * lin(rgb[0]) + 0.7152 * lin(rgb[1]) + 0.0722 * lin(rgb[2])
}

/** WCAG 2.x contrast ratio between two hex colors (1..21), or null when
 * either color is not a parseable hex. */
export function wcagContrastRatio(a: string, b: string): number | null {
  const la = wcagRelativeLuminance(a)
  const lb = wcagRelativeLuminance(b)
  if (la === null || lb === null) return null
  const [hi, lo] = la > lb ? [la, lb] : [lb, la]
  return (hi + 0.05) / (lo + 0.05)
}
