import { describe, expect, test } from 'bun:test'
import {
  assertRenderableLinearGradient,
  serializeLinearGradientResource,
  serializeLinearGradientResources,
} from '../scene/gradient-resources.ts'
import type { LinearGradientDescriptor } from '../scene/ir.ts'

const gradient = (overrides: Partial<LinearGradientDescriptor> = {}): LinearGradientDescriptor => ({
  id: 'flow-1',
  units: 'userSpaceOnUse',
  x1: 0,
  y1: 10,
  x2: 100,
  y2: 20,
  stops: [
    { offset: 0, color: '#112233' },
    { offset: 0.5, color: 'rgb(68 85 102)', opacity: 0.75 },
    { offset: 1, color: 'var(--accent)' },
  ],
  ...overrides,
})

describe('typed Scene linear-gradient resources', () => {
  test('serialize deterministically from validated typed data', () => {
    expect(serializeLinearGradientResource(gradient())).toBe(
      '  <linearGradient id="flow-1" gradientUnits="userSpaceOnUse" x1="0" y1="10" x2="100" y2="20">\n' +
      '    <stop offset="0%" stop-color="#112233" />\n' +
      '    <stop offset="50%" stop-color="rgb(68 85 102)" stop-opacity="0.75" />\n' +
      '    <stop offset="100%" stop-color="var(--accent)" />\n' +
      '  </linearGradient>',
    )
  })

  test('rejects unsafe IDs, fetching paints, unordered stops, and invalid numbers', () => {
    expect(() => assertRenderableLinearGradient(gradient({ id: 'bad id' }))).toThrow(/safe SVG id grammar/)
    expect(() => assertRenderableLinearGradient(gradient({ id: `g${'x'.repeat(256)}` }))).toThrow(/at most 256/)
    expect(() => assertRenderableLinearGradient(gradient({ x2: Number.NaN }))).toThrow(/x2 must be finite/)
    expect(() => assertRenderableLinearGradient(gradient({ x2: 1_000_001 }))).toThrow(/must not exceed/)
    expect(() => assertRenderableLinearGradient(gradient({ stops: [{ offset: 0, color: '#000' }] }))).toThrow(/at least two stops/)
    expect(() => assertRenderableLinearGradient(gradient({ stops: Array.from({ length: 257 }, (_, index) => ({ offset: index / 256, color: '#000' })) }))).toThrow(/at most 256 stops/)
    expect(() => assertRenderableLinearGradient(gradient({ stops: [{ offset: 0.8, color: '#000' }, { offset: 0.2, color: '#fff' }] }))).toThrow(/non-decreasing/)
    expect(() => assertRenderableLinearGradient(gradient({ stops: [{ offset: 0, color: 'url(https://example.test/a.svg)' }, { offset: 1, color: '#fff' }] }))).toThrow(/safe non-fetching/)
    expect(() => assertRenderableLinearGradient(gradient({ stops: [{ offset: 0, color: '#000', opacity: 2 }, { offset: 1, color: '#fff' }] }))).toThrow(/opacity must be in/)
  })

  test('rejects duplicate resource IDs before emitting ambiguous SVG', () => {
    expect(() => serializeLinearGradientResources([gradient(), gradient()])).toThrow(/Duplicate linear gradient resource/)
  })

  test('bounds aggregate resource and stop work before serialization', () => {
    const gradients = Array.from({ length: 10_001 }, (_, index) => gradient({ id: `g-${index}` }))
    expect(() => serializeLinearGradientResources(gradients)).toThrow(/at most 10000 linear gradients/)
  })
})
