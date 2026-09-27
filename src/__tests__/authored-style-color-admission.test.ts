import { describe, expect, test } from 'bun:test'
import fc from 'fast-check'

import { renderMermaidSVG } from '../index.ts'
import { buildMermaid, verifyMermaid } from '../agent/index.ts'
import { renderMermaidPNG } from '../agent/png.ts'
import { drawableAuthoredCssPaint } from '../shared/css-color.ts'
import { tryParseCssColor } from '../shared/color-math.ts'

const INVALID = [
  'notacolor', 'constructor', '__proto__', 'rgb(x)', 'rgb(1oops,2,3)',
  'rgba(1,2,3,0.5junk)', 'hsl(120,50%oops,50%)', '#12345',
  'hwb(120 0% 0%)', 'color-mix(in srgb, red, blue)', 'url(#a)',
] as const

const SOURCES = [
  { directive: 'style A', make: (value: string) => `flowchart TD\n  A --> B\n  style A fill:${value}` },
  { directive: 'classDef hot', make: (value: string) => `flowchart TD\n  A:::hot --> B\n  classDef hot fill:${value}` },
  { directive: 'linkStyle 0', make: (value: string) => `flowchart TD\n  A --> B\n  linkStyle 0 stroke:${value}` },
  { directive: 'classDef hot', make: (value: string) => `stateDiagram-v2\n  A --> B\n  classDef hot fill:${value}\n  class A hot` },
  { directive: 'style A', make: (value: string) => `classDiagram\n  class A\n  style A fill:${value}` },
  { directive: 'style A', make: (value: string) => `erDiagram\n  A ||--o{ B : has\n  style A fill:${value}` },
] as const

describe('authored style color admission (#303, source/typed slice)', () => {
  test('distinguishes real colors from safe-looking words and malformed functions', () => {
    for (const value of INVALID) expect(drawableAuthoredCssPaint(value), value).toBeUndefined()
    for (const value of ['red', '#f96', '#3b82', '#112233', '#11223380', 'rgb(1,2,3)', 'rgba(1,2,3,.5)', 'hsl(120,50%,50%)', 'transparent', 'currentColor', 'var(--brand)']) {
      expect(drawableAuthoredCssPaint(value), value).toBe(value)
    }
    expect(drawableAuthoredCssPaint('none', true)).toBe('none')
    expect(drawableAuthoredCssPaint('none', false)).toBeUndefined()
    expect(tryParseCssColor('constructor')).toBeNull()
    expect(tryParseCssColor('rgb(1oops,2,3)')).toBeNull()
    expect(tryParseCssColor('#3b82')).toEqual([0x33, 0xbb, 0x88, 0x22 / 255])
  })

  test('every affected graphical source placement refuses the offending value by directive and property', () => {
    fc.assert(fc.property(fc.constantFrom(...SOURCES), fc.constantFrom(...INVALID), ({ directive, make }, value) => {
      const source = make(value)
      expect(() => renderMermaidSVG(source)).toThrow(`${directive}: ${directive.startsWith('linkStyle') ? 'stroke' : 'fill'} ${JSON.stringify(value)} is not a CSS color`)
    }), { numRuns: 100 })
  })

  test('verify exposes the same reason, and PNG refuses before drawing a misleading node', () => {
    const source = SOURCES[0]!.make('notacolor')
    expect(verifyMermaid(source).warnings).toEqual([
      { code: 'RENDER_FAILED', reason: expect.stringContaining('style A: fill "notacolor" is not a CSS color') },
    ])
    expect(() => renderMermaidPNG(source)).toThrow('style A: fill "notacolor" is not a CSS color')
  })

  test('typed style mutations refuse the same unknown and malformed colors at build time', () => {
    fc.assert(fc.property(fc.constantFrom(...INVALID), value => {
      const result = buildMermaid('flowchart', [
        { kind: 'add_node', id: 'A', label: 'A' },
        { kind: 'set_node_style', id: 'A', style: `fill:${value}` },
      ])
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.error.code).toBe('INVALID_OP')
        expect(result.error.message).toContain(`fill ${JSON.stringify(value)} is not a CSS color`)
      }
    }), { numRuns: 100 })
  })
})
