import { expect, test } from 'bun:test'
import { renderMermaidASCIIWithReceipt } from '../ascii/index.ts'
import { parseMermaid } from '../parser.ts'
import { convertToAsciiGraph } from '../ascii/converter.ts'
import { createMapping } from '../ascii/grid.ts'
import { drawGraph } from '../ascii/draw.ts'
import { allocatedGraphPort } from '../ascii/graph-capacity.ts'
import { certifyTerminalLayout } from '../ascii/terminal-certification.ts'
import { measuredText, terminalDocumentOf, type TerminalDocument, type TerminalRegion } from '../ascii/terminal-document.ts'

type RelationshipWitness = [string, string, string?, ('circle' | 'cross')?]
const visibleStrokePorts: Record<string, number> = {
  '─': 10, '━': 10, '═': 10, '┄': 10, '┈': 10, '╌': 10, '-': 10, '=': 10, '.': 10,
  '│': 5, '┃': 5, '║': 5, '┆': 5, '┊': 5, '╎': 5, '|': 5, ':': 5,
  '┌': 6, '┐': 12, '└': 3, '┘': 9, '├': 7, '┤': 13, '┬': 14, '┴': 11, '┼': 15, '+': 15,
}
const containerEndpointCases: Array<{ name: string; body: string; texts: Array<[string, string]>; relationships: Array<[string, string, string, ('circle' | 'cross')?]>; variants?: readonly boolean[] }> = [
  {
    name: 'two complete sibling frame faces',
    body: 'subgraph G1\nA[Inside one]\nend\nsubgraph G2\nB[Inside two]\nend\nG1 -->|one| G2\nG1 -->|two| G2\nG2 -->|back| G1',
    texts: [['G1', 'G1'], ['G2', 'G2'], ['A', 'Inside one'], ['B', 'Inside two']],
    relationships: [['G1', 'G2', 'one'], ['G1', 'G2', 'two'], ['G2', 'G1', 'back']],
  },
  {
    name: 'multi-member frame independent of its representative anchor',
    body: 'subgraph G[Header]\nA[Left]\nC[Right]\nend\nG -->|one| B[Outside]\nG -->|two| B\nB -->|back| G',
    texts: [['G', 'Header'], ['A', 'Left'], ['C', 'Right'], ['B', 'Outside']],
    relationships: [['G', 'B', 'one'], ['G', 'B', 'two'], ['B', 'G', 'back']],
  },
  {
    name: 'ancestor and descendant share an anchor but remain distinct endpoints',
    body: 'subgraph Parent[Outer 日本]\nsubgraph Child[Inner 👩‍💻]\nA[Member]\nend\nend\nParent -->|one| A\nParent -->|two| A\nA -->|back| Parent',
    texts: [['Parent', 'Outer 日本'], ['Child', 'Inner 👩‍💻'], ['A', 'Member']],
    relationships: [['Parent', 'A', 'one'], ['Parent', 'A', 'two'], ['A', 'Parent', 'back']],
  },
  {
    name: 'nested container endpoints share an anchor but retain their own frames',
    body: 'subgraph Parent[Outer 日本]\nsubgraph Child[Inner 👩‍💻]\nA[Member]\nend\nend\nParent -->|one| Child\nParent -->|two| Child\nChild -->|back| Parent',
    texts: [['Parent', 'Outer 日本'], ['Child', 'Inner 👩‍💻'], ['A', 'Member']],
    relationships: [['Parent', 'Child', 'one'], ['Parent', 'Child', 'two'], ['Child', 'Parent', 'back']],
  },
  {
    name: 'empty frame endpoints have usable faces without phantom cards',
    body: 'subgraph Empty1[Nothing 日本]\nend\nsubgraph Empty2[Nothing 👩‍💻]\nend\nEmpty1 -->|one| Empty2\nEmpty1 -->|two| Empty2\nEmpty2 -->|back| Empty1',
    texts: [['Empty1', 'Nothing 日本'], ['Empty2', 'Nothing 👩‍💻']],
    relationships: [['Empty1', 'Empty2', 'one'], ['Empty1', 'Empty2', 'two'], ['Empty2', 'Empty1', 'back']],
  },
  {
    name: 'self-container relationships allocate separate ports on the full face',
    body: 'subgraph G[Wide 日本 header]\nA[Left]\nC[Right]\nend\nG -->|one| G\nG -->|two| G',
    texts: [['G', 'Wide 日本 header'], ['A', 'Left'], ['C', 'Right']],
    relationships: [['G', 'G', 'one'], ['G', 'G', 'two']],
  },
  {
    name: 'nested frame approaches stay disjoint with a multiline parallel label',
    body: 'subgraph P\nsubgraph C\nA\nend\nend\nP -->|one| C\nP -->|two<br>x| C\nC -->|back| P',
    texts: [['P', 'P'], ['C', 'C'], ['A', 'A']],
    relationships: [['P', 'C', 'one'], ['P', 'C', 'two\nx'], ['C', 'P', 'back']], variants: [true],
  },
  {
    name: 'nested frame approaches reserve both protected marker ends and self capacity',
    body: 'subgraph Parent[Outer 日本]\nsubgraph Child[Inner 👩‍💻]\nA[Member]\nend\nend\nParent o--o|界 👩‍💻 = é| Child\nParent x--x|again<br>日本| Child\nChild -->|back| Parent\nChild -->|self| Child',
    texts: [['Parent', 'Outer 日本'], ['Child', 'Inner 👩‍💻'], ['A', 'Member']],
    relationships: [['Parent', 'Child', '界 👩‍💻 = é', 'circle'], ['Parent', 'Child', 'again\n日本', 'cross'], ['Child', 'Parent', 'back'], ['Child', 'Child', 'self']], variants: [true],
  },
  {
    name: 'multilevel ancestor approaches coexist with a leaf and nested self relationship',
    body: 'subgraph Parent[Outer 日本]\nsubgraph Middle[Between]\nsubgraph Child[Inner 👩‍💻]\nA[Member]\nend\nend\nend\nParent o--o|界 👩‍💻 = é| Child\nParent x--x|again<br>日本| Child\nChild -->|back| Parent\nChild -->|self| Child\nA -->|leaf| Parent',
    texts: [['Parent', 'Outer 日本'], ['Middle', 'Between'], ['Child', 'Inner 👩‍💻'], ['A', 'Member']],
    relationships: [['Parent', 'Child', '界 👩‍💻 = é', 'circle'], ['Parent', 'Child', 'again\n日本', 'cross'], ['Child', 'Parent', 'back'], ['Child', 'Child', 'self'], ['A', 'Parent', 'leaf']], variants: [true],
  },
]

