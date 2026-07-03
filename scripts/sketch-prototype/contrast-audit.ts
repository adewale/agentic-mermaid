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
import { contrastRatio, adjustToContrast, WCAG } from './contrast.ts'


let fails = 0
console.log('style                  text(ink→effBg)  line→page   ink')
console.log('─'.repeat(70))
for (const st of STYLES) {
  // Labels are knocked out to a halo colour (default page; a style may override
  // it, e.g. a dark chip behind light text). Check ink vs that halo colour.
  const effBg = st.labelHalo ?? st.colors.bg
  const ink = st.labelInk ?? adjustToContrast(st.colors.fg, effBg, WCAG.textAA)
  const textR = contrastRatio(ink, effBg)
  const lineR = contrastRatio(st.colors.line, st.colors.bg)
  // Deliberately-faint rules (Tufte) are exempted via a declared style field.
  const lineOk = lineR >= WCAG.nonText || st.faintLinesIntentional === true
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
