import { expect, test } from 'bun:test'
import { renderMermaidASCIIWithReceipt } from '../ascii/index.ts'
import { terminalDocumentOf } from '../ascii/terminal-document.ts'

interface Bounds { left: number; top: number; right: number; bottom: number }

function completeComposition(source: string, useAscii: boolean, labels: Record<string, string>): void {
  const rendered = renderMermaidASCIIWithReceipt(source, { useAscii, colorMode: 'none' })
  const document = terminalDocumentOf(rendered)!, regions = document.regions()
  for (const [id, label] of Object.entries(labels)) {
    expect(regions.find(region => region.id === id)?.projectedText).toBe(label)
    for (const line of label.split('\n')) expect(rendered.text).toContain(line)
  }
  const cards = new Map<string, Bounds>()
  for (const [x, y, cell] of document.entries()) for (const owner of cell.owners) if (owner.kind === 'node') {
    const bounds = cards.get(owner.id) ?? { left: x, right: x, top: y, bottom: y }
    bounds.left = Math.min(bounds.left, x); bounds.right = Math.max(bounds.right, x)
    bounds.top = Math.min(bounds.top, y); bounds.bottom = Math.max(bounds.bottom, y)
    cards.set(owner.id, bounds)
  }
  const frames = regions.filter(region => region.kind === 'subgraph' || region.kind === 'cluster')
  expect([...cards.keys()].sort()).toEqual(Object.keys(labels).filter(id => !frames.some(frame => frame.id === id)).sort())
  const boundsOf = (frame: typeof frames[number]): Bounds => ({ left: frame.canvasColStart, right: frame.canvasColEnd - 1, top: frame.canvasRow, bottom: frame.canvasRow + frame.rowSpan! - 1 })
  const belongs = (id: string, parent: string): boolean => {
    let region = regions.find(region => region.id === id)
    while (region?.parentId) {
      if (region.parentId === parent) return true
      region = regions.find(candidate => candidate.id === region!.parentId)
    }
    return false
  }
  const separated = (a: Bounds, b: Bounds) => a.right < b.left || b.right < a.left || a.bottom < b.top || b.bottom < a.top
  for (const frame of frames) {
    const outer = boundsOf(frame)
    for (const [id, card] of cards) {
      if (belongs(id, frame.id)) {
        expect(card.left).toBeGreaterThan(outer.left); expect(card.right).toBeLessThan(outer.right)
        expect(card.top).toBeGreaterThan(outer.top); expect(card.bottom).toBeLessThan(outer.bottom)
      } else expect(separated(outer, card), `outside card ${id} must clear frame ${frame.id}`).toBe(true)
    }
    for (const other of frames) if (other !== frame && !belongs(frame.id, other.id) && !belongs(other.id, frame.id)) {
      expect(separated(outer, boundsOf(other)), `sibling frames ${frame.id}/${other.id}`).toBe(true)
    }
    for (let x = outer.left; x <= outer.right; x++) for (const y of [outer.top, outer.bottom]) expect(document.cell(x, y)?.kind).toMatch(/stroke|marker/)
    for (let y = outer.top; y <= outer.bottom; y++) for (const x of [outer.left, outer.right]) expect(document.cell(x, y)?.kind).toMatch(/stroke|marker/)
  }
  for (const edge of regions.filter(region => region.kind === 'edge')) {
    expect(edge.ports).toHaveLength(2)
    const start = edge.ports!.find(port => port.end === 'start')!, end = edge.ports!.find(port => port.end === 'end')!
    const covered = new Set([...document.entries()].filter(([, , cell]) => cell.owners.some(owner => owner.kind === 'edge' && owner.id === edge.id)).map(([x, y]) => `${x},${y}`))
    for (const port of [start, end]) {
      expect([...document.entries()].some(([x, y, cell]) => Math.abs(x - port.x) + Math.abs(y - port.y) <= 1 && cell.owners.some(owner => owner.kind === 'edge' && owner.id === edge.id))).toBe(true)
      covered.add(`${port.x},${port.y}`)
    }
    const queue = [`${start.x},${start.y}`], seen = new Set(queue)
    for (let index = 0; index < queue.length; index++) {
      const [x, y] = queue[index]!.split(',').map(Number)
      for (const next of [`${x! - 1},${y}`, `${x! + 1},${y}`, `${x},${y! - 1}`, `${x},${y! + 1}`]) if (covered.has(next) && !seen.has(next)) { seen.add(next); queue.push(next) }
    }
    expect(seen.has(`${end.x},${end.y}`), `actual route ${edge.from}->${edge.to}`).toBe(true)
    for (const cell of edge.authoredTextCells ?? []) expect(seen.has(`${cell.column},${cell.row}`)).toBe(true)
  }
  expect(document.diagnostics).toEqual([])
}

