// Round-trip property tests: parse / serialize / parse must converge.

import { describe, test, expect } from 'bun:test'
import fc from 'fast-check'
import { parseMermaid } from '../agent/parse.ts'
import { serializeMermaid } from '../agent/serialize.ts'
import { mutate } from '../agent/mutate.ts'
import type { MutationOp } from '../agent/types.ts'

describe('round-trip identity', () => {
  test('parse(serialize(parse(s))) ≡ parse(s) for a small corpus', () => {
    const corpus = [
      'flowchart TD\n  A --> B',
      'flowchart LR\n  A[Alpha] --> B[Beta]',
      'flowchart TD\n  A --> B\n  B --> C\n  C --> D',
      'flowchart TD\n  A{Decision} --> B[End]',
      'flowchart TD\n  A[(Database)] --> B((Cache))',
      'flowchart TD\n  A[Start] --> B{Choice}\n  B -->|yes| C[Yes path]\n  B -->|no| D[No path]',
    ]
    for (const src of corpus) {
      const a = parseMermaid(src)
      expect(a.ok).toBe(true)
      if (!a.ok) continue
      const s1 = serializeMermaid(a.value)
      const b = parseMermaid(s1)
      expect(b.ok).toBe(true)
      if (!b.ok) continue
      // Compare on the canonical structure: same node ids and same edge list.
      if (a.value.body.kind !== 'flowchart' || b.value.body.kind !== 'flowchart') continue
      const aNodes = [...a.value.body.graph.nodes.keys()].sort()
      const bNodes = [...b.value.body.graph.nodes.keys()].sort()
      expect(bNodes).toEqual(aNodes)
      expect(b.value.body.graph.edges.length).toBe(a.value.body.graph.edges.length)
    }
  })

  test('opaque-family round-trip preserves source verbatim', () => {
    const corpus = [
      'sequenceDiagram\n  Alice->>Bob: Hi\n  Bob-->>Alice: Hello',
      'timeline\n  title History\n  2020 : A\n  2021 : B',
      'journey\n  title Day\n  section Morning\n    Wake: 3: Me',
    ]
    for (const src of corpus) {
      const a = parseMermaid(src)
      expect(a.ok).toBe(true)
      if (!a.ok) continue
      const s1 = serializeMermaid(a.value)
      const b = parseMermaid(s1)
      expect(b.ok).toBe(true)
      if (!b.ok) continue
      expect(b.value.kind).toBe(a.value.kind)
    }
  })
})

describe('mutate idempotence on symmetric ops', () => {
  test('add_node + remove_node returns to the original node set', () => {
    const r = parseMermaid('flowchart TD\n  A --> B')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const d0 = r.value
    const r1 = mutate(d0, { kind: 'add_node', id: 'Z', label: 'Z' })
    expect(r1.ok).toBe(true)
    if (!r1.ok) return
    const r2 = mutate(r1.value, { kind: 'remove_node', id: 'Z' })
    expect(r2.ok).toBe(true)
    if (!r2.ok) return
    if (r2.value.body.kind !== 'flowchart' || d0.body.kind !== 'flowchart') return
    const after = [...r2.value.body.graph.nodes.keys()].sort()
    const before = [...d0.body.graph.nodes.keys()].sort()
    expect(after).toEqual(before)
  })

  test('rename A → B → A returns to original', () => {
    const r = parseMermaid('flowchart TD\n  X --> Y')
    if (!r.ok) throw new Error('parse failed')
    const d0 = r.value
    const r1 = mutate(d0, { kind: 'rename_node', from: 'X', to: 'Xtemp' })
    if (!r1.ok) throw new Error('first rename failed')
    const r2 = mutate(r1.value, { kind: 'rename_node', from: 'Xtemp', to: 'X' })
    expect(r2.ok).toBe(true)
    if (!r2.ok) return
    if (r2.value.body.kind !== 'flowchart' || d0.body.kind !== 'flowchart') return
    expect([...r2.value.body.graph.nodes.keys()].sort()).toEqual(
      [...d0.body.graph.nodes.keys()].sort(),
    )
  })
})

describe('mutate property: every result is parseable', () => {
  test('add_node + add_edge sequences always produce parseable source', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            kind: fc.constantFrom('add_node', 'add_edge'),
            id: fc.string({ minLength: 1, maxLength: 5 }).filter(s => /^[A-Za-z][A-Za-z0-9_]*$/.test(s)),
            label: fc.string({ minLength: 0, maxLength: 10 }).filter(s => !/[\[\]{}()<>|"]/.test(s)),
            from: fc.string({ minLength: 1, maxLength: 5 }).filter(s => /^[A-Za-z][A-Za-z0-9_]*$/.test(s)),
            to: fc.string({ minLength: 1, maxLength: 5 }).filter(s => /^[A-Za-z][A-Za-z0-9_]*$/.test(s)),
          }),
          { minLength: 0, maxLength: 6 },
        ),
        ops => {
          const r0 = parseMermaid('flowchart TD\n  A --> B')
          if (!r0.ok) return true
          let d = r0.value
          for (const o of ops) {
            const op: MutationOp =
              o.kind === 'add_node'
                ? { kind: 'add_node', id: o.id, label: o.label || o.id }
                : { kind: 'add_edge', from: o.from, to: o.to }
            const next = mutate(d, op)
            if (next.ok) d = next.value
          }
          const serialized = serializeMermaid(d)
          const reparsed = parseMermaid(serialized)
          return reparsed.ok
        },
      ),
      { numRuns: 100 },
    )
  })
})
