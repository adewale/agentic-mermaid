import { describe, expect, test } from 'bun:test'
import { BUILTIN_FAMILY_METADATA } from '../agent/families.ts'
import {
  renderWebsiteASCII,
  renderWebsiteASCIIWithReceipt,
  renderWebsiteRepresentationFixture,
  renderWebsiteSVG,
  renderWebsiteSVGWithReceipt,
} from '../../website/src/rendering.ts'
import { SECTION_A_TRANSPORT_FIXTURE } from './helpers/section-a-transport-fixture.ts'

describe('website receipt-bearing render boundary', () => {
  test('string projections are derived from receipt-bearing artifacts', () => {
    const { source, options } = SECTION_A_TRANSPORT_FIXTURE
    expect(renderWebsiteSVG(source, options)).toBe(renderWebsiteSVGWithReceipt(source, options).svg)
    expect(renderWebsiteASCII(source, { ...options, useAscii: true, colorMode: 'none' }))
      .toBe(renderWebsiteASCIIWithReceipt(source, { ...options, useAscii: true, colorMode: 'none' }).text)
  })

  test('every registered built-in family shares request and appearance identity across website SVG and text fixtures', () => {
    for (const family of BUILTIN_FAMILY_METADATA) {
      const fixture = renderWebsiteRepresentationFixture(family.example, {
        style: ['publication-figure', 'github-light'],
        padding: 19,
        security: 'strict',
        embedFontImport: false,
      })
      const receipts = [fixture.svg.receipt, fixture.unicode.receipt, fixture.ascii.receipt]
      expect(new Set(receipts.map(receipt => receipt.sharedRequestDigest)), family.id).toHaveLength(1)
      expect(new Set(receipts.map(receipt => receipt.appearanceDigest)), family.id).toHaveLength(1)
      expect(new Set(receipts.map(receipt => receipt.requestDigest)).size, family.id).toBe(3)
      expect(receipts.map(receipt => receipt.output), family.id).toEqual(['svg', 'unicode', 'ascii'])
      expect(fixture.svg.svg, family.id).toContain('<svg')
      expect(fixture.unicode.text.trim().length, family.id).toBeGreaterThan(0)
      expect(fixture.ascii.text.trim().length, family.id).toBeGreaterThan(0)
    }
  })
})