function completeText(document: TerminalDocument, glyphs: ReadonlyMap<string, string>, region: TerminalRegion, text: string): void {
  expect(region.projectedText).toBe(text)
  for (const cell of region.authoredTextCells ?? []) {
    expect(glyphs.get(`${cell.column},${cell.row}`)).toBe(cell.glyph)
    expect(document.cell(cell.column, cell.row)?.kind).toBe('text')
    if (region.kind === 'subgraph') {
      const ink = document.cell(cell.column, cell.row)!
      expect([...ink.owners, ...(ink.occludedOwners ?? [])].some(owner => owner.kind === 'edge')).toBe(false)
    }
  }
}

function relationship(document: TerminalDocument, glyphs: ReadonlyMap<string, string>, edge: TerminalRegion, from: string, to: string): void {
  expect({ from: edge.from, to: edge.to }).toEqual({ from, to })
  expect(edge.ports).toHaveLength(2)
  const start = edge.ports!.find(port => port.end === 'start')!
  const end = edge.ports!.find(port => port.end === 'end')!
  expect([start.nodeId, end.nodeId]).toEqual([from, to])
  // Traverse the actual emitted cells attributed to this relationship. Text
  // can occlude its own run, and opaque marks may retain hidden route cells.
  const covered = new Set<string>()
  for (const [x, y, cell] of document.entries()) {
    if (![...cell.owners, ...(cell.occludedOwners ?? [])].some(owner => owner.kind === 'edge' && owner.id === edge.id)) continue
    if (cell.head === x) expect(glyphs.get(`${x},${y}`)).toBe(cell.glyph)
    covered.add(`${x},${y}`)
  }
  expect(covered.size).toBeGreaterThan(0)
  const neighbors = (x: number, y: number) => [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]] as const
  const endpointInk = (x: number, y: number, id: string): boolean => {
    const cell = document.cell(x, y)
    return cell !== undefined && glyphs.get(`${x},${y}`) !== undefined && glyphs.get(`${x},${y}`) !== ' '
      && cell.kind !== 'text' && cell.kind !== 'surface'
      && cell.owners.some(owner => owner.id === id && (owner.kind === 'node' || owner.kind === 'subgraph'))
  }
  const attachments: string[][] = []
  for (const port of [start, end]) {
    expect(glyphs.get(`${port.x},${port.y}`)).toBeDefined()
    expect(glyphs.get(`${port.x},${port.y}`)).not.toBe(' ')
    expect(glyphs.get(`${port.x},${port.y}`)).toBe(document.cell(port.x, port.y)?.glyph)
    const around = neighbors(port.x, port.y)
    expect(endpointInk(port.x, port.y, port.nodeId) || around.some(([x, y]) => endpointInk(x!, y!, port.nodeId))).toBe(true)
    const ownRoute = covered.has(`${port.x},${port.y}`)
    const adjacentRoute = around.some(([x, y]) => covered.has(`${x},${y}`) && glyphs.has(`${x},${y}`) && glyphs.get(`${x},${y}`) !== ' ')
    expect(ownRoute || (endpointInk(port.x, port.y, port.nodeId) && adjacentRoute)).toBe(true)
    attachments.push([[port.x, port.y], ...around].filter(([x, y]) => covered.has(`${x},${y}`)
      && glyphs.has(`${x},${y}`) && glyphs.get(`${x},${y}`) !== ' '
      && /stroke|marker|text/.test(document.cell(x!, y!)?.kind ?? '')).map(([x, y]) => `${x},${y}`))
  }
  const queue = attachments[0]!, seen = new Set(queue)
  for (let index = 0; index < queue.length; index++) {
    const [x, y] = queue[index]!.split(',').map(Number)
    for (const [nx, ny] of neighbors(x!, y!)) {
      const key = `${nx},${ny}`
      const from = document.cell(x!, y!)!, to = document.cell(nx, ny)
      const outgoing = nx < x! ? 8 : nx > x! ? 2 : ny < y! ? 1 : 4
      const incoming = outgoing === 8 ? 2 : outgoing === 2 ? 8 : outgoing === 1 ? 4 : 1
      const fromMask = from.kind === 'stroke' ? visibleStrokePorts[from.glyph] ?? 15 : 15
      const toMask = to?.kind === 'stroke' ? visibleStrokePorts[to.glyph] ?? 15 : 15
      if (covered.has(key) && !seen.has(key) && (fromMask & outgoing) && (toMask & incoming)) { seen.add(key); queue.push(key) }
    }
  }
  expect(attachments[1]!.some(point => seen.has(point)), `physical relationship ${from}->${to}`).toBe(true)
  // A floating label may attach beside a real run without a wire into its
  // letters. Prove that semantic component only after endpoint connectivity.
  const labels = [...seen], attached = new Set(labels)
  for (let index = 0; index < labels.length; index++) {
    const [x, y] = labels[index]!.split(',').map(Number)
    for (const [nx, ny] of neighbors(x!, y!)) {
      const key = `${nx},${ny}`
      if (covered.has(key) && !attached.has(key)) { attached.add(key); labels.push(key) }
    }
  }
  for (const cell of edge.authoredTextCells ?? []) {
    expect(attached.has(`${cell.column},${cell.row}`), `label remains attached to ${from}->${to}`).toBe(true)
  }
}

