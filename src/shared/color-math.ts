// ============================================================================
// Shared hex color math.
//
// The single home for hex parsing, hex serialization, sRGB mixing, and the
// BT.601 luma used for dark/contrast decisions. Thresholds stay at the call
// sites (theme dark-detection, ANSI brightness, contrast text) — only the
// primitives live here, so the arithmetic cannot drift between the SVG,
// ASCII, and chart color paths.
// ============================================================================

import { CSS_NAMED_COLORS } from './css-named-colors.ts'

export type RgbaColor = [red: number, green: number, blue: number, alpha: number]

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

/** WCAG 2.x relative luminance for a concrete CSS color. */
export function relativeLuminance(color: string): number | null {
  const parsed = tryParseCssColor(color)
  if (!parsed) return null
  const linear = (channel: number): number => {
    const value = channel / 255
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * linear(parsed[0]) + 0.7152 * linear(parsed[1]) + 0.0722 * linear(parsed[2])
}

/** WCAG contrast ratio, or null when either color is unresolved CSS. */
export function contrastRatio(a: string, b: string): number | null {
  const la = relativeLuminance(a)
  const lb = relativeLuminance(b)
  if (la === null || lb === null) return null
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05)
}

/**
 * Preserve `candidate` when it meets the requested contrast. Otherwise mix it
 * toward a contrasting fallback in deterministic 0.1% steps until it does.
 * Unresolved CSS values pass through because their runtime background is
 * unknowable; concrete built-in palettes are therefore fully checkable.
 */
