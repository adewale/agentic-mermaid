// Edge serialization regression tests — every style × marker combination
// the parser supports must survive round-trip.

import { describe, test, expect } from 'bun:test'
import { parseMermaid } from '../agent/parse.ts'
import { serializeMermaid } from '../agent/serialize.ts'

const CASES = [
  // [name, source, expected-line-after-format (or null to check stability only)]
  ['solid arrow end',       'flowchart TD\n  A --> B',  'A --> B'],
  ['solid no arrow',        'flowchart TD\n  A --- B',  'A --- B'],
  ['solid circle end',      'flowchart TD\n  A --o B',  'A --o B'],
  ['solid cross end',       'flowchart TD\n  A --x B',  'A --x B'],
  ['solid both arrows',     'flowchart TD\n  A <--> B', 'A <--> B'],
  ['dotted arrow end',      'flowchart TD\n  A -.-> B', 'A -.-> B'],
  ['dotted no arrow',       'flowchart TD\n  A -.- B',  'A -.- B'],
  ['thick arrow end',       'flowchart TD\n  A ==> B',  'A ==> B'],
  ['thick no arrow',        'flowchart TD\n  A === B',  'A === B'],
] as const

describe('edge serialization round-trip', () => {
  for (const [name, src, expected] of CASES) {
    test(name, () => {
      const r = parseMermaid(src)
      expect(r.ok).toBe(true)
      if (!r.ok) return
      const out = serializeMermaid(r.value)
      // The body line should equal the expected canonical form.
      const bodyLine = out.split('\n').find(l => l.includes('A') && (l.includes('B') || l.includes('-')))
      expect(bodyLine?.trim()).toBe(expected)
      // And it should be stable (serializing again yields the same output).
      const r2 = parseMermaid(out)
      expect(r2.ok).toBe(true)
      if (!r2.ok) return
      expect(serializeMermaid(r2.value)).toBe(out)
    })
  }
})

describe('shape serialization round-trip', () => {
  const SHAPES = [
    ['rectangle',     'A[Alpha]'],
    ['rounded',       'A(Alpha)'],
    ['stadium',       'A([Alpha])'],
    ['subroutine',    'A[[Alpha]]'],
    ['cylinder',      'A[(Alpha)]'],
    ['circle',        'A((Alpha))'],
    ['double circle', 'A(((Alpha)))'],
    ['diamond',       'A{Alpha}'],
    ['hexagon',       'A{{Alpha}}'],
  ] as const
  for (const [name, ref] of SHAPES) {
    test(name, () => {
      const src = `flowchart TD\n  ${ref} --> B`
      const r = parseMermaid(src)
      expect(r.ok).toBe(true)
      if (!r.ok) return
      const out = serializeMermaid(r.value)
      expect(out).toContain(ref)
      // Stability check.
      const r2 = parseMermaid(out)
      if (!r2.ok) throw new Error('reparse')
      expect(serializeMermaid(r2.value)).toBe(out)
    })
  }
})

describe('label preservation', () => {
  test('multi-word labels survive round-trip', () => {
    const src = 'flowchart TD\n  A[Hello World] --> B[Goodbye World]'
    const r = parseMermaid(src)
    if (!r.ok) throw new Error('parse')
    const out = serializeMermaid(r.value)
    expect(out).toContain('Hello World')
    expect(out).toContain('Goodbye World')
  })

  test('edge labels survive round-trip', () => {
    const src = 'flowchart TD\n  A -->|yes path| B'
    const r = parseMermaid(src)
    if (!r.ok) throw new Error('parse')
    const out = serializeMermaid(r.value)
    expect(out).toContain('|yes path|')
  })
})
