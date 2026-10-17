import { expect, test } from 'bun:test'
import { renderMermaidASCIIWithReceipt } from '../ascii/index.ts'
import { terminalDocumentOf, type TerminalDocument, type TerminalRegion } from '../ascii/terminal-document.ts'
import { convertToAsciiGraph } from '../ascii/converter.ts'
import { createMapping } from '../ascii/grid.ts'
import { drawGraph } from '../ascii/draw.ts'
import { shapeRegistry } from '../ascii/shapes/index.ts'
import { parseMermaid } from '../parser.ts'
import { contactSheetScenarios } from '../../eval/visual-rubric/scenarios.ts'

function visibleEndpointMarkers(doc: TerminalDocument, edge: TerminalRegion) {
  return edge.ports!.flatMap(port => {
    expect(port.markers, `${edge.id}/${port.end} has model intent`).toBeDefined()
    const dx = port.side === 'R' ? 1 : port.side === 'L' ? -1 : 0, dy = port.side === 'B' ? 1 : port.side === 'T' ? -1 : 0
    return port.markers!.map((marker, index) => {
      const offset = (port.markerOffset ?? 0) + index
      const cell = doc.cell(port.x + dx * offset, port.y + dy * offset)!
      expect(cell.kind).toBe('marker')
      expect(cell.owners.some(owner => owner.kind === 'edge' && owner.id === edge.id)).toBe(true)
      expect(cell.marker).toMatchObject(marker)
      return cell.marker!
    })
  })
}

test.each([false, true])('native families retain typed endpoint meaning across faces and widths (ASCII=%s)', useAscii => {
  for (const direction of ['TB', 'BT', 'LR', 'RL']) {
    for (const [source, shapes] of [
      [`flowchart ${direction}\nA o--x B\nB <--> C\nC --> C`, ['wide-circle', 'cross', 'arrow', 'arrow', 'arrow']],
      [`stateDiagram-v2\ndirection ${direction}\nA --> B\nB --> A\nB --> B`, ['arrow', 'arrow', 'arrow']],
      [`classDiagram\ndirection ${direction}\nA o--* B\nB <|-- C\nC --() D\nnote for A "base type"\nclick A href "https://example.com/class"`, ['hollow-diamond', 'filled-diamond', 'open-arrow', 'lollipop']],
      [`erDiagram\ndirection ${direction}\nA ||--o{ B : owns`, ['cardinality-one', 'cardinality-many', 'circle']],
    ] as const) {
      for (const maxWidth of [48, 96]) {
        const rendered = renderMermaidASCIIWithReceipt(source, { useAscii, colorMode: 'none', maxWidth })
        const doc = terminalDocumentOf(rendered)!
        const actual = doc.regions().filter(region => region.kind === 'edge').flatMap(edge => visibleEndpointMarkers(doc, edge).map(marker => marker.shape))
        expect(actual.sort()).toEqual([...shapes].sort())
        expect(() => doc.assertMarkers()).not.toThrow()
      }
    }
  }
})

test.each([false, true])('different Flowchart marker meanings receive distinct physical ports, including self routes (ASCII=%s)', useAscii => {
  for (const direction of ['TB', 'BT', 'LR', 'RL']) for (const target of ['B', 'A']) {
    const { doc } = render(`flowchart ${direction}\nA o--o ${target}\nA x--x ${target}\nA <--> ${target}`, useAscii)
    const edges = doc.regions().filter(region => region.kind === 'edge')
    expect(edges).toHaveLength(3)
    const shapes: string[] = edges.flatMap(edge => visibleEndpointMarkers(doc, edge).map(marker => marker.shape))
    expect(shapes.sort()).toEqual(['wide-circle', 'wide-circle', 'cross', 'cross', 'arrow', 'arrow'].sort())
    for (const end of ['start', 'end']) expect(new Set(edges.map(edge => {
      const port = edge.ports!.find(port => port.end === end)!
      return `${port.x},${port.y}`
    })).size).toBe(3)
  }
})

