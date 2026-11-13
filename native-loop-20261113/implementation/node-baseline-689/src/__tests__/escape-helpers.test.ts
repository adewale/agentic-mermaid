/**
 * Property tests for the shared XML escape helpers — the single escape set
 * every renderer now uses (element text and attribute values alike).
 * Verifies both directions: markup-significant characters are neutralized,
 * and safe content passes through unchanged.
 */
import { describe, test, expect } from 'bun:test'
import fc from 'fast-check'
import { fcParameters } from './helpers/fc-parameters.ts'
import { decodeXML } from 'entities'
import { Resvg } from '@resvg/resvg-js'
import { escapeXml, escapeAttr } from '../multiline-utils.ts'

// fc.string() defaults to printable ASCII. Draw every UTF-16 code unit here:
// these string helpers also accept controls, lone surrogates, and astral text.
const textArb = fc.string({ unit: fc.integer({ min: 0, max: 0xffff }).map(code => String.fromCharCode(code)) })
const parameters = fcParameters({ numRuns: 5000, examples: [[''], ['\t\n\r'], ['😀é<&\"\''], ['\ud800\u0000\uffff']] })

describe('escapeXml / escapeAttr', () => {
  test('attribute escaping preserves authored whitespace through XML decoding', () => {
    fc.assert(fc.property(textArb, text => {
      expect(decodeXML(escapeAttr(text))).toBe(text)
      expect(escapeAttr(text)).not.toMatch(/[\t\n\r]/)
    }), parameters)
  })

  test('output never contains raw markup-significant characters', () => {
    fc.assert(fc.property(textArb, s => {
      const out = escapeXml(s)
      // Raw & is only legal as the start of one of our own entities.
      const deEntitized = out.replace(/&(?:amp|lt|gt|quot|#39);/g, '')
      return !/[<>"']/.test(deEntitized) && !deEntitized.includes('&')
    }), parameters)
  })

  test('text without special characters is preserved verbatim', () => {
    fc.assert(fc.property(
      textArb.map(s => s.replace(/[&<>"']/g, '')),
      s => escapeXml(s) === s,
    ), { ...parameters, examples: [[''], ['\t\n\r'], ['😀é']] })
  })

  // Injective: an independent XML decoder recovers every input, so no two
  // inputs share an output and nothing (such as a deleted character) is lost.
  test('escaping is injective: decoding the output recovers the input', () => {
    fc.assert(fc.property(textArb, s => decodeXML(escapeXml(s)) === s), parameters)
  })

  test('escaping preserves a large XML-significant label exactly', () => {
    const text = '&<>"\'😀é'.repeat(32768)
    expect(decodeXML(escapeXml(text))).toBe(text)
    expect(decodeXML(escapeAttr(text))).toBe(text)
    // Parse metadata rather than laying out hundreds of thousands of glyphs.
    expect(() => new Resvg(`<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1" data-label="${escapeAttr(text)}"><title>${escapeXml(text)}</title></svg>`, { font: { loadSystemFonts: false } })).not.toThrow()
  })

  test('each special character maps to its entity, and escaping is not idempotent', () => {
    expect(escapeXml(`&<>"'`)).toBe('&amp;&lt;&gt;&quot;&#39;')
    // Double-escaping must not happen at the helper level twice in a row for
    // already-escaped input to stay analyzable: escaping is deliberately not
    // idempotent (the & of an entity is re-escaped) — pin that so callers
    // never assume otherwise.
    expect(escapeXml('&amp;')).toBe('&amp;amp;')
  })
})
