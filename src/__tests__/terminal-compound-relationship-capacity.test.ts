import { expect, test } from 'bun:test'
import { AsciiWidthError, renderMermaidASCIIWithReceipt } from '../ascii/index.ts'
import { renderMermaidASCIIWithMeta } from '../ascii/meta.ts'
import { terminalDocumentOf, type TerminalDocument, type TerminalRegion } from '../ascii/terminal-document.ts'

type Direction = 'TD' | 'BT' | 'LR' | 'RL'
interface Element { id: string; kind: 'node' | 'subgraph'; text: string; parent?: string }
interface Relationship { from: string; to: string; text: string; id?: string; marker?: 'circle' | 'cross' }
interface Fixture { name: string; body: string; elements: Element[]; edges: Relationship[] }
interface Bounds { left: number; right: number; top: number; bottom: number }

const fixtures: Fixture[] = [
  {
    name: 'interleaved nested membership with parallel, reciprocal and self relationships',
    body: `subgraph Outer["外側 👩‍💻<br>é header"]
subgraph Inner["内側<br>second"]
A["日本<br>👩‍💻 é"]
B[End]
end
X[Outside]
end
A -->|界 👩‍💻 = é| X
X -->|back| B
A -->|again| X
X -->|return| A
B -->|self| B`,
    elements: [
      { id: 'Outer', kind: 'subgraph', text: '外側 👩‍💻\né header' },
      { id: 'Inner', kind: 'subgraph', text: '内側\nsecond', parent: 'Outer' },
      { id: 'A', kind: 'node', text: '日本\n👩‍💻 é', parent: 'Inner' },
      { id: 'B', kind: 'node', text: 'End', parent: 'Inner' },
      { id: 'X', kind: 'node', text: 'Outside', parent: 'Outer' },
    ],
    edges: [
      { from: 'A', to: 'X', text: '界 👩‍💻 = é' }, { from: 'X', to: 'B', text: 'back' },
      { from: 'A', to: 'X', text: 'again' }, { from: 'X', to: 'A', text: 'return' },
      { from: 'B', to: 'B', text: 'self' },
    ],
  },
  {
    name: 'sibling compound boundaries with reciprocal and protected-marker relationships',
    body: `subgraph Outer[Root]
subgraph Left["Left 日本<br>👩‍💻"]
A[Left start]
B[Left finish]
end
subgraph Right["Right é<br>界"]
C[Right start]
D[Right finish]
end
end
A -->|local| B
B o--o|界 👩‍💻 = é| C
B x--x|same way| C
C -->|return| B
C -->|local| D
D -->|self| D`,
    elements: [
      { id: 'Outer', kind: 'subgraph', text: 'Root' },
      { id: 'Left', kind: 'subgraph', text: 'Left 日本\n👩‍💻', parent: 'Outer' },
      { id: 'Right', kind: 'subgraph', text: 'Right é\n界', parent: 'Outer' },
      { id: 'A', kind: 'node', text: 'Left start', parent: 'Left' },
      { id: 'B', kind: 'node', text: 'Left finish', parent: 'Left' },
      { id: 'C', kind: 'node', text: 'Right start', parent: 'Right' },
      { id: 'D', kind: 'node', text: 'Right finish', parent: 'Right' },
    ],
    edges: [
      { from: 'A', to: 'B', text: 'local' }, { from: 'B', to: 'C', text: '界 👩‍💻 = é', marker: 'circle' },
      { from: 'B', to: 'C', text: 'same way', marker: 'cross' }, { from: 'C', to: 'B', text: 'return' },
      { from: 'C', to: 'D', text: 'local' }, { from: 'D', to: 'D', text: 'self' },
    ],
  },
  {
    name: 'generated-looking authored identities and duplicate wide labels',
    body: `edge-0["日本 👩‍💻<br>é"]
edge-0-1[Server]
edge-0 edge-0@ o--o|界 👩‍💻 = é| edge-0-1
edge-0 edge-0-1@ x--x|界 👩‍💻 = é| edge-0-1
edge-0 -->|third| edge-0-1
edge-0-1 -->|戻る| edge-0
edge-0-1 -->|self| edge-0-1`,
    elements: [
      { id: 'edge-0', kind: 'node', text: '日本 👩‍💻\né' },
      { id: 'edge-0-1', kind: 'node', text: 'Server' },
    ],
    edges: [
      { id: 'edge-0', from: 'edge-0', to: 'edge-0-1', text: '界 👩‍💻 = é', marker: 'circle' },
      { id: 'edge-0-1', from: 'edge-0', to: 'edge-0-1', text: '界 👩‍💻 = é', marker: 'cross' },
      { from: 'edge-0', to: 'edge-0-1', text: 'third' }, { from: 'edge-0-1', to: 'edge-0', text: '戻る' },
      { from: 'edge-0-1', to: 'edge-0-1', text: 'self' },
    ],
  },
]

