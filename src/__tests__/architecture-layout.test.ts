import { describe, expect, it } from 'bun:test'
import fc from 'fast-check'
import { layoutArchitectureDiagram } from '../architecture/layout.ts'
import { architectureToMermaidGraph, parseArchitectureDiagram } from '../architecture/parser.ts'
import { convertToElkFormat } from '../layout-engine.ts'
import { preprocessMermaidSource } from '../mermaid-source.ts'

function parse(source: string) {
  return parseArchitectureDiagram(preprocessMermaidSource(source).lines)
}

function layout(source: string) {
  return layoutArchitectureDiagram(parse(source))
}

function pointToSegmentDistance(
  point: { x: number; y: number },
  a: { x: number; y: number },
  b: { x: number; y: number },
): number {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const lenSq = dx * dx + dy * dy
  if (lenSq === 0) return Math.hypot(point.x - a.x, point.y - a.y)

  const t = Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / lenSq))
  const projX = a.x + t * dx
  const projY = a.y + t * dy
  return Math.hypot(point.x - projX, point.y - projY)
}

function distanceToPolyline(
  point: { x: number; y: number },
  polyline: Array<{ x: number; y: number }>,
): number {
  let minDistance = Infinity
  for (let i = 1; i < polyline.length; i++) {
    minDistance = Math.min(minDistance, pointToSegmentDistance(point, polyline[i - 1]!, polyline[i]!))
  }
  return minDistance
}

