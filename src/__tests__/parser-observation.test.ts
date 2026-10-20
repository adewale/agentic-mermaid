import { describe, expect, test } from 'bun:test'
import { getFamily, knownBuiltinFamilies } from '../agent/core.ts'
import { parseClassDiagram } from '../class/parser.ts'
import { renderMermaidSVG } from '../index.ts'
import { parseMermaid } from '../parser.ts'
import { parseSequenceDiagram } from '../sequence/parser.ts'
import { observeParserMutation, type ParserObservation, withParserObservation } from '../shared/parser-observation.ts'

describe('native parser observation', () => {
  test('selective mutation observation avoids reading excluded payloads and restores the enclosing scope', () => {
    const events: ParserObservation[] = []
    const unused = { get children(): never { throw new Error('excluded payload was traversed') } }
    withParserObservation('block', event => events.push(event), () => {
      withParserObservation('block', event => events.push(event), () => {
        observeParserMutation('block', 'upsert-block', unused)
        observeParserMutation('block', 'generate-id', 'anonymous-1')
      }, { mutations: ['generate-id'] })
      observeParserMutation('block', 'upsert-block', { id: 'outer' })
    })
    expect(events.map(event => [event.kind, event.value])).toEqual([['generate-id', 'anonymous-1'], ['upsert-block', { id: 'outer' }]])
  })
  for (const family of knownBuiltinFamilies()) {
    test(`${family}: public SVG is identical with actual native consumption/build observation`, () => {
      const source = getFamily(family)!.example
      const events: ParserObservation[] = []
      const control = renderMermaidSVG(source)
      const observed = withParserObservation(
        family,
        event => events.push(event),
        () => renderMermaidSVG(source),
      )
      expect(observed).toBe(control)
      expect(events.some(event => event.unit === 'statement')).toBe(true)
      expect(events.some(event => event.unit === 'mutation')).toBe(true)
      expect(events.every(event => event.family === family)).toBe(true)
    })
  }
  test('snapshots actual Class writes before later member and label changes, keeping endpoint sides and namespace membership', () => {
    const source = ['classDiagram', 'namespace Outer {', 'class A', 'class A["Alpha"] {', '+String name', '}', 'A <-- B : calls', '}']
    const events: ParserObservation[] = []
    const observed = withParserObservation(
      'class',
      event => events.push(event),
      () => parseClassDiagram(source),
    )
    expect(observed).toEqual(parseClassDiagram(source))
    expect(events.find(event => event.kind === 'add-class')?.value).toMatchObject({ id: 'A', label: 'A', attributes: [], methods: [] })
    expect(events.filter(event => event.kind === 'claim-member').map(event => event.value)).toEqual([{ id: 'A', parent: 'Outer' }])
    expect(events.find(event => event.kind === 'add-relationship')?.value).toMatchObject({ from: 'A', to: 'B', type: 'association', markerAt: 'from', label: 'calls' })
    expect(events.find(event => event.unit === 'statement' && event.kind === 'relationship')?.source).toMatchObject({ line: 7, unit: 'normalized' })
  })

  test('records consumed Flowchart fragments and ordered class/group mutations without replaying final graph state', () => {
    const source = 'flowchart TD\nsubgraph S[First]\nA["Nested [label]"] o--x B\nend\nclass A warm\nclass A cool\nsubgraph S[Later]\nC\nend'
    const events: ParserObservation[] = []
    const observed = withParserObservation(
      'flowchart',
      event => events.push(event),
      () => parseMermaid(source),
    )
    expect(observed).toEqual(parseMermaid(source))
    expect(events.filter(event => event.kind === 'append-class').map(event => event.value)).toEqual([
      { id: 'A', name: 'warm', classes: 'warm' },
      { id: 'A', name: 'cool', classes: 'warm cool' },
    ])
    expect(events.filter(event => event.kind === 'close-group').map(event => event.value)).toEqual([
      { id: 'S', label: 'First', members: ['A', 'B'], children: [] },
      { id: 'S', label: 'First', members: ['A', 'B', 'C'], children: [] },
    ])
    expect(events.find(event => event.kind === 'add-edge')?.value).toMatchObject({ source: 'A', target: 'B', startMarker: 'circle', endMarker: 'cross', hasArrowStart: true, hasArrowEnd: true })
    expect(events.filter(event => event.unit === 'token').map(event => [event.kind, event.text])).toEqual([
      ['quoted-node', 'A["Nested [label]"]'],
      ['link', 'o--x'],
      ['node', 'B'],
      ['node', 'C'],
    ])
  })

  test('records a reopened State composite under the parent it was first declared in', () => {
    const source = 'stateDiagram-v2\nstate P {\nstate A {\nx\n--\ny\n}\n}\nstate A {\nz\n}\nstate Q {\nstate P {\nw\n}\n}'
    const events: ParserObservation[] = []
    const observed = withParserObservation('state', event => events.push(event), () => parseMermaid(source))
    expect(observed).toEqual(parseMermaid(source))
    const groups = (kind: string) => events.filter(event => event.kind === kind).map(event => [(event.value as { id: string }).id, (event.value as { parent?: string }).parent])
    expect(groups('open-group')).toEqual([['P', undefined], ['A', 'P'], ['A', 'P'], ['Q', undefined], ['P', undefined]])
    expect(groups('close-group')).toEqual([['A', 'P'], ['P', undefined], ['A', 'P'], ['P', undefined], ['Q', undefined]])
  })

  test('records Sequence builder calls with both marker sides, labels and block parentage', () => {
    const source = ['sequenceDiagram', 'participant A as Alice', 'alt Outer', 'loop Inner', 'A<<->>B: hello', 'end', 'end']
    const events: ParserObservation[] = []
    const observed = withParserObservation(
      'sequence',
      event => events.push(event),
      () => parseSequenceDiagram(source),
    )
    expect(observed).toEqual(parseSequenceDiagram(source))
    expect(events.find(event => event.kind === 'participant.apply')?.value).toMatchObject({ kind: 'declare', id: 'A', label: 'Alice' })
    expect(events.find(event => event.kind === 'add-message')?.value).toMatchObject({ from: 'A', to: 'B', label: 'hello', startHead: 'filled', endHead: 'filled' })
    expect(events.filter(event => event.kind === 'open-block').map(event => event.value)).toEqual([expect.objectContaining({ id: 1, block: expect.objectContaining({ type: 'alt', label: 'Outer' }) }), expect.objectContaining({ id: 2, block: expect.objectContaining({ type: 'loop', label: 'Inner', parent: 1 }) })])
  })

  test('restores nested observers after rejection and isolates parser calls made by callbacks', () => {
    const outer: ParserObservation[] = [],
      inner: ParserObservation[] = []
    let nested = false
    withParserObservation(
      'class',
      event => {
        outer.push(event)
        if (!nested) {
          nested = true
          parseClassDiagram(['classDiagram', 'class CallbackOnly'])
        }
      },
      () => {
        parseClassDiagram(['classDiagram', 'class Before'])
        expect(() =>
          withParserObservation(
            'flowchart',
            event => inner.push(event),
            () => parseMermaid('flowchart TD\nA -->'),
          ),
        ).toThrow()
        parseClassDiagram(['classDiagram', 'class After'])
      },
    )
    parseClassDiagram(['classDiagram', 'class Outside'])
    expect(outer.filter(event => event.kind === 'add-class').map(event => (event.value as { id: string }).id)).toEqual(['Before', 'After'])
    expect(inner.some(event => event.kind === 'add-node')).toBe(true)
    expect(() =>
      withParserObservation(
        'class',
        () => {
          throw new Error('observer failed')
        },
        () => parseClassDiagram(['classDiagram', 'class Throws']),
      ),
    ).toThrow('observer failed')
    expect(() => parseClassDiagram(['classDiagram', 'class Safe'])).not.toThrow()
  })

  test('does not retain an observation scope across an async return', async () => {
    const events: ParserObservation[] = []
    let finish: Promise<void> | undefined
    expect(() =>
      withParserObservation(
        'class',
        event => events.push(event),
        () => {
          finish = Promise.resolve().then(() => {
            parseClassDiagram(['classDiagram', 'class Later'])
          })
          return finish
        },
      ),
    ).toThrow('must be synchronous')
    await finish
    expect(events).toEqual([])
  })
})
