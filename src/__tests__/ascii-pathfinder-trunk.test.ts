// Loop 10 M3 (#113): pathfinder trunk-sharing for fanouts.
//
// NOTE: trunk-sharing was ALREADY implemented (src/ascii/edge-bundling.ts
// fan-out bundles with a shared path + junction). rmvegasm PR #113 fixed
// fanout-trunk / floating-connector bugs (#111/#112) in an earlier upstream
// state; our fork's bundling already produces correct shared trunks. This
// file adds the regression coverage that locks the behavior + determinism in.

import { describe, test, expect } from 'bun:test'
import { renderMermaidASCII, renderMermaidASCIIWithReceipt } from '../ascii/index.ts'
import { terminalDocumentOf, type TerminalCell } from '../ascii/terminal-document.ts'
import { createHash } from 'node:crypto'

// T-junction glyphs that lie outside every node box. Box corners (┐ └) and the
// edge-exit tees drawn on a box border (└─┬─┘, │ A ├──) are not trunk forks, so
// only a junction off every box proves that a shared trunk splits.
function offBoxJunctions(out: string): string[] {
  const rows = out.split('\n')
  const inBox = rows.map(row => Array.from(row, () => false))
  rows.forEach((row, top) => {
    for (let left = row.indexOf('┌'); left >= 0; left = row.indexOf('┌', left + 1)) {
      const right = row.indexOf('┐', left)
      let bottom = top + 1
      while (bottom < rows.length && rows[bottom]![left] !== '└') bottom++
      for (let y = top; y <= bottom && y < rows.length; y++) for (let x = left; x <= right; x++) inBox[y]![x] = true
    }
  })
  const junctions: string[] = []
  rows.forEach((row, y) => Array.from(row).forEach((ch, x) => { if ('┬├┼┤┴'.includes(ch) && !inBox[y]![x]) junctions.push(`${ch}@${y},${x}`) }))
  return junctions
}

