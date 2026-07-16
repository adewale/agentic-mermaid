/**
 * Sequence `autonumber` — family-elevation-plan §Sequence item 4 (feature
 * stage). Upstream semantics (https://mermaid.js.org/syntax/sequenceDiagram.html):
 * `autonumber` attaches a sequence number to each message arrow; it accepts an
 * optional start value and increment (`autonumber 10 2`) and `autonumber off`
 * stops numbering. This renderer prefixes the number to the message label
 * ("1. label").
 */
import { describe, it, expect } from 'bun:test'
import { parseSequenceDiagram } from '../sequence/parser.ts'
import { layoutSequenceDiagram } from '../sequence/layout.ts'
import { renderMermaidSVG, renderMermaidASCII } from '../index.ts'

function parse(text: string) {
  const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0 && !l.startsWith('%%'))
  return parseSequenceDiagram(lines)
}

describe('parseSequenceDiagram – autonumber', () => {
  it('numbers messages sequentially from 1', () => {
    const d = parse(`sequenceDiagram
      autonumber
      A->>B: one
      B-->>A: two
      A->>B: three`)
    expect(d.messages.map(m => m.number)).toEqual([1, 2, 3])
  })

  it('leaves messages unnumbered without autonumber', () => {
    const d = parse(`sequenceDiagram
      A->>B: one`)
    expect(d.messages[0]!.number).toBeUndefined()
  })

  it('autonumber off stops numbering', () => {
    const d = parse(`sequenceDiagram
      autonumber
      A->>B: one
      autonumber off
      A->>B: two`)
    expect(d.messages[0]!.number).toBe(1)
    expect(d.messages[1]!.number).toBeUndefined()
  })

  it('restarts from an explicit start value', () => {
    const d = parse(`sequenceDiagram
      autonumber 10
      A->>B: one
      B->>A: two`)
    expect(d.messages.map(m => m.number)).toEqual([10, 11])
  })

  it('honors start + increment', () => {
    const d = parse(`sequenceDiagram
      autonumber 10 2
      A->>B: one
      B->>A: two
      A->>B: three`)
    expect(d.messages.map(m => m.number)).toEqual([10, 12, 14])
  })

  it('numbering resumes with a fresh autonumber after off', () => {
    const d = parse(`sequenceDiagram
      autonumber
      A->>B: one
      autonumber off
      A->>B: dark
      autonumber 5
      A->>B: five`)
    expect(d.messages.map(m => m.number)).toEqual([1, undefined, 5])
  })
})

describe('autonumber rendering', () => {
  const SRC = `sequenceDiagram
    autonumber
    Alice->>Bob: Hello
    Bob-->>Alice: Hi`

  it('prefixes numbers to positioned message labels', () => {
    const p = layoutSequenceDiagram(parse(SRC))
    expect(p.messages.map(m => m.label)).toEqual(['1. Hello', '2. Hi'])
  })

  it('SVG contains the numbered labels', () => {
    const svg = renderMermaidSVG(SRC)
    expect(svg).toContain('1. Hello')
    expect(svg).toContain('2. Hi')
  })

  it('unicode/ASCII output carries the same numbers (one label truth)', () => {
    const text = renderMermaidASCII(SRC, { useAscii: false })
    expect(text).toContain('1. Hello')
    expect(text).toContain('2. Hi')
  })
})
