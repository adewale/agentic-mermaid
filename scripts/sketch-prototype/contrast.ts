// ============================================================================
// WCAG contrast math — the *only* thing we borrow from WCAG. No ARIA, no audit
// framework, no conformance machinery: just relative luminance + contrast ratio
// + the threshold constants, used as a render-time readability guardrail.
//
// Definitions per WCAG 2.x:
//   relative luminance: sRGB linearized, weighted 0.2126/0.7152/0.0722
//   contrast ratio:     (L1 + 0.05) / (L2 + 0.05),  L1 ≥ L2
// Thresholds:
//   text (1.4.3):        4.5:1 normal, 3:1 large (≥24px / ≥18.66px bold)
//   non-text (1.4.11):   3:1 for graphical objects (strokes, borders)
// ============================================================================

export const WCAG = { textAA: 4.5, textAALarge: 3, nonText: 3 } as const

function parse(hex: string): [number, number, number] {
  let h = hex.trim().replace('#', '')
  if (h.length === 3) h = h[0]! + h[0]! + h[1]! + h[1]! + h[2]! + h[2]!
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)]
}
function hex(r: number, g: number, b: number): string {
  const c = (n: number) => Math.round(Math.max(0, Math.min(255, n))).toString(16).padStart(2, '0')
  return `#${c(r)}${c(g)}${c(b)}`
}

/** WCAG relative luminance of an sRGB hex colour, in [0,1]. */
export function relLuminance(color: string): number {
  const lin = (v: number) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4 }
  const [r, g, b] = parse(color)
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
}

/** WCAG contrast ratio between two hex colours, in [1, 21]. */
export function contrastRatio(a: string, b: string): number {
  const la = relLuminance(a), lb = relLuminance(b)
  const hi = Math.max(la, lb), lo = Math.min(la, lb)
  return (hi + 0.05) / (lo + 0.05)
}

/** Linear blend of two hex colours (t=0 → a, t=1 → b). */
export function mix(a: string, b: string, t: number): string {
  const [ar, ag, ab] = parse(a), [br, bg, bb] = parse(b)
  return hex(ar + (br - ar) * t, ag + (bg - ag) * t, ab + (bb - ab) * t)
}

/**
 * Nudge `ink` toward black or white (whichever the background allows) until it
 * meets `target` contrast against `bg`, preserving hue as long as possible.
 * Returns the original ink when it already passes.
 */
export function adjustToContrast(ink: string, bg: string, target = WCAG.textAA): string {
  if (contrastRatio(ink, bg) >= target) return ink
  // Pick the extreme that CAN reach the target on this background.
  const toWhite = contrastRatio('#ffffff', bg) >= target
  const toBlack = contrastRatio('#000000', bg) >= target
  const extreme = toBlack && (!toWhite || relLuminance(bg) > 0.45) ? '#000000' : '#ffffff'
  for (let t = 0.1; t <= 1.0001; t += 0.1) {
    const cand = mix(ink, extreme, t)
    if (contrastRatio(cand, bg) >= target) return cand
  }
  return extreme
}
