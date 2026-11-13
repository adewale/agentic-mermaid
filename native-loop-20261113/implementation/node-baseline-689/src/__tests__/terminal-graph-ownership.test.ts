import { expect, test } from 'bun:test'
import { renderMermaidASCIIWithReceipt } from '../ascii/index.ts'
import { terminalDocumentOf, type TerminalDocument, type TerminalRegion } from '../ascii/terminal-document.ts'
import { renderMermaidASCIIWithMeta } from '../ascii/meta.ts'

function connectedRelationship(document: TerminalDocument, edge: TerminalRegion): void {
  // Inline labels replace wire cells, including spaces and wide-cell continuations.
  const authoredText = new Set(edge.authoredTextCells!.flatMap(cell =>
    Array.from({ length: document.cell(cell.column, cell.row)!.width }, (_, offset) => `${cell.column + offset},${cell.row}`)))
  const strokePorts: Record<string, number> = {
    '─': 10, '━': 10, '═': 10, '┄': 10, '┈': 10, '╌': 10, '-': 10, '=': 10, '.': 10,
    '│': 5, '┃': 5, '║': 5, '┆': 5, '┊': 5, '╎': 5, '|': 5, ':': 5,
    '┌': 6, '┐': 12, '└': 3, '┘': 9, '┬': 14, '┴': 11, '├': 7, '┤': 13, '┼': 15, '+': 15,
    '╭': 6, '╮': 12, '╰': 3, '╯': 9, '╔': 6, '╗': 12, '╚': 3, '╝': 9,
    '╴': 8, '╵': 1, '╶': 2, '╷': 4,
  }
  const portsAt = (x: number, y: number) => {
    const cell = document.cell(x, y)
    if (cell?.kind === 'stroke') return strokePorts[cell.glyph] ?? 0
    if (cell?.kind === 'marker' && cell.glyph.trim()) return 15
    return cell?.kind === 'text' && authoredText.has(`${x},${y}`) ? 15 : 0
  }
  const covered = new Set([...document.entries()].filter(([x, y, cell]) => portsAt(x, y) && cell.owners.some(owner => owner.kind === 'edge' && owner.id === edge.id)).map(([x, y]) => `${x},${y}`))
  const start = edge.ports!.find(port => port.end === 'start')!, end = edge.ports!.find(port => port.end === 'end')!
  const attachments = [start, end].map(port => {
    const nearby = [[port.x, port.y], [port.x - 1, port.y], [port.x + 1, port.y], [port.x, port.y - 1], [port.x, port.y + 1]]
      .filter(([x, y]) => covered.has(`${x},${y}`) && /stroke|marker/.test(document.cell(x!, y!)?.kind ?? ''))
      .map(([x, y]) => `${x},${y}`)
    expect(nearby.length, `actual route adjacent to ${port.nodeId}`).toBeGreaterThan(0)
    return nearby
  })
  const pending = attachments[0]!, seen = new Set(pending)
  for (let index = 0; index < pending.length; index++) {
    const [x, y] = pending[index]!.split(',').map(Number)
    for (const [dx, dy, outward, inward] of [[-1, 0, 8, 2], [1, 0, 2, 8], [0, -1, 1, 4], [0, 1, 4, 1]] as const) {
      const nx = x! + dx, ny = y! + dy, next = `${nx},${ny}`
      if (covered.has(next) && !seen.has(next) && (portsAt(x!, y!) & outward) && (portsAt(nx, ny) & inward)) { seen.add(next); pending.push(next) }
    }
  }
  expect(attachments[1]!.some(point => seen.has(point))).toBe(true)
  // Labels can sit beside a route without a drawn junction. Only authored
  // text may extend the directionally connected endpoint route.
  const labeled = [...seen], attachedText = new Set(labeled)
  for (let index = 0; index < labeled.length; index++) {
    const [x, y] = labeled[index]!.split(',').map(Number)
    for (const next of [`${x! - 1},${y}`, `${x! + 1},${y}`, `${x},${y! - 1}`, `${x},${y! + 1}`]) {
      if (authoredText.has(next) && covered.has(next) && !attachedText.has(next)) { attachedText.add(next); labeled.push(next) }
    }
  }
  for (const cell of edge.authoredTextCells!) expect(attachedText.has(`${cell.column},${cell.row}`)).toBe(true)
}

test('BT keeps complete ragged multiline card labels and their opaque surfaces', () => {
  const rendered = renderMermaidASCIIWithReceipt('flowchart BT\nA["ab<br>x"] --> B[Other]', { colorMode: 'none' })
  const doc = terminalDocumentOf(rendered)!
  expect(doc.regions().find(region => region.id === 'A')?.projectedText).toBe('ab\nx')
  expect(rendered.text).toContain('ab')
  expect(doc.diagnostics).toEqual([])
})

