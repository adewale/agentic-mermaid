import { expect, test } from 'bun:test'
import { renderMermaidASCIIWithReceipt } from '../ascii/index.ts'
import { terminalDocumentOf, type TerminalDocument, type TerminalRegion } from '../ascii/terminal-document.ts'

function completeText(document: TerminalDocument, lines: string[], region: TerminalRegion, text: string): void {
  expect(region.projectedText).toBe(text)
  for (const cell of region.authoredTextCells ?? []) {
    // These witnesses use one-cell authored characters and terminal glyphs.
    expect(lines[cell.row]?.[cell.column]).toBe(cell.glyph)
    expect(document.cell(cell.column, cell.row)?.kind).toBe('text')
    if (region.kind === 'subgraph') {
      const ink = document.cell(cell.column, cell.row)!
      expect([...ink.owners, ...(ink.occludedOwners ?? [])].some(owner => owner.kind === 'edge')).toBe(false)
    }
  }
}

function relationship(document: TerminalDocument, lines: string[], edge: TerminalRegion, from: string, to: string): void {
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
    expect(lines[y]?.[x]).toBe(cell.glyph)
    covered.add(`${x},${y}`)
  }
  expect(covered.size).toBeGreaterThan(0)
  const neighbors = (x: number, y: number) => [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]]
  const endpointInk = (x: number, y: number, id: string): boolean => {
    const cell = document.cell(x, y)
    return cell !== undefined && lines[y]?.[x] !== undefined && lines[y]?.[x] !== ' '
      && cell.kind !== 'text' && cell.kind !== 'surface'
      && cell.owners.some(owner => owner.id === id && (owner.kind === 'node' || owner.kind === 'subgraph'))
  }
  for (const port of [start, end]) {
    expect(lines[port.y]?.[port.x]).toBeDefined()
    expect(lines[port.y]?.[port.x]).not.toBe(' ')
    expect(lines[port.y]?.[port.x]).toBe(document.cell(port.x, port.y)?.glyph)
    const around = neighbors(port.x, port.y)
    expect(endpointInk(port.x, port.y, port.nodeId) || around.some(([x, y]) => endpointInk(x!, y!, port.nodeId))).toBe(true)
    const ownRoute = covered.has(`${port.x},${port.y}`)
    const adjacentRoute = around.some(([x, y]) => covered.has(`${x},${y}`) && lines[y!]?.[x!] !== ' ')
    expect(ownRoute || (endpointInk(port.x, port.y, port.nodeId) && adjacentRoute)).toBe(true)
    // Only a proven visible endpoint may supplement the relationship cells.
    covered.add(`${port.x},${port.y}`)
  }
  const first = `${start.x},${start.y}`, last = `${end.x},${end.y}`
  const queue = [first], seen = new Set(queue)
  for (let index = 0; index < queue.length; index++) {
    const [x, y] = queue[index]!.split(',').map(Number)
    for (const [nx, ny] of [[x! - 1, y!], [x! + 1, y!], [x!, y! - 1], [x!, y! + 1]]) {
      const key = `${nx},${ny}`
      if (covered.has(key) && !seen.has(key)) { seen.add(key); queue.push(key) }
    }
  }
  expect(seen.has(last), `physical relationship ${from}->${to}`).toBe(true)
  for (const cell of edge.authoredTextCells ?? []) {
    expect(seen.has(`${cell.column},${cell.row}`), `label remains attached to ${from}->${to}`).toBe(true)
  }
}

function witness(
  source: string,
  useAscii: boolean,
  texts: Array<[string, string]>,
  relationships: Array<[string, string, string?]>,
): void {
  const rendered = renderMermaidASCIIWithReceipt(source, { useAscii, colorMode: 'none' })
  const document = terminalDocumentOf(rendered)!
  const regions = document.regions(), lines = rendered.text.split('\n')
  for (const [id, text] of texts) {
    const region = regions.find(candidate => candidate.id === id)!
    expect(region, `owned text ${id}`).toBeDefined()
    completeText(document, lines, region, text)
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
      expect(lines[y!]?.[x!], `visible frame ${container.id}`).toBeDefined()
      expect(lines[y!]?.[x!], `opaque frame ${container.id}`).not.toBe(' ')
      expect(document.cell(x!, y!)?.kind, `frame cannot become authored text: ${container.id}`).not.toBe('text')
    }
  }
  expect(regions.filter(region => region.kind === 'edge')).toHaveLength(relationships.length)
  for (const [from, to, text] of relationships) {
    const edge = regions.find(region => region.kind === 'edge' && region.from === from && region.to === to)!
    expect(edge, `relationship ${from}->${to}`).toBeDefined()
    if (text !== undefined) completeText(document, lines, edge, text)
    relationship(document, lines, edge, from, to)
  }
  expect(document.diagnostics.filter(diagnostic => /COLLISION|OVERLAP/.test(diagnostic.code))).toEqual([])
}

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
