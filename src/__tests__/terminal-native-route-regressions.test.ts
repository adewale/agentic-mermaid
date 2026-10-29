import { expect, test } from 'bun:test'
import { AsciiWidthError, renderMermaidASCIIWithReceipt } from '../ascii/index.ts'
import { renderMermaidWithActions } from '../agent/index.ts'
import { terminalDocumentOf, type TerminalDocument, type TerminalRegion } from '../ascii/terminal-document.ts'
import { convertToAsciiGraph } from '../ascii/converter.ts'
import { createMapping } from '../ascii/grid.ts'
import { drawGraph } from '../ascii/draw.ts'
import { shapeRegistry } from '../ascii/shapes/index.ts'
import { parseMermaid } from '../parser.ts'
import { contactSheetScenarios } from '../../eval/visual-rubric/scenarios.ts'
import { readFileSync } from 'node:fs'
import { parseAsciiGoldenFixture } from '../../scripts/ascii-golden-fixture.ts'

const denseClassSource = `classDiagram
direction TB
class \`ns:Domain\`["Card 1-0 WWW 👩‍💻"] {
  +String value0
}
class \`class-namespace:Domain\`["Card 1-1 WWWWWWWW"] {
  +String value1
  +step1()
}
class \`__interface_0\`["Card 1-2 WWWWWW"] {
  +String value2
}
class \`C3\`["Card 1-3 WWWWWWWWW 👩‍💻"] {
  +String value3
  +step3()
}
class \`C4\`["Card 1-4 WWWWWWW"] {
  +String value4
}
class \`C5\`["Card 1-5 WWWW"] {
  +String value5
}
class \`C6\`["Card 1-6 WWWWWWWW 👩‍💻"] {
  +String value6
  +step6()
}
class \`C7\`["Card 1-7 WW"] {
  +String value7
  +step7()
}
class \`C8\`["Card 1-8 W"] {
  +String value8
  +step8()
}
class \`C9\`["Card 1-9 WWWWWWWWW 👩‍💻"] {
  +String value9
}
\`ns:Domain\` ..> \`class-namespace:Domain\`
\`ns:Domain\` --> \`__interface_0\` : edge 1 xxxxx
\`ns:Domain\` ..> \`C3\`
\`ns:Domain\` *-- \`C4\`
\`ns:Domain\` ..> \`C5\` : edge 4 x
\`ns:Domain\` ..|> \`C6\` : edge 5 xxxxxxxxxxxxxxxxx
\`ns:Domain\` ..> \`C7\` : edge 6 xxxxx
\`ns:Domain\` --> \`C8\`
\`ns:Domain\` <|-- \`C9\`
\`class-namespace:Domain\` -- \`C9\`
\`__interface_0\` ..> \`C9\` : edge 10 xxxxxxxxxxxxxx
\`C3\` -- \`C9\`
\`C4\` <|-- \`C9\`
\`C5\` <|-- \`C9\` : edge 13 xxxxxxxxx
\`C6\` -- \`C9\`
\`C7\` *-- \`C9\`
\`C8\` ..> \`C9\`
\`ns:Domain\` ..|> \`class-namespace:Domain\` : edge 17 xxxxxxxxxxxxxxx
\`C9\` ..> \`C9\` : edge 18 xxxxxxxxxxxx
note for \`ns:Domain\` "owned note 1<br/>second line"
note "free note 1"`

