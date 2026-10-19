import { describe, expect, test } from 'bun:test'
import { withPerformanceExperiments } from '../experimental-performance.ts'
import { IncrementalGraphOrder } from '../experimental/graph-order.ts'
import { TerminalDocument } from '../ascii/terminal-document.ts'
import { parseRegisteredMermaid } from '../agent/parse.ts'
import { mutate } from '../agent/mutate.ts'
import { serializeMermaid } from '../agent/serialize.ts'
import type { FlowchartMutationOp } from '../agent/types.ts'
import * as marks from '../scene/marks.ts'
import type { SceneDoc, SceneNode } from '../scene/ir.ts'
import { certifyScenePaint } from '../scene/paint-certification.ts'
import { preparePixelText } from '../shared/prepared-text.ts'

describe('adversarial algorithm experiment contracts', () => {
  test('online insertion agrees with a fresh graph search and stable scan after every accepted or rejected edge', () => {
    // A fresh graph traversal and linear ready-node scan avoid trusting the
    // implementation's evolving ranks, generation marks or ordinal heap.
    for (let seed = 1; seed <= 30; seed++) {
      const count = 3 + seed % 13
      const ids = Array.from({ length: count }, (_, index) => `node-${index}`)
      const actual = new IncrementalGraphOrder(ids)
      const edges = ids.map(() => new Set<number>())
      let state = seed
      const random = (): number => { state ^= state << 13; state ^= state >>> 17; state ^= state << 5; return state >>> 0 }
      for (let step = 0; step < 100; step++) {
        const from = random() % count, to = random() % count
        const seen = new Set<number>(), pending = [to]
        while (pending.length) {
          const next = pending.pop()!
          if (seen.has(next)) continue
          seen.add(next)
          pending.push(...edges[next]!)
        }
        const accepted = from !== to && !seen.has(from)
        expect(actual.add(ids[from]!, ids[to]!)).toBe(accepted)
        if (accepted) edges[from]!.add(to)
        const remaining = ids.map((_, index) => index), expected: string[] = []
        while (remaining.length) {
          const ready = remaining.findIndex(candidate => !remaining.some(source => edges[source]!.has(candidate)))
          if (ready < 0) throw new Error('Independent accepted graph must be acyclic')
          expected.push(ids[remaining.splice(ready, 1)[0]!]!)
        }
        expect(actual.stableOrder()).toEqual(expected)
      }
      expect(actual.add('unknown', ids[0]!)).toBe(false)
    }
  })

  test('tiled document storage preserves owned wide glyphs across boundaries, retirement, overlays and reflection', () => {
    const exercise = (): unknown => {
      const document = new TerminalDocument(192, 3)
      const owner = { id: 'wide-text', kind: 'node' as const }
      document.fill(0, 0, 192, 3, { owner })
      // Both halves straddle a tile boundary after rows have become dense.
      document.text(31, 0, '界東京👩‍💻', { owner })
      document.text(95, 1, '界東京', { owner })
      document.put(32, 0, 'x', { owner, kind: 'text' })
      document.put(96, 1, 'y', { owner, kind: 'text' })
      const overlay = new TerminalDocument()
      overlay.text(0, 0, 'wide 界', { owner: { id: 'other', kind: 'node' } })
      document.overlay(overlay, 64, 2)
      document.flip(true, true)
      return {
        text: document.serialize(), occupied: document.occupiedCells,
        cells: [...document.entries()].map(([x, y, cell]) => ({ x, y, glyph: cell.glyph, head: cell.head, width: cell.width, kind: cell.kind, owners: cell.owners })).sort((a, b) => a.y - b.y || a.x - b.x),
        diagnostics: document.diagnostics,
      }
    }
    const expected = withPerformanceExperiments([], exercise)
    expect(withPerformanceExperiments(['terminal-tiles'], exercise)).toEqual(expected)
  })

  test('packed occlusion preserves failure details and exhausted proof budgets under hostile overlap', () => {
    const text = (index: number): SceneNode => marks.text({ id: `text-${index}`, role: 'label', text: 'Retained label', block: preparePixelText('Retained label', { fontSize: 12, fontWeight: 400 }), x: 20, y: 30, fontSize: 12, anchor: 'start', paint: { fill: '#111' } }, '<text x="20" y="30">Retained label</text>')
    const surfaces = Array.from({ length: 1300 }, (_, index) => marks.shape({ id: `surface-${index}`, role: 'node', geometry: { kind: 'rect', x: 0, y: 0, width: 200, height: 100 }, paint: { fill: '#fff' } }, '<rect width="200" height="100" fill="#fff"/>'))
    const document: SceneDoc = { family: 'flowchart', width: 200, height: 100, transparent: false, colors: { bg: '#fff', fg: '#111' }, parts: [...surfaces, ...Array.from({ length: 100 }, (_, index) => text(index))] }
    const expected = withPerformanceExperiments([], () => certifyScenePaint(document))
    expect(expected.issues.some(issue => issue.code === 'CHECK_BUDGET')).toBe(true)
    expect(expected.status).toBe('unverified')
    expect(withPerformanceExperiments(['paint-bvh', 'scene-arena'], () => certifyScenePaint(document))).toEqual(expected)
  })

  test('draft and fallback mutations compose without aliasing caller records or losing authored wrapper and labels', () => {
    const parsed = parseRegisteredMermaid('---\ntitle: Preserve wrapper\n---\nflowchart LR\nsubgraph outer[Outer]\nA["<b>Before</b>"] -->|message| B[After]\nend\nclassDef hot fill:#f00\nclass A hot\nstyle B stroke:#333\nlinkStyle 0 stroke:#f00')
    if (!parsed.ok) throw new Error('Fixture failed to parse')
    const original = structuredClone(parsed.value)
    const operations: FlowchartMutationOp[] = [
      { kind: 'set_label', target: 'A', label: 'Changed 界' },
      { kind: 'set_node_style', id: 'B', style: null },
      { kind: 'define_class', name: 'hot', style: 'fill:#0f0,stroke:#333' },
      { kind: 'set_node_class', id: 'A', className: null },
      { kind: 'add_edge', from: 'B', to: 'C', label: 'new edge' },
      { kind: 'rename_node', from: 'C', to: 'D' },
      { kind: 'set_shape', id: 'A', shape: 'diamond' },
      { kind: 'move_node', id: 'B', subgraph: null },
      { kind: 'set_direction', direction: 'BT' },
    ]
    let baseline = parsed.value, draft = parsed.value
    for (const operation of operations) {
      const before = structuredClone(draft)
      const reference = withPerformanceExperiments([], () => mutate(baseline, operation))
      const candidate = withPerformanceExperiments(['persistent-mutations', 'incremental-order', 'text-spans'], () => mutate(draft, operation))
      expect(draft).toEqual(before)
      expect(reference.ok).toBe(true)
      expect(candidate.ok).toBe(true)
      if (!reference.ok || !candidate.ok) throw new Error('Mutation unexpectedly rejected')
      baseline = reference.value; draft = candidate.value
      expect(serializeMermaid(draft)).toBe(serializeMermaid(baseline))
      expect(draft.source).toEqual(baseline.source)
    }
    expect(parsed.value).toEqual(original)
    expect(serializeMermaid(draft)).toContain('title: Preserve wrapper')
    expect(serializeMermaid(draft)).toContain('Changed 界')
  })
})