test.each([false, true])('every native node silhouette retains inward markers on all four faces (ASCII=%s)', useAscii => {
  for (const shape of shapeRegistry.keys()) for (const graphDirection of ['TD', 'LR'] as const) for (const reverse of [false, true]) {
    const graph = convertToAsciiGraph(parseMermaid('flowchart TD\nA <--> B'), { useAscii, graphDirection, reverseDirection: graphDirection === 'LR' && reverse, paddingX: 3, paddingY: 3, boxBorderPadding: 1 })
    for (const node of graph.nodes) node.shape = shape
    createMapping(graph)
    const doc = drawGraph(graph)
    if (graphDirection === 'TD' && reverse) doc.flip(false, true)
    expect(() => doc.serialize()).not.toThrow()
    const edge = doc.regions().find(region => region.kind === 'edge')!
    const markers = visibleEndpointMarkers(doc, edge)
    expect(markers.map(marker => marker.direction)).toEqual(graphDirection === 'TD' ? reverse ? ['B', 'T'] : ['T', 'B'] : reverse ? ['R', 'L'] : ['L', 'R'])
  }
})

test.each([false, true])('existing AI/AR contact-sheet routes retain every marked native endpoint (ASCII=%s)', useAscii => {
  for (const letter of ['AI', 'AR']) for (const direction of ['TD', 'BT', 'LR', 'RL']) {
    const source = contactSheetScenarios().find(scenario => scenario.letter === letter)!.source.replace(/^flowchart \w+/, `flowchart ${direction}`)
    const { doc } = render(source, useAscii)
    const edges = doc.regions().filter(region => region.kind === 'edge')
    expect(edges).toHaveLength(parseMermaid(source).edges.length)
    for (const edge of edges) expect(visibleEndpointMarkers(doc, edge)).toHaveLength(1)
  }
})

test.each([false, true])('Architecture preserves authored arrow faces, ends and parallel routes (ASCII=%s)', useAscii => {
  const inward = { T: 'B', R: 'L', B: 'T', L: 'R' } as const
  for (const [from, to] of [['L', 'R'], ['R', 'L'], ['T', 'B'], ['B', 'T']] as const) {
    const { doc } = render(`architecture-beta\nservice a(server)[Source]\nservice b(database)[Target]\na:${from} <--> ${to}:b\na:${from} <--> ${to}:b`, useAscii)
    const edges = doc.regions().filter(region => region.kind === 'edge')
    expect(edges).toHaveLength(2)
    for (const edge of edges) {
      expect(edge.ports!.map(port => port.side)).toEqual([from, to])
      expect(edge.ports!.map(port => port.markers![0]!.direction)).toEqual([inward[from], inward[to]])
      if (edge.ports!.some(port => port.markerProjection)) {
        expect(edge.projectedText).toContain(`a:${from} <--> ${to}:b`)
        for (const port of edge.ports!) expect(doc.diagnostics).toContainEqual(expect.objectContaining({ code: 'TERMINAL_FAMILY_PROJECTION', feature: port.markerProjection }))
      } else expect(visibleEndpointMarkers(doc, edge).map(marker => marker.direction)).toEqual([inward[from], inward[to]])
    }
    expect(() => doc.assertMarkers()).not.toThrow()
  }
})

