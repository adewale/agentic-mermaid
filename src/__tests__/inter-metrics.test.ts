import { expect, test } from 'bun:test'
import { renderMermaidSVGWithReceipt, renderMermaidSVG, createMermaidRenderer, validateSerializableRenderOptions } from '../index.ts'
import { BUNDLED_INTER_TEXT_MEASUREMENT } from '../inter-metrics.ts'
import { measureTextWidth } from '../text-metrics.ts'
import { createTextMeasurementExecution, withTextMeasurementExecution } from '../text-measurement-profile.ts'
import { preparePixelText } from '../shared/prepared-text.ts'

test('bundled Inter reserves natural digit and kerned word advances', () => {
  // Independent hb-shape observations from the shipped Regular face, 16px.
  for (const [text, expected] of [['11111111', 52.0625], ['AVATAR', 59.875], ['Authentication', 109.5234375]] as const) {
    const execution = createTextMeasurementExecution(BUNDLED_INTER_TEXT_MEASUREMENT, 'Inter')
    expect(withTextMeasurementExecution(execution, () => measureTextWidth(text, 16, 400))).toBeCloseTo(expected, 6)
  }
})

test('unsupported scripts, styles, faces and weights retain the estimator', () => {
  for (const [text, family, style, weight] of [['مرحبا', 'Inter', 'normal', 400], ['Hello', 'Acme, Inter', 'normal', 400], ['Hello', 'Inter', 'italic', 400], ['Hello', 'Inter', 'normal', 450]] as const) {
    const expected = measureTextWidth(text, 16, weight, style, family)
    const execution = createTextMeasurementExecution(BUNDLED_INTER_TEXT_MEASUREMENT, family)
    expect(withTextMeasurementExecution(execution, () => measureTextWidth(text, 16, weight, style, family))).toBe(expected)
  }
})

test('the serializable option selects the same profile for layout and paint', () => {
  expect(validateSerializableRenderOptions({ fontMetrics: 'bundled-inter' })).toEqual([])
  const source = 'flowchart TD\nA[11111111]'
  const options = { fontMetrics: 'bundled-inter' as const, embedFontImport: false }
  const result = renderMermaidSVGWithReceipt(source, options)
  expect(result.receipt.textMeasurement?.id).toBe('agentic-mermaid:bundled-inter-ascii')
  expect(result.svg).not.toBe(renderMermaidSVG(source, { embedFontImport: false }))
  const host = createMermaidRenderer({ textMeasurement: { id: 'test:host', version: '1.0.0', measure: () => 100 } })
  expect(() => host.renderMermaidSVG(source, options)).toThrow('cannot be combined')
  expect(renderMermaidSVG(source, { fontMetrics: 'estimate' })).toBe(renderMermaidSVG(source))
})

test('partial metrics preserve fallback shaping envelopes and italic tracking padding', () => {
  for (const text of ['مرحبا', '👩‍💻', '<i>WWW</i>']) {
    const options = { fontSize: 16, fontWeight: 400, letterSpacing: 1 }
    const expected = preparePixelText(text, options)
    const execution = createTextMeasurementExecution(BUNDLED_INTER_TEXT_MEASUREMENT, 'Inter')
    const actual = withTextMeasurementExecution(execution, () => preparePixelText(text, options))
    expect(actual.width).toBeCloseTo(expected.width, 6)
    expect(actual.height).toBe(expected.height)
  }
})