test.each(['TD', 'BT', 'LR', 'RL'] as const)('opaque edge-label spaces survive real %s routes (#157)', direction => {
  for (const useAscii of [false, true]) {
    const { ascii, regions } = renderMermaidASCIIWithMeta(`graph ${direction}\nA -->|push = build| B`, { useAscii, colorMode: 'none' })
    expect(ascii).toContain('push = build')
    const edge = regions.find(region => region.kind === 'edge')!
    expect(edge.projectedText).toBe('push = build')
    for (const cell of edge.authoredTextCells!) expect(ascii.split('\n')[cell.row]![cell.column]).toBe(cell.glyph)
  }
})

test.each(['TD', 'BT'] as const)('relocated %s relationship labels retain measured graphemes, authored spaces and color', direction => {
  for (const useAscii of [false, true]) {
    const label = '界 👩‍💻 = build'
    const rendered = renderMermaidASCIIWithReceipt(`flowchart ${direction}\nA -->|${label}| B\nB -->|戻る| A\nlinkStyle 0 color:#00ffff`, { useAscii, colorMode: 'none' })
    const document = terminalDocumentOf(rendered)!
    const edge = document.regions().find(region => region.kind === 'edge' && region.from === 'A')!
    expect(rendered.text).toContain(label)
    expect(rendered.text).toContain('戻る')
    expect(rendered.text).not.toContain('\0')
    expect(edge.projectedText).toBe(label)
    expect(edge.authoredTextCells!.filter(cell => cell.glyph === ' ')).toHaveLength(3)
    for (const authored of edge.authoredTextCells!) {
      const cell = document.cell(authored.column, authored.row)!
      expect(cell.glyph).toBe(authored.glyph)
      expect(cell.color).toBe('#00ffff')
      expect(cell.owners.map(owner => owner.id)).toEqual([edge.id])
    }
    connectedRelationship(document, edge)
    expect(document.diagnostics).toEqual([])
  }
})

for (const direction of ['TD', 'BT', 'LR', 'RL'] as const) for (const length of [50, 80]) for (const useAscii of [false, true]) {
  test(`${direction} places ${length}-cell reciprocal labels beside their actual routes (${useAscii ? 'ASCII' : 'Unicode'})`, () => {
    const label = 'a'.repeat(length)
    const rendered = renderMermaidASCIIWithReceipt(`flowchart ${direction}\nA -->|${label}| B\nB -->|return| A`, { useAscii, colorMode: 'none' })
    const document = terminalDocumentOf(rendered)!
    expect(rendered.text).toContain(label)
    expect(rendered.text).toContain('return')
    const edges = document.regions().filter(region => region.kind === 'edge')
    expect(edges.map(edge => edge.projectedText).sort()).toEqual([label, 'return'])
    for (const edge of edges) connectedRelationship(document, edge)
    expect(document.diagnostics).toEqual([])
  })
}

test.each([
  'graph TD\nA -->|push = build| B\nA --> C',
  'graph LR\nA -->|push = build| C\nB --> C',
])('opaque edge-label spaces survive beside another branch: %s', source => {
  expect(renderMermaidASCIIWithMeta(source, { colorMode: 'none' }).ascii).toContain('push = build')
})

test.each(['TD', 'BT', 'LR', 'RL'] as const)('%s preserves text, physical ports and marker direction', direction => {
  const result = renderMermaidASCIIWithReceipt(`flowchart ${direction}\n A["< > ^ v 界"] --> B["< > ^ v 界"]`, { colorMode: 'none' })
  const doc = terminalDocumentOf(result)!
  const regions = doc.regions()
  for (const id of ['A', 'B']) expect(regions.find(region => region.id === id)?.projectedText).toBe('< > ^ v 界')
  const edge = regions.find(region => region.kind === 'edge')!
  expect(edge).toMatchObject({ from: 'A', to: 'B' })
  expect(edge.ports?.map(port => [port.nodeId, port.end])).toEqual([['A', 'start'], ['B', 'end']])
  const markers = [...doc.entries()].filter(([, , cell]) => cell.kind === 'marker' && cell.owners.some(owner => owner.id === edge.id))
  expect(markers.map(([, , cell]) => cell.glyph)).toEqual([{ TD: '▼', BT: '▲', LR: '►', RL: '◄' }[direction]])
  for (const port of edge.ports!) {
    expect(port.x).toBeGreaterThanOrEqual(0)
    expect(port.y).toBeGreaterThanOrEqual(0)
    const nodeInk = [...doc.entries()].filter(([, , cell]) => cell.owners.some(owner => owner.id === port.nodeId && owner.kind === 'node'))
    expect(nodeInk.some(([x, y]) => Math.abs(x - port.x) + Math.abs(y - port.y) <= 1)).toBe(true)
  }
  expect(doc.diagnostics).toEqual([])
})