test.each([false, true])('Sequence preserves half/stick distinctions and inward self heads after wrapping (ASCII=%s)', useAscii => {
  const tokens = [
    ['-|\\', 'half-top', 'end'], ['-|/', 'half-bottom', 'end'], ['-\\\\', 'stick-top', 'end'], ['-//', 'stick-bottom', 'end'],
    ['\\|-', 'half-top', 'start'], ['/|-', 'half-bottom', 'start'], ['\\\\-', 'stick-top', 'start'], ['//-', 'stick-bottom', 'start'],
  ] as const
  for (const [token, shape, end] of tokens) for (const [from, to] of [['A', 'B'], ['B', 'A'], ['A', 'A']] as const) {
    const result = renderMermaidASCIIWithReceipt(`sequenceDiagram\nparticipant A\nparticipant B\n${from}${token}${to}: complete wrapped message with long text`, { useAscii, colorMode: 'none', targetWidth: 48 })
    const doc = terminalDocumentOf(result)!, edge = doc.regions().find(region => region.kind === 'edge')!
    expect(visibleEndpointMarkers(doc, edge)).toMatchObject([{ shape, direction: from === to || (end === 'end' ? from > to : from < to) ? 'L' : 'R' }])
  }
  const { doc } = render('sequenceDiagram\nA<<->>A: self', useAscii)
  expect(visibleEndpointMarkers(doc, doc.regions().find(region => region.kind === 'edge')!).map(marker => marker.direction)).toEqual(['L', 'L'])
})

test('non-geometric terminal families explicitly retain their distinct projection', () => {
  const journey = renderMermaidASCIIWithReceipt('journey\nsection Work\nDone: 5: Me')
  expect(journey.terminalStyle.diagnostics).toContainEqual(expect.objectContaining({ feature: 'journey.axis', code: 'TERMINAL_FAMILY_PROJECTION' }))
  const gantt = renderMermaidASCIIWithReceipt('gantt\ndateFormat YYYY-MM-DD\nA :a, 2026-01-01, 1d\nB :b, after a, 1d\nC :c, 2026-01-01, until b', { useAscii: true, targetWidth: 48 })
  expect(gantt.text).toContain('b after a')
  expect(gantt.text).toContain('c until b')
  const relations = terminalDocumentOf(gantt)!.regions().filter(region => region.kind === 'edge')
  expect(relations.map(region => [region.from, region.to])).toEqual([['a', 'b'], ['c', 'b']])
  expect(gantt.terminalStyle.diagnostics.filter(diagnostic => diagnostic.feature.endsWith('.dependencies'))).toHaveLength(2)
})

function render(source: string, useAscii = false) {
  const result = renderMermaidASCIIWithReceipt(source, { useAscii, colorMode: 'none' })
  return { output: result.text, doc: terminalDocumentOf(result)! }
}

function hasOwnedRoute(doc: TerminalDocument, edge: TerminalRegion): boolean {
  const [start, end] = edge.ports!
  const points = new Set([...doc.entries()].filter(([, , cell]) => cell.owners.some(owner => owner.kind === 'edge' && owner.id === edge.id)).map(([x, y]) => `${x},${y}`))
  points.add(`${start!.x},${start!.y}`); points.add(`${end!.x},${end!.y}`)
  const queue = [`${start!.x},${start!.y}`], seen = new Set(queue)
  for (let index = 0; index < queue.length; index++) {
    const [x, y] = queue[index]!.split(',').map(Number)
    for (const [nx, ny] of [[x! - 1, y!], [x! + 1, y!], [x!, y! - 1], [x!, y! + 1]]) {
      const next = `${nx},${ny}`
      if (points.has(next) && !seen.has(next)) { seen.add(next); queue.push(next) }
    }
  }
  return seen.has(`${end!.x},${end!.y}`)
}

test.each(['TB', 'BT', 'LR', 'RL'])('Class routes avoid complete namespace headers in %s', direction => {
  const { output, doc } = render(`classDiagram
direction ${direction}
namespace Alpha["First<br/>complete header"] {
  class A
}
namespace Beta["Second<br/>complete header"] {
  class B
}
A --> B : edge`)
  expect(output).toContain('complete header')
  expect(doc.regions().filter(region => region.kind === 'cluster').map(region => region.projectedText)).toEqual(expect.arrayContaining([' First \n complete header ', ' Second \n complete header ']))
  const edge = doc.regions().find(region => region.kind === 'edge')!
  expect(hasOwnedRoute(doc, edge)).toBe(true)
  expect(doc.diagnostics.filter(diagnostic => /COLLISION|OVERLAP/.test(diagnostic.code))).toEqual([])
})