function witness(
  source: string,
  useAscii: boolean,
  texts: Array<[string, string]>,
  relationships: RelationshipWitness[],
  geometry?: (document: TerminalDocument, regions: TerminalRegion[]) => void,
): void {
  const rendered = renderMermaidASCIIWithReceipt(source, { useAscii, colorMode: 'none' })
  const document = terminalDocumentOf(rendered)!
  const regions = document.regions(), glyphs = new Map<string, string>()
  // Decode emitted graphemes at terminal columns, including CJK and ZWJ emoji.
  rendered.text.split('\n').forEach((line, y) => {
    for (const cluster of measuredText(line).lines[0]!) glyphs.set(`${cluster.x},${y}`, cluster.glyph)
  })
  geometry?.(document, regions)
  for (const [id, text] of texts) {
    const region = regions.find(candidate => candidate.id === id)!
    expect(region, `owned text ${id}`).toBeDefined()
    completeText(document, glyphs, region, text)
  }
  for (const container of regions.filter(region => region.kind === 'subgraph')) {
    const left = container.canvasColStart, right = container.canvasColEnd - 1
    const top = container.canvasRow, bottom = top + (container.rowSpan ?? 1) - 1
    const perimeter = [
      ...Array.from({ length: right - left + 1 }, (_, offset) => [left + offset, top]),
      ...Array.from({ length: right - left + 1 }, (_, offset) => [left + offset, bottom]),
      ...Array.from({ length: bottom - top + 1 }, (_, offset) => [left, top + offset]),
      ...Array.from({ length: bottom - top + 1 }, (_, offset) => [right, top + offset]),
    ]
    for (const [x, y] of perimeter) {
      expect(glyphs.get(`${x},${y}`), `visible frame ${container.id}`).toBeDefined()
      expect(glyphs.get(`${x},${y}`), `opaque frame ${container.id}`).not.toBe(' ')
      expect(document.cell(x!, y!)?.kind, `frame cannot become authored text: ${container.id}`).not.toBe('text')
    }
  }
  expect(regions.filter(region => region.kind === 'edge')).toHaveLength(relationships.length)
  const remaining = regions.filter(region => region.kind === 'edge')
  for (const [from, to, text] of relationships) {
    const index = remaining.findIndex(region => region.from === from && region.to === to && (text === undefined || region.projectedText === text))
    const edge = remaining.splice(index, 1)[0]!
    expect(index).toBeGreaterThanOrEqual(0)
    expect(edge, `relationship ${from}->${to}`).toBeDefined()
    if (text !== undefined) completeText(document, glyphs, edge, text)
    relationship(document, glyphs, edge, from, to)
  }
  expect(document.diagnostics.filter(diagnostic => /COLLISION|OVERLAP/.test(diagnostic.code))).toEqual([])
}

