import { expect, test } from 'bun:test'
import { renderMermaidASCIIWithReceipt } from '../ascii/index.ts'
import { terminalDocumentOf } from '../ascii/terminal-document.ts'
import { renderMermaidASCIIWithMeta } from '../ascii/meta.ts'

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
style A color:#0000ff
linkStyle 0 stroke:#ff00ff,color:#00ffff
linkStyle 1 stroke:#ffff00`, { colorMode: 'truecolor' })
  const doc = terminalDocumentOf(result)!
  const cells = [...doc.entries()].map(([, , cell]) => cell)
  expect(cells.filter(cell => cell.owners.some(owner => owner.kind === 'node' && owner.id === 'A') && cell.kind === 'text').every(cell => cell.color === '#0000ff')).toBe(true)
  expect(cells.some(cell => cell.owners.some(owner => owner.id === 'A') && cell.kind === 'stroke' && cell.color === '#00ff00')).toBe(true)
  expect(cells.some(cell => cell.owners.some(owner => owner.id === 'edge#0:A->B') && cell.kind === 'text' && cell.color === '#00ffff')).toBe(true)
  expect(cells.some(cell => cell.owners.some(owner => owner.id === 'edge#1:A->C') && cell.kind === 'stroke' && cell.color === '#ffff00')).toBe(true)
  expect(result.text).toContain('\x1b[38;2;0;0;255m')
  expect(doc.regions().filter(region => region.kind === 'edge').every(region => region.bundle === undefined)).toBe(true)
})

test.each(['TB', 'BT'] as const)('state note attachments retain physical ports after %s layout', direction => {
  const result = renderMermaidASCIIWithReceipt(`stateDiagram-v2\ndirection ${direction}\nA --> B\nnote left of A : Left note\nnote right of B : Right note`, { colorMode: 'none' })
  const doc = terminalDocumentOf(result)!
  const notes = doc.regions().filter(region => region.kind === 'node' && region.parentId)
  expect(notes.map(note => note.projectedText).sort()).toEqual(['Left note', 'Right note'])
  for (const note of notes) {
    const link = doc.regions().find(region => region.kind === 'edge' && region.to === note.id)!
    expect(link.from).toBe(note.parentId)
    expect(link.ports?.map(port => [port.nodeId, port.end])).toEqual([[note.parentId!, 'start'], [note.id, 'end']])
    for (const port of link.ports!) {
      expect(doc.cell(port.x, port.y)?.owners.some(owner => owner.id === port.nodeId)).toBe(true)
    }
  }
})
