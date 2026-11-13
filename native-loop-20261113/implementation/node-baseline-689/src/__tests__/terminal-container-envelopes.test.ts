import { expect, test } from 'bun:test'
import { renderMermaidASCIIWithReceipt } from '../ascii/index.ts'
import { terminalDocumentOf, type TerminalDocument } from '../ascii/terminal-document.ts'

interface Bounds { left: number; top: number; right: number; bottom: number }
const strokePorts: Record<string, number> = {
  '─': 10, '━': 10, '┄': 10, '-': 10, '=': 10, '.': 10,
  '│': 5, '┃': 5, '┊': 5, '|': 5, ':': 5,
  '┌': 6, '┐': 12, '└': 3, '┘': 9, '├': 7, '┤': 13, '┬': 14, '┴': 11, '┼': 15, '+': 15,
  '╭': 6, '╮': 12, '╰': 3, '╯': 9, '╴': 8, '╵': 1, '╶': 2, '╷': 4, '┆': 5,
  '▲': 5, '▼': 5, '^': 5, 'v': 5, '◄': 10, '►': 10, '<': 10, '>': 10, '◯': 15, 'o': 15, '✕': 15, 'x': 15,
}

function completeComposition(source: string, useAscii: boolean, labels: Record<string, string>, containerIds: string[], expectedEdges: string[][]): TerminalDocument {
  const rendered = renderMermaidASCIIWithReceipt(source, { useAscii, colorMode: 'none' })
  const document = terminalDocumentOf(rendered)!, regions = document.regions()
  for (const [id, label] of Object.entries(labels)) {
    expect(regions.find(region => region.id === id)?.projectedText).toBe(label)
    for (const line of label.split('\n')) expect(rendered.text).toContain(line)
  }
  const containerKind = source.startsWith('stateDiagram-v2') ? 'cluster' : 'subgraph'
  expect(regions.filter(region => region.kind === containerKind).map(region => region.id).sort()).toEqual([...containerIds].sort())
  expect(regions.filter(region => region.kind === 'edge').map(edge => [edge.from!, edge.to!]).sort()).toEqual([...expectedEdges].sort())
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
  const cardBounds = [...cards]
  for (let index = 0; index < cardBounds.length; index++) for (let next = index + 1; next < cardBounds.length; next++) {
    const [id, first] = cardBounds[index]!, [other, second] = cardBounds[next]!
    expect(separated(first, second), `complete cards ${id}/${other} must not overlap`).toBe(true)
  }
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
    const covered = new Map([...document.entries()].filter(([, , cell]) => cell.owners.some(owner => owner.kind === 'edge' && owner.id === edge.id)).map(([x, y, cell]) => [`${x},${y}`, cell]))
    for (const port of [start, end]) {
      expect([...document.entries()].some(([x, y, cell]) => Math.abs(x - port.x) + Math.abs(y - port.y) <= 1 && cell.owners.some(owner => owner.kind === 'edge' && owner.id === edge.id))).toBe(true)
    }
    const normal = { T: [0, -1], R: [1, 0], B: [0, 1], L: [-1, 0] } as const
    const [sx, sy] = normal[start.side!], [tx, ty] = normal[end.side!]
    for (const port of [start, end]) for (const expected of port.markers ?? []) {
      const [dx, dy] = normal[port.side!], cell = document.cell(port.x + dx * (port.markerOffset ?? 0), port.y + dy * (port.markerOffset ?? 0))!
      const glyph = expected.shape === 'wide-circle' ? useAscii ? 'o' : '◯' : expected.shape === 'cross' ? useAscii ? 'x' : '✕'
        : (useAscii ? { T: 'v', R: '<', B: '^', L: '>' } : { T: '▼', R: '◄', B: '▲', L: '►' })[port.side!]
      expect(cell.kind).toBe('marker'); expect(cell.glyph).toBe(glyph); expect(cell.width).toBe(1)
      expect(cell.owners.some(owner => owner.kind === 'edge' && owner.id === edge.id)).toBe(true)
    }
    const exit = `${start.x + sx},${start.y + sy}`
    const markerX = end.x + tx * (end.markerOffset ?? 1), markerY = end.y + ty * (end.markerOffset ?? 1)
    const arrow = end.markers?.some(marker => marker.shape === 'arrow')
    const tip = `${markerX + (arrow ? tx : 0)},${markerY + (arrow ? ty : 0)}`
    if (arrow) {
      const marker = document.cell(markerX, markerY)!
      expect(marker.kind).toBe('marker')
      expect(marker.glyph).toBe((useAscii ? { T: 'v', R: '<', B: '^', L: '>' } : { T: '▼', R: '◄', B: '▲', L: '►' })[end.side!])
      expect(marker.owners.some(owner => owner.kind === 'edge' && owner.id === edge.id)).toBe(true)
    }
    expect(covered.has(exit), `owned exterior shaft ${edge.id}`).toBe(true)
    const queue = [exit], seen = new Set(queue)
    for (let index = 0; index < queue.length; index++) {
      const [x, y] = queue[index]!.split(',').map(Number)
      for (const [dx, dy, out, into] of [[0, -1, 1, 4], [1, 0, 2, 8], [0, 1, 4, 1], [-1, 0, 8, 2]]) {
        const next = `${x! + dx!},${y! + dy!}`, from = covered.get(queue[index]!)!, to = covered.get(next)
        const fromMask = from.marker?.shape === 'arrow' ? 0 : from.kind === 'text' ? 15 : strokePorts[from.glyph] ?? 0
        const toMask = to?.marker?.shape === 'arrow' ? 0 : to?.kind === 'text' ? 15 : strokePorts[to?.glyph ?? ''] ?? 0
        if (to && !seen.has(next) && (fromMask & out!) && (toMask & into!)) { seen.add(next); queue.push(next) }
      }
    }
    expect(seen.has(tip), `directionally connected emitted route ${edge.from}->${edge.to}`).toBe(true)
    // Labels can attach beside a route, after its directional endpoints are
    // proven connected; they may not float as a separate owned component.
    const authoredText = new Set((edge.authoredTextCells ?? []).flatMap(cell =>
      Array.from({ length: document.cell(cell.column, cell.row)!.width }, (_, offset) => `${cell.column + offset},${cell.row}`)))
    const attached = [...seen], labelSeen = new Set(attached)
    for (let index = 0; index < attached.length; index++) {
      const [x, y] = attached[index]!.split(',').map(Number)
      for (const next of [`${x! - 1},${y}`, `${x! + 1},${y}`, `${x},${y! - 1}`, `${x},${y! + 1}`]) {
        if (authoredText.has(next) && covered.get(next)?.kind === 'text' && !labelSeen.has(next)) { labelSeen.add(next); attached.push(next) }
      }
    }
    for (const cell of edge.authoredTextCells ?? []) expect(labelSeen.has(`${cell.column},${cell.row}`)).toBe(true)
  }
  expect(document.diagnostics).toEqual([])
  expect(rendered.receipt.layoutCertification?.status).toBe('passed')
  return document
}