for (const direction of ['TD', 'BT', 'LR', 'RL']) for (const useAscii of [false, true]) {
  for (const labels of [
    ['request 0', 'request 1'],
    ['request 0', 'request 1', 'request 2'],
    ['界 👩‍💻 = é', '界 👩‍💻 = é', 'long  authored  spaces'],
    ['first<br>second', '日本<br>👩‍💻 = é', 'third'],
  ]) {
    for (const reciprocal of [false, true]) {
      test(`complete parallel face/lane/label demand (${direction}/${useAscii ? 'ASCII' : 'Unicode'}, ${JSON.stringify(labels)}, return=${reciprocal})`, () => {
        const source = `flowchart ${direction}\n${labels.map(label => `A[Client] -->|${label}| B[Server]`).join('\n')}${reciprocal ? '\nB -->|reply| A' : ''}\nB -->|self| B`
        const relationships: Array<[string, string, string]> = labels.map(label => ['A', 'B', label.replaceAll('<br>', '\n')])
        if (reciprocal) relationships.push(['B', 'A', 'reply'])
        relationships.push(['B', 'B', 'self'])
        witness(source, useAscii, [['A', 'Client'], ['B', 'Server']], relationships)
      })
    }
  }
  test(`parallel container endpoints bind to real frame ports (${direction}/${useAscii ? 'ASCII' : 'Unicode'})`, () => {
    witness(`flowchart ${direction}\nsubgraph Group\nA[Inner]\nend\nGroup -->|one| B[Outside]\nGroup -->|two| B\nB -->|back| Group`, useAscii, [['Group', 'Group'], ['A', 'Inner'], ['B', 'Outside']], [['Group', 'B', 'one'], ['Group', 'B', 'two'], ['B', 'Group', 'back']])
  })
  for (const fixture of containerEndpointCases) for (const parallel of fixture.variants ?? [false, true]) test(`${fixture.name} (${direction}/${useAscii ? 'ASCII' : 'Unicode'}, parallel=${parallel})`, () => {
    const body = parallel ? fixture.body : fixture.body.split('\n').filter(line => !line.includes('-->|two|')).join('\n')
    const relationships = parallel ? fixture.relationships : fixture.relationships.filter(([, , text]) => text !== 'two')
    witness(`flowchart ${direction}\n${body}`, useAscii, fixture.texts, relationships, (document, regions) => {
      for (const edge of regions.filter(region => region.kind === 'edge')) {
        for (const port of edge.ports ?? []) {
          const endpoint = regions.find(region => region.id === port.nodeId && (region.kind === 'node' || region.kind === 'subgraph'))!
          const ink = [...document.entries()].filter(([, , cell]) => [...cell.owners, ...(cell.occludedOwners ?? [])].some(owner => owner.id === endpoint.id && owner.kind === endpoint.kind))
          const left = Math.min(...ink.map(([x]) => x)), right = Math.max(...ink.map(([x]) => x)), top = Math.min(...ink.map(([, y]) => y)), bottom = Math.max(...ink.map(([, y]) => y))
          expect(port.x === left && port.y > top && port.y < bottom || port.x === right && port.y > top && port.y < bottom
            || port.y === top && port.x > left && port.x < right || port.y === bottom && port.x > left && port.x < right).toBe(true)
        }
        const expectedRelationship = relationships.find(([from, to, text]) => edge.from === from && edge.to === to && edge.projectedText === text)!
        const shape = expectedRelationship[3]
        if (shape) for (const port of edge.ports!) {
          const dx = port.end === 'end' ? port.side === 'L' ? -1 : port.side === 'R' ? 1 : 0 : 0
          const dy = port.end === 'end' ? port.side === 'T' ? -1 : port.side === 'B' ? 1 : 0 : 0
          const marker = document.cell(port.x + dx, port.y + dy)!
          expect(marker?.kind).toBe('marker')
          expect(marker?.glyph).toBe(shape === 'circle' ? useAscii ? 'o' : '◯' : useAscii ? 'x' : '✕')
          expect(marker?.owners.some(owner => owner.kind === 'edge' && owner.id === edge.id)).toBe(true)
        }
        if (shape) continue
        const end = edge.ports!.find(port => port.end === 'end')!
        const dx = end.side === 'L' ? -1 : end.side === 'R' ? 1 : 0, dy = end.side === 'T' ? -1 : end.side === 'B' ? 1 : 0
        const marker = document.cell(end.x + dx, end.y + dy)!
        const expected = useAscii ? { T: 'v', B: '^', L: '>', R: '<' } : { T: '▼', B: '▲', L: '►', R: '◄' }
        expect(marker?.kind).toBe('marker')
        expect(marker?.glyph).toBe(expected[end.side!])
        expect(marker?.owners.some(owner => owner.kind === 'edge' && owner.id === edge.id)).toBe(true)
      }
    })
  })
  test(`multiline lane labels retain authored blank rows and attached short rows (${direction}/${useAscii ? 'ASCII' : 'Unicode'})`, () => {
    const rendered = renderMermaidASCIIWithReceipt(`flowchart ${direction}\nA -->|long  label<br><br>x| B\nA -->|other| B\nA -->|third| B\nB -->|self| B`, { useAscii, colorMode: 'none' })
    const document = terminalDocumentOf(rendered)!, glyphs = new Map<string, string>()
    rendered.text.split('\n').forEach((line, y) => {
      for (const cluster of measuredText(line).lines[0]!) glyphs.set(`${cluster.x},${y}`, cluster.glyph)
    })
    const edge = document.regions().find(region => region.kind === 'edge' && region.id === 'edge#0:A->B')!
    const rows = new Map<number, string>()
    for (const cell of edge.authoredTextCells ?? []) {
      expect(glyphs.get(`${cell.column},${cell.row}`)).toBe(cell.glyph)
      rows.set(cell.row, (rows.get(cell.row) ?? '') + cell.glyph)
    }
    expect([...rows.values()]).toEqual(['long  label', 'x'])
    const positions = [...rows.keys()]
    expect(positions[1]! - positions[0]!).toBe(2)
    expect(edge.projectedText).toBe('long  label\n\nx')
    relationship(document, glyphs, edge, 'A', 'B')
    expect(document.diagnostics).toEqual([])
  })
}

