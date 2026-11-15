import { describe, expect, it } from 'bun:test'
import fc from 'fast-check'
import { collectSamples } from '../../eval/layout-compare/run.ts'
import { fcParameters } from './helpers/fc-parameters.ts'
import { ARCHITECTURE_GROUP_ICON_TITLE_OFFSET, DEFAULT_ARCHITECTURE_VISUAL } from '../architecture/config.ts'
import { layoutArchitectureDiagram } from '../architecture/layout.ts'
import { architectureToMermaidGraph, parseArchitectureDiagram } from '../architecture/parser.ts'
import { convertToElkFormat } from '../layout-engine.ts'
import { preprocessMermaidSource } from '../mermaid-source.ts'
import { measureMultilineText } from '../text-metrics.ts'
import { renderMermaidSVG, renderMermaidSVGWithReceipt } from '../index.ts'
import { layoutMermaidWithReceipt } from '../agent/index.ts'
import raynerGroups from './testdata/rayner-528/architecture-groups.json'

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

function segmentCrossesBoxInterior(
  a: { x: number; y: number },
  b: { x: number; y: number },
  box: { x: number; y: number; width: number; height: number },
): boolean {
  const EPS = 0.001
  if (Math.abs(a.y - b.y) <= EPS) {
    return a.y > box.y + EPS && a.y < box.y + box.height - EPS
      && Math.min(a.x, b.x) < box.x + box.width - EPS
      && Math.max(a.x, b.x) > box.x + EPS
  }
  if (Math.abs(a.x - b.x) <= EPS) {
    return a.x > box.x + EPS && a.x < box.x + box.width - EPS
      && Math.min(a.y, b.y) < box.y + box.height - EPS
      && Math.max(a.y, b.y) > box.y + EPS
  }
  return true
}

function routeCrossesBoxInterior(
  points: Array<{ x: number; y: number }>,
  box: { x: number; y: number; width: number; height: number },
): boolean {
  return points.slice(1).some((point, index) => segmentCrossesBoxInterior(points[index]!, point, box))
}

function boxesOverlap(
  a: { x: number; y: number; width: number; height: number },
  b: { x: number; y: number; width: number; height: number },
): boolean {
  return a.x < b.x + b.width - 0.001 && b.x < a.x + a.width - 0.001
    && a.y < b.y + b.height - 0.001 && b.y < a.y + a.height - 0.001
}

