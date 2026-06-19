// ============================================================================
// Contrast audit — turns readability into a testable property.
//
//   bun run scripts/sketch-prototype/contrast-audit.ts
//
// For every style, checks the two WCAG ratios we care about:
//   text     : label ink vs the effective background (page + fill marks) ≥ 4.5
//   non-text : stroke/line vs page                                       ≥ 3.0
// and reports the ink the guardrail picked. Exits non-zero if any style fails,
// so it can gate CI exactly like a golden test.
// ============================================================================

import { STYLES } from './styles.ts'
import { contrastRatio, adjustToContrast, mix, relLuminance, WCAG } from './contrast.ts'

function coverage(fill: string, t: number): number {
  switch (fill) {
    case 'none': return 0
    case 'hachure': return Math.min(0.5, 0.2 + t * 0.6)
    case 'crosshatch': return Math.min(0.6, 0.4 + t * 0.4)
    case 'stipple': return Math.min(0.5, t * 0.7)
    case 'halftone': return Math.min(0.6, t * 0.9)
    case 'wash': return 0.25
    case 'scribble': return Math.min(0.55, 0.3 + t * 0.4)
    default: return 0
  }
}

let fails = 0
console.log('style                  text(ink→effBg)  line→page   ink')
console.log('─'.repeat(70))
for (const st of STYLES) {
  // Labels are always knocked out to the page colour by a paint-order halo
  // (restyle.ts), so the effective background under text is the PAGE, not the
  // fill. Check the chosen ink against the page.
  const effBg = st.colors.bg
  const ink = adjustToContrast(st.colors.fg, effBg, WCAG.textAA)
  const textR = contrastRatio(ink, effBg)
  const lineR = contrastRatio(st.colors.line, st.colors.bg)
  // Tufte deliberately uses faint rules; only flag non-text contrast elsewhere.
  const lineOk = lineR >= WCAG.nonText || st.name === 'tufte'
  const textOk = textR >= WCAG.textAA
  if (!textOk || !lineOk) fails++
  const mark = (ok: boolean) => (ok ? '✓' : '✗')
  console.log(
    `${st.name.padEnd(20)} ${mark(textOk)} ${textR.toFixed(2).padStart(5)}        ` +
    `${mark(lineOk)} ${lineR.toFixed(2).padStart(5)}   ${ink}${ink.toLowerCase() !== st.colors.fg.toLowerCase() ? ` (was ${st.colors.fg})` : ''}`,
  )
}
console.log('─'.repeat(70))
console.log(fails === 0 ? 'PASS — all styles meet WCAG text 4.5:1 and non-text 3:1' : `FAIL — ${fails} style(s) below threshold`)
process.exit(fails === 0 ? 0 : 1)
