// Unicode / XML-significant label fuzz — the escaping + text-measurement axis.
//
// The other property tests use identifier-safe labels, so a finding there is a
// layout fault, not a parse/escape fault. This one deliberately fills labels
// with the characters most likely to break rendering — XML metacharacters
// (& < > " '), emoji and multi-codepoint ZWJ sequences, CJK, RTL scripts,
// combining marks, zero-width spaces, and an SVG-injection attempt — and asserts
// the pipeline stays sound:
//   • parses + lays out without throwing, with FINITE geometry (zero-width and
//     combining marks must not produce NaN widths in text measurement),
//   • emits well-formed SVG with NO bare '&' (every metacharacter is escaped)
//     and no un-neutralised '<script>' (label text cannot break out of markup),
//   • is deterministic, and route-clean at the rendered level.
// Seed pinned for cross-run reproducibility.

import { describe, expect, it } from 'bun:test'
import fc from 'fast-check'
import { parseMermaid, layoutMermaid, renderMermaidSVG, renderMermaidASCII } from '../agent/index.ts'
import { auditRenderedRoutes } from '../agent/rendered-route-audit.ts'

const SEED = 0x00c0ffee

const TOKENS = [
  '&', '<', '>', "'", '"',              // XML metacharacters
  '🚀', '✅', '😀🌍', '👩‍💻',           // emoji, incl. a ZWJ sequence
  '中文', '日本語', '한국어',             // CJK
  'مرحبا', 'עברית',                     // RTL scripts
  'café', 'naïve', 'é',           // precomposed + combining accent
  '​', '‍', ' ',         // zero-width space, ZWJ, non-breaking space
  '</text><script>x</script>',          // SVG-injection attempt
  'ok', 'warn', 'x y',                  // ordinary tokens
]
// Mermaid decodes &quot; inside a quoted label, so escape the one delimiter that
// would otherwise close the label; every other character (including a bare &)
// is carried through literally and must be escaped by the renderer.
const esc = (s: string): string => s.replace(/"/g, '&quot;')

const labelArb = fc.array(fc.constantFrom(...TOKENS), { minLength: 1, maxLength: 4 }).map(xs => xs.join(' '))
// A '&' that does NOT begin a valid XML entity — the signature of unescaped text.
const bareAmp = /&(?!(amp|lt|gt|quot|apos|#[0-9]+|#x[0-9a-fA-F]+);)/

function assertSound(src: string): void {
  const p = parseMermaid(src)
  expect(p.ok).toBe(true)
  if (!p.ok) return
  const layout = layoutMermaid(p.value)
  expect(Number.isFinite(layout.bounds.w) && Number.isFinite(layout.bounds.h)).toBe(true)
  for (const n of layout.nodes) expect(Number.isFinite(n.x) && Number.isFinite(n.w) && n.w >= 0).toBe(true)
  expect(JSON.stringify(layoutMermaid(p.value))).toBe(JSON.stringify(layout)) // determinism
  const svg = renderMermaidSVG(src)
  expect(svg).toContain('<svg')
  expect(svg).toContain('</svg>')
  expect(svg.includes('NaN') || svg.includes('Infinity') || svg.includes('undefined')).toBe(false)
  expect(bareAmp.test(svg)).toBe(false)         // every metacharacter escaped
  expect(svg.includes('<script')).toBe(false)   // injection neutralised
  expect(() => renderMermaidASCII(src)).not.toThrow()
  expect(auditRenderedRoutes(layout)).toEqual([])
}

describe('unicode / XML-significant label fuzz (escaping + measurement axis)', () => {
  it('flowchart node + edge labels survive any unicode / metacharacter content', () => {
    fc.assert(
      fc.property(labelArb, labelArb, labelArb, labelArb, (a, b, c, e) => {
        assertSound(`flowchart TD\n  A["${esc(a)}"] -->|${esc(e)}| B["${esc(b)}"]\n  B --> C["${esc(c)}"]`)
      }),
      { numRuns: 100, seed: SEED },
    )
  }, 30000)
})