test.each([false, true])('complete tall/wide nested headers own their text and contain their children (ASCII=%s)', useAscii => {
  const source = `flowchart LR
subgraph Outer["One<br>Two<br>Three<br>Four<br>Five"]
 subgraph Inner["A complete wide group header"]
  A[Node]
 end
end`
  const result = renderMermaidASCIIWithMeta(source, { useAscii, colorMode: 'none' })
  const outer = result.regions.find(region => region.id === 'Outer')!
  const inner = result.regions.find(region => region.id === 'Inner')!
  const node = result.regions.find(region => region.id === 'A')!
  expect(outer.projectedText).toBe('One\nTwo\nThree\nFour\nFive')
  expect(inner.projectedText).toBe('A complete wide group header')
  expect(inner.parentId).toBe('Outer')
  expect(node.parentId).toBe('Inner')
  for (const [parent, child] of [[outer, inner], [inner, node]] as const) {
    expect(child.canvasRow).toBeGreaterThan(parent.canvasRow)
    expect(child.canvasColStart).toBeGreaterThan(parent.canvasColStart)
    expect(child.canvasColEnd).toBeLessThan(parent.canvasColEnd)
    expect(child.canvasRow + (child.rowSpan ?? 1)).toBeLessThan(parent.canvasRow + parent.rowSpan!)
  }
  expect(result.warnings.filter(warning => /COLLISION|OVERLAP/.test(warning.code))).toEqual([])
})

test('empty and nested empty containers have real frames and attributable links without phantom nodes', () => {
  const result = renderMermaidASCIIWithMeta(`flowchart TD
subgraph Parent[Empty parent]
 subgraph Empty[Nothing here]
 end
end
A[Start] --> Empty`, { colorMode: 'none' })
  expect(result.ascii).toContain('Empty parent')
  expect(result.ascii).toContain('Nothing here')
  expect(result.regions.filter(region => region.kind === 'node').map(region => region.id)).toEqual(['A'])
  const empty = result.regions.find(region => region.id === 'Empty')!
  expect(empty).toMatchObject({ parentId: 'Parent', members: [] })
  expect(empty.ownedCellSpans!.length).toBeGreaterThan(2)
  expect(result.regions.find(region => region.kind === 'edge')).toMatchObject({ from: 'A', to: 'Empty', ports: [{ nodeId: 'A', end: 'start' }, { nodeId: 'Empty', end: 'end' }] })
})

test('authored node/link paints use typed cells and separate incompatible bundles', () => {
  const result = renderMermaidASCIIWithReceipt(`flowchart TD
A[Start] -->|first| B[Finish]
A -->|second| C[Finish]
classDef hot color:#ff0000,stroke:#00ff00
class A hot
style A color:#0000ff,fill:#f00
linkStyle 0 stroke:#ff00ff,color:#00ffff
linkStyle 1 stroke:#ffff00`, { colorMode: 'truecolor' })
  const doc = terminalDocumentOf(result)!
  const cells = [...doc.entries()].map(([, , cell]) => cell)
  expect(cells.filter(cell => cell.owners.some(owner => owner.kind === 'node' && owner.id === 'A') && cell.kind === 'text').every(cell => cell.color === '#0000ff')).toBe(true)
  expect(cells.some(cell => cell.owners.some(owner => owner.id === 'A') && cell.kind === 'stroke' && cell.color === '#00ff00')).toBe(true)
  expect(cells.some(cell => cell.owners.some(owner => owner.id === 'edge#0:A->B') && cell.kind === 'text' && cell.color === '#00ffff')).toBe(true)
  expect(cells.some(cell => cell.owners.some(owner => owner.id === 'edge#1:A->C') && cell.kind === 'stroke' && cell.color === '#ffff00')).toBe(true)
  expect(result.text).toContain('\x1b[38;2;0;0;255m')
  const projection = expect.objectContaining({ code: 'TERMINAL_FAMILY_PROJECTION', feature: 'node:A:style:fill' })
  expect(doc.diagnostics).toContainEqual(projection)
  expect(result.terminalStyle.diagnostics).toContainEqual(projection)
  const certification = result.receipt.layoutCertification
  if (certification?.unit !== 'cell') throw new Error('Expected terminal cell certification')
  expect(certification.projections).toContainEqual(expect.objectContaining({ feature: 'node:A:style:fill' }))
  expect(doc.regions().filter(region => region.kind === 'edge').every(region => region.bundle === undefined)).toBe(true)
})

test.each(['TB', 'BT'] as const)('state note attachments retain physical ports after %s layout', direction => {
  const result = renderMermaidASCIIWithReceipt(`stateDiagram-v2\ndirection ${direction}\nA --> B\nnote left of A : Left note\nnote right of B : Right note`, { colorMode: 'none' })
  const doc = terminalDocumentOf(result)!
  const notes = doc.regions().filter(region => region.kind === 'node' && region.annotationTarget)
  expect(notes.map(note => note.projectedText).sort()).toEqual(['Left note', 'Right note'])
  for (const note of notes) {
    const link = doc.regions().find(region => region.kind === 'edge' && region.to === note.id)!
    expect(note.parentId).toBeUndefined()
    expect(link.from).toBe(note.annotationTarget!.id)
    expect(link.ports?.map(port => [port.nodeId, port.end])).toEqual([[note.annotationTarget!.id, 'start'], [note.id, 'end']])
    for (const port of link.ports!) {
      expect(doc.cell(port.x, port.y)?.owners.some(owner => owner.id === port.nodeId)).toBe(true)
    }
  }
})