const key = (x: number, y: number) => `${x},${y}`
const neighbors = (x: number, y: number) => [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]] as const
const segmenter = new Intl.Segmenter('en', { granularity: 'grapheme' })
const visibleStrokePorts: Record<string, number> = {
  '-': 10, '|': 5, '+': 15, '─': 10, '│': 5, '┌': 6, '┐': 12, '└': 3, '┘': 9,
  '┬': 14, '┴': 11, '├': 7, '┤': 13, '┼': 15,
  '╭': 6, '╮': 12, '╰': 3, '╯': 9, '┄': 10, '┊': 5,
}

// These fixtures use CJK and one ZWJ emoji. Decode their emitted columns
// independently of the production width/measurement helpers.
function emittedColumns(output: string): { glyphs: Map<string, string>; occupied: Set<string>; width: number } {
  const glyphs = new Map<string, string>(), occupied = new Set<string>()
  let width = 0
  output.split('\n').forEach((line, y) => {
    let x = 0
    for (const { segment } of segmenter.segment(line)) {
      const cells = /[\u3000-\u9fff]|👩/u.test(segment) ? 2 : 1
      glyphs.set(key(x, y), segment)
      if (segment !== ' ') for (let offset = 0; offset < cells; offset++) occupied.add(key(x + offset, y))
      x += cells
    }
    width = Math.max(width, x)
  })
  return { glyphs, occupied, width }
}

function completeText(document: TerminalDocument, glyphs: Map<string, string>, region: TerminalRegion, text: string): void {
  expect(region.projectedText, `${region.kind}:${region.id} complete display text`).toBe(text)
  const cells = region.authoredTextCells ?? []
  expect(cells.length).toBeGreaterThan(0)
  const rows = new Map<number, string>()
  for (const cell of cells) {
    expect(glyphs.get(key(cell.column, cell.row))).toBe(cell.glyph)
    const ink = document.cell(cell.column, cell.row)!
    expect(ink.kind).toBe('text')
    expect(ink.owners.some(owner => owner.kind === region.kind && owner.id === region.id)).toBe(true)
    rows.set(cell.row, (rows.get(cell.row) ?? '') + cell.glyph)
  }
  expect([...rows.values()].join('\n')).toBe(text)
}

function occupiedBounds(document: TerminalDocument, element: Pick<Element, 'id' | 'kind'>): Bounds {
  const cells = [...document.entries()].filter(([, , cell]) => [...cell.owners, ...(cell.occludedOwners ?? [])].some(owner => owner.id === element.id && owner.kind === element.kind))
  expect(cells.length, `actual occupied footprint ${element.kind}:${element.id}`).toBeGreaterThan(0)
  return {
    left: Math.min(...cells.map(([x]) => x)), right: Math.max(...cells.map(([x]) => x)),
    top: Math.min(...cells.map(([, y]) => y)), bottom: Math.max(...cells.map(([, y]) => y)),
  }
}

function checkGeometry(document: TerminalDocument, fixture: Fixture, occupied: Set<string>): void {
  const bounds = new Map(fixture.elements.map(element => [element.id, occupiedBounds(document, element)]))
  const ancestorOf = (container: string, element: Element): boolean => {
    let parent = element.parent
    while (parent) {
      if (parent === container) return true
      parent = fixture.elements.find(candidate => candidate.id === parent)?.parent
    }
    return false
  }
  for (const frame of fixture.elements.filter(element => element.kind === 'subgraph')) {
    const outer = bounds.get(frame.id)!
    for (const element of fixture.elements) {
      if (element === frame || ancestorOf(element.id, frame)) continue
      const inner = bounds.get(element.id)!
      if (ancestorOf(frame.id, element)) {
        expect(inner.left, `${element.id} inside ${frame.id}`).toBeGreaterThan(outer.left)
        expect(inner.right).toBeLessThan(outer.right)
        expect(inner.top).toBeGreaterThan(outer.top)
        expect(inner.bottom).toBeLessThan(outer.bottom)
      } else {
        expect(inner.right < outer.left || inner.left > outer.right || inner.bottom < outer.top || inner.top > outer.bottom,
          `unrelated ${element.id} excludes ${frame.id}`).toBe(true)
      }
    }
    const perimeter = [
      ...Array.from({ length: outer.right - outer.left + 1 }, (_, offset) => [outer.left + offset, outer.top]),
      ...Array.from({ length: outer.right - outer.left + 1 }, (_, offset) => [outer.left + offset, outer.bottom]),
      ...Array.from({ length: outer.bottom - outer.top + 1 }, (_, offset) => [outer.left, outer.top + offset]),
      ...Array.from({ length: outer.bottom - outer.top + 1 }, (_, offset) => [outer.right, outer.top + offset]),
    ]
    for (const [x, y] of perimeter) {
      expect(occupied.has(key(x!, y!)), `visible frame ${frame.id}`).toBe(true)
      expect(document.cell(x!, y!)?.kind).toMatch(/stroke|marker/)
    }
  }
}