describe('layoutArchitectureDiagram', () => {
  it('keeps grouped services and junctions inside their parent frame', () => {
    const result = layout(`architecture-beta
      group app(cloud)[Application]
      service api(server)[API] in app
      service workers(server)[Workers] in app
      junction bus in app
      api:R --> L:workers
      api:B --> T:bus`)

    const group = result.groups[0]!
    const groupBottom = group.y + group.height
    const groupRight = group.x + group.width

    for (const service of result.services.filter((entry) => entry.parentId === group.id)) {
      expect(service.x).toBeGreaterThanOrEqual(group.x)
      expect(service.y).toBeGreaterThan(group.y)
      expect(service.x + service.width).toBeLessThanOrEqual(groupRight)
      expect(service.y + service.height).toBeLessThanOrEqual(groupBottom)
    }

    const junction = result.junctions.find((entry) => entry.parentId === group.id)!
    expect(junction.x).toBeGreaterThanOrEqual(group.x)
    expect(junction.y).toBeGreaterThan(group.y)
    expect(junction.x + junction.width).toBeLessThanOrEqual(groupRight)
    expect(junction.y + junction.height).toBeLessThanOrEqual(groupBottom)
  })

  // Property: containment is a structural invariant, not a property of one
  // example — for ANY architecture, every service/junction declared `in` a group
  // must lie within that group's frame. Generates random multi-group diagrams.
  it('every grouped service/junction stays inside its parent frame (property)', () => {
    const sides = ['L', 'R', 'T', 'B']
    const arb = fc.record({
      groups: fc.integer({ min: 1, max: 2 }),
      svcPerGroup: fc.array(fc.integer({ min: 2, max: 3 }), { minLength: 2, maxLength: 2 }),
      junctions: fc.array(fc.boolean(), { minLength: 2, maxLength: 2 }),
      edges: fc.array(fc.record({ a: fc.nat(5), b: fc.nat(5), sa: fc.nat(3), sb: fc.nat(3) }), { maxLength: 5 }),
    }).map(({ groups, svcPerGroup, junctions, edges }) => {
      const lines = ['architecture-beta']
      const svc: string[] = []
      for (let g = 0; g < groups; g++) {
        lines.push(`  group g${g}(cloud)[Group ${g}]`)
        for (let s = 0; s < svcPerGroup[g]!; s++) {
          const id = `s${g}_${s}`
          svc.push(id)
          lines.push(`  service ${id}(server)[Svc ${id}] in g${g}`)
        }
        if (junctions[g]) lines.push(`  junction j${g} in g${g}`)
      }
      for (const e of edges) {
        const A = svc[e.a % svc.length]!, B = svc[e.b % svc.length]!
        if (A !== B) lines.push(`  ${A}:${sides[e.sa]} --> ${sides[e.sb]}:${B}`)
      }
      return lines.join('\n')
    })

    const EPS = 0.5
    fc.assert(
      fc.property(arb, source => {
        const result = layout(source)
        const groupById = new Map(result.groups.map(g => [g.id, g]))
        const contained = (n: { parentId?: string; x: number; y: number; width: number; height: number }) => {
          const g = n.parentId ? groupById.get(n.parentId) : undefined
          if (!g) return true
          return n.x >= g.x - EPS && n.y >= g.y - EPS
            && n.x + n.width <= g.x + g.width + EPS && n.y + n.height <= g.y + g.height + EPS
        }
        return result.services.every(contained) && result.junctions.every(contained)
      }),
      { numRuns: 300 },
    )
  })

  // #90: on same-side edge patterns the graph projection can seat a wider
  // member flush against the group box, so `expandGroupBounds` re-fit it onto
  // the border (0px clearance) — the service outline drawn on the group border.
  // Re-fit now pads every member by GROUP_EDGE_PAD; assert each service keeps
  // that clearance inside the drawable interior. Reverting the pad leaves s0
  // flush against g0's right border (right clearance 0) and fails this test.
  it('keeps grouped services a full GROUP_EDGE_PAD inside the group border (#90)', () => {
    const PAD = 18 // GROUP_EDGE_PAD
    const result = layout(`architecture-beta
      group g0(cloud)[retry]
      group g1(cloud)[process the request]
      service s0(internet)[reads profiles] in g0
      service s1(server)[x] in g1
      service s2(database)[q] in g0
      service s3(disk)[done] in g1
      service s4(internet)[errors] in g0
      s2:L --> T:s3
      s2:R -[fan out]-> B:s3`)

    const groupById = new Map(result.groups.map(g => [g.id, g]))
    for (const service of result.services) {
      const group = groupById.get(service.parentId!)!
      expect(service.x - group.x).toBeGreaterThanOrEqual(PAD)
      expect(group.x + group.width - (service.x + service.width)).toBeGreaterThanOrEqual(PAD)
      expect(group.y + group.height - (service.y + service.height)).toBeGreaterThanOrEqual(PAD)
      expect(service.y - group.y).toBeGreaterThanOrEqual(PAD)
    }
  })

  it('routes group-boundary edges from the enclosing group frame', () => {
    const result = layout(`architecture-beta
      group storage(cloud)[Storage]
      service db(database)[Database] in storage
      service cache(disk)[Cache]
      db{group}:R -[replicates]-> L:cache`)

    const group = result.groups[0]!
    const edge = result.edges[0]!
    const start = edge.points[0]!
    const exit = edge.points[1]!

    expect(start.x).toBeCloseTo(group.x + group.width, 6)
    expect(exit.x).toBeGreaterThan(start.x)
    expect(start.y).toBeGreaterThanOrEqual(group.y + 18)
    expect(start.y).toBeLessThanOrEqual(group.y + group.height - 18)
  })

  it('routes group-boundary edges for iconless architecture services', () => {
    const result = layout(`architecture-beta
      group storage[Storage]
      service db[Database] in storage
      service cache[Cache]
      db{group}:R -[replicates]-> L:cache`)

    const group = result.groups[0]!
    const edge = result.edges[0]!
    const start = edge.points[0]!
    const exit = edge.points[1]!

    expect(start.x).toBeCloseTo(group.x + group.width, 6)
    expect(exit.x).toBeGreaterThan(start.x)
    expect(start.y).toBeGreaterThanOrEqual(group.y + 18)
    expect(start.y).toBeLessThanOrEqual(group.y + group.height - 18)
  })

  it('preserves iconless grouped service order before ELK sees architecture children', () => {
    const diagram = parse(`architecture-beta
      group app[Application]
      service worker[Worker] in app
      service api[API] in app
      api:R --> L:worker`)
    const graph = architectureToMermaidGraph(diagram)
    const elk = convertToElkFormat(graph, { preserveSubgraphChildOrder: true })
    const app = elk.children?.find((child) => child.id === 'app')

    expect(app?.children?.map((child) => child.id)).toEqual(['worker', 'api'])
  })

  it('places edge labels on the routed polyline', () => {
    const result = layout(`architecture-beta
      group app(cloud)[Application]
      service api(server)[API] in app
      service db(database)[Database]
      api:R -[reads replica]-> L:db`)

    const edge = result.edges[0]!
    expect(edge.labelPosition).toBeDefined()
    expect(distanceToPolyline(edge.labelPosition!, edge.points)).toBeLessThanOrEqual(0.001)
  })

  // Upstream v11.16.0 align directives are real geometry constraints. The
  // graph engine establishes deterministic order; architecture layout then
  // shares the requested center coordinate before routes freeze.
  it('honors align row with shared centers and non-overlapping siblings', () => {
    const body = `
      group api(cloud)[API]
      service db1(database)[DB1] in api
      service db2(database)[DB2] in api
      service db3(database)[DB3] in api
      service mcp(server)[MCP] in api
      db1:R --> L:mcp
      db2:R --> L:mcp
      db3:R --> L:mcp`

    const aligned = layout(`architecture-beta${body}\n      align row db1 db2 db3`)
    const plain = layout(`architecture-beta${body}`)

    expect(aligned.services.length).toBe(4)
    expect(aligned.edges.length).toBe(3)
    const members = ['db1', 'db2', 'db3'].map(id => aligned.services.find(service => service.id === id)!)
    expect(new Set(members.map(service => service.y + service.height / 2)).size).toBe(1)
    for (let i = 1; i < members.length; i++) {
      expect(members[i]!.x).toBeGreaterThanOrEqual(members[i - 1]!.x + members[i - 1]!.width)
    }
    for (let i = 0; i < aligned.services.length; i++) {
      for (let j = i + 1; j < aligned.services.length; j++) {
        const a = aligned.services[i]!, b = aligned.services[j]!
        const overlaps = a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height
        expect({ pair: `${a.id}/${b.id}`, overlaps }).toEqual({ pair: `${a.id}/${b.id}`, overlaps: false })
      }
    }
    for (const edge of aligned.edges) {
      const source = aligned.services.find(service => service.id === edge.source.id)!
      expect(edge.points[0]).toEqual({ x: source.x + source.width, y: source.y + source.height / 2 })
    }
    expect(JSON.stringify(aligned)).not.toBe(JSON.stringify(plain))
  })
})
