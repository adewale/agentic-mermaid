import { describe, expect, test } from 'bun:test'
import { lazySizes, payloadDelta, payloadDeltaMarkdown, websiteSizes } from '../../scripts/ci/payload-delta.ts'

const size = (gzip: number, requests = 3) => ({ requests, raw: gzip * 3, gzip })

describe('per-PR payload delta', () => {
  test('small absolute or relative growth passes; growth beyond both limits fails', () => {
    const rows = payloadDelta(
      { tiny: size(10_000), large: size(1_000_000), bloated: size(100_000) },
      { tiny: size(11_000), large: size(1_015_000), bloated: size(103_000) },
    )
    expect(rows.map(row => [row.name, row.gzipDelta, row.exceeds])).toEqual([
      ['bloated', 3_000, true],
      ['large', 15_000, false],
      ['tiny', 1_000, false],
    ])
  })

  test('shrinking passes and a payload new in the head is reported and judged by bytes', () => {
    const rows = payloadDelta({ shrunk: size(50_000) }, { shrunk: size(40_000), added: size(2_000) })
    expect(rows.find(row => row.name === 'shrunk')).toMatchObject({ gzipDelta: -10_000, exceeds: false })
    expect(rows.find(row => row.name === 'added')).toMatchObject({ gzipDelta: 2_000, exceeds: true })
    expect(payloadDeltaMarkdown(rows)).toContain('| added | — → 3 | — | 2,000 | +2,000 | new | ❌ |')
  })

  test('reads the lazy build report and the website route report', () => {
    expect(lazySizes({ initial: size(40_000, 5), families: { pie: size(190_000, 26) } })).toEqual({
      'lazy:initial': size(40_000, 5),
      'lazy:pie': size(190_000, 26),
    })
    expect(websiteSizes({ routes: [{ id: 'home', totals: { requests: 9, rawBytes: 682_870, gzipBytes: 406_581 } }] }))
      .toEqual({ 'route:home': { requests: 9, raw: 682_870, gzip: 406_581 } })
  })
})