function connectedRelationship(document: TerminalDocument, glyphs: Map<string, string>, occupied: Set<string>, edge: TerminalRegion, expected: Relationship, useAscii: boolean): void {
  expect([edge.from, edge.to]).toEqual([expected.from, expected.to])
  expect(edge.ports).toHaveLength(2)
  const start = edge.ports!.find(port => port.end === 'start')!, end = edge.ports!.find(port => port.end === 'end')!
  expect([start.nodeId, end.nodeId]).toEqual([expected.from, expected.to])
  const route = new Set<string>()
  for (const [x, y, cell] of document.entries()) {
    const owners = [...cell.owners, ...(cell.occludedOwners ?? [])]
    if (!owners.some(owner => owner.kind === 'edge' && owner.id === edge.id)) continue
    expect(cell.kind).not.toBe('surface')
    if (cell.head === x) expect(glyphs.get(key(x, y))).toBe(cell.glyph)
    route.add(key(x, y))
  }
  expect(route.size).toBeGreaterThan(0)
  const attachments = [start, end].map(port => {
    const nearby = [[port.x, port.y], ...neighbors(port.x, port.y)]
    expect(nearby.some(([x, y]) => occupied.has(key(x!, y!)) && /stroke|marker/.test(document.cell(x!, y!)?.kind ?? '')
      && document.cell(x!, y!)?.owners.some(owner => owner.kind === 'node' && owner.id === port.nodeId)),
      `physical card endpoint ${port.nodeId}`).toBe(true)
    expect(occupied.has(key(port.x, port.y)), `nonblank port ${edge.id}`).toBe(true)
    const attached = nearby.filter(([x, y]) => route.has(key(x!, y!)) && occupied.has(key(x!, y!))
      && /stroke|marker/.test(document.cell(x!, y!)?.kind ?? '')).map(([x, y]) => key(x!, y!))
    expect(attached.length, `actual route adjacent to ${port.nodeId}`).toBeGreaterThan(0)
    return attached
  })
  const queue = attachments[0]!, seen = new Set(queue)
  for (let index = 0; index < queue.length; index++) {
    const [x, y] = queue[index]!.split(',').map(Number)
    for (const [nx, ny] of neighbors(x!, y!)) {
      const next = key(nx, ny)
      const from = document.cell(x!, y!)!, to = document.cell(nx, ny)
      const out = nx < x! ? 8 : nx > x! ? 2 : ny < y! ? 1 : 4
      const incoming = out === 8 ? 2 : out === 2 ? 8 : out === 1 ? 4 : 1
      const fromPorts = from.kind === 'stroke' ? visibleStrokePorts[from.glyph] ?? 15 : 15
      const toPorts = to?.kind === 'stroke' ? visibleStrokePorts[to.glyph] ?? 15 : 15
      if (route.has(next) && !seen.has(next) && (fromPorts & out) && (toPorts & incoming)) { seen.add(next); queue.push(next) }
    }
  }
  expect(attachments[1]!.some(point => seen.has(point)), `connected emitted relationship ${edge.id}`).toBe(true)
  // A label may sit beside its route; its letters need no drawn junction.
  // Its complete owned component must still meet the proven connected route.
  const labeled = [...seen], attachedText = new Set(labeled)
  for (let index = 0; index < labeled.length; index++) {
    const [x, y] = labeled[index]!.split(',').map(Number)
    for (const [nx, ny] of neighbors(x!, y!)) {
      const next = key(nx, ny)
      if (route.has(next) && !attachedText.has(next)) { attachedText.add(next); labeled.push(next) }
    }
  }
  for (const cell of edge.authoredTextCells ?? []) expect(attachedText.has(key(cell.column, cell.row)), `label attached to ${edge.id}`).toBe(true)
  if (expected.marker) for (const port of [start, end]) {
    const markerGlyph = expected.marker === 'circle' ? (useAscii ? 'o' : '◯') : (useAscii ? 'x' : '✕')
    expect([...document.entries()].some(([x, y, cell]) => Math.abs(x - port.x) + Math.abs(y - port.y) <= 1
      && occupied.has(key(x, y)) && cell.kind === 'marker' && cell.glyph === markerGlyph
      && cell.owners.some(owner => owner.kind === 'edge' && owner.id === edge.id)), `protected ${expected.marker} at ${edge.id}/${port.end}`).toBe(true)
  }
  if (!expected.marker) {
    const arrows = useAscii ? { T: 'v', B: '^', L: '>', R: '<' } : { T: '▼', B: '▲', L: '►', R: '◄' }
    expect([...document.entries()].some(([x, y, cell]) => Math.abs(x - end.x) + Math.abs(y - end.y) <= 1
      && occupied.has(key(x, y)) && cell.kind === 'marker' && cell.glyph === arrows[end.side!]
      && cell.owners.some(owner => owner.kind === 'edge' && owner.id === edge.id)), `authored arrow at ${edge.id}/end`).toBe(true)
  }
}

