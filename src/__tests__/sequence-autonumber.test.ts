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
import { parseRegisteredMermaid, serializeMermaid, verifyMermaid, asSequence, mutate, renderMermaidPNG } from '../agent/index.ts'
import { AsciiWidthError } from '../ascii/width-error.ts'

function parse(text: string) {
  const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0 && !l.startsWith('%%'))
  return parseSequenceDiagram(lines)
}

describe('parseSequenceDiagram – autonumber', () => {

  it('config initializes visibility while ordered controls survive fragments, edits and PNG rendering', () => {
    const source = '%%{init: {"sequence":{"showSequenceNumbers":true}}}%%\nsequenceDiagram\nA->>B: one\nloop work\nautonumber off\nB->>A: hidden\nend\nautonumber 10 2\nA->>B: three\nautonumber\nB->>A: four'
    const parsed = parseRegisteredMermaid(source)
    if (!parsed.ok) throw new Error(JSON.stringify(parsed.error))
    const sequence = asSequence(parsed.value)!
    expect(sequence.body.messages.map(message => message.text)).toEqual(['one', 'three', 'four'])
    expect(renderMermaidPNG(sequence)).toEqual(renderMermaidPNG(source))
    const edited = mutate(sequence, { kind: 'set_message_text', index: 1, text: 'edited' })
    if (!edited.ok) throw new Error(edited.error.message)
    const serialized = serializeMermaid(edited.value)
    expect(serialized).toContain('autonumber off')
    expect(serialized).toContain('autonumber 10 2')
    for (const output of [renderMermaidSVG(edited.value), renderMermaidASCII(edited.value, { colorMode: 'none' }), renderMermaidASCII(serialized, { colorMode: 'none', useAscii: true })]) {
      for (const label of ['1. one', 'hidden', '10. edited', '12. four']) expect(output).toContain(label)
      expect(output).not.toContain('2. hidden')
    }
    expect(renderMermaidPNG(edited.value)).toEqual(renderMermaidPNG(serialized))
  })

  it('keeps a long numeric reference or refuses the complete terminal geometry', () => {
    const source = 'sequenceDiagram\nautonumber 123456789\nA->>B: work'
    expect(renderMermaidASCII(source, { colorMode: 'none', targetWidth: 50 })).toContain('123456789. work')
    expect(() => renderMermaidASCII(source, { colorMode: 'none', targetWidth: 3 })).toThrow(AsciiWidthError)
  })

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

  it.each([
    ['10.1 .01', [10.1, 10.11, 10.12]],
    ['10.01 .01', [10.01, 10.02, 10.03]],
    ['10.1 .1', [10.1, 10.2, 10.3]],
    ['.1 .01', [0.1, 0.11, 0.12]],
  ] as const)('keeps authored decimal numbering %s instead of resetting to default', (numbering, expected) => {
    const source = `sequenceDiagram\n  autonumber ${numbering}\n  A->>B: one\n  B->>A: two\n  A->>B: three`
    expect(parse(source).messages.map(message => message.number)).toEqual([...expected])
    const parsed = parseRegisteredMermaid(source)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) throw new Error(JSON.stringify(parsed.error))
    expect(parse(serializeMermaid(parsed.value)).messages.map(message => message.number)).toEqual([...expected])
    const svg = renderMermaidSVG(source)
    for (const [index, label] of ['one', 'two', 'three'].entries()) expect(svg).toContain(`${expected[index]}. ${label}`)
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

  it.each([
    ['repeat enable', ['autonumber', 'autonumber', ''], [1, 2, 3]],
    ['retain step', ['autonumber 10 2', 'autonumber', ''], [10, 12, 14]],
    ['resume after hidden message', ['autonumber 10 2', 'autonumber off', 'autonumber'], [10, undefined, 14]],
    ['late enable', ['', 'autonumber', ''], [undefined, 2, 3]],
    ['start only resets increment', ['autonumber 10 2', 'autonumber 20', ''], [10, 20, 21]],
    ['zero start', ['autonumber 0', '', ''], [0, 1, 2]],
    ['zero increment survives resume', ['autonumber 7 0', 'autonumber off', 'autonumber'], [7, undefined, 7]],
    ['zero increment on repeated enable', ['autonumber 7 0', 'autonumber', ''], [7, 7, 7]],
    ['fractional resume', ['autonumber .1 .01', 'autonumber off', 'autonumber'], [0.1, undefined, 0.12]],
  ] as const)('preserves control intent: %s', (_name, controls, expected) => {
    const source = `sequenceDiagram\n${controls[0]}\nA->>B: first\n${controls[1]}\nB->>A: second\n${controls[2]}\nA->>B: third`
    expect(parse(source).messages.map(message => message.number)).toEqual([...expected])
    const parsed = parseRegisteredMermaid(source)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) throw new Error(JSON.stringify(parsed.error))
    const serialized = serializeMermaid(parsed.value)
    expect(parse(serialized).messages.map(message => message.number)).toEqual([...expected])
    for (const renderedSource of [source, serialized, parsed.value]) {
      const svg = renderMermaidSVG(renderedSource)
      for (const useAscii of [true, false]) {
        const terminal = renderMermaidASCII(renderedSource, { useAscii })
        for (const [index, label] of ['first', 'second', 'third'].entries()) {
          const display = expected[index] === undefined ? label : `${expected[index]}. ${label}`
          expect(svg).toContain(display)
          expect(terminal).toContain(display)
        }
      }
    }
  })

  it('gives authored controls precedence over initial config across fragments', () => {
    const body = `sequenceDiagram
A->>B: first
autonumber off
loop hidden
B->>A: hidden
end
autonumber
A->>B: third`
    expect(parseSequenceDiagram(body.split('\n'), { showSequenceNumbers: true }).messages.map(message => message.number)).toEqual([1, undefined, 3])
    const source = `%%{init: {"sequence": {"showSequenceNumbers": true}}}%%\n${body}`
    for (const output of [renderMermaidSVG(source), renderMermaidASCII(source)]) {
      expect(output).toContain('1. first')
      expect(output).toContain('3. third')
      expect(output).not.toContain('2. hidden')
    }
  })

  it('keeps authored text separate from display numbers after an edit and serialization', () => {
    const parsed = parseRegisteredMermaid(`sequenceDiagram
autonumber 10 2
A->>B: first
autonumber off
B->>A: hidden
autonumber
A->>B: resumed`)
    if (!parsed.ok) throw new Error(JSON.stringify(parsed.error))
    const sequence = asSequence(parsed.value)
    if (!sequence) throw new Error('Expected structured sequence')
    expect(sequence.body.messages.map(message => message.text)).toEqual(['first', 'hidden', 'resumed'])
    const edited = mutate(sequence, { kind: 'set_participant_label', id: 'A', label: 'Alice' })
    if (!edited.ok) throw new Error(JSON.stringify(edited.error))
    const serialized = serializeMermaid(edited.value)
    expect(parse(serialized).messages.map(message => message.number)).toEqual([10, undefined, 14])
    expect(serialized).not.toContain('14. resumed')
    expect(renderMermaidSVG(serialized)).toContain('14. resumed')
    expect(renderMermaidASCII(serialized)).toContain('14. resumed')
  })

  it('retains a large step reference and reports impossible terminal geometry explicitly', () => {
    const source = `sequenceDiagram\nautonumber 123456789012\nA->>B: step`
    expect(renderMermaidSVG(source)).toContain('123456789012. step')
    expect(renderMermaidASCII(source)).toContain('123456789012. step')
    expect(() => renderMermaidASCII(source, { targetWidth: 3 })).toThrow('Cannot render sequence within 3 terminal cells')
  })

  it.each(['.001 .001', '.001 .01', '.01 .001', '0.001 0.001'])('refuses unsupported decimal precision %s rather than drawing backwards numbering', numbering => {
    const source = `sequenceDiagram\n  autonumber ${numbering}\n  A->>B: one\n  A->>B: two\n  A->>B: three`
    expect(() => renderMermaidSVG(source)).toThrow('SEQUENCE_UNSUPPORTED_STATEMENT')
    const verified = verifyMermaid(source)
    expect(verified.ok).toBe(false)
    expect(verified.warnings.map(warning => warning.code)).toContain('RENDER_FAILED')
    const parsed = parseRegisteredMermaid(source)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) throw new Error(JSON.stringify(parsed.error))
    expect(serializeMermaid(parsed.value)).toContain(`autonumber ${numbering}`)
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
