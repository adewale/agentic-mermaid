// The shared Mermaid entity codec (src/shared/mermaid-entities.ts and its
// display half, src/shared/mermaid-entity-display.ts).
//
// Decoding follows the HTML character-reference rules upstream relies on (its
// final SVG goes through the browser's parser; e2e/browser.test.ts checks Pie
// against pinned 11.16 in a real browser). Encoding is checked by round trip
// and by pinned upstream itself: upstream's DB, read through the entity
// layer, must hold the text we encoded.

import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { decodeHTML } from 'entities'
import fc from 'fast-check'
import { encodeMermaidEntities, fromEntityMarkers, mermaidEntityPrepass, toEntityMarkers } from '../shared/mermaid-entities.ts'
import { decodeMermaidEntities, projectEntityMarkers } from '../shared/mermaid-entity-display.ts'
import { startUpstreamMermaid, type UpstreamMermaid } from './helpers/upstream-mermaid.ts'

describe('decodeMermaidEntities', () => {
  test('resolves codes as the HTML parser resolves upstream\'s &name; / &#123; output', () => {
    const cases: Array<[string, string]> = [
      ['I #9829; you', 'I ♥ you'],
      ['#35;', '#'],
      ['a #quot;b#quot;', 'a "b"'],
      ['#lt;b#gt;', '<b>'],
      ['#amp;amp;', '&amp;'],
      ['#notit;', '¬it;'],
      ['#unknown;', '&unknown;'],
      ['#x41;', '&x41;'],
      ['#0;', '\ufffd'],
      ['#55296;', '\ufffd'],
      ['#1114112;', '\ufffd'],
      ['#128;', '€'],
      ['#0065;', 'A'],
      ['#; # ;', '#; # ;'],
      ['a#b', 'a#b'],
    ]
    expect(cases.map(([source]) => [source, decodeMermaidEntities(source)])).toEqual(cases)
  })

  test('refuses an entity that projects a terminal control, naming the subject', () => {
    for (const source of ['#9;', '#10;', '#127;', '#129;', '#Tab;', '#NewLine;']) {
      expect(() => decodeMermaidEntities(source, { subject: 'Flowchart label entity', example: 'A["#35;"]' }))
        .toThrow('Flowchart label entity projects a terminal control character')
    }
    // Raw controls are the caller's concern: only entity-produced ones are refused.
    expect(decodeMermaidEntities('a\tb\nc')).toBe('a\tb\nc')
  })

  test('the marker form is upstream\'s DB key: #35; and a literal marker are one key', () => {
    expect(toEntityMarkers('#35;')).toBe(toEntityMarkers('ﬂ°°35¶ß'))
    expect(projectEntityMarkers(toEntityMarkers('a #quot; b'))).toBe('a " b')
    // fromEntityMarkers spells markers back as the codes they came from.
    expect(fromEntityMarkers(toEntityMarkers('a #quot; #35; #x_1; b'))).toBe('a #quot; #35; #x_1; b')
  })

  test('the prepass strips the last semicolon of a qualifying style/classDef line only', () => {
    expect(mermaidEntityPrepass('style A fill:#f00;')).toBe('style A fill:#f00')
    expect(mermaidEntityPrepass('classDef c color:#fff;stroke:#000;')).toBe('classDef c color:#fff;stroke:#000')
    expect(mermaidEntityPrepass('A["style x: #a;"]')).toBe('A["style x: #a;"]')
    expect(mermaidEntityPrepass('A --> B;')).toBe('A --> B;')
  })
})

// Characters every grammar context treats specially, the sentinel pieces, and
// entity-shaped text (valid, unknown, legacy, numeric, refused-if-decoded).
const ALPHABET = [
  ...'#;"\\n<>& a1_'.split(''), 'ﬂ', '°', '¶', 'ß', '\t',
  '#35;', '#quot;', '#9829;', '#amp;', '#lt;', '#x41;', '#notit;', '#0;', '#10;', '#128;', 'ﬂ°amp¶ß', 'ﬂ°°35¶ß',
]
const textArb = fc.array(fc.constantFrom(...ALPHABET), { maxLength: 14 }).map(parts => parts.join(''))
const reservedArb = fc.subarray([...'"#;<>&\\n '])
  .map(chars => chars.join(''))