function witness(fixture: Fixture, direction: Direction, useAscii: boolean, targetWidth?: number): void {
  const source = `flowchart ${direction}\n${fixture.body}`, options = { useAscii, colorMode: 'none' as const, ...(targetWidth === undefined ? {} : { targetWidth }) }
  const rendered = renderMermaidASCIIWithReceipt(source, options), document = terminalDocumentOf(rendered)!
  const regions = document.regions(), { glyphs, occupied, width } = emittedColumns(rendered.text)
  if (targetWidth !== undefined) expect(width).toBeLessThanOrEqual(targetWidth)
  checkGeometry(document, fixture, occupied)
  expect(regions.filter(region => region.kind === 'node' || region.kind === 'subgraph')).toHaveLength(fixture.elements.length)
  expect(new Set(regions.map(region => JSON.stringify([region.kind, region.id]))).size).toBe(regions.length)
  for (const element of fixture.elements) {
    const region = regions.find(region => region.id === element.id && region.kind === element.kind)!
    expect(region).toBeDefined()
    expect(region.parentId).toBe(element.parent)
    expect(region.parentKind).toBe(element.parent ? 'subgraph' : undefined)
    completeText(document, glyphs, region, element.text)
  }
  const edges = regions.filter(region => region.kind === 'edge')
  expect(edges).toHaveLength(fixture.edges.length)
  const slots = new Map<string, TerminalRegion>()
  for (const edge of edges) for (const port of edge.ports ?? []) {
    const slot = JSON.stringify([port.nodeId, port.x, port.y]), prior = slots.get(slot)
    if (prior && prior.id !== edge.id) {
      expect(edge.bundle, `shared physical slot requires an allocated bundle: ${prior.id}/${edge.id}`).toBeDefined()
      expect(prior.bundle).toBe(edge.bundle)
    }
    slots.set(slot, edge)
  }
  const remaining = [...edges]
  for (const expected of fixture.edges) {
    const index = remaining.findIndex(edge => expected.id ? edge.id === expected.id : edge.from === expected.from && edge.to === expected.to && edge.projectedText === expected.text)
    expect(index, `unique authored relationship ${JSON.stringify(expected)}`).toBeGreaterThanOrEqual(0)
    const [edge] = remaining.splice(index, 1)
    completeText(document, glyphs, edge!, expected.text)
    connectedRelationship(document, glyphs, occupied, edge!, expected, useAscii)
  }
  expect(document.diagnostics).toEqual([])
  const repeated = renderMermaidASCIIWithReceipt(source, options)
  expect(repeated.text).toBe(rendered.text)
  expect(terminalDocumentOf(repeated)!.regions()).toEqual(regions)
  const metadata = renderMermaidASCIIWithMeta(source, options)
  expect(metadata.ascii).toBe(rendered.text)
  expect(metadata.warnings.filter(warning => /COLLISION|OVERLAP|UNAVAILABLE|FAILED/.test(warning.code))).toEqual([])
  expect(metadata.regions.map(({ sourceLine: _sourceLine, ...region }) => region)).toEqual(regions.map(({ sourceLine: _sourceLine, ...region }) => region))
}

for (const direction of ['TD', 'BT', 'LR', 'RL'] as const) for (const useAscii of [false, true]) {
  for (const fixture of fixtures) test(`${fixture.name} (${direction}/${useAscii ? 'ASCII' : 'Unicode'})`, () => witness(fixture, direction, useAscii))
}

test.each([false, true])('compound relationship capacity respects a generous hard width (ASCII=%s)', useAscii => {
  witness(fixtures[0]!, 'TD', useAscii, 200)
})

test.each([false, true])('wide authored text already preserves both endpoint markers (ASCII=%s)', useAscii => {
  witness({
    name: 'single-marker control',
    body: 'A[Client] o--o|界 👩‍💻 = é| B[Server]',
    elements: [{ id: 'A', kind: 'node', text: 'Client' }, { id: 'B', kind: 'node', text: 'Server' }],
    edges: [{ from: 'A', to: 'B', text: '界 👩‍💻 = é', marker: 'circle' }],
  }, 'LR', useAscii)
})

test.each([false, true])('compound relationships reject an impossible hard width (ASCII=%s)', useAscii => {
  expect(() => renderMermaidASCIIWithReceipt(`flowchart TD\n${fixtures[0]!.body}`, { useAscii, colorMode: 'none', targetWidth: 1 })).toThrow(AsciiWidthError)
})