for (const direction of ['TD', 'BT', 'LR', 'RL']) for (const depth of [1, 3, 5]) for (const useAscii of [false, true]) {
  test(`${direction} depth ${depth} multiline envelopes clear incoming/outgoing cards (${useAscii ? 'ASCII' : 'Unicode'})`, () => {
    const headers = Array.from({ length: depth }, (_, index) => `subgraph G${index}[Group ${index} 日本<br>Hierarchy<br>Complete]`).join('\n')
    const source = `flowchart ${direction}\nX[Start] --> A\n${headers}\nA[日本語 👩‍💻 long label] -->|handoff labels| B[Wide terminal label]\n${'end\n'.repeat(depth)}B --> C[Finish]`
    completeComposition(source, useAscii, {
      X: 'Start', A: '日本語 👩‍💻 long label', B: 'Wide terminal label', C: 'Finish',
      ...Object.fromEntries(Array.from({ length: depth }, (_, index) => [`G${index}`, `Group ${index} 日本\nHierarchy\nComplete`])),
    }, Array.from({ length: depth }, (_, index) => `G${index}`), [['X', 'A'], ['A', 'B'], ['B', 'C']])
  })
}

for (const direction of ['TD', 'BT', 'LR', 'RL']) for (const depth of [3, 5]) for (const useAscii of [false, true]) {
  test(`${direction} sibling depth ${depth} envelopes stay disjoint (${useAscii ? 'ASCII' : 'Unicode'})`, () => {
    const headers = (prefix: string) => Array.from({ length: depth }, (_, index) => `subgraph ${prefix}${index}[${prefix} group ${index} 日本]`).join('\n')
    const source = `flowchart ${direction}\n${headers('L')}\nA[Left start] --> B[Left finish]\n${'end\n'.repeat(depth)}${headers('R')}\nR[Right start] --> S[Right finish]\n${'end\n'.repeat(depth)}B -->|handoff| R\nS --> C[Finish]`
    completeComposition(source, useAscii, {
      A: 'Left start', B: 'Left finish', R: 'Right start', S: 'Right finish', C: 'Finish',
      ...Object.fromEntries(['L', 'R'].flatMap(prefix => Array.from({ length: depth }, (_, index) => [`${prefix}${index}`, `${prefix} group ${index} 日本`]))),
    }, ['L', 'R'].flatMap(prefix => Array.from({ length: depth }, (_, index) => `${prefix}${index}`)), [['A', 'B'], ['R', 'S'], ['B', 'R'], ['S', 'C']])
  })
}

