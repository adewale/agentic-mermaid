/**
 * Widened flowchart op menu (plan §Flowchart 8 — the thinnest family menu at
 * the time). New ops, following the journey/gantt conventions (prescriptive
 * errors; op-schema + mutation-ops + sdk-decl + types registration):
 *
 *   subgraph ops — add_subgraph / remove_subgraph / move_node
 *   set_shape (geometry names + the v11 @{ shape } vocabulary)
 *   set_direction (diagram-level, or a subgraph's direction override)
 *   style ops — define_class / set_node_class / set_node_style (the graph
 *   model already carries classDefs / classAssignments / nodeStyles).
 *
 * Every op must round-trip: serialize → render-parse reproduces the edit
 * (P3 conformance).
 */
import { describe, it, expect } from 'bun:test'

import { parseMermaid as parseGraph } from '../parser.ts'
import {
  asFlowchart, mutate, parseRegisteredMermaid as parseMermaid, serializeMermaid, opMenu, validateOp,
} from '../agent/index.ts'
import { MUTATION_OPS_BY_FAMILY } from '../agent/mutation-ops.ts'
import type { FlowchartMutationOp, FlowchartValidDiagram } from '../agent/types.ts'

function flowchart(source: string): FlowchartValidDiagram {
  const parsed = parseMermaid(source)
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.error))
  const narrowed = asFlowchart(parsed.value)
  if (!narrowed) throw new Error('expected flowchart body')
  return narrowed
}

function apply(d: FlowchartValidDiagram, op: FlowchartMutationOp): FlowchartValidDiagram {
  const result = mutate(d, op)
  if (!result.ok) throw new Error(result.error.message)
  return result.value
}

const BASE = 'flowchart TD\n  A[Start] --> B{Check}\n  B --> C[Done]\n'

describe('op registry', () => {
  const NEW_OPS = [
    'add_subgraph', 'remove_subgraph', 'move_node', 'set_shape', 'set_direction',
    'define_class', 'set_node_class', 'set_node_style',
  ] as const

  it('MUTATION_OPS_BY_FAMILY lists the widened flowchart menu', () => {
    for (const op of NEW_OPS) expect(MUTATION_OPS_BY_FAMILY.flowchart).toContain(op)
  })

  it('opMenu exposes the new op field shapes', () => {
    const menu = opMenu('flowchart')
    expect(menu.add_subgraph).toEqual(['id', 'label?', 'parent?', 'members?'])
    expect(menu.move_node).toEqual(['id', 'subgraph'])
    expect(menu.set_shape).toEqual(['id', 'shape'])
    expect(menu.set_direction).toEqual(['direction', 'subgraph?'])
    expect(menu.define_class).toEqual(['name', 'style'])
    expect(menu.set_node_class).toEqual(['id', 'className'])
    expect(menu.set_node_style).toEqual(['id', 'style'])
  })

  it('validateOp shape-checks the new ops with prescriptive errors', () => {
    expect(validateOp('flowchart', { kind: 'add_subgraph', id: 'G' })).toBeNull()
    const bad = validateOp('flowchart', { kind: 'move_node', id: 'A' })
    expect(bad).toMatchObject({ code: 'INVALID_OP', reason: 'missing_field', field: 'subgraph' })
    const badDir = validateOp('flowchart', { kind: 'set_direction', direction: 'NE' })
    expect(badDir).toMatchObject({ code: 'INVALID_OP', reason: 'wrong_type', field: 'direction' })
  })
})

