// Loop 10 M2 (#116): auto-contrast node text on custom fills.
//
// NOTE: this feature was already implemented (contrastTextColor + nodeTextColor
// in renderer.ts) before Loop 10 — the Loop 10 verification pass initially
// missed it (checked theme.ts's isColorDark, not renderer.ts's
// contrastTextColor). This file adds the regression coverage that was missing
// so the behavior can't silently regress.

import { describe, test, expect } from 'bun:test'
import fc from 'fast-check'
import { fcParameters } from './helpers/fc-parameters.ts'
import { contrastTextColor, createFillInkResolver } from '../color-resolver.ts'
import { renderMermaidSVG } from '../index.ts'
import { wcagContrastRatio } from '../shared/color-math.ts'
import { renderMermaidPNG } from '../agent/png.ts'
import { decodePng } from './helpers/png-pixels.ts'

function firstTextFill(svg: string): string | undefined {
  return svg.match(/<text[^>]*fill="([^"]+)"/)?.[1]
}

describe('#116 auto-contrast node text on custom fills', () => {
  test('dark fill → white text', () => {
    const svg = renderMermaidSVG('flowchart TD\n  A\n  style A fill:#000000')
    expect(firstTextFill(svg)).toBe('#FFFFFF')
  })

  test('light fill → black text', () => {
    const svg = renderMermaidSVG('flowchart TD\n  A\n  style A fill:#ffffff')
    expect(firstTextFill(svg)).toBe('#000000')
  })

  test('no custom fill → theme default (not forced black/white)', () => {
    const svg = renderMermaidSVG('flowchart TD\n  A')
    expect(svg).toMatch(/<text\b[^>]*>A<\/text>/)
    const fill = firstTextFill(svg)
    expect(fill).toBeDefined()
    expect(fill).not.toBe('#FFFFFF')
    expect(fill).not.toBe('#000000')
  })

  test('mid-tone fill resolves to a contrasting color', () => {
    const darkBlue = renderMermaidSVG('flowchart TD\n  A\n  style A fill:#1a2b4c')
    expect(firstTextFill(darkBlue)).toBe('#FFFFFF')
    const paleYellow = renderMermaidSVG('flowchart TD\n  A\n  style A fill:#fff8b0')
    expect(firstTextFill(paleYellow)).toBe('#000000')
  })

  test('explicit color: overrides auto-contrast', () => {
    const svg = renderMermaidSVG('flowchart TD\n  A\n  style A fill:#000000,color:#ff0000')
    expect(firstTextFill(svg)).toBe('#ff0000')
  })

  test('classDef fill drives contrast the same as inline style', () => {
    const svg = renderMermaidSVG('flowchart TD\n  A\n  classDef dark fill:#101010\n  class A dark')
    expect(firstTextFill(svg)).toBe('#FFFFFF')
  })

  // Loop 12 M4: `style A fill:rgb(10,10,10)` now works — the style parser
  // splits on top-level commas only, so rgb()/rgba()/hsl() survive intact
  // and drive contrast end-to-end.
  test('rgb() fill drives contrast (Loop 12 M4 fix)', () => {
    const svg = renderMermaidSVG('flowchart TD\n A\n style A fill:rgb(10,10,10)')
    expect(firstTextFill(svg)).toBe('#FFFFFF')
  })
})

// Auto ink is the better of black and white, which clears WCAG AA (4.5:1) on
// every opaque fill. A brightness cut-off picked white on mid-tone fills such
// as #3b82f6 (3.68:1) and #10b981 (2.54:1).
describe('auto-contrast ink contract', () => {
  test('a render-local ink resolver keeps authored-fill policy and page colors independent', () => {
    const ink = createFillInkResolver({ bg: '#ffffff', fg: '#27272a' })
    // A Style's explicit ink stays authoritative on its own surface. The same
    // ink on an independently authored fill must adapt to remain legible.
    expect(ink('#ffffff', '#ffffff')).toBe('#ffffff')
    expect(wcagContrastRatio(ink('#ffffff', '#ffffff', true), '#ffffff')!).toBeGreaterThanOrEqual(4.5)
    expect(ink('#ffffff', '#ffffff')).toBe('#ffffff')
    expect(wcagContrastRatio(ink('#ffffff', '#000000', true), '#000000')!).toBeGreaterThanOrEqual(4.5)
    expect(createFillInkResolver({ bg: 'var(--page)', fg: 'var(--ink)' })('var(--_text)', 'var(--surface)')).toBe('var(--_text)')
  })
  const hexArb = fc.integer({ min: 0, max: 0xffffff }).map(value => `#${value.toString(16).padStart(6, '0')}`)

  test('picks the higher-contrast ink, at least 4.5:1, for any opaque fill', () => {
    fc.assert(fc.property(hexArb, fill => {
      const ink = contrastTextColor(fill)!
      const other = ink === '#000000' ? '#FFFFFF' : '#000000'
      expect(wcagContrastRatio(ink, fill)!).toBeGreaterThanOrEqual(Math.max(4.5, wcagContrastRatio(other, fill)!))
    }), fcParameters({ numRuns: 2000 }))
  })

  test('node text on a custom fill clears WCAG AA end to end', () => {
    fc.assert(fc.property(hexArb, fill => {
      const svg = renderMermaidSVG(`flowchart TD\n  A\n  style A fill:${fill}`)
      expect(wcagContrastRatio(firstTextFill(svg)!, fill)!).toBeGreaterThanOrEqual(4.5)
    }), fcParameters({ numRuns: 60 }))
  })
})