test.each(['TD', 'BT', 'LR', 'RL'])('%s places an interleaved nonmember outside its unrelated inner frame', direction => {
  for (const useAscii of [false, true]) {
    const source = `flowchart ${direction}\nsubgraph Outer\nsubgraph Inner\nA[First]\nB[Last]\nend\nX[Outside]\nend\nA --> X --> B`
    completeComposition(source, useAscii, { A: 'First', B: 'Last', X: 'Outside', Inner: 'Inner', Outer: 'Outer' }, ['Outer', 'Inner'], [['A', 'X'], ['X', 'B']])
  }
})

for (const direction of ['TD', 'BT', 'LR', 'RL']) for (const useAscii of [false, true]) {
  test(`${direction} child direction overrides preserve atomic membership (${useAscii ? 'ASCII' : 'Unicode'})`, () => {
    const childDirection = direction === 'LR' || direction === 'RL' ? 'TD' : 'LR'
    completeComposition(`flowchart ${direction}\nsubgraph Outer[Outer 日本]\nsubgraph Inner[Inner 👩‍💻]\ndirection ${childDirection}\nA[First]\nB[Last]\nend\nX[Outside]\nend\nsubgraph Sibling\nC[Sibling card]\nend\nA --> X --> B\nX --> C`, useAscii, {
      A: 'First', B: 'Last', X: 'Outside', C: 'Sibling card', Inner: 'Inner 👩‍💻', Outer: 'Outer 日本', Sibling: 'Sibling',
    }, ['Outer', 'Inner', 'Sibling'], [['A', 'X'], ['X', 'B'], ['X', 'C']])
  })
  test(`${direction} an unconnected empty child retains its own measured position (${useAscii ? 'ASCII' : 'Unicode'})`, () => {
    completeComposition(`flowchart ${direction}\nsubgraph Outer\nsubgraph Inner\nA[First]\nB[Last]\nsubgraph Empty[Unused 日本]\nend\nend\nX[Outside]\nend\nA --> X --> B`, useAscii, {
      A: 'First', B: 'Last', X: 'Outside', Inner: 'Inner', Outer: 'Outer', Empty: 'Unused 日本',
    }, ['Outer', 'Inner', 'Empty'], [['A', 'X'], ['X', 'B']])
  })
}