test('an obstructed physical face retains explicit summaries without fabricating route ink', () => {
  const graph = convertToAsciiGraph(parseMermaid('flowchart LR\nA -->|one| B\nA -->|two| B\nB -->|back| A'), {
    graphDirection: 'LR', paddingX: 1, paddingY: 1, boxBorderPadding: 1, useAscii: false,
  })
  createMapping(graph)
  const source = graph.nodes.find(node => node.name === 'A')!
  const x = source.drawingCoord!.x + source.drawing!.width
  graph.canvas.fill(x, source.drawingCoord!.y, 3, source.drawing!.height, { owner: { id: 'blocked-face', kind: 'label' } })
  const document = drawGraph(graph)
  expect(document.diagnostics.some(diagnostic => diagnostic.feature.startsWith('edge-lane:') && diagnostic.message.includes('physical ports'))).toBe(true)
  const edges = document.regions().filter(region => region.kind === 'edge')
  expect(edges.map(edge => edge.projectedText)).toEqual(['A --> B : one', 'A --> B : two', 'B --> A : back'])
  for (const edge of edges) {
    const feature = `graph.${edge.id}.route`
    expect(edge.ports).toHaveLength(2)
    for (const port of edge.ports!) expect(port.markerProjection).toBe(feature)
    expect(document.diagnostics).toContainEqual(expect.objectContaining({ code: 'TERMINAL_FAMILY_PROJECTION', feature }))
  }
  expect([...document.entries()].filter(([, , cell]) => cell.owners.some(owner => owner.kind === 'edge')).every(([, , cell]) => cell.kind === 'text')).toBe(true)
  expect(() => document.assertMarkers()).not.toThrow()
  expect(certifyTerminalLayout(document, document.serialize(), 'none').status).toBe('failed')
})

