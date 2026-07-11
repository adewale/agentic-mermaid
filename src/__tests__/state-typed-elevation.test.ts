import { describe, expect, test } from 'bun:test'
import { parseMermaid } from '../agent/parse.ts'
import { serializeMermaid } from '../agent/serialize.ts'
import { mutate } from '../agent/mutate.ts'
import { asState, type StateMutationOp, type StateValidDiagram } from '../agent/types.ts'
import { parseMermaid as parseRenderGraph } from '../parser.ts'

function state(source: string): StateValidDiagram {
  const parsed = parseMermaid(source)
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.error))
  const narrowed = asState(parsed.value)
  if (!narrowed) throw new Error(`expected structured State body, got ${parsed.value.body.kind}`)
  return narrowed
}

function apply(diagram: StateValidDiagram, op: StateMutationOp): StateValidDiagram {
  const result = mutate(diagram, op)
  if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`)
  return result.value
}

describe('typed State residual elevation (B07)', () => {
  test('models concurrency regions and lets region-addressed edits round-trip', () => {
    let diagram = state(`stateDiagram-v2
      state parallel-work {
        [*] --> Left
        --
        Right --> [*]
      }`)
    const composite = diagram.body.states.find(item => item.id === 'parallel-work')!
    expect(composite.regions).toHaveLength(2)
    expect(composite.regions![0]!.states.some(item => item.id === 'Left')).toBe(true)
    expect(composite.regions![1]!.states.some(item => item.id === 'Right')).toBe(true)

    diagram = apply(diagram, { kind: 'add_state', id: 'Audit', parent: 'parallel-work', region: 1 })
    diagram = apply(diagram, { kind: 'add_transition', from: 'Right', to: 'Audit', parent: 'parallel-work', region: 1 })
    const serialized = serializeMermaid(diagram)
    expect(serialized).toContain('  --')
    expect(serialized.indexOf('Audit')).toBeGreaterThan(serialized.indexOf('  --'))
    expect(parseRenderGraph(serialized).subgraphs[0]!.children).toHaveLength(2)
    expect(state(serialized).body.states[0]!.regions![1]!.transitions).toContainEqual({ from: 'Right', to: 'Audit' })
  })

  test('models classDef, class/cssClass, inline style, and linkStyle paint', () => {
    let diagram = state(`stateDiagram-v2
      A --> B
      classDef hot fill:#ff0000,stroke:#220000
      class A hot
      style B fill:#00ff00
      linkStyle 0 stroke:#0000ff`)
    expect(diagram.body.classDefs?.hot?.fill).toBe('#ff0000')
    expect(diagram.body.states.find(item => item.id === 'A')?.className).toBe('hot')
    expect(diagram.body.states.find(item => item.id === 'B')?.style?.fill).toBe('#00ff00')
    expect(diagram.body.transitions[0]?.style?.stroke).toBe('#0000ff')

    diagram = apply(diagram, { kind: 'define_class', name: 'cool', style: 'fill:#abcdef,stroke:#123456' })
    diagram = apply(diagram, { kind: 'set_state_class', id: 'B', className: 'cool' })
    diagram = apply(diagram, { kind: 'set_state_style', id: 'A', style: 'stroke-width:4px' })
    diagram = apply(diagram, { kind: 'set_transition_style', index: 0, style: 'stroke:#654321' })
    const graph = parseRenderGraph(serializeMermaid(diagram))
    expect(graph.classDefs.get('cool')?.fill).toBe('#abcdef')
    expect(graph.classAssignments.get('B')).toBe('cool')
    expect(graph.nodeStyles.get('A')?.['stroke-width']).toBe('4px')
    expect(graph.linkStyles.get(0)?.stroke).toBe('#654321')
  })

  test('paint mutations reject statement-injecting line breaks', () => {
    const diagram = state('stateDiagram-v2\n  A --> B')
    const operations: StateMutationOp[] = [
      { kind: 'define_class', name: 'hot', style: 'fill:#f00\nInjected' },
      { kind: 'set_state_style', id: 'A', style: 'fill:#f00\rInjected' },
      { kind: 'set_transition_style', index: 0, style: 'stroke:#000\nInjected' },
    ]
    for (const operation of operations) {
      const result = mutate(diagram, operation)
      expect(result.ok, operation.kind).toBe(false)
      if (!result.ok) expect(result.error).toMatchObject({ code: 'INVALID_OP', message: expect.stringContaining('single-line') })
    }
    expect(state(serializeMermaid(diagram)).body).toEqual(diagram.body)
  })

  test('deferred paint targets stay in their composite or concurrency-region scope', () => {
    const cases = [
      ['class', 'class A hot', 'hot', undefined],
      ['cssClass', 'cssClass A hot', 'hot', undefined],
      ['style', 'style A fill:#ff0000', undefined, '#ff0000'],
      ['shorthand', 'A:::hot', 'hot', undefined],
    ] as const
    for (const [name, directive, className, fill] of cases) {
      const diagram = state(`stateDiagram-v2
  state C {
    ${directive}
  }`)
      const composite = diagram.body.states.find(item => item.id === 'C')!
      expect(composite.states?.map(item => item.id), name).toEqual(['A'])
      expect(diagram.body.states.some(item => item.id === 'A'), name).toBe(false)
      expect(composite.states?.[0]?.className, name).toBe(className)
      expect(composite.states?.[0]?.style?.fill, name).toBe(fill)
      const serialized = serializeMermaid(diagram)
      const rendered = parseRenderGraph(serialized)
      expect(rendered.subgraphs[0]?.nodeIds, name).toContain('A')
      expect(state(serialized).body, `${name} agent round-trip`).toEqual(diagram.body)
    }

    const regions = state(`stateDiagram-v2
  state C {
    class Left hot
    --
    style Right fill:#00ff00
  }`)
    const composite = regions.body.states.find(item => item.id === 'C')!
    expect(composite.regions?.[0]?.states).toContainEqual(expect.objectContaining({ id: 'Left', className: 'hot' }))
    expect(composite.regions?.[1]?.states).toContainEqual(expect.objectContaining({ id: 'Right', style: { fill: '#00ff00' } }))
    expect(state(serializeMermaid(regions)).body, 'region agent round-trip').toEqual(regions.body)
  })

  test('bare declarations are structured, rendered, and survive unlabeled add_state', () => {
    let diagram = state('stateDiagram-v2\n  Standalone')
    expect(diagram.body.states).toContainEqual(expect.objectContaining({ id: 'Standalone', declaredBare: true }))
    expect(parseRenderGraph(serializeMermaid(diagram)).nodes.has('Standalone')).toBe(true)

    diagram = apply(diagram, { kind: 'add_state', id: 'Added' })
    const serialized = serializeMermaid(diagram)
    expect(serialized).toContain('  Added')
    expect(parseRenderGraph(serialized).nodes.has('Added')).toBe(true)
  })

  test('hyphenated composite ids share the ordinary State identifier grammar', () => {
    const diagram = state(`stateDiagram-v2
      state in-flight {
        waiting-room --> active-work
      }`)
    const composite = diagram.body.states.find(item => item.id === 'in-flight')!
    expect(composite.states?.map(item => item.id)).toEqual(['waiting-room', 'active-work'])
    const graph = parseRenderGraph(serializeMermaid(diagram))
    expect(graph.subgraphs[0]?.id).toBe('in-flight')
    expect(graph.subgraphs[0]?.nodeIds.sort()).toEqual(['active-work', 'waiting-room'])
  })
})
