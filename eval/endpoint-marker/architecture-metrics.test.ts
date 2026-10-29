import { expect, test } from 'bun:test'
import { renderMermaidSVGWithReceipt, layoutMermaidWithReceipt } from '../../src/agent/index.ts'
import { architectureSvgMetrics } from './architecture-metrics.ts'

test('the SVG audit rejects a clipped contact even when its shaft and unclipped tip reach the card', () => {
  const source = 'architecture-beta\nservice a(server)[A]\nservice b(database)[B]\na:R-->L:b'
  const options = { embedFontImport: false, architecture: { visual: { edgeLineWidth: 3 } } }
  const { svg, receipt } = renderMermaidSVGWithReceipt(source, options)
  const layout = layoutMermaidWithReceipt(source, { ...options, debug: true }).layout
  const certification = receipt.layoutCertification
  if (!certification || certification.scope !== 'native-scene') throw new Error('Missing native paint certificate')
  const measure = (value: string) => architectureSvgMetrics(value, layout, certification)
  const clipped = svg.replace('id="architecture-arrow-end" markerWidth="8"', 'id="architecture-arrow-end" markerWidth="7"')
  const before = measure(svg), after = measure(clipped)
  expect(clipped).not.toBe(svg)
  expect(before.metrics.offOutlineMarkers).toBe(0)
  expect(after.metrics.offOutlineEndpoints).toBe(0)
  expect(after.metrics.offOutlineMarkers).toBe(1)
  expect(after.findings.some(finding => finding.includes('contact clipped'))).toBe(true)

  // An equal total marker count must not conceal reversed relationship meaning.
  const reversed = svg.replace('marker-end="url(#architecture-arrow-end)"', 'marker-start="url(#architecture-arrow-start)"')
  expect(reversed).not.toBe(svg)
  expect(measure(reversed).metrics.markerChecks).toBe(before.metrics.markerChecks)
  expect(measure(reversed).markerEndpoints).not.toEqual(before.markerEndpoints)

  const malformed = svg.replace('points="160,64 216,64"', 'points="160,64 NaN,NaN 216,64"')
  expect(malformed).not.toBe(svg)
  expect(() => measure(malformed)).toThrow('Invalid SVG numeric list')
})