test('joint approach admission retains explicit summaries for rejected nested corridors', () => {
  const graph = convertToAsciiGraph(parseMermaid('flowchart TD\nsubgraph P\nsubgraph C\nA\nend\nend\nP -->|one| C\nP -->|two<br>x| C\nC -->|back| P'), {
    graphDirection: 'TD', paddingX: 5, paddingY: 5, boxBorderPadding: 1, useAscii: false,
  })
  createMapping(graph)
  const parent = graph.subgraphs.find(group => group.id === 'P')!, child = graph.subgraphs.find(group => group.id === 'C')!
  // Reintroduce the old two-cell content inset at the native layout boundary.
  parent.maxX = child.maxX + 2
  const document = drawGraph(graph)
  const rejected = document.diagnostics.filter(diagnostic => diagnostic.feature.startsWith('edge-approach:'))
  expect(rejected).toHaveLength(2)
  const summaries: Record<string, string> = { 'edge#0:P->C': 'P --> C : one', 'edge#1:P->C': 'P --> C : two\nx', 'edge#2:C->P': 'C --> P : back' }
  for (const diagnostic of rejected) {
    expect(diagnostic.code).toBe('TERMINAL_GEOMETRY_COLLISION')
    const id = diagnostic.feature.slice('edge-approach:'.length)
    const edge = document.regions().find(region => region.kind === 'edge' && region.id === id)!
    expect(edge.projectedText).toBe(summaries[id])
    expect(document.diagnostics).toContainEqual(expect.objectContaining({ code: 'TERMINAL_FAMILY_PROJECTION', feature: `graph.${id}.route` }))
    expect([...document.entries()].filter(([, , cell]) => cell.owners.some(owner => owner.kind === 'edge' && owner.id === id)).every(([, , cell]) => cell.kind === 'text' || cell.kind === 'surface')).toBe(true)
  }
  expect(() => document.assertMarkers()).not.toThrow()
  expect(certifyTerminalLayout(document, document.serialize(), 'none').status).toBe('failed')
})

