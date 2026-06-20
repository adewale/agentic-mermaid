// ============================================================================
// Style invariants — run with: bun test scripts/sketch-prototype/styles.test.ts
//
// Enforces the design contracts the prototype relies on. The headline one:
// MONOCHROME styles must convey tone/emphasis via shading/hatching, never via
// multiple fill hues — so a mono style may not carry a multi-hue spotPalette,
// and must keep keepHue=false. (A single accent colour is still allowed.)
// ============================================================================

import { test, expect } from 'bun:test'
import { renderMermaidSVG } from '../../src/index.ts'
import { restyle } from './restyle.ts'
import { STYLES, type Style } from './styles.ts'
import { relLuminance, contrastRatio, adjustToContrast, WCAG } from './contrast.ts'

// crude hue extractor: returns HSL hue (0-360) or null for greys/near-greys
function hue(hex: string): number | null {
  const h = hex.replace('#', '')
  const f = h.length === 3 ? h.split('').map(c => c + c).join('') : h
  const r = parseInt(f.slice(0, 2), 16) / 255, g = parseInt(f.slice(2, 4), 16) / 255, b = parseInt(f.slice(4, 6), 16) / 255
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min
  if (d < 0.06) return null // achromatic (grey/black/white)
  let hh = 0
  if (max === r) hh = ((g - b) / d) % 6
  else if (max === g) hh = (b - r) / d + 2
  else hh = (r - g) / d + 4
  return (hh * 60 + 360) % 360
}
function hueSpread(colors: string[]): number {
  const hs = colors.map(hue).filter((x): x is number => x != null)
  if (hs.length < 2) return 0
  let max = 0
  for (let i = 0; i < hs.length; i++) for (let j = i + 1; j < hs.length; j++) {
    const diff = Math.abs(hs[i]! - hs[j]!); max = Math.max(max, Math.min(diff, 360 - diff))
  }
  return max
}

const mono = STYLES.filter(s => s.mono)

test('there is at least one monochrome and one polychrome style', () => {
  expect(mono.length).toBeGreaterThan(0)
  expect(STYLES.length - mono.length).toBeGreaterThan(0)
})

for (const s of STYLES) {
  if (!s.mono) continue
  test(`mono style "${s.name}" uses shading not colour — no multi-hue spotPalette`, () => {
    // A monochrome style must not vary FILL by hue. spotPalette is how the
    // engine introduces per-region hues, so a mono style must not set one
    // (unless every entry is the same hue / all greys).
    if (s.spotPalette) expect(hueSpread(s.spotPalette)).toBeLessThan(20)
    expect(s.keepHue).toBe(false)
  })
  test(`mono style "${s.name}" stroke/fill inks share one hue family`, () => {
    // line, border and fillColor should be the same hue (or grey) — the "ink".
    // The accent may differ (a single accent is allowed, e.g. Tufte red).
    expect(hueSpread([s.colors.line, s.colors.border, s.fillColor])).toBeLessThan(40)
  })
}

// Readability contract (mirrors contrast-audit.ts) — every style must clear
// WCAG 4.5:1 text against its halo/page, so labels are always legible.
for (const s of STYLES) {
  test(`style "${s.name}" meets WCAG 4.5:1 label contrast`, () => {
    const halo = s.labelHalo ?? s.colors.bg
    const ink = s.labelInk ?? adjustToContrast(s.colors.fg, halo, WCAG.textAA)
    expect(contrastRatio(ink, halo)).toBeGreaterThanOrEqual(WCAG.textAA)
  })
}

// Structural: required fields present and a bundled font named.
for (const s of STYLES) {
  test(`style "${s.name}" is well-formed`, () => {
    expect(s.name && s.label && s.font && s.fontFile).toBeTruthy()
    expect(relLuminance(s.colors.bg)).toBeGreaterThanOrEqual(0) // parses
  })
}

test('restyle preserves arrowheads and dashed edge semantics on roughened edges', () => {
  const handDrawn = STYLES.find(s => s.name === 'hand-drawn')!
  const raw = renderMermaidSVG(`flowchart TD
    A-.->B
    B-->C`, { transparent: true, embedFontImport: false })
  const styled = restyle(raw, handDrawn, { backdrop: false })

  expect(styled).toContain('marker-end="url(#arrowhead)"')
  expect(styled).toContain('stroke-dasharray=')
  expect(styled).not.toContain('marker-end="arrow"')
})

test('restyle preserves concrete marker URLs instead of semantic data-marker names', () => {
  const handDrawn = STYLES.find(s => s.name === 'hand-drawn')!
  const raw = renderMermaidSVG('flowchart TD\n  A o--x B', { transparent: true, embedFontImport: false })
  const styled = restyle(raw, handDrawn, { backdrop: false })

  expect(styled).toContain('marker-start="url(#circlehead-start)"')
  expect(styled).toContain('marker-end="url(#crosshead)"')
  expect(styled).not.toContain('marker-start="circle"')
  expect(styled).not.toContain('marker-end="cross"')
})

test('crisp styles still apply solid fill palettes', () => {
  const bauhaus = STYLES.find(s => s.name === 'bauhaus')!
  const raw = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 140 100"><rect x="0" y="0" width="100" height="61" fill="#ffffff" stroke="#000000" /></svg>'
  const styled = restyle(raw, bauhaus, { backdrop: false })

  expect(styled).toContain('fill="#e53935"')
  expect(styled).toContain('stroke-width="2.4"')
  expect(styled).not.toContain('<rect x="0" y="0" width="100" height="61"')
})

test('restyle preserves rounded rectangle geometry', () => {
  const transit = STYLES.find(s => s.name === 'transit')!
  const raw = renderMermaidSVG('flowchart TD\n  A[Alpha]', {
    transparent: true,
    embedFontImport: false,
    style: { node: { cornerRadius: 12 } },
  })
  const styled = restyle(raw, transit, { backdrop: false })
  const d = styled.match(/<path d="([^"]+)"[^>]*stroke="#d4d4d4"/)?.[1]

  expect(d).toBeTruthy()
  expect(d!.match(/L/g)?.length ?? 0).toBeGreaterThan(8)
  expect(styled).not.toContain('<rect')
})
