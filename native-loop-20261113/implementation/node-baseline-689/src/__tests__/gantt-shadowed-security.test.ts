import { describe, expect, test } from 'bun:test'
import { renderMermaidASCII, renderMermaidSVG, renderMermaidSVGWithReceipt, verifyNoExternalRefs } from '../index.ts'
import { renderMermaidPNG } from '../agent/png.ts'
import { verifyMermaid } from '../agent/index.ts'
import { projectRenderErrorDiagnostic } from '../render-error-diagnostic.ts'

const source = (payload: string) => `gantt
  dateFormat YYYY-MM-DD
  todayMarker ${payload}
  Build : task, 2024-01-01, 3d`
const options = { ganttToday: '2024-01-02', embedFontImport: false }
const unsafe = [
  'url(//example.com/paint)', 'expression(alert(1))', 'behavior(foo)',
  'image-set(foo)', 'cross-fade(foo)', 'calc(-webkit-image-set(foo))',
]

describe('Gantt shadowed line paint security', () => {
  test.each(['notacolor', 'rgb(x)', '#12345', 'hwb(120 0% 0%)'])('refuses effective %s by name before clock and output projection', value => {
    const input = source(`stroke:${value}`)
    const named = `todayMarker: stroke ${JSON.stringify(value)} is not a CSS color`
    for (const renderOptions of [{}, options, { ganttToday: '2030-01-01' }]) {
      for (const render of [renderMermaidSVG, renderMermaidPNG]) {
        expect(() => render(input, renderOptions)).toThrow(named)
      }
      for (const useAscii of [true, false]) {
        expect(() => renderMermaidASCII(input, { ...renderOptions, useAscii })).toThrow(named)
      }
      const verification = verifyMermaid(input, { renderOptions })
      expect(verification.ok).toBe(false)
      expect(verification.warnings).toContainEqual({ code: 'RENDER_FAILED', reason: expect.stringContaining(named), origin: 'source' })
    }
    try {
      renderMermaidSVG(input)
      throw new Error('Expected invalid stroke refusal')
    } catch (error) {
      expect(projectRenderErrorDiagnostic(error)).toEqual({
        code: 'INVALID_STYLE_COLOR', message: expect.stringContaining(named), subject: 'todayMarker', property: 'stroke', value,
      })
    }
  })

  test.each(['rebeccapurple', '#3b82', 'rgb(1,2,3)', 'hsl(120 100% 50%)', 'transparent', 'currentColor', 'none', 'var(--brand)'])('retains a valid authored %s on the marker', value => {
    const input = source(`stroke:${value}`)
    const marker = renderMermaidSVG(input, options).match(/<line class="gantt-today-marker"[^>]*>/)![0]
    expect(marker).toContain(`stroke="${value}"`)
    expect(() => renderMermaidASCII(input, { ...options, colorMode: 'truecolor' })).not.toThrow()
  })

  test.each(unsafe)('overridden %s cannot become new output content', value => {
    for (const payload of [`Stroke:${value},stroke:#f00`, `stroke:#111,Stroke:${value},stroke:#f00`]) {
      const input = source(payload)
      for (const security of ['default', 'strict'] as const) {
        const artifact = renderMermaidSVGWithReceipt(input, { ...options, security })
        expect(artifact.svg).toContain('stroke="#f00"')
        expect(artifact.svg).not.toContain(value)
        expect(verifyNoExternalRefs(artifact.svg).ok).toBe(true)
        expect(artifact.receipt.diagnostics?.filter(diagnostic => diagnostic.code === 'EXTERNAL_REFERENCE') ?? []).toEqual([])
      }
    }
  })

  test.each(unsafe)('overridden %s preserves the final effective paint in PNG', value => {
    const pngOptions = { ...options, scale: 0.2, onWarning: () => {} }
    const expected = renderMermaidPNG(source('stroke:#f00'), pngOptions)
    for (const payload of [`Stroke:${value},stroke:#f00`, `stroke:#111,Stroke:${value},stroke:#f00`]) {
      const actual = renderMermaidPNG(source(payload), pngOptions)
      expect(Buffer.from(actual).equals(Buffer.from(expected))).toBe(true)
    }
  })

  test.each(unsafe)('an effective %s still fails rather than silently changing security policy', value => {
    const input = source(`stroke:#f00,Stroke:${value}`)
    for (const security of ['default', 'strict'] as const) {
      expect(() => renderMermaidSVG(input, { ...options, security })).toThrow()
    }
    expect(() => renderMermaidPNG(input, { ...options, scale: 0.2, onWarning: () => {} })).toThrow()
  })

  test('safe case-alias overrides retain their final effective paint', () => {
    for (const payload of ['stroke:#111,Stroke:#222,STROKE:#f00,opacity:0.5', 'stroke:#111,Stroke:#222,stroke:#f00,opacity:0.5']) {
      const svg = renderMermaidSVG(source(payload), options)
      expect(svg).toContain('stroke="#f00"')
      expect(svg).toContain('opacity="0.5"')
      expect(verifyNoExternalRefs(svg).ok).toBe(true)
    }
  })
})