for (const direction of ['TD', 'BT', 'LR', 'RL'] as const) for (const useAscii of [false, true]) {
  const mode = `${direction}/${useAscii ? 'ASCII' : 'Unicode'}`
  test(`incoming relationships bypass complete container headers (${mode})`, () => {
    witness(`flowchart ${direction}
X
subgraph one
  A --> B
end
Y
X --> A
B --> Y`, useAscii, [['X', 'X'], ['A', 'A'], ['B', 'B'], ['Y', 'Y'], ['one', 'one']], [['A', 'B'], ['X', 'A'], ['B', 'Y']])
  })

  test(`nested empty container headers coexist with their attached relationship (${mode})`, () => {
    witness(`flowchart ${direction}
subgraph Parent[Empty parent]
  subgraph Empty[Nothing here]
  end
end
A[Start] --> Empty`, useAscii, [['A', 'Start'], ['Parent', 'Empty parent'], ['Empty', 'Nothing here']], [['A', 'Empty']])
  })

  test(`reciprocal relationship labels preserve both complete routes (${mode})`, () => {
    witness(`flowchart ${direction}
A -->|down| B
B -->|up| A`, useAscii, [['A', 'A'], ['B', 'B']], [['A', 'B', 'down'], ['B', 'A', 'up']])
  })

  test(`relationship labels between containers fit without erasing their frames (${mode})`, () => {
    witness(`flowchart ${direction}
subgraph one
  A -->|sends| B
end
subgraph two
  C -->|receives| D
end
B -->|data| C`, useAscii, [['A', 'A'], ['B', 'B'], ['C', 'C'], ['D', 'D'], ['one', 'one'], ['two', 'two']], [['A', 'B', 'sends'], ['C', 'D', 'receives'], ['B', 'C', 'data']])
  })
}

for (const depth of [2, 4]) for (const direction of ['TD', 'BT', 'LR', 'RL'] as const) for (const useAscii of [false, true]) {
  test(`nested measured frames exclude the outside node (depth=${depth}, ${direction}/${useAscii ? 'ASCII' : 'Unicode'})`, () => {
    const groups = Array.from({ length: depth }, (_, index) => `subgraph G${index}[Group ${index} 日本]`)
    const source = `flowchart ${direction}
${groups.join('\n')}
A[日本語 👩‍💻 long label] -->|handoff labels| B[Wide terminal label]
${Array(depth).fill('end').join('\n')}
B --> C[Finish]`
    witness(source, useAscii, [
      ['A', '日本語 👩‍💻 long label'], ['B', 'Wide terminal label'], ['C', 'Finish'],
      ...groups.map((_, index): [string, string] => [`G${index}`, `Group ${index} 日本`]),
    ], [['A', 'B', 'handoff labels'], ['B', 'C']], (document, regions) => {
      const bounds = (id: string, kind: 'node' | 'subgraph') => {
        // Use the actual occupied footprint, including card borders and padding;
        // projected text bounds alone can conceal an external card crossing a frame.
        const cells = [...document.entries()].filter(([, , cell]) =>
          [...cell.owners, ...(cell.occludedOwners ?? [])].some(owner => owner.id === id && owner.kind === kind))
        expect(cells.length).toBeGreaterThan(0)
        return {
          left: Math.min(...cells.map(([x]) => x)), right: Math.max(...cells.map(([x]) => x)),
          top: Math.min(...cells.map(([, y]) => y)), bottom: Math.max(...cells.map(([, y]) => y)),
        }
      }
      const contains = (outer: ReturnType<typeof bounds>, inner: ReturnType<typeof bounds>): void => {
        expect(inner.left).toBeGreaterThan(outer.left)
        expect(inner.right).toBeLessThan(outer.right)
        expect(inner.top).toBeGreaterThan(outer.top)
        expect(inner.bottom).toBeLessThan(outer.bottom)
      }
      const outside = bounds('C', 'node')
      expect(regions.find(region => region.id === 'C')?.parentId).toBeUndefined()
      for (let index = 0; index < depth; index++) {
        const frame = bounds(`G${index}`, 'subgraph')
        expect(outside.right < frame.left || outside.left > frame.right || outside.bottom < frame.top || outside.top > frame.bottom,
          `external card C must not intersect G${index}`).toBe(true)
        if (index + 1 < depth) contains(frame, bounds(`G${index + 1}`, 'subgraph'))
        else for (const id of ['A', 'B']) contains(frame, bounds(id, 'node'))
      }
    })
  })
}

