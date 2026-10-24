import { describe, expect, test } from 'bun:test'
import { renderMermaidSVG, renderMermaidSVGWithReceipt, verifyNoExternalRefs } from '../index.ts'
import { renderMermaidPNG } from '../agent/png.ts'

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
  test.each(unsafe)('overridden %s cannot become new output content', value => {
    const input = source(`Stroke:${value},stroke:#f00`)
    for (const security of ['default', 'strict'] as const) {
      const artifact = renderMermaidSVGWithReceipt(input, { ...options, security })
      expect(artifact.svg).toContain('stroke="#f00"')
      expect(artifact.svg).not.toContain(value)
      expect(verifyNoExternalRefs(artifact.svg).ok).toBe(true)
      expect(artifact.receipt.diagnostics?.filter(diagnostic => diagnostic.code === 'EXTERNAL_REFERENCE') ?? []).toEqual([])
    }
  })

  test.each(unsafe)('overridden %s preserves the final effective paint in PNG', value => {
    const pngOptions = { ...options, scale: 0.2, onWarning: () => {} }
    const expected = renderMermaidPNG(source('stroke:#f00'), pngOptions)
    const actual = renderMermaidPNG(source(`Stroke:${value},stroke:#f00`), pngOptions)
    expect(Buffer.from(actual).equals(Buffer.from(expected))).toBe(true)
  })

  test.each(unsafe)('an effective %s still fails rather than silently changing security policy', value => {
    const input = source(`stroke:#f00,Stroke:${value}`)
    for (const security of ['default', 'strict'] as const) {
      expect(() => renderMermaidSVG(input, { ...options, security })).toThrow()
    }
    expect(() => renderMermaidPNG(input, { ...options, scale: 0.2, onWarning: () => {} })).toThrow()
  })

  test('safe case-alias overrides retain their final effective paint', () => {
    const svg = renderMermaidSVG(source('stroke:#111,Stroke:#222,STROKE:#f00,opacity:0.5'), options)
    expect(svg).toContain('stroke="#f00"')
    expect(svg).toContain('opacity="0.5"')
    expect(verifyNoExternalRefs(svg).ok).toBe(true)
  })
})
