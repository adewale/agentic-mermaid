/**
 * Property tests for the shared XML escape helpers — the single escape set
 * every renderer now uses (element text and attribute values alike).
 * Verifies both directions: markup-significant characters are neutralized,
 * and safe content passes through unchanged.
 */
import { describe, test, expect } from 'bun:test'
import fc from 'fast-check'
import { escapeXml, escapeAttr } from '../multiline-utils.ts'

describe('escapeXml / escapeAttr', () => {
  test('escapeAttr and escapeXml are the same escape set', () => {
    fc.assert(fc.property(fc.string(), s => escapeAttr(s) === escapeXml(s)))
  })

  test('output never contains raw markup-significant characters', () => {
    fc.assert(fc.property(fc.string(), s => {
      const out = escapeXml(s)
      // Raw & is only legal as the start of one of our own entities.
      const deEntitized = out.replace(/&(?:amp|lt|gt|quot|#39);/g, '')
      return !/[<>"']/.test(deEntitized) && !deEntitized.includes('&')
    }))
  })

  test('text without special characters is preserved verbatim', () => {
    fc.assert(fc.property(
      fc.string().filter(s => !/[&<>"']/.test(s)),
      s => escapeXml(s) === s,
    ))
  })

  test('escaping is injective on the special characters', () => {
    expect(escapeXml(`&<>"'`)).toBe('&amp;&lt;&gt;&quot;&#39;')
    // Double-escaping must not happen at the helper level twice in a row for
    // already-escaped input to stay analyzable: escaping is deliberately not
    // idempotent (the & of an entity is re-escaped) — pin that so callers
    // never assume otherwise.
    expect(escapeXml('&amp;')).toBe('&amp;amp;')
  })
})