// The Class1 hub/parallel/self-route counterexample retains authored
// endpoint roles and labels survive even when the compact shafts collide.
test.each([false, true].flatMap(useAscii => (['none', 'ansi16', 'html'] as const).map(colorMode => [useAscii, colorMode] as const)))('Class dense relationships retain certified owned ink (ASCII=%s, %s)', (useAscii, colorMode) => {
  const source = denseClassSource
  const result = renderMermaidASCIIWithReceipt(source, { useAscii, colorMode, layoutSafety: 'strict' })
  expect(result.receipt.layoutCertification).toMatchObject({ status: 'passed', issues: [], budget: { exhausted: false, maxOperations: 1_000_000, maxOutputCodeUnits: 2_000_000 } })
  const doc = terminalDocumentOf(result)!, regions = doc.regions(), edges = regions.filter(region => region.kind === 'edge')
  expect(edges).toHaveLength(20)
  for (const edge of edges) {
    expect(hasOwnedRoute(doc, edge), edge.id).toBe(true)
    expect(edge.ports).toHaveLength(2)
    visibleEndpointMarkers(doc, edge)
  }
  const owners = [...doc.layoutEvidence().owners].filter(owner => owner.kind === 'edge')
  expect(owners).toHaveLength(20)
  expect(owners.every(owner => owner.route === 'connected')).toBe(true)
  const witnesses = [...(doc.layoutEvidence().pathWitnesses ?? [])]
  expect(witnesses).toHaveLength(edges.length)
  expect(witnesses.every(witness => witness !== null && edges.some(edge => edge.id === witness.owner.id))).toBe(true)
  expect(regions.find(region => region.id === 'relationship:0')).toMatchObject({ from: 'ns:Domain', to: 'class-namespace:Domain' })
  expect(regions.find(region => region.id === 'relationship:17')).toMatchObject({ from: 'ns:Domain', to: 'class-namespace:Domain', projectedText: 'edge 17 xxxxxxxxxxxxxxx' })
  expect(regions.find(region => region.id === 'relationship:18')).toMatchObject({ from: 'C9', to: 'C9', projectedText: 'edge 18 xxxxxxxxxxxx' })
  expect(regions.find(region => region.id === 'ns:Domain')?.projectedText).toContain('Card 1-0 WWW 👩‍💻')
  expect(regions.find(region => region.id === 'class-namespace:Domain')?.parentId).toBeUndefined()
  expect(regions.find(region => region.id === '__interface_0')?.kind).toBe('node')
  expect(regions.find(region => region.annotationTarget?.id === 'ns:Domain')?.projectedText).toBe('owned note 1\nsecond line')
  expect(regions.find(region => region.id === 'note:1')?.projectedText).toBe('free note 1')
  expect(visibleEndpointMarkers(doc, edges.find(edge => edge.id === 'relationship:3')!).map(marker => marker.shape)).toEqual(['filled-diamond'])
  expect(visibleEndpointMarkers(doc, edges.find(edge => edge.id === 'relationship:17')!).map(marker => marker.shape)).toEqual(['open-arrow'])
  expect(() => doc.assertMarkers()).not.toThrow()
})

test.each([false, true])('Class safe compact association preserves its reviewed canvas (ASCII=%s)', useAscii => {
  const fixture = parseAsciiGoldenFixture(readFileSync(new URL(`./testdata/${useAscii ? 'ascii' : 'unicode'}/cls_association.txt`, import.meta.url), 'utf8'))
  const result = renderMermaidASCIIWithReceipt(fixture.mermaid, { useAscii, colorMode: 'none', paddingX: fixture.paddingX, paddingY: fixture.paddingY, layoutSafety: 'strict' })
  const canvas = (text: string) => text.split('\n').map(line => line.trimEnd()).join('\n').replace(/^\n+/, '').trimEnd()
  expect(canvas(result.text)).toBe(canvas(fixture.expected))
  expect(result.receipt.layoutCertification).toMatchObject({ status: 'passed', issues: [] })
  const doc = terminalDocumentOf(result)!, edge = doc.regions().find(region => region.kind === 'edge')!
  expect(hasOwnedRoute(doc, edge)).toBe(true)
  expect(edge).toMatchObject({ from: 'Student', to: 'Course', projectedText: 'enrolls' })
})

