import { describe, expect, test } from 'bun:test'

import { renderMermaidASCII, renderMermaidSVG } from '../index.ts'
import { renderMermaidSVGAsync } from '../browser-lazy.ts'
import { buildMermaid, verifyMermaid } from '../agent/index.ts'
import { renderMermaidPNG } from '../agent/png.ts'
import { runBatchLine } from '../cli/index.ts'
import { handleHostedRequest } from '../mcp/hosted-server.ts'
import { projectRenderErrorDiagnostic } from '../render-error-diagnostic.ts'
import { drawableAuthoredCssPaint } from '../shared/css-color.ts'
import { tryParseCssColor } from '../shared/color-math.ts'

const INVALID = [
  'notacolor', 'constructor', '__proto__', 'rgb(x)', 'rgb(1oops,2,3)',
  'rgba(1,2,3,0.5junk)', 'hsl(120,50%oops,50%)', '#12345',
  'rgb(1 2 3 / .5 / junk)', 'hsl(120 50% 50% / .5 / junk)',
  'rgb(1 2 3 .5)', 'hsl(120 50% 50% .5)',
  'rgb(1,20%,3)', 'rgba(1,20%,3,.5)',
  'rgb(1. 2 3)', 'rgb(1.e2 2 3)', 'hsl(120. 50% 50%)',
  'rgb(1, 2, 3 / .5)', 'hsl(120, 50%, 50% / .5)',
  'hsl(1e308turn,50%,50%)',
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
    for (const value of ['red', '#f96', '#3b82', '#112233', '#11223380', 'rgb(1,2,3)', 'rgba(1,2,3,.5)', 'rgb(300,0,0)', 'rgb(-1 0 0)', 'rgba(255,0,0,2)', 'hsl(120,50%,50%)', 'hsl(120 100 50)', 'hsl(120 150% 50%)', 'hsl(120 100% 150%)', 'transparent', 'currentColor', 'var(--brand)']) {
      expect(drawableAuthoredCssPaint(value), value).toBe(value)
    }
    expect(tryParseCssColor('rgb(300,0,0)')).toEqual([255, 0, 0, 1])
    expect(tryParseCssColor('rgba(255,0,0,2)')).toEqual([255, 0, 0, 1])
    expect(tryParseCssColor('hsl(120 100 50)')).toEqual([0, 255, 0, 1])
    for (const value of ['rgb(300,0,0)', 'rgba(255,0,0,2)', 'hsl(120 100 50)', 'hsl(120 150% 50%)']) {
      expect(() => renderMermaidSVG(SOURCES[0]!.make(value)), value).not.toThrow()
    }
    expect(drawableAuthoredCssPaint('none', true)).toBe('none')
    expect(drawableAuthoredCssPaint('none', false)).toBeUndefined()
    expect(tryParseCssColor('constructor')).toBeNull()
    expect(tryParseCssColor('rgb(1oops,2,3)')).toBeNull()
    expect(tryParseCssColor('rgb(1 2 3 / .5 / junk)')).toBeNull()
    expect(tryParseCssColor('hsl(120 50% 50% / .5 / junk)')).toBeNull()
    expect(tryParseCssColor('hsl(1e308turn,50%,50%)')).toBeNull()
    expect(tryParseCssColor('rgb(1,20%,3)')).toBeNull()
    expect(tryParseCssColor('#3b82')).toEqual([0x33, 0xbb, 0x88, 0x22 / 255])
  })

  test('every affected graphical source placement refuses the offending value by directive and property', () => {
    for (const { directive, make } of SOURCES) {
      for (const value of INVALID) {
        const source = make(value)
        const named = `${directive}: ${directive.startsWith('linkStyle') ? 'stroke' : 'fill'} ${JSON.stringify(value)} is not a CSS color`
        expect(() => renderMermaidSVG(source)).toThrow(named)
        expect(() => renderMermaidASCII(source, { useAscii: true })).toThrow(named)
        expect(() => renderMermaidASCII(source, { useAscii: false })).toThrow(named)
      }
    }
  })

  test('verify exposes the same reason, and PNG refuses before drawing a misleading node', () => {
    const source = SOURCES[0]!.make('notacolor')
    expect(verifyMermaid(source).warnings).toEqual([
      { code: 'RENDER_FAILED', reason: expect.stringContaining('style A: fill "notacolor" is not a CSS color') },
    ])
    expect(() => renderMermaidPNG(source)).toThrow('style A: fill "notacolor" is not a CSS color')
    for (const colorMode of ['none', 'ansi16', 'ansi256', 'truecolor', 'html'] as const) {
      expect(() => renderMermaidASCII(source, { colorMode })).toThrow('style A: fill "notacolor" is not a CSS color')
    }
  })

  test('unused declarations cannot hide invalid colors from render or verify', () => {
    for (const [source, named] of [
      ['flowchart TD\n  A --> B\n  classDef unused fill:notacolor', 'classDef unused: fill "notacolor"'],
      ['flowchart TD\n  A --> B\n  style Z fill:notacolor', 'style Z: fill "notacolor"'],
      ['flowchart TD\n  A --> B\n  linkStyle 99 stroke:notacolor', 'linkStyle 99: stroke "notacolor"'],
      ['stateDiagram-v2\n  A --> B\n  classDef unused fill:notacolor', 'classDef unused: fill "notacolor"'],
      ['classDiagram\n  class A\n  classDef unused fill:notacolor', 'classDef unused: fill "notacolor"'],
      ['erDiagram\n  A ||--o{ B : has\n  classDef unused fill:notacolor', 'classDef unused: fill "notacolor"'],
    ] as const) {
      expect(() => renderMermaidSVG(source), source).toThrow(named)
      expect(() => renderMermaidASCII(source, { useAscii: true }), source).toThrow(named)
      const result = verifyMermaid(source)
      expect(result.ok, source).toBe(false)
      expect(result.warnings.some(warning => warning.code === 'RENDER_FAILED' && warning.reason?.includes(named)), source).toBe(true)
    }
  })

  test('async browser SVG refuses invalid paint in every affected family', async () => {
    for (const { directive, make } of SOURCES) {
      const source = make('notacolor')
      const named = `${directive}: ${directive.startsWith('linkStyle') ? 'stroke' : 'fill'} "notacolor" is not a CSS color`
      await expect(renderMermaidSVGAsync(source), source).rejects.toThrow(named)
    }
    for (const [source, named] of [
      ['flowchart TD\n  A --> B\n  classDef unused fill:notacolor', 'classDef unused: fill "notacolor"'],
      ['flowchart TD\n  A --> B\n  linkStyle 99 stroke:notacolor', 'linkStyle 99: stroke "notacolor"'],
      ['stateDiagram-v2\n  A --> B\n  classDef unused fill:notacolor', 'classDef unused: fill "notacolor"'],
      ['classDiagram\n  class A\n  classDef unused fill:notacolor', 'classDef unused: fill "notacolor"'],
      ['erDiagram\n  A ||--o{ B : has\n  classDef unused fill:notacolor', 'classDef unused: fill "notacolor"'],
    ] as const) {
      await expect(renderMermaidSVGAsync(source), source).rejects.toThrow(named)
    }
  })

  test('typed style mutations refuse the same unknown and malformed colors at build time', () => {
    for (const value of INVALID) {
      const result = buildMermaid('flowchart', [
        { kind: 'add_node', id: 'A', label: 'A' },
        { kind: 'set_node_style', id: 'A', style: `fill:${value}` },
      ])
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.error.code).toBe('INVALID_OP')
        expect(result.error.message).toContain(`fill ${JSON.stringify(value)} is not a CSS color`)
      }
    }
  })

  test('Class, ER, and State typed style mutations reject bad paint', () => {
    const results = [
      buildMermaid('class', [
        { kind: 'add_class', id: 'A' },
        { kind: 'set_class_style', class: 'A', style: 'fill:notacolor' },
      ]),
      buildMermaid('class', [{ kind: 'define_class', name: 'hot', style: 'fill:notacolor' }]),
      buildMermaid('er', [
        { kind: 'add_entity', id: 'A' },
        { kind: 'set_entity_style', entity: 'A', style: 'fill:notacolor' },
      ]),
      buildMermaid('er', [{ kind: 'define_class', name: 'hot', style: 'fill:notacolor' }]),
      buildMermaid('state', [
        { kind: 'add_state', id: 'A' },
        { kind: 'set_state_style', id: 'A', style: 'fill:notacolor' },
      ]),
      buildMermaid('state', [{ kind: 'define_class', name: 'hot', style: 'fill:notacolor' }]),
      buildMermaid('state', [
        { kind: 'add_state', id: 'A' },
        { kind: 'add_state', id: 'B' },
        { kind: 'add_transition', from: 'A', to: 'B' },
        { kind: 'set_transition_style', index: 0, style: 'stroke:notacolor' },
      ]),
    ]
    const contexts = ['set_class_style A', 'define_class hot', 'set_entity_style A', 'define_class hot', 'State inline style', 'State class style', 'State transition style']
    for (const [index, result] of results.entries()) {
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.error.code).toBe('INVALID_OP')
        expect(result.error.message).toContain(contexts[index]!)
        expect(result.error.message).toContain('"notacolor" is not a CSS color')
      }
    }
  })

  test('CLI and MCP SVG transport preserve only the nominal, named diagnostic', async () => {
    const source = SOURCES[0]!.make('notacolor')
    for (const format of ['svg', 'ascii', 'unicode'] as const) {
      const batch = runBatchLine(JSON.stringify({ op: 'render', format, source }), 0) as { ok: boolean; error: { code: string; message: string; property: string; value: string } }
      expect(batch.ok).toBe(false)
      expect(batch.error).toMatchObject({ code: 'INVALID_STYLE_COLOR', property: 'fill', value: 'notacolor', message: expect.stringContaining('style A: fill "notacolor"') })
    }

    const response = await handleHostedRequest(
      { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'render_svg', arguments: { source } } },
      {
        async execute() { return { ok: true, value: null, logs: [] } },
        async renderPng() { throw new Error('not used by render_svg') },
      },
    )
    const text = (response?.result as { content: Array<{ text: string }> }).content[0]!.text
    const payload = JSON.parse(text) as { ok: boolean; error: { code: string; property: string; value: string } }
    expect(payload).toMatchObject({ ok: false, error: { code: 'INVALID_STYLE_COLOR', property: 'fill', value: 'notacolor' } })

    expect(projectRenderErrorDiagnostic({ code: 'INVALID_STYLE_COLOR', message: 'forged', property: 'fill', value: 'notacolor' }))
      .toEqual({ code: 'RENDER_FAILED', message: 'Rendering failed' })
  })
})
