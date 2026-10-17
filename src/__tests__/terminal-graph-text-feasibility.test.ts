import { expect, test } from 'bun:test'
import { renderMermaidASCIIWithReceipt } from '../ascii/index.ts'
import { measuredText, terminalDocumentOf, type TerminalDocument, type TerminalRegion } from '../ascii/terminal-document.ts'

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
  const neighbors = (x: number, y: number) => [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]]
  const endpointInk = (x: number, y: number, id: string): boolean => {
    const cell = document.cell(x, y)
    return cell !== undefined && glyphs.get(`${x},${y}`) !== undefined && glyphs.get(`${x},${y}`) !== ' '
      && cell.kind !== 'text' && cell.kind !== 'surface'
      && cell.owners.some(owner => owner.id === id && (owner.kind === 'node' || owner.kind === 'subgraph'))
  }
  for (const port of [start, end]) {
    expect(glyphs.get(`${port.x},${port.y}`)).toBeDefined()
    expect(glyphs.get(`${port.x},${port.y}`)).not.toBe(' ')
    expect(glyphs.get(`${port.x},${port.y}`)).toBe(document.cell(port.x, port.y)?.glyph)
    const around = neighbors(port.x, port.y)
    expect(endpointInk(port.x, port.y, port.nodeId) || around.some(([x, y]) => endpointInk(x!, y!, port.nodeId))).toBe(true)
    const ownRoute = covered.has(`${port.x},${port.y}`)
    const adjacentRoute = around.some(([x, y]) => covered.has(`${x},${y}`) && glyphs.has(`${x},${y}`) && glyphs.get(`${x},${y}`) !== ' ')
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
  for (const [from, to, text] of relationships) {
    const edge = regions.find(region => region.kind === 'edge' && region.from === from && region.to === to)!
    expect(edge, `relationship ${from}->${to}`).toBeDefined()
    if (text !== undefined) completeText(document, glyphs, edge, text)
    relationship(document, glyphs, edge, from, to)
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
