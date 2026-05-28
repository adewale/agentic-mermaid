// Tests for mutate (agent surface) — all six MutationOp kinds.

import { describe, test, expect } from 'bun:test'
import { parseMermaid } from '../agent/parse.ts'
import { mutate } from '../agent/mutate.ts'
import { serializeMermaid } from '../agent/serialize.ts'

function parse(src: string) {
  const r = parseMermaid(src)
  if (!r.ok) throw new Error('parse failed: ' + JSON.stringify(r.error))
  return r.value
}

describe('mutate — add_node', () => {
  test('adds a fresh node', () => {
    const d = parse('flowchart TD\n  A --> B')
    const r = mutate(d, { kind: 'add_node', id: 'C', label: 'Cache' })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value.body.kind).toBe('flowchart')
    if (r.value.body.kind !== 'flowchart') return
    expect(r.value.body.graph.nodes.has('C')).toBe(true)
    expect(r.value.body.graph.nodes.get('C')!.label).toBe('Cache')
  })

  test('respects shape override', () => {
    const d = parse('flowchart TD\n  A --> B')
    const r = mutate(d, { kind: 'add_node', id: 'D', label: 'DB', shape: 'cylinder' })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    if (r.value.body.kind !== 'flowchart') return
    expect(r.value.body.graph.nodes.get('D')!.shape).toBe('cylinder')
  })

  test('rejects duplicate id', () => {
    const d = parse('flowchart TD\n  A --> B')
    const r = mutate(d, { kind: 'add_node', id: 'A', label: 'Another' })
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.error.code).toBe('DUPLICATE_NODE')
  })
})

describe('mutate — remove_node', () => {
  test('removes the node and its incident edges', () => {
    const d = parse('flowchart TD\n  A --> B\n  B --> C')
    const r = mutate(d, { kind: 'remove_node', id: 'B' })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    if (r.value.body.kind !== 'flowchart') return
    expect(r.value.body.graph.nodes.has('B')).toBe(false)
    expect(r.value.body.graph.edges).toHaveLength(0)
  })

  test('returns NODE_NOT_FOUND for missing id', () => {
    const d = parse('flowchart TD\n  A --> B')
    const r = mutate(d, { kind: 'remove_node', id: 'Z' })
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.error.code).toBe('NODE_NOT_FOUND')
  })
})

describe('mutate — rename_node', () => {
  test('renames a node and updates incident edges', () => {
    const d = parse('flowchart TD\n  A --> B\n  B --> C')
    const r = mutate(d, { kind: 'rename_node', from: 'B', to: 'Middle' })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    if (r.value.body.kind !== 'flowchart') return
    expect(r.value.body.graph.nodes.has('Middle')).toBe(true)
    expect(r.value.body.graph.nodes.has('B')).toBe(false)
    expect(r.value.body.graph.edges[0]!.target).toBe('Middle')
    expect(r.value.body.graph.edges[1]!.source).toBe('Middle')
  })

  test('rejects rename to existing id', () => {
    const d = parse('flowchart TD\n  A --> B')
    const r = mutate(d, { kind: 'rename_node', from: 'A', to: 'B' })
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.error.code).toBe('DUPLICATE_NODE')
  })

  test('rejects rename of missing node', () => {
    const d = parse('flowchart TD\n  A --> B')
    const r = mutate(d, { kind: 'rename_node', from: 'Z', to: 'Y' })
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.error.code).toBe('NODE_NOT_FOUND')
  })
})

describe('mutate — set_label', () => {
  test('sets a node label', () => {
    const d = parse('flowchart TD\n  A --> B')
    const r = mutate(d, { kind: 'set_label', target: 'A', label: 'Alpha' })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    if (r.value.body.kind !== 'flowchart') return
    expect(r.value.body.graph.nodes.get('A')!.label).toBe('Alpha')
  })

  test('sets an edge label', () => {
    const d = parse('flowchart TD\n  A --> B')
    const r = mutate(d, { kind: 'set_label', target: 'A->B', label: 'flows to' })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    if (r.value.body.kind !== 'flowchart') return
    expect(r.value.body.graph.edges[0]!.label).toBe('flows to')
  })

  test('returns NODE_NOT_FOUND when target matches nothing', () => {
    const d = parse('flowchart TD\n  A --> B')
    const r = mutate(d, { kind: 'set_label', target: 'Z', label: 'x' })
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.error.code).toBe('NODE_NOT_FOUND')
  })
})

describe('mutate — add_edge', () => {
  test('adds an edge between existing nodes', () => {
    const d = parse('flowchart TD\n  A --> B')
    const r = mutate(d, { kind: 'add_edge', from: 'A', to: 'B', label: 'second' })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    if (r.value.body.kind !== 'flowchart') return
    expect(r.value.body.graph.edges).toHaveLength(2)
    expect(r.value.body.graph.edges[1]!.label).toBe('second')
  })

  test('creates implicit nodes if missing', () => {
    const d = parse('flowchart TD\n  A --> B')
    const r = mutate(d, { kind: 'add_edge', from: 'C', to: 'D' })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    if (r.value.body.kind !== 'flowchart') return
    expect(r.value.body.graph.nodes.has('C')).toBe(true)
    expect(r.value.body.graph.nodes.has('D')).toBe(true)
  })
})

describe('mutate — remove_edge', () => {
  test('removes a single edge by id', () => {
    const d = parse('flowchart TD\n  A --> B\n  B --> C')
    const r = mutate(d, { kind: 'remove_edge', id: 'A->B' })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    if (r.value.body.kind !== 'flowchart') return
    expect(r.value.body.graph.edges).toHaveLength(1)
    expect(r.value.body.graph.edges[0]!.source).toBe('B')
  })

  test('returns EDGE_NOT_FOUND for missing id', () => {
    const d = parse('flowchart TD\n  A --> B')
    const r = mutate(d, { kind: 'remove_edge', id: 'Z->Y' })
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.error.code).toBe('EDGE_NOT_FOUND')
  })
})

describe('mutate — totality on opaque families', () => {
  test('returns UNSUPPORTED_FAMILY for opaque-body diagrams', () => {
    const d = parse('sequenceDiagram\n  Alice->>Bob: Hi')
    const r = mutate(d, { kind: 'add_node', id: 'X', label: 'X' })
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.error.code).toBe('UNSUPPORTED_FAMILY')
  })
})

describe('mutate — immutability', () => {
  test('does not modify the input diagram', () => {
    const d = parse('flowchart TD\n  A --> B')
    if (d.body.kind !== 'flowchart') return
    const beforeIds = Array.from(d.body.graph.nodes.keys()).sort()
    mutate(d, { kind: 'add_node', id: 'C', label: 'C' })
    const afterIds = Array.from(d.body.graph.nodes.keys()).sort()
    expect(afterIds).toEqual(beforeIds)
  })
})

describe('mutate — chained edits preserve serializability', () => {
  test('add → rename → set_label survives a parse round-trip', () => {
    const d0 = parse('flowchart TD\n  A --> B')
    const d1 = mutate(d0, { kind: 'add_node', id: 'C', label: 'Cache' })
    if (!d1.ok) throw new Error('add_node failed')
    const d2 = mutate(d1.value, { kind: 'add_edge', from: 'B', to: 'C' })
    if (!d2.ok) throw new Error('add_edge failed')
    const d3 = mutate(d2.value, { kind: 'rename_node', from: 'C', to: 'Cache' })
    if (!d3.ok) throw new Error('rename failed')
    const out = serializeMermaid(d3.value)
    const reparsed = parseMermaid(out)
    expect(reparsed.ok).toBe(true)
  })
})