describe('encodeMermaidEntities', () => {
  test('decode(encode(x)) === x for every text and reserved set', () => {
    fc.assert(fc.property(textArb, reservedArb, (text, reserved) => {
      expect({ text, reserved, decoded: decodeMermaidEntities(encodeMermaidEntities(text, reserved)) })
        .toEqual({ text, reserved, decoded: text })
    }), { numRuns: 500 })
  })

  test('the encoding is canonical: it re-encodes to itself and leaves plain text alone', () => {
    fc.assert(fc.property(textArb, reservedArb, (text, reserved) => {
      const encoded = encodeMermaidEntities(text, reserved)
      expect({ text, reserved, again: encodeMermaidEntities(decodeMermaidEntities(encoded), reserved) })
        .toEqual({ text, reserved, again: encoded })
      const needsEscape = [...reserved].some(char => text.includes(char)) || /#\w+;|ﬂ°|¶ß/.test(text)
      if (!needsEscape) expect({ text, reserved, encoded }).toEqual({ text, reserved, encoded: text })
    }), { numRuns: 500 })
  })

  test('no reserved character or marker piece survives literally, and the spellings are upstream\'s', () => {
    fc.assert(fc.property(textArb, reservedArb, (text, reserved) => {
      const encoded = encodeMermaidEntities(text, reserved)
      // Entity spellings are opaque to the grammar (the prepass turns them
      // into markers first), so check what the grammar sees. Upstream's
      // decodeEntities replaces even a lone `ﬂ°` or `¶ß`, so neither may be
      // spelled literally.
      const grammarView = toEntityMarkers(encoded)
      expect({ encoded, reserved, literal: [...reserved].filter(char => grammarView.includes(char)), markerPieces: /ﬂ°|¶ß/.test(encoded) })
        .toEqual({ encoded, reserved, literal: [], markerPieces: false })
    }), { numRuns: 300 })
    expect(encodeMermaidEntities('say "hi" #1; & <b>', '"&<>')).toBe('say #quot;hi#quot; #35;1; #amp; #lt;b#gt;')
    expect(encodeMermaidEntities('a;b#c', ';#')).toBe('a#59;b#35;c')
    expect(encodeMermaidEntities('#quot; and #', '')).toBe('#35;quot; and #')
    expect(encodeMermaidEntities('ﬂ°amp¶ß', '')).toBe('#64258;°amp#182;ß')
  })

  test('refuses to reserve a character no entity can display', () => {
    expect(() => encodeMermaidEntities('a\nb', '\n')).toThrow(RangeError)
    expect(() => encodeMermaidEntities('a', '\u0085')).toThrow(RangeError)
  })
})

/** What upstream displays for DB text: its `decodeEntities` (utils.ts),
 * which replaces marker pieces one by one, then the browser's character
 * references. SVG text (sequence) is serialized by d3, which escapes a raw
 * `&` first; an HTML label (flowchart) is parsed as HTML, so a caller writing
 * one reserves `&`, `<` and `>` as well as the grammar's `"`. */
function upstreamDisplayed(db: string, context: 'html' | 'svg-text'): string {
  const serialized = context === 'svg-text' ? db.replaceAll('&', '&amp;') : db
  return decodeHTML(serialized.replace(/ﬂ°°/g, '&#').replace(/ﬂ°/g, '&').replace(/¶ß/g, ';'))
}

// Pinned upstream reads what we write. Both contexts trim their text and
// reject an empty one.
describe('pinned upstream Mermaid displays encodeMermaidEntities output as the text', () => {
  let upstream: UpstreamMermaid
  beforeAll(() => {
    upstream = startUpstreamMermaid()
  })
  afterAll(() => upstream.close())

  // A raw tab is whitespace the grammars trim or split on.
  const labelArb = textArb.map(text => text.replaceAll('\t', ' ').trim()).filter(text => text.length > 0)

  test('a quoted flowchart label reserves `"`, and `&<>` for its HTML display', async () => {
    let checked = 0
    await fc.assert(fc.asyncProperty(labelArb, async text => {
      const source = `flowchart TD\n  A["${encodeMermaidEntities(text, '"&<>')}"]`
      const parsed = await upstream.parse(source)
      const label = parsed.ok ? parsed.flowchart?.vertices[0]?.text : parsed.error
      expect({ source, displayed: label === undefined ? label : upstreamDisplayed(label, 'html') })
        .toEqual({ source, displayed: text })
      checked++
    }), { numRuns: 150 })
    expect(checked).toBeGreaterThan(0)
  }, 30_000)

  test('a sequence message reserves `#` and `;`', async () => {
    let checked = 0
    await fc.assert(fc.asyncProperty(labelArb, async text => {
      const source = `sequenceDiagram\n  A->>B: ${encodeMermaidEntities(text, '#;')}`
      const parsed = await upstream.parse(source)
      const message = parsed.ok ? parsed.sequence?.messages[0]?.message : parsed.error
      expect({ source, displayed: message === undefined ? message : upstreamDisplayed(message, 'svg-text') })
        .toEqual({ source, displayed: text })
      checked++
    }), { numRuns: 150 })
    expect(checked).toBeGreaterThan(0)
  }, 30_000)
})