for (const direction of ['TD', 'BT', 'LR', 'RL']) for (const useAscii of [false, true]) {
  test(`${direction} State compound membership shares complete relationship capacity (${useAscii ? 'ASCII' : 'Unicode'})`, () => {
    completeComposition(`stateDiagram-v2\ndirection ${direction}\nstate Outer {\nstate Inner {\nstate "First" as A\nstate "Last" as B\n}\nstate "Outside" as X\n}\nA --> X: one\nA --> X: two\nX --> A: return\nX --> B: back\nB --> B: self`, useAscii, { A: 'First', B: 'Last', X: 'Outside', Inner: 'Inner', Outer: 'Outer' }, ['Outer', 'Inner'], [['A', 'X'], ['A', 'X'], ['X', 'A'], ['X', 'B'], ['B', 'B']])
  })
}

for (const useAscii of [false, true]) {
  test(`mixed nested directions separate several shared-track envelopes (${useAscii ? 'ASCII' : 'Unicode'})`, () => {
    const groups = [0, 1, 2].map(group => `${Array.from({ length: group + 1 }, (_, depth) => `subgraph G${group}_${depth}[Group ${group} ${depth} 日本]`).join('\n')}
direction ${group === 2 ? 'TD' : 'LR'}
N${group}_0[Card ${group} start${group === 2 ? ' wide 日本語 label' : ''}]
N${group}_1[Card ${group} middle${group === 2 ? ' wide 日本語 label' : ''}]
N${group}_2[Card ${group} finish${group === 2 ? ' wide 日本語 label' : ''}]
${'end\n'.repeat(group + 1)}`).join('\n')
    completeComposition(`flowchart LR
${groups}
N1_0 --> N2_0
N2_1 --> N2_2
N2_0 --> N2_1
N0_0 --> N1_2
N1_1 --> N1_2
N1_0 --> N1_1
N0_1 --> N0_2
N0_0 --> N0_1`, useAscii, Object.fromEntries([0, 1, 2].flatMap(group => [
      ...Array.from({ length: group + 1 }, (_, depth) => [`G${group}_${depth}`, `Group ${group} ${depth} 日本`]),
      ...['start', 'middle', 'finish'].map((position, index) => [`N${group}_${index}`, `Card ${group} ${position}${group === 2 ? ' wide 日本語 label' : ''}`]),
    ])), [0, 1, 2].flatMap(group => Array.from({ length: group + 1 }, (_, depth) => `G${group}_${depth}`)), [
      ['N1_0', 'N2_0'], ['N2_1', 'N2_2'], ['N2_0', 'N2_1'], ['N0_0', 'N1_2'],
      ['N1_1', 'N1_2'], ['N1_0', 'N1_1'], ['N0_1', 'N0_2'], ['N0_0', 'N0_1'],
    ])
  })
  test(`subgraph contacts preserve connected owned routes when labels bend (${useAscii ? 'ASCII' : 'Unicode'})`, () => {
    completeComposition(`flowchart LR
outside --> subgraph1
subgraph subgraph1
inner1 --> inner2
end`, useAscii, { outside: 'outside', subgraph1: 'subgraph1', inner1: 'inner1', inner2: 'inner2' }, ['subgraph1'], [['outside', 'subgraph1'], ['inner1', 'inner2']])
    completeComposition(`flowchart LR
A -.->|load| Cluster
subgraph Cluster
direction TB
In --> Work --> Out
end
Cluster ==> Done`, useAscii, { A: 'A', Cluster: 'Cluster', In: 'In', Work: 'Work', Out: 'Out', Done: 'Done' }, ['Cluster'], [['A', 'Cluster'], ['In', 'Work'], ['Work', 'Out'], ['Cluster', 'Done']])
  })
}