test.each([false, true])('Sequence selects central endpoint markers before painting (ASCII=%s)', useAscii => {
  const { doc } = render(`sequenceDiagram
A->>()B: central end
B() ->>A: central start
A() <<->>()B: both ends
A->>()A: self end`, useAscii)
  const edges = doc.regions().filter(region => region.kind === 'edge')
  for (const [index, ends] of [[0, ['end']], [1, ['start']], [2, ['start', 'end']], [3, ['end']]] as const) {
    const edge = edges.find(region => region.id === `message:${index}`)!
    for (const end of ends) {
      const port = edge.ports!.find(port => port.end === end)!
      expect(doc.cell(port.x, port.y)?.glyph).toBe(useAscii ? 'o' : '○')
      expect(doc.cell(port.x, port.y)?.owners.some(owner => owner.id === edge.id)).toBe(true)
    }
  }
  expect(doc.diagnostics.filter(diagnostic => /COLLISION|OVERLAP/.test(diagnostic.code))).toEqual([])
})

test.each(['LR', 'RL'])('shared %s trunk junction belongs to each route traversing it', direction => {
  const { doc } = render(`flowchart ${direction}\nA --> B\nA --> C\nA --> D`)
  const edges = doc.regions().filter(region => region.kind === 'edge')
  const through = edges.find(region => region.to === 'D')!
  const branch = edges.find(region => region.to === 'C')!
  const x = through.ports!.find(port => port.end === 'start')!.x
  const y = branch.ports!.find(port => port.end === 'end')!.y
  expect(doc.cell(x, y)?.glyph).toBe(direction === 'LR' ? '├' : '┤')
  expect(doc.cell(x, y)?.owners.map(owner => owner.id)).toContain(through.id)
  expect(hasOwnedRoute(doc, through)).toBe(true)
})

test.each(['TD', 'BT', 'LR', 'RL'])('container/external reciprocal cycle allocates both endpoints in %s', direction => {
  const { output, doc } = render(`flowchart ${direction}
subgraph G[Group]
  subgraph H[Inner]
    A[Member]
  end
end
B[External] --> G
G --> B`)
  expect(output).toContain('Member')
  expect(output).toContain('External')
  const edges = doc.regions().filter(region => region.kind === 'edge')
  expect(edges.map(edge => [edge.from, edge.to])).toEqual(expect.arrayContaining([['B', 'G'], ['G', 'B']]))
  expect(edges).toHaveLength(2)
  for (const edge of edges) {
    expect(edge.ports).toHaveLength(2)
    expect(edge.ownedCellSpans.length).toBeGreaterThan(0)
    expect(hasOwnedRoute(doc, edge)).toBe(true)
    for (const port of edge.ports!) expect([...doc.entries()].some(([x, y, cell]) => Math.abs(x - port.x) + Math.abs(y - port.y) <= 1 && cell.owners.some(owner => owner.id === edge.id))).toBe(true)
  }
  expect(doc.diagnostics.filter(diagnostic => /COLLISION|OVERLAP/.test(diagnostic.code))).toEqual([])
})

test('Class namespace obstacles cannot replace a same-named class relationship endpoint', () => {
  const { output, doc } = render(`classDiagram
class A["Actual source"]
namespace A["Namespace"] {
  class B["Actual target"]
}
A --> B : edge`)
  expect(output).toContain('Actual source')
  expect(output).toContain('Namespace')
  const edge = doc.regions().find(region => region.kind === 'edge')!
  expect([edge.from, edge.to]).toEqual(['A', 'B'])
  for (const port of edge.ports!) {
    expect([...doc.entries()].some(([x, y, cell]) => Math.abs(x - port.x) + Math.abs(y - port.y) <= 1 && cell.owners.some(owner => owner.kind === 'node' && owner.id === port.nodeId))).toBe(true)
  }
  expect(hasOwnedRoute(doc, edge)).toBe(true)
})