describe('subgraph ops', () => {
  it('add_subgraph declares a group, moves named members in, and round-trips', () => {
    const d = apply(flowchart(BASE), { kind: 'add_subgraph', id: 'phase1', label: 'Phase 1', members: ['A', 'B'] })
    const sg = d.body.graph.subgraphs.find(s => s.id === 'phase1')!
    expect(sg.label).toBe('Phase 1')
    expect(sg.nodeIds).toEqual(['A', 'B'])
    const reparsed = parseGraph(serializeMermaid(d))
    expect(reparsed.subgraphs.map(s => s.id)).toEqual(['phase1'])
    expect(reparsed.subgraphs[0]!.nodeIds.sort()).toEqual(['A', 'B'])
  })

  it('add_subgraph supports nesting via parent', () => {
    let d = apply(flowchart(BASE), { kind: 'add_subgraph', id: 'outer' })
    d = apply(d, { kind: 'add_subgraph', id: 'inner', parent: 'outer', members: ['C'] })
    const outer = d.body.graph.subgraphs.find(s => s.id === 'outer')!
    expect(outer.children.map(c => c.id)).toEqual(['inner'])
    const reparsed = parseGraph(serializeMermaid(d))
    expect(reparsed.subgraphs[0]!.children.map(c => c.id)).toEqual(['inner'])
  })

  it('add_subgraph rejects duplicates and unknown members prescriptively', () => {
    const d = apply(flowchart(BASE), { kind: 'add_subgraph', id: 'G', members: ['A'] })
    const dup = mutate(d, { kind: 'add_subgraph', id: 'G' })
    expect(dup.ok).toBe(false)
    if (!dup.ok) expect(dup.error.message).toContain('G')
    const missing = mutate(d, { kind: 'add_subgraph', id: 'H', members: ['Nope'] })
    expect(missing.ok).toBe(false)
    if (!missing.ok) expect(missing.error.message).toContain('Nope')
  })

  it('remove_subgraph dissolves by default (members survive at the parent scope)', () => {
    let d = apply(flowchart(BASE), { kind: 'add_subgraph', id: 'G', members: ['A', 'B'] })
    d = apply(d, { kind: 'remove_subgraph', id: 'G' })
    expect(d.body.graph.subgraphs).toHaveLength(0)
    expect([...d.body.graph.nodes.keys()].sort()).toEqual(['A', 'B', 'C'])
    expect(d.body.graph.edges).toHaveLength(2)
  })

  it('remove_subgraph removeMembers deletes members and their edges', () => {
    let d = apply(flowchart(BASE), { kind: 'add_subgraph', id: 'G', members: ['B'] })
    d = apply(d, { kind: 'remove_subgraph', id: 'G', removeMembers: true })
    expect(d.body.graph.nodes.has('B')).toBe(false)
    expect(d.body.graph.edges).toHaveLength(0)
  })

  it('move_node moves between subgraphs and to the top level (null)', () => {
    let d = apply(flowchart(BASE), { kind: 'add_subgraph', id: 'G1', members: ['A'] })
    d = apply(d, { kind: 'add_subgraph', id: 'G2' })
    d = apply(d, { kind: 'move_node', id: 'A', subgraph: 'G2' })
    expect(d.body.graph.subgraphs.find(s => s.id === 'G1')!.nodeIds).toEqual([])
    expect(d.body.graph.subgraphs.find(s => s.id === 'G2')!.nodeIds).toEqual(['A'])
    d = apply(d, { kind: 'move_node', id: 'A', subgraph: null })
    expect(d.body.graph.subgraphs.find(s => s.id === 'G2')!.nodeIds).toEqual([])
    const missing = mutate(d, { kind: 'move_node', id: 'A', subgraph: 'nope' })
    expect(missing.ok).toBe(false)
  })
})

describe('set_shape / set_direction', () => {
  it('set_shape changes geometry and serializes the legacy form', () => {
    const d = apply(flowchart(BASE), { kind: 'set_shape', id: 'A', shape: 'stadium' })
    expect(d.body.graph.nodes.get('A')!.shape).toBe('stadium')
    expect(serializeMermaid(d)).toContain('A([Start])')
  })

  it('set_shape rejects unknown names with the valid vocabulary', () => {
    const bad = mutate(flowchart(BASE), { kind: 'set_shape', id: 'A', shape: 'blob' })
    expect(bad.ok).toBe(false)
    if (!bad.ok) expect(bad.error.code).toBe('INVALID_OP')
  })

  it('set_direction changes the diagram direction', () => {
    const d = apply(flowchart(BASE), { kind: 'set_direction', direction: 'LR' })
    expect(d.body.graph.direction).toBe('LR')
    expect(serializeMermaid(d).startsWith('flowchart LR')).toBe(true)
  })

  it('set_direction targets a subgraph direction override', () => {
    let d = apply(flowchart(BASE), { kind: 'add_subgraph', id: 'G', members: ['A'] })
    d = apply(d, { kind: 'set_direction', direction: 'RL', subgraph: 'G' })
    expect(d.body.graph.subgraphs.find(s => s.id === 'G')!.direction).toBe('RL')
    expect(serializeMermaid(d)).toContain('direction RL')
    const missing = mutate(d, { kind: 'set_direction', direction: 'LR', subgraph: 'nope' })
    expect(missing.ok).toBe(false)
  })
})