export function ensureContrast(
  candidate: string,
  background: string,
  minimum: number,
  preferredFallback?: string,
): string {
  const current = contrastRatio(candidate, background)
  if (current === null || current >= minimum) return candidate

  const blackRatio = contrastRatio('#000000', background) ?? 0
  const whiteRatio = contrastRatio('#ffffff', background) ?? 0
  const preferredRatio = preferredFallback ? contrastRatio(preferredFallback, background) ?? 0 : 0
  const fallback = preferredRatio >= minimum
    ? preferredFallback!
    : blackRatio >= whiteRatio ? '#000000' : '#ffffff'
  if ((contrastRatio(fallback, background) ?? 0) < minimum) return candidate

  for (let fallbackPart = 1; fallbackPart <= 1000; fallbackPart++) {
    const mixed = mixHex(fallback, candidate, fallbackPart / 10)
    if ((contrastRatio(mixed, background) ?? 0) >= minimum) return mixed
  }
  return fallback
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

/** Parse concrete CSS colors used by Mermaid config into RGBA. */
export function tryParseCssColor(color: string): RgbaColor | null {
  const value = color.trim().toLowerCase()
  const named = CSS_NAMED_COLORS[value]
  if (named) {
    const rgb = parseHex(named)
    return [rgb[0], rgb[1], rgb[2], 1]
  }
  if (value === 'transparent') return [0, 0, 0, 0]

  const hex = value.match(/^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i)?.[1]
  if (hex) {
    const expanded = hex.length <= 4 ? [...hex].map(char => char + char).join('') : hex
    return [
      Number.parseInt(expanded.slice(0, 2), 16),
      Number.parseInt(expanded.slice(2, 4), 16),
      Number.parseInt(expanded.slice(4, 6), 16),
      expanded.length === 8 ? Number.parseInt(expanded.slice(6, 8), 16) / 255 : 1,
    ]
  }

  const rgb = value.match(/^rgba?\((.*)\)$/)
  if (rgb) {
    const body = rgb[1]!.trim()
    const slash = body.split('/').map(part => part.trim())
    const components = (body.includes(',') ? body.split(',') : slash[0]!.split(/\s+/)).map(part => part.trim())
    let alphaToken = slash[1]
    if (components.length === 4 && alphaToken === undefined) alphaToken = components.pop()
    if (components.length !== 3) return null
    const channel = (token: string): number | null => {
      const percent = token.endsWith('%')
      const number = Number.parseFloat(token)
      if (!Number.isFinite(number)) return null
      const resolved = percent ? number * 2.55 : number
      return resolved >= 0 && resolved <= 255 ? resolved : null
    }
    const channels = components.map(channel)
    if (channels.some(component => component === null)) return null
    const alpha = parseAlpha(alphaToken)
    if (alpha === null) return null
    return [channels[0]!, channels[1]!, channels[2]!, alpha]
  }

  const hsl = value.match(/^hsla?\((.*)\)$/)
  if (hsl) {
    const body = hsl[1]!.trim()
    const slash = body.split('/').map(part => part.trim())
    const components = (body.includes(',') ? body.split(',') : slash[0]!.split(/\s+/)).map(part => part.trim())
    let alphaToken = slash[1]
    if (components.length === 4 && alphaToken === undefined) alphaToken = components.pop()
    if (components.length !== 3 || !components[1]!.endsWith('%') || !components[2]!.endsWith('%')) return null
    const hue = parseCssHue(components[0]!)
    const saturation = Number.parseFloat(components[1]!)
    const lightness = Number.parseFloat(components[2]!)
    const alpha = parseAlpha(alphaToken)
    if (hue === null || ![saturation, lightness].every(Number.isFinite) || saturation < 0 || saturation > 100 || lightness < 0 || lightness > 100 || alpha === null) return null
    const s = saturation / 100
    const l = lightness / 100
    const chroma = (1 - Math.abs(2 * l - 1)) * s
    const h = ((hue % 360) + 360) % 360 / 60
    const x = chroma * (1 - Math.abs(h % 2 - 1))
    const [r1, g1, b1] = h < 1 ? [chroma, x, 0] : h < 2 ? [x, chroma, 0] : h < 3 ? [0, chroma, x] : h < 4 ? [0, x, chroma] : h < 5 ? [x, 0, chroma] : [chroma, 0, x]
    const m = l - chroma / 2
    return [(r1 + m) * 255, (g1 + m) * 255, (b1 + m) * 255, alpha]
  }

  return null
}

/** CSS hue angle → degrees. Bare numbers and `deg` are degrees; the other
 * units follow CSS Color 4. Reject trailing junk instead of parseFloat's
 * dangerous partial parse (for example, treating `0.5turn` as 0.5 degrees). */
function parseCssHue(token: string): number | null {
  const match = token.trim().match(/^([+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?)(deg|grad|rad|turn)?$/i)
  if (!match) return null
  const value = Number(match[1])
  if (!Number.isFinite(value)) return null
  switch (match[2]?.toLowerCase()) {
    case 'grad': return value * 0.9
    case 'rad': return value * 180 / Math.PI
    case 'turn': return value * 360
    default: return value
  }
}

function parseAlpha(token: string | undefined): number | null {
  if (token === undefined) return 1
  const percent = token.endsWith('%')
  const value = Number.parseFloat(token)
  if (!Number.isFinite(value)) return null
  const alpha = percent ? value / 100 : value
  return alpha >= 0 && alpha <= 1 ? alpha : null
}

/** Composite a concrete CSS color over a concrete background. */
export function compositeCssColor(color: string, background: string): [number, number, number] | null {
  const fg = tryParseCssColor(color)
  if (!fg) return null
  if (fg[3] === 1) return [fg[0], fg[1], fg[2]]
  const bg = tryParseCssColor(background)
  if (!bg) return null
  const bgAlpha = bg[3]
  const outAlpha = fg[3] + bgAlpha * (1 - fg[3])
  if (outAlpha <= 0) return null
  return [0, 1, 2].map(index =>
    (fg[index]! * fg[3] + bg[index]! * bgAlpha * (1 - fg[3])) / outAlpha,
  ) as [number, number, number]
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

/** Contrast for concrete CSS colors after alpha compositing. The background
 * itself is composited over `canvas`; foreground is then composited over the
 * resolved background, matching SVG paint order. */
export function wcagCssContrastRatio(foreground: string, background: string, canvas = '#ffffff'): number | null {
  const resolvedBackground = compositeCssColor(background, canvas)
  if (!resolvedBackground) return null
  const backgroundHex = toHex(...resolvedBackground)
  const resolvedForeground = compositeCssColor(foreground, backgroundHex)
  if (!resolvedForeground) return null
  return wcagContrastRatio(toHex(...resolvedForeground), backgroundHex)
}
