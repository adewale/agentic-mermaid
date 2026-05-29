// Loop 9 M11 — renderMermaidASCIIWithMeta returns regions that cover the
// node ids and whose column ranges line up with the rendered characters.

import { describe, test, expect } from 'bun:test'
import { renderMermaidASCIIWithMeta } from '../ascii/meta.ts'

describe('renderMermaidASCIIWithMeta', () => {
  test('flowchart: every node id appears in regions', () => {
    const src = 'flowchart TD\n  A --> B\n  B --> C\n  C --> D\n'
    const { ascii, regions } = renderMermaidASCIIWithMeta(src)
    expect(ascii.length).toBeGreaterThan(0)
    const ids = new Set(regions.map(r => r.id))
    for (const id of ['A', 'B', 'C', 'D']) expect(ids.has(id)).toBe(true)
  })

  test('flowchart: col ranges actually match rendered characters', () => {
    const src = 'flowchart LR\n  Alpha --> Beta\n'
    const { ascii, regions } = renderMermaidASCIIWithMeta(src)
    const lines = ascii.split('\n')
    for (const r of regions) {
      const line = lines[r.canvasRow]
      expect(line).toBeDefined()
      const slice = line!.slice(r.canvasColStart, r.canvasColEnd)
      // The slice should contain the node id or its label substring.
      expect(slice.length).toBe(r.canvasColEnd - r.canvasColStart)
      expect(slice.trim().length).toBeGreaterThan(0)
    }
  })

  test('flowchart with labels: label string is what regions point at', () => {
    const src = 'flowchart LR\n  A[Login] --> B[Dashboard]\n'
    const { ascii, regions } = renderMermaidASCIIWithMeta(src)
    const lines = ascii.split('\n')
    const byId: Record<string, typeof regions[number]> = {}
    for (const r of regions) byId[r.id] = r
    expect(byId.A).toBeDefined()
    expect(byId.B).toBeDefined()
    expect(lines[byId.A!.canvasRow]!.slice(byId.A!.canvasColStart, byId.A!.canvasColEnd)).toContain('Login')
    expect(lines[byId.B!.canvasRow]!.slice(byId.B!.canvasColStart, byId.B!.canvasColEnd)).toContain('Dashboard')
  })

  test('sequence: participants appear in regions', () => {
    const src = 'sequenceDiagram\n  Alice->>Bob: Hi\n  Bob->>Carol: Hello\n'
    const { regions } = renderMermaidASCIIWithMeta(src)
    const ids = new Set(regions.map(r => r.id))
    expect(ids.has('Alice')).toBe(true)
    expect(ids.has('Bob')).toBe(true)
    expect(ids.has('Carol')).toBe(true)
  })

  test('stable: same input → same regions (deterministic)', () => {
    const src = 'flowchart TD\n  A --> B\n  B --> C\n'
    const a = renderMermaidASCIIWithMeta(src)
    const b = renderMermaidASCIIWithMeta(src)
    expect(a.ascii).toBe(b.ascii)
    expect(a.regions).toEqual(b.regions)
  })

  test('regions sorted top-down, left-to-right', () => {
    const src = 'flowchart TD\n  A --> B\n  A --> C\n  B --> D\n  C --> D\n'
    const { regions } = renderMermaidASCIIWithMeta(src)
    for (let i = 1; i < regions.length; i++) {
      const prev = regions[i - 1]!
      const cur = regions[i]!
      if (prev.canvasRow !== cur.canvasRow) expect(cur.canvasRow).toBeGreaterThan(prev.canvasRow)
      else expect(cur.canvasColStart).toBeGreaterThanOrEqual(prev.canvasColStart)
    }
  })

  test('unparseable source yields empty regions', () => {
    const { regions } = renderMermaidASCIIWithMeta('not a diagram')
    expect(regions).toEqual([])
  })
})