describe('#113 fanout trunk-sharing', () => {
  test('1→{B,C,D} fanout renders a shared trunk with a fork connector', () => {
    const out = renderMermaidASCII('flowchart TD\n  A --> B\n  A --> C\n  A --> D')
    // A single trunk descends from A, then forks. The fork uses box-drawing
    // tee/branch glyphs (├ ┬ ┐) rather than three independent parallel lines.
    expect(out).toContain('A')
    expect(out).toContain('B')
    expect(out).toContain('C')
    expect(out).toContain('D')
    // One trunk forks three ways: two T-junctions on the connector row, off every box.
    const junctions = offBoxJunctions(out)
    expect(junctions.map(j => j[0])).toEqual(['├', '┬'])
    expect(new Set(junctions.map(j => j.split('@')[1]!.split(',')[0])).size).toBe(1)
  })

  test('a fan-out fork row contains a horizontal line', () => {
    const out = renderMermaidASCII('flowchart TD\n  A --> B\n  A --> C\n  A --> D')
    const lines = out.split('\n')
    // A row containing a fork glyph must also contain a horizontal run, so the
    // connector isn't dangling in space (the #112 floating-connector bug).
    const forkRow = lines.find(l => /[├┬┼]/.test(l))
    expect(forkRow).toBeDefined()
    expect(forkRow!).toMatch(/─/)
  })

  test('LR fanout also produces a clean trunk', () => {
    const out = renderMermaidASCII('flowchart LR\n  A --> B\n  A --> C\n  A --> D')
    // The vertical trunk leaving A tees off to C before turning into D.
    expect(offBoxJunctions(out).map(j => j[0])).toEqual(['├'])
    for (const id of ['A', 'B', 'C', 'D']) expect(out).toContain(id)
  })

  test('labeled LR fanout keeps labels on branch runs and shares a vertical trunk', () => {
    const out = renderMermaidASCII(`flowchart LR
  Src["Source"]
  Top["Top Target"]
  Mid["Middle Target"]
  Bot["Bottom Target"]
  Src -->|top*| Top
  Src -->|mid*| Mid
  Src -->|bot*| Bot`)
    expect(out).toContain('Source ├────top*──►')
    expect(out).toContain('├─────mid*─────►')
    expect(out).toContain('└─────bot*─────►')
  })

  test('labeled TD fanout shares one trunk and places labels on branches (upstream #111 repro)', () => {
    const out = renderMermaidASCII(`flowchart TB
    Src["Source"]
    Left["Left Target"]
    Center["Center Target"]
    Right["Right Target"]
    Src -->|left*| Left
    Src -->|center*| Center
    Src -->|right*| Right`)
    expect(out).toContain('Source   ├─────────────┬─────────────────────┐')
    expect(out).toContain('center*')
    expect(out).toContain('right*')
    // Regression guard: center* used to be written onto the horizontal trunk.
    expect(out).not.toContain('└────center*')
    expect(out).not.toContain('┼──────/right*')
  })

  for (const useAscii of [false, true]) for (const [down, up] of [['down', 'up'], ['down界', 'up界']] as const) {
    test(`reciprocal vertical ${useAscii ? 'ASCII' : 'Unicode'} labels ${down}/${up} retain exclusive text and connected physical lanes`, () => {
      const rendered = renderMermaidASCIIWithReceipt(`flowchart TD\n  A -->|${down}| B\n  B -->|${up}| A`, { useAscii, colorMode: 'none' })
      const document = terminalDocumentOf(rendered)!
      const entries = [...document.entries()], edges = document.regions().filter(region => region.kind === 'edge')
      expect(document.diagnostics).toEqual([])
      expect(edges.map(edge => [edge.from, edge.to]).sort()).toEqual([['A', 'B'], ['B', 'A']])
      const ports = edges.flatMap(edge => edge.ports ?? [])
      expect(new Set(ports.map(port => `${port.x},${port.y}`)).size).toBe(4)
      // Read the emitted glyphs, including their directional connections.
      // Label cells bridge the wire they replace; adjacent parallel strokes
      // alone cannot establish a connected relationship.
      const masks: Record<string, number> = { '─': 10, '│': 5, '┌': 6, '┐': 12, '└': 3, '┘': 9, '├': 7, '┤': 13, '┬': 14, '┴': 11, '┼': 15, '-': 10, '|': 5, '+': 15, '▲': 5, '▼': 5, '^': 5, 'v': 5, '◄': 10, '►': 10, '<': 10, '>': 10 }
      const mask = (cell: TerminalCell) => cell.kind === 'text' ? 15 : masks[cell.glyph] ?? 0
      const steps = [[0, -1, 1, 4], [1, 0, 2, 8], [0, 1, 4, 1], [-1, 0, 8, 2]] as const
      const normals = { T: [0, -1], R: [1, 0], B: [0, 1], L: [-1, 0] } as const
      const inward = { T: 4, R: 8, B: 1, L: 2 } as const
      const targetGlyphs = useAscii ? { T: 'v', R: '<', B: '^', L: '>' } : { T: '▼', R: '◄', B: '▲', L: '►' }
      for (const edge of edges) {
        const downward = edge.from === 'A'
        const owned = entries.filter(([, , cell]) => cell.owners.some(owner => owner.kind === 'edge' && owner.id === edge.id))
        const text = owned.filter(([, , cell]) => cell.kind === 'text')
        expect(text.filter(([x, , cell]) => cell.head === x).sort(([ax], [bx]) => ax - bx).map(([, , cell]) => cell.glyph).join('')).toBe(downward ? down : up)
        expect(new Set(text.map(([, y]) => y)).size).toBe(1)
        const left = Math.min(...text.map(([x]) => x)), right = Math.max(...text.map(([x]) => x)), row = text[0]![1]
        // Separation can use rows or columns. The full text envelope must not
        // cover the opposite lane, marker, or any other authored text/card.
        for (let x = left; x <= right; x++) expect(document.cell(x, row)?.owners.map(owner => [owner.kind, owner.id])).toEqual([['edge', edge.id]])
        const start = edge.ports!.find(port => port.end === 'start')!, end = edge.ports!.find(port => port.end === 'end')!
        expect([start.nodeId, end.nodeId]).toEqual([edge.from!, edge.to!])
        for (const port of [start, end]) expect(document.cell(port.x, port.y)?.owners.some(owner => owner.kind === 'node' && owner.id === port.nodeId)).toBe(true)
        const [sx, sy] = normals[start.side!], [tx, ty] = normals[end.side!]
        const tip = { x: end.x + tx, y: end.y + ty }
        expect(document.cell(tip.x, tip.y)?.glyph).toBe(targetGlyphs[end.side!])
        const cells = new Map(owned.map(([x, y, cell]) => [`${x},${y}`, cell]))
        const exit = { x: start.x + sx, y: start.y + sy }, first = cells.get(`${exit.x},${exit.y}`)!
        expect(first?.kind).toBe('stroke')
        expect(mask(first) & inward[start.side!]).toBeGreaterThan(0)
        const queue = [exit], seen = new Set([`${exit.x},${exit.y}`])
        for (let at = 0; at < queue.length; at++) {
          const point = queue[at]!, current = cells.get(`${point.x},${point.y}`)
          for (const [dx, dy, outgoing, incoming] of steps) {
            const x = point.x + dx, y = point.y + dy, key = `${x},${y}`, next = cells.get(key)
            if (current && next && mask(current) & outgoing && mask(next) & incoming && !seen.has(key)) { seen.add(key); queue.push({ x, y }) }
          }
        }
        expect(seen.has(`${tip.x},${tip.y}`), `${edge.from}->${edge.to} emitted path reaches its directional target marker`).toBe(true)
        for (const [x, y] of text) expect(seen.has(`${x},${y}`), 'the complete label remains attached to its own path').toBe(true)
      }
    })
  }

  test('fanout rendering is deterministic across 10 runs', () => {
    const src = 'flowchart TD\n  A --> B\n  A --> C\n  A --> D\n  B --> E\n  C --> E\n  D --> E'
    const hashes = new Set<string>()
    for (let i = 0; i < 10; i++) {
      hashes.add(createHash('sha256').update(renderMermaidASCII(src)).digest('hex'))
    }
    expect(hashes.size).toBe(1)
  })

  test('single edge (no fanout) does not force a trunk', () => {
    const out = renderMermaidASCII('flowchart TD\n  A --> B')
    expect(out).toContain('A')
    expect(out).toContain('B')
    expect(offBoxJunctions(out)).toEqual([])
  })
})