// Read only the selected semantic owner's shape ink: marker definitions,
// text halos, translucent watercolor washes and invisible scaffolds cannot
// stand in for the card's actual outline.
function ownedShapes(svg: string, id: string): string[] {
  const owner = svg.match(new RegExp(`<g\\b[^>]*data-id="${id}"[^>]*>([\\s\\S]*?)</g>`))?.[1]
  expect(owner, `SVG owner ${id}`).toBeDefined()
  return [...owner!.matchAll(/<(?:rect|path|polygon|circle|ellipse)\b[^>]*>/g)].map(match => match[0])
}

function attribute(tag: string, name: string): string | undefined {
  return tag.match(new RegExp(`(?:^|\\s)${name}="([^"]*)"`))?.[1]
}

function opaqueOutlineStrokes(shapes: string[]): string[] {
  return shapes.filter(tag =>
    Number(attribute(tag, 'opacity') ?? 1) === 1 &&
    Number(attribute(tag, 'stroke-opacity') ?? 1) === 1 &&
    Number(attribute(tag, 'stroke-width') ?? 1) > 0,
  ).map(tag => attribute(tag, 'stroke')).filter((paint): paint is string => !!paint && paint !== 'none')
}

describe('public structural outline ink', () => {
  const presentations = [
    { name: 'default', style: undefined, bg: '#FFFFFF' },
    { name: 'rough look with dark palette', style: ['hand-drawn', 'dracula'], bg: '#282a36' },
    { name: 'hybrid look with dark palette', style: ['watercolor', 'dracula'], bg: '#282a36' },
  ]
  const cards = [
    { name: 'flowchart', source: 'flowchart TD\nsubgraph app[Application]\nA[Card]\nend', ids: ['app', 'A'] },
    { name: 'Class', source: 'classDiagram\nclass Card', ids: ['Card'] },
    { name: 'ER', source: 'erDiagram\nCard {\n string value\n}', ids: ['Card'] },
    { name: 'C4', source: 'C4Context\nSystem_Boundary(app,"Application") {\nSystem(a,"Card")\n}', ids: ['app', 'a'] },
  ]

  for (const { name, style, bg } of presentations) {
    test(`${name}: owned C4, flowchart, Class and ER borders clear 3:1 against the page`, () => {
      for (const card of cards) {
        const svg = renderMermaidSVG(card.source, { style, mermaidConfig: { c4: { typeLegend: false } } })
        for (const id of card.ids) {
          const strokes = opaqueOutlineStrokes(ownedShapes(svg, id))
          expect(strokes.length, `${card.name} ${id} has painted outline ink`).toBeGreaterThan(0)
          for (const ink of strokes) expect(wcagContrastRatio(ink, bg), `${card.name} ${id}: ${ink} against ${bg}`).toBeGreaterThanOrEqual(3)
        }
      }
    })
  }

  test('a top-level palette border is repaired in owned ink while its public token is retained', () => {
    for (const { bg, fg, page } of [
      { bg: '#282a36', fg: '#f8f8f2', page: '#282a36' },
      { bg: 'rgb(40,42,54)', fg: 'rgb(248,248,242)', page: '#282a36' },
      { bg: 'hsl(240,100%,10%)', fg: 'hsl(60,100%,90%)', page: '#000033' },
      { bg: 'black', fg: 'white', page: '#000000' },
    ]) {
      const svg = renderMermaidSVG('flowchart TD\nA[Card]', { bg, fg, border: '#26262b' })
      expect(svg).toContain(`--bg:${bg}`)
      expect(svg).toContain(`--fg:${fg}`)
      expect(svg).toMatch(/--border:\s*#26262b/)
      expect(svg).not.toContain('NaN')
      const strokes = opaqueOutlineStrokes(ownedShapes(svg, 'A'))
      expect(strokes).toHaveLength(1)
      expect(wcagContrastRatio(strokes[0]!, page), `${bg} / ${fg}`).toBeGreaterThanOrEqual(3)
    }
    for (const { bg, stroke } of [
      { bg: 'var(--host-page)', stroke: 'var(--_node-stroke)' },
      { bg: '#282a3680', stroke: '#26262b' },
      { bg: 'rgba(40,42,54,0.5)', stroke: 'var(--_node-stroke)' },
    ]) {
      const svg = renderMermaidSVG('flowchart TD\nA[Card]', { bg, fg: '#f8f8f2', border: '#26262b' })
      expect(svg).toContain(`--bg:${bg}`)
      expect(svg).toContain('--border:#26262b')
      expect(opaqueOutlineStrokes(ownedShapes(svg, 'A'))).toEqual([stroke])
      expect(svg).not.toContain('NaN')
    }
  })

  test('the public PNG paints a contrasting card edge under default, rough and hybrid looks', () => {
    const source = 'C4Context\nSystem(a,"Card")'
    const options = { mermaidConfig: { c4: { typeLegend: false } } }
    const box = ownedShapes(renderMermaidSVG(source, options), 'a')[0]!
    const x = Number(attribute(box, 'x')), y = Number(attribute(box, 'y')), height = Number(attribute(box, 'height'))
    for (const { name, style, bg } of presentations) {
      // Exercise the original rough/dark witness at the public default PNG
      // scale. Magnify the other paths to inspect their source ink: a .75px
      // crisp stroke need not retain 3:1 in every antialiased screen pixel.
      const image = decodePng(renderMermaidPNG(source, { ...options, style, ...(style?.[0] === 'hand-drawn' ? {} : { scale: 4 }) }))
      const svg = renderMermaidSVG(source, { ...options, style })
      const scale = image.width / Number(attribute(svg.match(/<svg\b[^>]*>/)![0], 'width'))
      const colorAt = (px: number, py: number) => '#'+ [...image.rgba.slice((py * image.width + px) * 4, (py * image.width + px) * 4 + 3)].map(channel => channel.toString(16).padStart(2, '0')).join('')
      expect(colorAt(0, 0).toLowerCase()).toBe(bg.toLowerCase())
      let paintedRows = 0, rows = 0
      // A border-only strip away from corners, text and any relation. A
      // faint background rule or wash cannot satisfy this paint threshold.
      for (let py = Math.ceil((y + height * 0.25) * scale); py < (y + height * 0.75) * scale; py++) {
        rows++
        for (let px = Math.floor((x - 4) * scale); px <= (x + 4) * scale; px++) {
          if (wcagContrastRatio(colorAt(px, py), bg)! >= 3) { paintedRows++; break }
        }
      }
      expect(paintedRows / rows, `${name}: contrasting painted border rows`).toBeGreaterThan(0.8)
    }
  })

  test('authored host border variables remain live through concrete palette resolution', () => {
    for (const colors of [
      { bg: '#282a36', fg: '#f8f8f2' },
      { bg: 'black', fg: 'white' },
      { bg: 'rgb(40,42,54)', fg: 'rgb(248,248,242)' },
    ]) {
      for (const border of ['var(--brand-border)', 'var(--brand-border, #ff0000)', 'var(--brand-border, var(--fallback-border, #ff0000))']) {
        const svg = renderMermaidSVG('flowchart TD\nA[Card]', { ...colors, border })
        expect(svg).toContain(`--border:${border}`)
        expect(opaqueOutlineStrokes(ownedShapes(svg, 'A'))).toEqual([border])
        expect(svg).not.toContain('NaN')
      }
    }
  })

  test('explicit node/group role ink and intentional none bypass palette repair', () => {
    const source = 'C4Context\nSystem_Boundary(app,"Application") {\nSystem(a,"Card")\n}'
    for (const borderColor of ['#282a36', 'none']) {
      const svg = renderMermaidSVG(source, {
        style: ['dracula', { roles: { node: { borderColor, lineWidth: 2 }, group: { borderColor, lineWidth: 2 } } }],
        mermaidConfig: { c4: { typeLegend: false } },
      })
      for (const id of ['app', 'a']) {
        const shapes = ownedShapes(svg, id)
        expect(shapes.some(tag => attribute(tag, 'stroke') === borderColor && attribute(tag, 'stroke-width') === '2')).toBe(true)
      }
    }
  })

  test('authored C4 node and boundary borders override palette and role candidates', () => {
    const source = 'C4Context\nSystem_Boundary(app,"Application") {\nSystem(a,"Card")\n}\nUpdateElementStyle(a,$borderColor="#282a36")\nUpdateElementStyle(app,$borderColor="#282a36")'
    const svg = renderMermaidSVG(source, {
      style: ['hand-drawn', 'dracula', { roles: { node: { borderColor: '#ff0000' }, group: { borderColor: '#00ff00' } } }],
      mermaidConfig: { c4: { typeLegend: false } },
    })
    for (const id of ['app', 'a']) expect(opaqueOutlineStrokes(ownedShapes(svg, id))).toContain('#282a36')
    const flow = renderMermaidSVG('flowchart TD\nA[Card]\nstyle A stroke:#282a36,stroke-width:0', { style: ['hand-drawn', 'dracula'] })
    expect(ownedShapes(flow, 'A').some(tag => attribute(tag, 'stroke') === '#282a36' && attribute(tag, 'stroke-width') === '0')).toBe(true)
  })
})