for (const direction of ['TD', 'BT', 'LR', 'RL']) for (const depth of [1, 3, 5]) for (const useAscii of [false, true]) {
  test(`${direction} depth ${depth} multiline envelopes clear incoming/outgoing cards (${useAscii ? 'ASCII' : 'Unicode'})`, () => {
    const headers = Array.from({ length: depth }, (_, index) => `subgraph G${index}[Group ${index} 日本<br>Hierarchy<br>Complete]`).join('\n')
    const source = `flowchart ${direction}\nX[Start] --> A\n${headers}\nA[日本語 👩‍💻 long label] -->|handoff labels| B[Wide terminal label]\n${'end\n'.repeat(depth)}B --> C[Finish]`
    completeComposition(source, useAscii, {
      X: 'Start', A: '日本語 👩‍💻 long label', B: 'Wide terminal label', C: 'Finish',
      ...Object.fromEntries(Array.from({ length: depth }, (_, index) => [`G${index}`, `Group ${index} 日本\nHierarchy\nComplete`])),
    })
  })
}

for (const direction of ['TD', 'BT', 'LR', 'RL']) for (const depth of [3, 5]) for (const useAscii of [false, true]) {
  test(`${direction} sibling depth ${depth} envelopes stay disjoint (${useAscii ? 'ASCII' : 'Unicode'})`, () => {
    const headers = (prefix: string) => Array.from({ length: depth }, (_, index) => `subgraph ${prefix}${index}[${prefix} group ${index} 日本]`).join('\n')
    const source = `flowchart ${direction}\n${headers('L')}\nA[Left start] --> B[Left finish]\n${'end\n'.repeat(depth)}${headers('R')}\nR[Right start] --> S[Right finish]\n${'end\n'.repeat(depth)}B -->|handoff| R\nS --> C[Finish]`
    completeComposition(source, useAscii, {
      A: 'Left start', B: 'Left finish', R: 'Right start', S: 'Right finish', C: 'Finish',
      ...Object.fromEntries(['L', 'R'].flatMap(prefix => Array.from({ length: depth }, (_, index) => [`${prefix}${index}`, `${prefix} group ${index} 日本`]))),
    })
  })
}

test.each(['TD', 'BT', 'LR', 'RL'])('%s places an interleaved nonmember outside its unrelated inner frame', direction => {
  for (const useAscii of [false, true]) {
    const source = `flowchart ${direction}\nsubgraph Outer\nsubgraph Inner\nA[First]\nB[Last]\nend\nX[Outside]\nend\nA --> X --> B`
    completeComposition(source, useAscii, { A: 'First', B: 'Last', X: 'Outside', Inner: 'Inner', Outer: 'Outer' })
  }
})

for (const direction of ['TD', 'BT', 'LR', 'RL']) for (const useAscii of [false, true]) {
  test(`${direction} child direction overrides preserve atomic membership (${useAscii ? 'ASCII' : 'Unicode'})`, () => {
    const childDirection = direction === 'LR' || direction === 'RL' ? 'TD' : 'LR'
    completeComposition(`flowchart ${direction}\nsubgraph Outer[Outer 日本]\nsubgraph Inner[Inner 👩‍💻]\ndirection ${childDirection}\nA[First]\nB[Last]\nend\nX[Outside]\nend\nsubgraph Sibling\nC[Sibling card]\nend\nA --> X --> B\nX --> C`, useAscii, {
      A: 'First', B: 'Last', X: 'Outside', C: 'Sibling card', Inner: 'Inner 👩‍💻', Outer: 'Outer 日本', Sibling: 'Sibling',
    })
  })
  test(`${direction} an unconnected empty child retains its own measured position (${useAscii ? 'ASCII' : 'Unicode'})`, () => {
    completeComposition(`flowchart ${direction}\nsubgraph Outer\nsubgraph Inner\nA[First]\nB[Last]\nsubgraph Empty[Unused 日本]\nend\nend\nX[Outside]\nend\nA --> X --> B`, useAscii, {
      A: 'First', B: 'Last', X: 'Outside', Inner: 'Inner', Outer: 'Outer', Empty: 'Unused 日本',
    })
  })
}

for (const direction of ['TD', 'BT', 'LR', 'RL']) for (const useAscii of [false, true]) {
  test(`${direction} State compound membership shares complete relationship capacity (${useAscii ? 'ASCII' : 'Unicode'})`, () => {
    completeComposition(`stateDiagram-v2\ndirection ${direction}\nstate Outer {\nstate Inner {\nstate "First" as A\nstate "Last" as B\n}\nstate "Outside" as X\n}\nA --> X: one\nA --> X: two\nX --> A: return\nX --> B: back\nB --> B: self`, useAscii, { A: 'First', B: 'Last', X: 'Outside', Inner: 'Inner', Outer: 'Outer' })
  })
}
