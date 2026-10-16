import { expect, test } from 'bun:test'
import { renderMermaidASCIIWithReceipt } from '../ascii/index.ts'
import { terminalDocumentOf, type TerminalDocument, type TerminalRegion } from '../ascii/terminal-document.ts'

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
