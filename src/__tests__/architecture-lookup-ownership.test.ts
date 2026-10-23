import { describe, expect, spyOn, test } from 'bun:test'
import * as graphLayout from '../layout-engine.ts'
import { layoutArchitectureDiagram } from '../architecture/layout.ts'
import { parseArchitectureDiagram } from '../architecture/parser.ts'
import type { PositionedArchitectureJunction } from '../architecture/types.ts'
import { toMermaidLines } from '../mermaid-source.ts'

const native = { graphLayout: { backend: 'agentic' as const, fallback: 'none' as const } }

describe('Architecture positioned lookup ownership', () => {
  test('caller mutations and changed measured keys do not contaminate cached family geometry', () => {
    const model = parseArchitectureDiagram(toMermaidLines(`architecture-beta
group app[Application]
service a(server)[A] in app
service b(database)[B] in app
junction first in app
junction second in app
a:R --> L:b
a:B --> T:first
first:R --> L:second
align row a b`))
    const original = structuredClone(model)
    const placed = layoutArchitectureDiagram(model, native), expected = structuredClone(placed)
    placed.services[0]!.x = 999999
    placed.junctions[0]!.width = 999999
    placed.groups[0]!.width = 999999
    placed.edges[0]!.points[0]!.y = 999999
    expect(layoutArchitectureDiagram(model, native)).toEqual(expected)
    expect(model).toEqual(original)
    const edited = structuredClone(model)
    edited.services[0]!.label = 'A substantially wider authored service label'
    const changed = layoutArchitectureDiagram(edited, native)
    expect(changed.services[0]!.label).toBe(edited.services[0]!.label)
    expect(changed.services[0]!.width).toBeGreaterThan(expected.services[0]!.width)
    expect(layoutArchitectureDiagram(model, { ...native, nodeSpacing: 71 })).not.toEqual(expected)
  })

  test('route obstacles iterate junctions in positioned-array order after the lookup is reused', () => {
    const model = parseArchitectureDiagram(toMermaidLines('architecture-beta\njunction first\njunction second\nfirst:R --> L:second'))
    const produce = graphLayout.layoutNativeGraphPlacementSync
    const producer = spyOn(graphLayout, 'layoutNativeGraphPlacementSync').mockImplementation((graph, options) => {
      const result = produce(graph, options)
      return { ...result, nodes: result.nodes.slice().sort((a, b) => a.id < b.id ? 1 : a.id > b.id ? -1 : 0) }
    })
    const originalValues = Map.prototype.values, snapshots: unknown[][] = []
    const values = spyOn(Map.prototype, 'values').mockImplementation(function (this: Map<unknown, unknown>) {
      const items = [...originalValues.call(this)]
      if (items.length === 2 && items.every(value => value !== null && typeof value === 'object' && 'id' in value && ['first', 'second'].includes(String(value.id)))) snapshots.push(items)
      return originalValues.call(this)
    })
    try {
      const placed = layoutArchitectureDiagram(model, native)
      expect(placed.junctions.map(junction => junction.id)).toEqual(['second', 'first'])
      const routeOrders = snapshots.filter(items => items.every(item => placed.junctions.includes(item as PositionedArchitectureJunction))).map(items => items.map(item => (item as PositionedArchitectureJunction).id))
      expect(routeOrders.length).toBeGreaterThan(0)
      for (const order of routeOrders) expect(order).toEqual(['second', 'first'])
    } finally { values.mockRestore(); producer.mockRestore() }
  })
})