for (const direction of ['TD', 'BT', 'LR', 'RL']) for (const useAscii of [false, true]) {
  test(`${direction} selected approaches clear wide sibling cards and complete nested headers (${useAscii ? 'ASCII' : 'Unicode'})`, () => {
    for (const [link, shape] of [['-->', 'arrow'], ['<-->', 'arrow'], ['o--o', 'wide-circle'], ['x--x', 'cross']] as const) {
      const document = completeComposition(`flowchart ${direction}
subgraph Outer[Outer 日本<br>complete]
subgraph Inner[Inner 👩‍💻]
direction TD
A[First 界界👩‍💻 é]
B[Last]
end
X[Outside wide track 日本語]
end
subgraph Sibling[Sibling é<br>wide 日本]
C[Sibling card]
end
A -->|one界| X
A -->|two| X
X -->|return| A
X ${link}|back| B
X -->|branch| C
B -->|self| B`, useAscii, { Outer: 'Outer 日本\ncomplete', Inner: 'Inner 👩‍💻', Sibling: 'Sibling é\nwide 日本', A: 'First 界界👩‍💻 é', B: 'Last', X: 'Outside wide track 日本語', C: 'Sibling card' }, ['Outer', 'Inner', 'Sibling'], [['A', 'X'], ['A', 'X'], ['X', 'A'], ['X', 'B'], ['X', 'C'], ['B', 'B']])
      const edge = document.regions().find(region => region.kind === 'edge' && region.from === 'X' && region.to === 'B')!
      expect(edge.projectedText).toBe('back')
      expect(edge.ports!.find(port => port.end === 'start')!.markers?.map(marker => marker.shape)).toEqual(link === '-->' ? [] : [shape])
      expect(edge.ports!.find(port => port.end === 'end')!.markers?.map(marker => marker.shape)).toEqual([shape])
    }
  })
  test(`${direction} ordinary parallel and reciprocal selected approaches preserve both marker ends (${useAscii ? 'ASCII' : 'Unicode'})`, () => {
    completeComposition(`flowchart ${direction}
A[Wide 界界👩‍💻 é] <-->|request| B[Server]
A o--o|other| B
B x--x|return| A
B --> C[Done]`, useAscii, { A: 'Wide 界界👩‍💻 é', B: 'Server', C: 'Done' }, [], [['A', 'B'], ['A', 'B'], ['B', 'A'], ['B', 'C']])
  })
  test(`${direction} nested cuts retain complete directional relationship ink (${useAscii ? 'ASCII' : 'Unicode'})`, () => {
    completeComposition(`flowchart ${direction}
subgraph Outer[Outer 界<br>complete]
subgraph Left[Left 日本]
direction TD
A[Wide A 日本語👩‍💻]
B[B]
subgraph Deep[Deep 👩‍💻<br>three]
direction LR
D[Deep start]
E[Deep end 界界]
end
end
X[Outside 日本語]
Y[Other é]
end
subgraph Sibling[Sibling 日本]
C[Sibling wide 👩‍💻]
end
A -->|first| X
X -->|back| B
B -->|next| D
D -->|inside| E
E -->|out界| Y
Y -->|return| D
A -->|parallel| X
X -->|branch| C
E -->|self| E`, useAscii, {
      Outer: 'Outer 界\ncomplete', Left: 'Left 日本', Deep: 'Deep 👩‍💻\nthree', Sibling: 'Sibling 日本', A: 'Wide A 日本語👩‍💻', B: 'B', D: 'Deep start', E: 'Deep end 界界', X: 'Outside 日本語', Y: 'Other é', C: 'Sibling wide 👩‍💻',
    }, ['Outer', 'Left', 'Deep', 'Sibling'], [['A', 'X'], ['X', 'B'], ['B', 'D'], ['D', 'E'], ['E', 'Y'], ['Y', 'D'], ['A', 'X'], ['X', 'C'], ['E', 'E']])
  })
}
