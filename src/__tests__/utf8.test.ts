import { expect, test } from 'bun:test'
import fc from 'fast-check'
import { boundedUtf8ByteLength } from '../shared/utf8.ts'
import { fcParameters } from './helpers/fc-parameters.ts'

test('bounded serialization byte counts agree with UTF-8 encoding at the ceiling', () => {
  const encoder = new TextEncoder()
  // Include malformed UTF-16, whose replacement encoding still costs bytes.
  const text = fc.array(fc.integer({ min: 0, max: 0xffff }), { maxLength: 128 })
    .map(units => String.fromCharCode(...units))
  fc.assert(fc.property(text, fc.integer({ min: 0, max: 512 }), (value, limit) => {
    const bytes = encoder.encode(value).byteLength
    expect(boundedUtf8ByteLength(value, limit)).toBe(bytes > limit ? limit + 1 : bytes)
  }), fcParameters({ numRuns: 300, examples: [
    ['', 0], ['ASCII', 4], ['ASCII', 5], ['\u0000', 0],
    ['é', 1], ['東京', 5], ['\u{10000}', 3], ['\u{10000}', 4],
    ['\ud800', 2], ['\udfff', 3],
  ] }))
})