test.each([false, true])('Class recovery keeps hyperlink footers and inert actions (ASCII=%s)', useAscii => {
  const href = 'https://example.com/docs?x=1&y=2'
  const source = `${denseClassSource}\nclick \`ns:Domain\` href "${href}" "API reference"`
  const result = renderMermaidASCIIWithReceipt(source, { useAscii, colorMode: 'none', layoutSafety: 'strict' })
  expect(result.receipt.layoutCertification).toMatchObject({ status: 'passed', issues: [] })
  expect(result.text).toContain(`link ns:Domain: ${href}`)
  const doc = terminalDocumentOf(result)!
  expect(doc.regions().filter(region => region.kind === 'edge')).toHaveLength(20)
  expect([...doc.entries()].filter(([, , cell]) => cell.glyph === '&').every(([, , cell]) => cell.owners.some(owner => owner.kind === 'node' && owner.id === 'ns:Domain'))).toBe(true)
  const artifact = renderMermaidWithActions(source, { format: 'ascii', options: { useAscii, colorMode: 'none', layoutSafety: 'strict' } })
  expect(artifact.actionSurface.actions[0]).toMatchObject({ target: 'ns:Domain', href, tooltip: 'API reference', security: 'safe', executable: false })
  const unsafe = renderMermaidWithActions('classDiagram\nclass A\nclick A href "javascript:alert(1)"', { format: 'ascii', options: { useAscii, colorMode: 'none' } })
  expect(unsafe.output).not.toContain('javascript:')
  expect(unsafe.actionSurface.actions[0]).toMatchObject({ target: 'A', href: 'javascript:alert(1)', security: 'unsafe', executable: false })
})

test('Class recovery includes complete hyperlink footers in its width limit', () => {
  const href = `https://example.com/${'long'.repeat(200)}`
  const source = `${denseClassSource}\nclick \`ns:Domain\` href "${href}"`
  for (const field of ['targetWidth', 'maxWidth'] as const) {
    let caught: unknown
    try { renderMermaidASCIIWithReceipt(source, { colorMode: 'none', [field]: 400 }) } catch (error) { caught = error }
    expect(caught).toBeInstanceOf(AsciiWidthError)
    expect(caught).toMatchObject({ code: 'ASCII_TARGET_WIDTH_IMPOSSIBLE', requestedWidth: 400, family: 'class' })
  }
})

test.each(['TB', 'BT', 'LR', 'RL'].flatMap(direction => [false, true].map(useAscii => [direction, useAscii] as const)))('Class unboxed interfaces use their actual lollipop surface (%s, ASCII=%s)', (direction, useAscii) => {
  const name = 'Interface 👩‍💻'
  const result = renderMermaidASCIIWithReceipt(`classDiagram
direction ${direction}
namespace Outer {
  class A["Carrier 👩‍💻"]
}
class interface0["Authored interface0"]
A --() \`${name}\`
A --() \`${name}\``, { useAscii, colorMode: 'none', layoutSafety: 'strict' })
  expect(result.receipt.layoutCertification).toMatchObject({ status: 'passed', issues: [] })
  const doc = terminalDocumentOf(result)!, regions = doc.regions(), edges = regions.filter(region => region.kind === 'edge')
  expect(edges).toHaveLength(2)
  expect(new Set(edges.map(edge => edge.to)).size).toBe(2)
  expect(regions.find(region => region.id === 'interface0')?.projectedText).toBe('Authored interface0')
  expect(regions.find(region => region.id === 'A')?.parentId).toBe('Outer')
  for (const edge of edges) {
    expect(edge.from).toBe('A')
    expect(edge.to).not.toBe('interface0')
    const node = regions.find(region => region.kind === 'node' && region.id === edge.to)!, port = edge.ports!.find(port => port.end === 'end')!, cell = doc.cell(port.x, port.y)!
    expect(node.projectedText).toBe(name)
    expect(node.canvasColStart).toBe(port.x)
    expect(node.canvasColEnd).toBe(port.x + cell.width)
    expect(node.canvasRow).toBe(port.y)
    expect(node.rowSpan ?? 1).toBe(1)
    expect(cell.marker?.shape).toBe('lollipop')
    expect(cell.owners).toContainEqual(expect.objectContaining({ id: node.id, kind: 'node' }))
    expect(cell.owners).toContainEqual(expect.objectContaining({ id: edge.id, kind: 'edge' }))
    expect(hasOwnedRoute(doc, edge)).toBe(true)
    expect(visibleEndpointMarkers(doc, edge).map(marker => marker.shape)).toEqual(['lollipop'])
  }
  expect(() => doc.assertMarkers()).not.toThrow()
})

