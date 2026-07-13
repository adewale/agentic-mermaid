import { describe, expect, test } from 'bun:test'
import { BUILTIN_FAMILY_METADATA } from '../agent/families.ts'
import {
  renderWebsiteASCII,
  renderWebsiteASCIIWithReceipt,
  renderWebsiteRepresentationFixture,
  renderWebsiteSVG,
  renderWebsiteSVGWithReceipt,
} from '../../website/src/rendering.ts'

const REPRESENTATIVE_FAMILIES = [
  'flowchart',
  'sequence',
  'architecture',
  'pie',
  'gantt',
  'mindmap',
] as const

describe('website receipt-bearing render boundary', () => {
  test('string projections are derived from receipt-bearing artifacts', () => {
    const source = 'flowchart LR\n  A[Start] --> B[Finish]'
    const options = { security: 'strict' as const, embedFontImport: false }
    expect(renderWebsiteSVG(source, options)).toBe(renderWebsiteSVGWithReceipt(source, options).svg)
    expect(renderWebsiteASCII(source, { ...options, useAscii: true, colorMode: 'none' }))
      .toBe(renderWebsiteASCIIWithReceipt(source, { ...options, useAscii: true, colorMode: 'none' }).text)
  })

  test('representative families share request and appearance identity across website SVG and text fixtures', () => {
    const selected = BUILTIN_FAMILY_METADATA.filter(family =>
      (REPRESENTATIVE_FAMILIES as readonly string[]).includes(family.id))
    expect(selected.map(family => family.id)).toEqual([...REPRESENTATIVE_FAMILIES])

    for (const family of selected) {
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