describe('layoutArchitectureDiagram', () => {
  it.each(raynerGroups)('keeps the original Rayner $id groups separate without losing row alignment or ports', ({ source, style }) => {
    let svg = ''
    expect(() => { svg = renderMermaidSVG(source, { style }) }).not.toThrow()
    const { layout: projected } = layoutMermaidWithReceipt(source, { style, debug: true })
    for (let i = 0; i < projected.groups.length; i++) {
      const a = projected.groups[i]!
      for (const b of projected.groups.slice(i + 1)) {
        const overlap = a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h
        expect(overlap, `${a.id}/${b.id}`).toBe(false)
      }
    }
    const nodes = ['k1', 'k2', 'k3'].map(id => projected.nodes.find(node => node.id === id)!)
    expect(nodes[1]!.y + nodes[1]!.h / 2).toBeCloseTo(nodes[0]!.y + nodes[0]!.h / 2)
    expect(nodes[2]!.y + nodes[2]!.h / 2).toBeCloseTo(nodes[0]!.y + nodes[0]!.h / 2)
    expect(svg).toContain('data-id="k3"')
    const authoredEdges = parse(source).edges
    const anchor = (node: typeof nodes[number], side: string) => ({
      x: side === 'L' ? node.x : side === 'R' ? node.x + node.w : node.x + node.w / 2,
      y: side === 'T' ? node.y : side === 'B' ? node.y + node.h : node.y + node.h / 2,
    })
    for (const [index, edge] of projected.edges.entries()) {
      const from = projected.nodes.find(node => node.id === edge.from)!
      const to = projected.nodes.find(node => node.id === edge.to)!
      expect(from).toBeDefined()
      expect(to).toBeDefined()
      expect(edge.path.length).toBeGreaterThan(1)
      const start = anchor(from, authoredEdges[index]!.source.side), end = anchor(to, authoredEdges[index]!.target.side)
      // Public layout boxes and paths round independently to integer units.
      expect(Math.abs(edge.path[0]![0] - start.x)).toBeLessThanOrEqual(1)
      expect(Math.abs(edge.path[0]![1] - start.y)).toBeLessThanOrEqual(1)
      expect(Math.abs(edge.path.at(-1)![0] - end.x)).toBeLessThanOrEqual(1)
      expect(Math.abs(edge.path.at(-1)![1] - end.y)).toBeLessThanOrEqual(1)
      expect(edge.route).toMatchObject({
        sourceAnchored: true, targetAnchored: true, obstacleFree: true,
        sourceSide: authoredEdges[index]!.source.side, targetSide: authoredEdges[index]!.target.side,
      })
      for (const obstacle of projected.nodes.filter(node => node.id !== edge.from && node.id !== edge.to)) {
        expect(routeCrossesBoxInterior(edge.path.map(([x, y]) => ({ x, y })), {
          x: obstacle.x, y: obstacle.y, width: obstacle.w, height: obstacle.h,
        }), `${edge.id} crosses ${obstacle.id}`).toBe(false)
      }
    }
  })

  it.each(['nested', 'columns', 'reversed row', 'reversed columns', 'wide headers'])('keeps expanded aligned group frames separate with %s', variant => {
    let source = raynerGroups[0]!.source
    if (variant === 'nested') {
      source = source.replace('architecture-beta', 'architecture-beta\n  group fleet[Cluster]')
        .replace(/group (n\d)\[ \]/g, 'group $1[ ] in fleet')
    } else if (variant === 'columns') source += '\n  align column k1 a\n  align column k2 b\n  align column k3 c'
    else if (variant === 'reversed columns') source += '\n  align column a k1\n  align column b k2\n  align column c k3'
    else if (variant === 'reversed row') source = source.replace('align row k1 k2 k3', 'align row k3 k2 k1')
    else source = source.replace(/group (n\d)\[ \]/g, 'group $1[An intentionally wide group header]')
    const { layout: projected } = layoutMermaidWithReceipt(source, { style: 'github-light' })
    const nodes = ['k1', 'k2', 'k3'].map(id => projected.nodes.find(node => node.id === id)!)
    for (const node of nodes) expect(node.y + node.h / 2).toBeCloseTo(nodes[0]!.y + nodes[0]!.h / 2)
    const groups = ['n1', 'n2', 'n3'].map(id => projected.groups.find(group => group.id === id)!)
    for (let i = 0; i < groups.length; i++) for (const other of groups.slice(i + 1)) {
      const a = groups[i]!
      expect(a.x < other.x + other.w && other.x < a.x + a.w && a.y < other.y + other.h && other.y < a.y + a.h).toBe(false)
    }
    if (variant.includes('columns')) for (const [node, pod] of [['k1', 'a'], ['k2', 'b'], ['k3', 'c']]) {
      const a = projected.nodes.find(entry => entry.id === node)!, b = projected.nodes.find(entry => entry.id === pod)!
      expect(a.x + a.w / 2).toBeCloseTo(b.x + b.w / 2)
    }
    expect(renderMermaidSVG(source, { style: 'github-light' })).toContain('data-id="k1"')
  })

  it('retains the authored Output row when transitive columns constrain the preceding layers', () => {
    const source = collectSamples().find(sample => sample.id === 'corpus/architecture/3')!.source
    const { layout: projected } = layoutMermaidWithReceipt(source, { debug: true })
    const row = ['brief', 'analyst', 'delivery'].map(id => projected.nodes.find(node => node.id === id)!)
    for (const node of row) expect(node.y + node.h / 2).toBeCloseTo(row[0]!.y + row[0]!.h / 2)
    for (const edge of projected.edges) expect(edge.route).toMatchObject({
      sourceAnchored: true, targetAnchored: true, obstacleFree: true, placement: 'satisfied',
    })
    expect(renderMermaidSVG(source)).toContain('data-id="analyst"')
  })

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

  // The renderer draws an icon group's title after its icon, so a group widened
  // for a long title has to hold the icon's offset as well as the title.
  it('widens an icon group narrower than its title to hold the icon and the title', () => {
    const title = 'Regional ingestion and replay services'
    const group = layout(`architecture-beta
      group g(cloud)[${title}]
      service s(server)[S] in g`).groups[0]!
    const visual = DEFAULT_ARCHITECTURE_VISUAL
    const titleWidth = measureMultilineText(title, visual.groupFontSize, visual.groupFontWeight, visual.groupLetterSpacing).width
    expect(group.width).toBeGreaterThanOrEqual(ARCHITECTURE_GROUP_ICON_TITLE_OFFSET + titleWidth)
  })

  // Random multi-group diagrams: 1-2 cloud groups of 2-3 services, optional
  // junctions, and up to five side-anchored edges between services.
  const sides = ['L', 'R', 'T', 'B']
  const groupedArchitectureArb = fc.record({
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


  // Each invariant is reported by name and element, so a failing run says which
  // one broke instead of returning a bare false.
  const GROUP_EPS = 0.5
  function groupedLayoutViolations(source: string): string[] {
    const result = layout(source)
    const violations: string[] = []
    const groupById = new Map(result.groups.map(g => [g.id, g]))
    for (const n of [...result.services, ...result.junctions]) {
      const g = n.parentId ? groupById.get(n.parentId) : undefined
      if (g && !(n.x >= g.x - GROUP_EPS && n.y >= g.y - GROUP_EPS
        && n.x + n.width <= g.x + g.width + GROUP_EPS && n.y + n.height <= g.y + g.height + GROUP_EPS)) {
        violations.push(`containment: ${n.id} escapes ${g.id}`)
      }
    }
    result.services.forEach((service, index) => {
      for (const other of result.services.slice(index + 1)) {
        if (boxesOverlap(service, other)) violations.push(`card overlap: ${service.id} / ${other.id}`)
      }
    })
    const rootGroups = result.groups.filter(group => !group.parentId)
    rootGroups.forEach((group, index) => {
      for (const other of rootGroups.slice(index + 1)) {
        if (boxesOverlap(group, other)) violations.push(`root group overlap: ${group.id} / ${other.id}`)
      }
    })
    for (const edge of result.edges) {
      const id = `${edge.source.id}->${edge.target.id}`
      if (!edge.obstacleFree) violations.push(`router reports obstacle: ${id}`)
      for (const service of result.services) {
        if (routeCrossesBoxInterior(edge.points, service)) {
          violations.push(`route through card: ${id} crosses ${service.id}`)
        }
      }
      for (const [endpoint, contact, adjacent] of [
        [edge.source, edge.points[0]!, edge.points[1]!],
        [edge.target, edge.points.at(-1)!, edge.points.at(-2)!],
      ] as const) {
        const outward = endpoint.side === 'L' ? adjacent.x < contact.x
          : endpoint.side === 'R' ? adjacent.x > contact.x
            : endpoint.side === 'T' ? adjacent.y < contact.y : adjacent.y > contact.y
        if (!outward) violations.push(`inward endpoint approach: ${id} at ${endpoint.id}:${endpoint.side}`)
      }
    }
    return violations
  }

  // Property: containment is a structural invariant, not a property of one
  // example — for ANY architecture, every service/junction declared `in` a group
  // must lie within that group's frame, cards and root groups never overlap, and
  // edges route clear of every other card.
  it('grouped layouts keep containment, card/group separation, and card-clear routes (property)', () => {
    fc.assert(
      fc.property(groupedArchitectureArb, source => {
        expect(groupedLayoutViolations(source)).toEqual([])
      }),
      fcParameters({
        numRuns: 300,
        // Graph crossing preferences must not score the temporary routes that
        // Architecture replaces with its authored side-specific projection.
        examples: [['architecture-beta\n  group g0(cloud)[Group 0]\n  service s0_0(server)[Svc s0_0] in g0\n  service s0_1(server)[Svc s0_1] in g0\n  service s0_2(server)[Svc s0_2] in g0\n  group g1(cloud)[Group 1]\n  service s1_0(server)[Svc s1_0] in g1\n  service s1_1(server)[Svc s1_1] in g1\n  s1_0:L --> L:s0_1\n  s1_1:L --> T:s0_0'],
          ["architecture-beta\n  group g0(cloud)[Group 0]\n  service s0_0(server)[Svc s0_0] in g0\n  service s0_1(server)[Svc s0_1] in g0\n  service s0_2(server)[Svc s0_2] in g0\n  group g1(cloud)[Group 1]\n  service s1_0(server)[Svc s1_0] in g1\n  service s1_1(server)[Svc s1_1] in g1\n  s1_0:L --> L:s0_2\n  s1_1:L --> L:s0_1\n  s0_1:L --> L:s1_0\n  s0_0:B --> B:s0_1"],
          ["architecture-beta\n  group g0(cloud)[Group 0]\n  service s0_0(server)[Svc s0_0] in g0\n  service s0_1(server)[Svc s0_1] in g0\n  group g1(cloud)[Group 1]\n  service s1_0(server)[Svc s1_0] in g1\n  service s1_1(server)[Svc s1_1] in g1\n  service s1_2(server)[Svc s1_2] in g1\n  s1_0:T --> L:s0_0\n  s1_0:L --> L:s1_1\n  s1_2:L --> L:s1_1\n  s0_0:L --> L:s1_1"],
          ["architecture-beta\n  group g0(cloud)[Group 0]\n  service s0_0(server)[Svc s0_0] in g0\n  service s0_1(server)[Svc s0_1] in g0\n  junction j0 in g0\n  group g1(cloud)[Group 1]\n  service s1_0(server)[Svc s1_0] in g1\n  service s1_1(server)[Svc s1_1] in g1\n  s1_0:L --> L:s0_1\n  s0_0:L --> L:s0_1\n  s0_0:L --> L:s0_1\n  s1_0:L --> T:s0_0"],
          ["architecture-beta\n  group g0(cloud)[Group 0]\n  service s0_0(server)[Svc s0_0] in g0\n  service s0_1(server)[Svc s0_1] in g0\n  service s0_2(server)[Svc s0_2] in g0\n  group g1(cloud)[Group 1]\n  service s1_0(server)[Svc s1_0] in g1\n  service s1_1(server)[Svc s1_1] in g1\n  s0_2:L --> L:s0_0\n  s0_1:B --> B:s0_0\n  s0_0:L --> L:s0_1\n  s1_0:L --> L:s0_0\n  s1_0:L --> L:s0_0"],
          ["architecture-beta\n  group g0(cloud)[Group 0]\n  service s0_0(server)[Svc s0_0] in g0\n  service s0_1(server)[Svc s0_1] in g0\n  group g1(cloud)[Group 1]\n  service s1_0(server)[Svc s1_0] in g1\n  service s1_1(server)[Svc s1_1] in g1\n  service s1_2(server)[Svc s1_2] in g1\n  s1_0:L --> L:s0_0\n  s0_0:L --> L:s1_1\n  s1_2:B --> B:s1_0\n  s1_2:L --> L:s0_0\n  s1_2:L --> L:s1_1"],
          ["architecture-beta\n  group g0(cloud)[Group 0]\n  service s0_0(server)[Svc s0_0] in g0\n  service s0_1(server)[Svc s0_1] in g0\n  junction j0 in g0\n  group g1(cloud)[Group 1]\n  service s1_0(server)[Svc s1_0] in g1\n  service s1_1(server)[Svc s1_1] in g1\n  s1_0:L --> L:s0_1\n  s0_0:L --> L:s0_1\n  s0_0:L --> L:s0_1\n  s0_0:T --> T:s0_1"],
          ["architecture-beta\n  group g0(cloud)[Group 0]\n  service s0_0(server)[Svc s0_0] in g0\n  service s0_1(server)[Svc s0_1] in g0\n  service s0_2(server)[Svc s0_2] in g0\n  group g1(cloud)[Group 1]\n  service s1_0(server)[Svc s1_0] in g1\n  service s1_1(server)[Svc s1_1] in g1\n  s1_0:L --> L:s0_1\n  s0_0:L --> L:s0_1\n  s0_0:L --> L:s0_1\n  s0_2:B --> B:s0_1"],
          ['architecture-beta\n  group g0(cloud)[Group 0]\n  service s0_0(server)[Svc s0_0] in g0\n  service s0_1(server)[Svc s0_1] in g0\n  service s0_2(server)[Svc s0_2] in g0\n  group g1(cloud)[Group 1]\n  service s1_0(server)[Svc s1_0] in g1\n  service s1_1(server)[Svc s1_1] in g1\n  s0_0:L --> L:s1_0\n  s0_0:T --> T:s0_1\n  s0_2:L --> L:s1_0\n  s0_1:L --> L:s1_0']],
      }),
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

  // A1/B03 regression: the old midpoint dogleg drew the a→c shortcut straight
  // through b. Authored endpoint sides are necessary but insufficient: every
  // non-incident service is a routing obstacle.
  it('routes a shortcut around an intervening service while retaining authored sides', () => {
    const result = layout(`architecture-beta
      service a(server)[A]
      service b(server)[B]
      service c(server)[C]
      a:R --> L:b
      b:R --> L:c
      a:R -[shortcut]-> L:c`)
    const shortcut = result.edges[2]!
    const a = result.services.find(service => service.id === 'a')!
    const b = result.services.find(service => service.id === 'b')!
    const c = result.services.find(service => service.id === 'c')!

    expect(shortcut.points[0]).toEqual({ x: a.x + a.width, y: a.y + a.height / 2 })
    expect(shortcut.points.at(-1)).toEqual({ x: c.x, y: c.y + c.height / 2 })
    expect(shortcut.points.every((point, index, points) => index === 0 || point.x === points[index - 1]!.x || point.y === points[index - 1]!.y)).toBe(true)
    expect(routeCrossesBoxInterior(shortcut.points, b)).toBe(false)
    expect(distanceToPolyline(shortcut.labelPosition!, shortcut.points)).toBeLessThanOrEqual(0.001)
  })

  it('every chain shortcut clears every intermediate card', () => {
    // A finite domain (3..8 services): every length runs.
    for (let count = 3; count <= 8; count++) {
      const lines = ['architecture-beta']
      for (let i = 0; i < count; i++) lines.push(`service s${i}(server)[S${i}]`)
      for (let i = 1; i < count; i++) lines.push(`s${i - 1}:R --> L:s${i}`)
      lines.push(`s0:R -[shortcut]-> L:s${count - 1}`)
      const result = layout(lines.join('\n'))
      const shortcut = result.edges.at(-1)!
      const intermediates = result.services.filter(service => service.id !== 's0' && service.id !== `s${count - 1}`)
      expect({ count, orthogonal: shortcut.points.every((point, index, points) => index === 0 || point.x === points[index - 1]!.x || point.y === points[index - 1]!.y) }).toEqual({ count, orthogonal: true })
      expect({ count, crossed: intermediates.filter(service => routeCrossesBoxInterior(shortcut.points, service)).map(service => service.id) }).toEqual({ count, crossed: [] })
    }
  })

  it('routes group-boundary shortcuts around an unrelated group interior', () => {
    const result = layout(`architecture-beta
      group ga(cloud)[A]
      service a(server)[A] in ga
      group gb(cloud)[B]
      service b(server)[B] in gb
      group gc(cloud)[C]
      service c(server)[C] in gc
      a{group}:R --> L:b{group}
      b{group}:R --> L:c{group}
      a{group}:R -[shortcut]-> L:c{group}`)
    const middle = result.groups.find(group => group.id === 'gb')!
    const shortcut = result.edges[2]!
    expect(routeCrossesBoxInterior(shortcut.points, middle)).toBe(false)
    expect(shortcut.obstacleFree).toBe(true)
    expect(shortcut.placement).toBe('satisfied')
  })

  it('treats every satisfiable endpoint-side pair as placement constraints and classifies legal conflicts', () => {
    const sides = ['L', 'R', 'T', 'B'] as const
    const axis = (side: typeof sides[number]) => side === 'L' || side === 'R' ? 'x' : 'y'
    for (const sourceSide of sides) {
      for (const targetSide of sides) {
        const result = layout(`architecture-beta
          service a(server)[A]
          service b(server)[B]
          a:${sourceSide} --> ${targetSide}:b`)
        const edge = result.edges[0]!
        const impossible = axis(sourceSide) === axis(targetSide) && sourceSide === targetSide
        expect({ sourceSide, targetSide, placement: edge.placement }).toEqual({
          sourceSide,
          targetSide,
          placement: impossible ? 'conflicted' : 'satisfied',
        })
        expect(edge.sourceFacesTarget && edge.targetFacesSource).toBe(!impossible)
        expect(edge.obstacleFree).toBe(true)
      }
    }
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


// The literal band/contacts below are independent of the route-obstacle helper.
it.each(['agentic', 'elk'] as const)('keeps %s item-side shafts outside their own ancestor header in final SVG', backend => {
  const source = 'architecture-beta\ngroup g(cloud)[Group]\nservice a(server)[A] in g\nservice b(server)[B]\na:T --> B:b'
  const options = { graphLayout: { backend, fallback: 'none' as const } }
  const positioned = layoutArchitectureDiagram(parse(source), options)
  const group = positioned.groups[0]!, edge = positioned.edges[0]!
  expect({ x: group.x, y: group.y, width: group.width, height: group.headerHeight }).toEqual({ x: 38, y: 124, width: 156, height: 28 })
  expect(edge.source).toEqual({ id: 'a', boundary: 'item', side: 'T' })
  expect(edge.target).toEqual({ id: 'b', boundary: 'item', side: 'B' })
  expect(edge.points[0]).toEqual({ x: 116, y: 168 })
  expect(edge.points.at(-1)).toEqual({ x: 116, y: 88 })
  expect(edge.obstacleFree).toBe(true)
  const rendered = renderMermaidSVGWithReceipt(source, { ...options, idPrefix: `owned-header-${backend}-` })
  expect(rendered.svg).toContain('d="M38,124 H194 V152 H38 Z"')
  const tag = [...rendered.svg.matchAll(/<polyline\b[^>]*>/g)].map(match => match[0]).find(value => value.includes('data-from="a"') && value.includes('data-to="b"'))!
  expect(tag).toContain('data-from-side="T"')
  expect(tag).toContain('data-to-side="B"')
  expect(tag).toContain('data-from-boundary="item"')
  expect(tag).toContain('data-to-boundary="item"')
  expect(tag).toContain('marker-end="url(')
  const points = /points="([^"]+)"/.exec(tag)![1]!.split(' ').map(value => { const [x, y] = value.split(',').map(Number); return { x: x!, y: y! } })
  expect(points).toEqual(edge.points)
  for (let index = 1; index < points.length; index++) {
    const a = points[index - 1]!, b = points[index]!
    const entersLiteralBand = Math.max(a.x, b.x) > 38 && Math.min(a.x, b.x) < 194
      && Math.max(a.y, b.y) > 124 && Math.min(a.y, b.y) < 152
    expect(entersLiteralBand).toBe(false)
  }
  expect(edge.points[1]).toEqual({ x: 116, y: 152 })
  expect(edge.points.at(-2)).toEqual({ x: 116, y: 104 })
})


it('draws an empty Architecture group as a visible frame under its measured header band', () => {
  const source = 'architecture-beta\ngroup edge(cloud)[Edge]\ngroup cloud(cloud)[Cloud]\ngroup storage(disk)[Storage] in cloud\ngroup app(server)[Application] in cloud\nservice api(server)[Public API] in app\njunction bus in app\nservice db(database)[Primary DB]\napi:R --> L:db\napi:B -["async fan-out"]-> T:bus'
  const svg = renderMermaidSVGWithReceipt(source, { graphLayout: { backend: 'elk' } }).svg
  const visual = DEFAULT_ARCHITECTURE_VISUAL
  const frame = (id: string) => {
    const tag = new RegExp(`<rect class="architecture-group-frame" x="([\\d.]+)" y="([\\d.]+)" width="([\\d.]+)" height="([\\d.]+)"[^>]*data-id="group-frame:${id}"`).exec(svg)!
    const [x, y, width, height] = tag.slice(1).map(Number) as [number, number, number, number]
    return { x, y, width, height }
  }
  const bands = [...svg.matchAll(/class="architecture-group-band" d="M([\d.]+),([\d.]+) H([\d.]+) V([\d.]+)/g)].map(match => match.slice(1).map(Number) as [number, number, number, number])
  // Empty groups, top-level and nested, keep a body below the header that holds
  // the icon and the whole title, inside any parent frame and clear of siblings.
  for (const [id, title] of [['edge', 'Edge'], ['storage', 'Storage']] as const) {
    const box = frame(id)
    const titleWidth = measureMultilineText(title, visual.groupFontSize, visual.groupFontWeight, visual.groupLetterSpacing).width
    expect(box.width, id).toBeGreaterThanOrEqual(ARCHITECTURE_GROUP_ICON_TITLE_OFFSET + titleWidth)
    expect(box.height, id).toBeGreaterThan(28)
    expect(bands.some(([x, y, right, bottom]) => x === box.x && y === box.y && Math.abs(right - (box.x + box.width)) < 1e-6 && bottom - y === 28), id).toBe(true)
  }
  const [storage, app, cloud] = [frame('storage'), frame('app'), frame('cloud')]
  expect(storage.x >= cloud.x && storage.y >= cloud.y && storage.x + storage.width <= cloud.x + cloud.width && storage.y + storage.height <= cloud.y + cloud.height).toBe(true)
  expect(storage.x + storage.width <= app.x || app.x + app.width <= storage.x || storage.y + storage.height <= app.y || app.y + app.height <= storage.y).toBe(true)
  const edgeTags = [...svg.matchAll(/<polyline\b[^>]*class="architecture-edge"[^>]*>/g)].map(match => match[0])
  expect(edgeTags.map(tag => /data-from="(\w+)" data-to="(\w+)"/.exec(tag)!.slice(1).join('->'))).toEqual(['api->db', 'api->bus'])
  for (const tag of edgeTags) {
    expect(tag).toContain('marker-end="url(')
    const points = /points="([^"]+)"/.exec(tag)![1]!.split(' ').map(value => value.split(',').map(Number))
    // No emitted route enters any group's header band.
    for (let index = 1; index < points.length; index++) {
      const a = points[index - 1]!, b = points[index]!
      for (const [x, y, right, bottom] of bands) {
        expect(Math.max(a[0]!, b[0]!) > x && Math.min(a[0]!, b[0]!) < right && Math.max(a[1]!, b[1]!) > y && Math.min(a[1]!, b[1]!) < bottom).toBe(false)
      }
    }
  }
})