for (const useAscii of [false, true]) for (const connected of [false, true]) for (const labeled of [false, true]) {
  test(`contact conflicts retain an unrelated shared routing unit (ASCII=${useAscii}, connected=${connected}, labeled=${labeled})`, () => {
    for (const returnEdge of ['', '\nY --> X']) {
      const fanout = labeled ? 'S -->|one| A\nS -->|two| B\nS -->|three| C' : 'S --> A\nS --> B\nS --> C'
      const source = `flowchart TD\n${fanout}\n${connected ? 'C --> X\n' : ''}X --> Y${returnEdge}`
      const relationships: RelationshipWitness[] = [
        ['S', 'A', labeled ? 'one' : undefined], ['S', 'B', labeled ? 'two' : undefined], ['S', 'C', labeled ? 'three' : undefined],
        ...(connected ? [['C', 'X'] as RelationshipWitness] : []), ['X', 'Y'], ...(returnEdge ? [['Y', 'X'] as RelationshipWitness] : []),
      ]
      witness(source, useAscii, ['S', 'A', 'B', 'C', 'X', 'Y'].map(id => [id, id]), relationships, document => {
        const shared = [...document.entries()].filter(([, , cell]) => cell.kind === 'stroke' && cell.owners.filter(owner => owner.kind === 'edge' && owner.from === 'S').length > 1)
        expect(shared.length, 'retained fan-out must still paint shared owned ink').toBeGreaterThan(0)
        for (const [, , cell] of shared) {
          const owners = cell.owners.filter(owner => owner.kind === 'edge')
          expect(owners.every(owner => owner.bundle === owners[0]!.bundle && owner.bundle !== undefined)).toBe(true)
        }
      })
    }
  })
}


test('a blocked allocated group lead retains exterior marker meaning in its failed summary', () => {
  const graph = convertToAsciiGraph(parseMermaid('flowchart LR\nsubgraph G[Target]\nB[Inside]\nend\nA[Outside]\nA --> G\nA --> G'), {
    graphDirection: 'LR', paddingX: 3, paddingY: 3, boxBorderPadding: 1, useAscii: false,
  })
  createMapping(graph)
  const edge = graph.edges[0]!, group = edge.attachToSubgraph ?? edge.toSubgraph!
  const port = allocatedGraphPort(edge, false, group)!, direction = edge.endDir
  graph.canvas.fill(port.x + direction.x - 1, port.y + direction.y - 1, 1, 1, { owner: { id: 'blocked-group-lead', kind: 'label' } })
  const document = drawGraph(graph), region = document.regions().find(region => region.id === 'edge#0:A->G')!
  expect(region.ports!.find(port => port.end === 'end')).toMatchObject({ nodeId: 'G', markerOffset: 1, markerProjection: `graph.${region.id}.route` })
  expect(document.diagnostics).toContainEqual(expect.objectContaining({ code: 'TERMINAL_GEOMETRY_COLLISION', feature: `edge-lane:${region.id}` }))
  expect(certifyTerminalLayout(document, document.serialize(), 'none').status).toBe('failed')
})