describe('style ops', () => {
  it('define_class + set_node_class assign and serialize', () => {
    let d = apply(flowchart(BASE), { kind: 'define_class', name: 'hot', style: 'fill:#f96,stroke:#333' })
    d = apply(d, { kind: 'set_node_class', id: 'A', className: 'hot' })
    const serialized = serializeMermaid(d)
    expect(serialized).toContain('classDef hot fill:#f96,stroke:#333')
    expect(serialized).toContain('class A hot')
    const reparsed = parseGraph(serialized)
    expect(reparsed.classDefs.get('hot')).toEqual({ fill: '#f96', stroke: '#333' })
    expect(reparsed.classAssignments.get('A')).toBe('hot')
  })

  it('class names reject line-oriented syntax injection', () => {
    for (const op of [
      { kind: 'define_class', name: 'hot\nInjected', style: 'fill:#f96' },
      { kind: 'set_node_class', id: 'A', className: 'hot%%cut' },
    ] as FlowchartMutationOp[]) {
      const result = mutate(flowchart(BASE), op)
      expect(result.ok, op.kind).toBe(false)
      if (!result.ok) expect(result.error).toMatchObject({ code: 'INVALID_OP', message: expect.stringContaining('Class name') })
    }
  })

  it('set_node_class null clears the assignment', () => {
    let d = apply(flowchart(BASE), { kind: 'define_class', name: 'hot', style: 'fill:#f96' })
    d = apply(d, { kind: 'set_node_class', id: 'A', className: 'hot' })
    d = apply(d, { kind: 'set_node_class', id: 'A', className: null })
    expect(d.body.graph.classAssignments.has('A')).toBe(false)
  })

  it('define_class rejects style strings that parse to nothing', () => {
    const bad = mutate(flowchart(BASE), { kind: 'define_class', name: 'x', style: 'not a style' })
    expect(bad.ok).toBe(false)
    if (!bad.ok) expect(bad.error.message).toContain('fill:')
  })

  it('paint mutations reject line breaks that would create nodes', () => {
    for (const op of [
      { kind: 'define_class', name: 'hot', style: 'fill:#f00\nInjected' },
      { kind: 'set_node_style', id: 'A', style: 'fill:#f00\rInjected' },
    ] as FlowchartMutationOp[]) {
      const result = mutate(flowchart(BASE), op)
      expect(result.ok, op.kind).toBe(false)
      if (!result.ok) expect(result.error.code).toBe('INVALID_OP')
    }
  })

  it('set_node_style sets and clears inline styles', () => {
    let d = apply(flowchart(BASE), { kind: 'set_node_style', id: 'B', style: 'fill:#bbf,stroke-width:2px' })
    expect(serializeMermaid(d)).toContain('style B fill:#bbf,stroke-width:2px')
    const reparsed = parseGraph(serializeMermaid(d))
    expect(reparsed.nodeStyles.get('B')).toEqual({ fill: '#bbf', 'stroke-width': '2px' })
    d = apply(d, { kind: 'set_node_style', id: 'B', style: null })
    expect(d.body.graph.nodeStyles.has('B')).toBe(false)
  })

  it('style/shape ops reject unknown nodes', () => {
    for (const op of [
      { kind: 'set_shape', id: 'nope', shape: 'stadium' },
      { kind: 'set_node_class', id: 'nope', className: 'x' },
      { kind: 'set_node_style', id: 'nope', style: 'fill:#fff' },
    ] as FlowchartMutationOp[]) {
      const result = mutate(flowchart(BASE), op)
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.error.code).toBe('NODE_NOT_FOUND')
    }
  })
})