test.each([false, true])('dense parallel relationships retain connected owned ink and physical markers (ASCII=%s)', useAscii => {
  const source = readFileSync(new URL('../../eval/layout-compare/fixtures/cyclic-labelled-19.mmd', import.meta.url), 'utf8')
  const { doc } = render(source, useAscii)
  const edge = doc.regions().find(region => region.id === 'edge#19:n3->n5')!
  expect(edge).toMatchObject({ from: 'n3', to: 'n5' })
  expect(hasOwnedRoute(doc, edge)).toBe(true)
  expect(edge.ports!.some(port => port.markerProjection)).toBe(false)
  expect(doc.diagnostics.filter(diagnostic => diagnostic.code === 'TERMINAL_GEOMETRY_COLLISION')).toEqual([])
  expect(visibleEndpointMarkers(doc, edge).map(marker => marker.shape)).toEqual(['arrow'])
  expect(() => doc.assertMarkers()).not.toThrow()
})

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

test.each([false, true])('bounded Flowchart routing connects previously declined parallel relationships (ASCII=%s)', useAscii => {
  for (const source of [
    'graph RL\nN0[N0]\nN1[N1]\nN2[N2]\nN3[N3]\nN4[N4]\nN5[N5]\nN5 --> N1\nN1 --> N4\nN5 --> N0\nN1 --> N4\nN0 --> N5',
    'graph TD\nN0[N0]\nN1[N1]\nN2[N2]\nN3[N3]\nN4[N4]\nN5[N5]\nN6[N6]\nN3 --> N6\nN3 --> N1\nN1 --> N6\nN1 --> N2\nN1 --> N6',
  ]) {
    const result = renderMermaidASCIIWithReceipt(source, { useAscii, colorMode: 'none' })
    const doc = terminalDocumentOf(result)!
    const edges = doc.regions().filter(region => region.kind === 'edge')
    expect(edges).toHaveLength(parseMermaid(source).edges.length)
    for (const edge of edges) {
      expect(hasOwnedRoute(doc, edge), edge.id).toBe(true)
      expect(edge.ports!.some(port => port.markerProjection)).toBe(false)
      visibleEndpointMarkers(doc, edge)
    }
    expect(() => doc.assertMarkers()).not.toThrow()
    expect(result.receipt.layoutCertification).toMatchObject({ status: 'passed', issues: [] })
    expect(() => renderMermaidASCIIWithReceipt(source, { useAscii, colorMode: 'none', layoutSafety: 'strict' })).not.toThrow()
  }
})

function render(source: string, useAscii = false) {
  const result = renderMermaidASCIIWithReceipt(source, { useAscii, colorMode: 'none' })
  return { output: result.text, doc: terminalDocumentOf(result)! }
}

function hasOwnedRoute(doc: TerminalDocument, edge: TerminalRegion): boolean {
  const [start, end] = edge.ports!.map(port => {
    const dx = port.side === 'R' ? 1 : port.side === 'L' ? -1 : 0, dy = port.side === 'B' ? 1 : port.side === 'T' ? -1 : 0
    // Unmarked border ink belongs to the node. Its relationship starts at
    // the outward-adjacent cell; marked endpoints retain the actual glyph.
    const offset = port.markers?.length ? port.markerOffset ?? 0 : 1
    return { x: port.x + dx * offset, y: port.y + dy * offset }
  })
  const glyphMasks: Readonly<Record<string, number>> = { '─': 10, '│': 5, '┌': 6, '┐': 12, '└': 3, '┘': 9, '├': 7, '┤': 13, '┬': 14, '┴': 11, '┼': 15, '╌': 10, '┊': 5, '-': 10, '|': 5, '.': 10, ':': 5, '+': 15 }
  const points = new Map<string, number>([...doc.entries()].flatMap(([x, y, cell]) => {
    if (!cell.owners.some(owner => owner.kind === 'edge' && owner.id === edge.id)) return []
    const mask = cell.kind === 'stroke' ? glyphMasks[cell.glyph] : cell.kind === 'marker' ? cell.marker?.direction === 'T' || cell.marker?.direction === 'B' ? 5 : 10 : 0
    return mask ? [[`${x},${y}`, mask] as const] : []
  }))
  const first = `${start!.x},${start!.y}`, queue = points.has(first) ? [first] : [], seen = new Set(queue)
  for (let index = 0; index < queue.length; index++) {
    const [x, y] = queue[index]!.split(',').map(Number), mask = points.get(queue[index]!)!
    for (const [dx, dy, exit, entry] of [[-1, 0, 8, 2], [1, 0, 2, 8], [0, -1, 1, 4], [0, 1, 4, 1]]) {
      const next = `${x! + dx!},${y! + dy!}`
      if ((mask & exit!) && ((points.get(next) ?? 0) & entry!) && !seen.has(next)) { seen.add(next); queue.push(next) }
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
  expect(doc.cell(x, y)?.owners.map(owner => owner.id)).toContain(branch.id)
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

test.each(['cyclic-labelled-15-chains', 'cyclic-labelled-19'].flatMap(fixture => [false, true].map(useAscii => [fixture, useAscii] as const)))('dense labelled Flow retains complete terminal routes: %s (ASCII=%s)', (fixture, useAscii) => {
  const source = readFileSync(new URL(`../../eval/layout-compare/fixtures/${fixture}.mmd`, import.meta.url), 'utf8')
  const result = renderMermaidASCIIWithReceipt(source, { useAscii, colorMode: 'none', graphLayout: { backend: 'agentic', fallback: 'none' } })
  expect(result.receipt.layoutCertification).toMatchObject({ status: 'passed', issues: [], budget: { exhausted: false, maxOperations: 1_000_000 } })
  const parsed = parseMermaid(source), doc = terminalDocumentOf(result)!, regions = doc.regions()
  const edges = regions.filter(region => region.kind === 'edge')
  expect(edges).toHaveLength(parsed.edges.length)
  for (const [index, authored] of parsed.edges.entries()) {
    const edge = edges.find(region => region.id === `edge#${index}:${authored.source}->${authored.target}`)!
    expect(edge, `occurrence ${index}`).toBeDefined()
    expect(edge).toMatchObject({ from: authored.source, to: authored.target })
    expect(edge.ports).toHaveLength(2)
    if (authored.label) expect(edge.projectedText).toContain(authored.label)
  }
  const affected = fixture === 'cyclic-labelled-15-chains' ? [31] : [19, 25, 22, 42]
  for (const index of affected) {
    const authored = parsed.edges[index]!, edge = edges.find(region => region.id === `edge#${index}:${authored.source}->${authored.target}`)!
    expect(hasOwnedRoute(doc, edge), edge.id).toBe(true)
    expect(edge.ports!.some(port => port.markerProjection)).toBe(false)
  }
})


test.each(['TD', 'BT', 'LR', 'RL'])('nested face escape lanes retain parallel and reciprocal routes (%s)', direction => {
  const source = `flowchart ${direction}
subgraph Outer[Outer]
subgraph Inner[Inner]
A[Source]
end
end
X[Target]
A --> X
A --> X
A --> X
X --> A`
  const result = renderMermaidASCIIWithReceipt(source, { colorMode: 'none', layoutSafety: 'strict' })
  expect(result.receipt.layoutCertification).toMatchObject({ status: 'passed', issues: [] })
  const doc = terminalDocumentOf(result)!, edges = doc.regions().filter(region => region.kind === 'edge')
  expect(edges).toHaveLength(4)
  for (const edge of edges) { expect(hasOwnedRoute(doc, edge), edge.id).toBe(true); visibleEndpointMarkers(doc, edge) }
})
