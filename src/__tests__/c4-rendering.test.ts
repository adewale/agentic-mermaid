import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { renderMermaidSVG, renderMermaidASCII } from '../index.ts'
import { renderMermaidASCIIWithMeta } from '../ascii/meta.ts'
import { parseC4Diagram } from '../c4/parser.ts'
import { layoutC4Diagram } from '../c4/layout.ts'
import { lowerC4Scene } from '../c4/renderer.ts'
import type { Point, PositionedGroup } from '../types.ts'
import { measureRenderedText, renderedTextReady } from './helpers/rendered-text.ts'

const center = (box: { x: number; y: number; width: number; height: number }) => ({ x: box.x + box.width / 2, y: box.y + box.height / 2 })
const groups = (items: PositionedGroup[]): PositionedGroup[] => items.flatMap(item => [item, ...groups(item.children)])
const crosses = (a: Point, b: Point, box: { x: number; y: number; width: number; height: number }) => a.x === b.x
  ? a.x > box.x && a.x < box.x + box.width && Math.max(a.y, b.y) > box.y && Math.min(a.y, b.y) < box.y + box.height
  : a.y > box.y && a.y < box.y + box.height && Math.max(a.x, b.x) > box.x && Math.min(a.x, b.x) < box.x + box.width
const intersects = (a: { x: number; y: number; width: number; height: number }, b: { x: number; y: number; width: number; height: number }) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height

const NESTED = `C4Deployment
Deployment_Node(region, "Region", "cloud", "Primary") {
  Node_L(zone, "Zone", "availability zone", "Left aligned") {
    Node_R(host, "Host", "VM", "Right aligned") {
      Container(api, "API", "Node.js", "Serves requests")
      ContainerDb_Ext(db, "Store", "SQL", "Managed externally")
    }
  }
  Node(empty, "Spare", "VM") {}
}
System_Ext(external, "Partner")
Rel(region, api, "Deploys")
Rel(api, empty, "Failover")
BiRel(host, external, "Connects", "TLS")`

describe('native C4 geometry and display', () => {
  test('person silhouettes stay clear of measured text when node padding is reduced and retain an outline for hatch styles', async () => {
    const source = 'C4Context\nPerson(a,"Customer","Uses the shop")'
    const svg = renderMermaidSVG(source, { style: { roles: { node: { paddingY: 0 } } } })
    await renderedTextReady()
    const label = measureRenderedText(svg).texts.find(text => text.content.includes('Customer'))!
    const shoulders = svg.match(/<path\b[^>]*data-id="c4:a:person-shoulders"[^>]*>/)![0]
    const bottom = Number(shoulders.match(/d="M [-\d.]+ ([-\d.]+)/)![1])
    expect(bottom, 'the complete figure must finish above its first rendered label glyph').toBeLessThan(label.box!.y)
    // Hatch backends preserve a supplied outline; fill-only icons become
    // disconnected hatch strokes and lose their person silhouette.
    const head = svg.match(/<circle\b[^>]*data-id="c4:a:person-head"[^>]*>/)![0]
    for (const figure of [head, shoulders]) {
      expect(figure).toMatch(/\sstroke="(?!none")/)
      expect(Number(figure.match(/stroke-width="([^"]+)"/)![1])).toBeGreaterThan(0)
    }
  })

  test('the checkout example keeps complete relationship label halos clear of all card surfaces', () => {
    const source = readFileSync(new URL('../../docs/design/families/c4-context-demo.mmd', import.meta.url), 'utf8')
    const positioned = layoutC4Diagram(parseC4Diagram(source))
    for (const edge of positioned.edges) {
      const at = edge.labelPosition!, block = edge.labelBlock!
      const label = { x: at.x - block.width / 2 - 10, y: at.y - block.height / 2 - 8, width: block.width + 20, height: block.height + 16 }
      for (const node of positioned.nodes) expect(intersects(label, node), `${edge.id} must not be covered by ${node.id}`).toBe(false)
    }
  })

  test('ordinary fan-out reserves ports without sizing the hub as a stack of parallel labels', () => {
    const base = 'C4Context\nSystem(hub,"API")\nSystem(a,"A")\nRel(hub,a,"Uses")'
    const fanout = base + '\nSystem(b,"B")\nSystem(c,"C")\nSystem(d,"D")\nRel(hub,b,"Uses")\nRel(hub,c,"Uses")\nRel(hub,d,"Uses")'
    const repeated = base + '\nRel(hub,a,"Second")\nRel_Back(hub,a,"Reply")'
    const hub = (source: string) => layoutC4Diagram(parseC4Diagram(source)).nodes.find(node => node.id === 'hub')!
    expect(hub(fanout).height).toBe(hub(base).height)
    expect(hub(repeated).height).toBeGreaterThan(hub(base).height)
  })

  for (const variant of ['C4Context', 'C4Container', 'C4Component', 'C4Dynamic', 'C4Deployment']) test(`${variant} exposes native cards and routed relations in SVG and plain text`, () => {
    const source = `${variant}\nPerson(user, "Customer")\nComponentQueue_Ext(queue, "Inbox", "AMQP", "Durable events")\nRel(user, queue, "Sends", "TLS")`
    const svg = renderMermaidSVG(source), text = renderMermaidASCII(source, { colorMode: 'none' })
    for (const label of ['Customer', 'Inbox', 'AMQP', 'Durable events', 'External Component', 'Queue', 'TLS']) { expect(svg).toContain(label); expect(text).toContain(label) }
    expect(svg).toContain('<circle')
    expect(svg).toContain('data-c4-shape="queue"')
    expect(svg).toContain('data-c4-macro="Rel"')
    expect(svg).not.toContain('var(--_surface)')
    expect(text).toContain('/|\\')
    expect(text).toContain('Legend')
  })

  for (const [macro, axis, sign] of [['Rel_L', 'x', -1], ['Rel_R', 'x', 1], ['Rel_U', 'y', -1], ['Rel_D', 'y', 1]] as const) test(`${macro} moves the target without reversing the arrow`, () => {
    const source = `C4Context\nSystem(a, "A")\nSystem(b, "B")\n${macro}(a,b,"Uses")`
    const positioned = layoutC4Diagram(parseC4Diagram(source)), a = center(positioned.nodes.find(n => n.id === 'a')!), b = center(positioned.nodes.find(n => n.id === 'b')!)
    expect((b[axis] - a[axis]) * sign).toBeGreaterThan(0)
    expect(positioned.edges[0]).toMatchObject({ source: 'a', target: 'b', hasArrowEnd: true, hasArrowStart: false })
    const terminal = renderMermaidASCIIWithMeta(source, { colorMode: 'none' }), card = (id: string) => terminal.regions.find(region => region.id === id && region.kind === 'node')!
    expect(terminal.warnings.some(w => w.code === 'ASCII_RENDER_FAILED')).toBe(false)
    const terminalCenter = (id: string) => axis === 'x' ? (card(id).canvasColStart + card(id).canvasColEnd) / 2 : card(id).canvasRow + (card(id).rowSpan ?? 1) / 2
    expect((terminalCenter('b') - terminalCenter('a')) * sign).toBeGreaterThan(0)
    expect(terminal.regions.find(region => region.kind === 'edge')).toMatchObject({ from: 'a', to: 'b' })
  })

  test('parallel, reverse, bidirectional and self interactions have distinct owned routes and labels', () => {
    const source = `C4Dynamic
Person(c4_rel_1, "Customer")
Container(api, "API", "HTTPS", "Handles requests")
RelIndex(7, c4_rel_1, api, "First")
Rel(c4_rel_1, api, "Second", "HTTPS")
Rel_Back(c4_rel_1, api, "Reply")
BiRel(c4_rel_1, api, "Sync")
Rel(api, api, "Retry", "timer")`
    const model = parseC4Diagram(source), terminal = renderMermaidASCIIWithMeta(source, { colorMode: 'none' }), edges = terminal.regions.filter(region => region.kind === 'edge')
    expect(edges).toHaveLength(5)
    expect(new Set(edges.map(edge => edge.id)).size).toBe(5)
    for (const relationship of model.relationships) {
      const edge = edges.find(edge => edge.id === relationship.id)!
      expect(edge).toMatchObject({ from: relationship.source, to: relationship.target })
      expect(edge.ownedCellSpans!.length).toBeGreaterThan(1)
      expect(edge.ports).toHaveLength(2)
      expect(edge.projectedText).toContain(relationship.label)
      expect(edge.ports!.reduce((count, port) => count + (port.markers?.length ?? 0), 0)).toBe(relationship.bidirectional ? 2 : 1)
    }
    for (const label of ['7: First', '2: Second', '3: Reply', '4: Sync', '5: Retry', '[HTTPS]', '[timer]']) expect(terminal.ascii).toContain(label)
    expect(terminal.warnings.filter(w => /COLLISION|OVERLAP|UNMAPPED|UNAVAILABLE|FAILED/.test(w.code))).toEqual([])
    const svg = renderMermaidSVG(source)
    expect(svg).toContain('data-index="7"')
    expect(svg).toContain('data-relationship="c4-Rel_Back"')
  })

  test('mixed C4 composition preserves reserved IDs, companion labels, stroke defaults and paint order', () => {
    const source = `C4Dynamic
AddRelTag("async", $lineStyle="dotted", $lineColor="navy", $textColor="maroon")
System_Boundary(scope, "Scope") {
  System(a, "API")
  System(b, "Store")
  System("c4:c4-rel-1:relationship", "Reserved")
}
Rel(a,b,"First\trequest", $tags="async")
Rel(a,b,"Again", $tags="async")
Rel_Back(a,b,"Reply")
Rel(b,b,"Retry")`
    const positioned = layoutC4Diagram(parseC4Diagram(source), { diagramTitle: 'Composition title' })
    const scene = lowerC4Scene({ positioned, colors: { bg: '#fff', fg: '#111' }, resolved: { renderOptions: {} } })
    expect(scene.parts.slice(0, 8).map(part => part.id)).toEqual([
      'prelude', 'defs', 'diagram-title', 'c4:scope:frame',
      'c4:c4-rel-1:relationship#1', 'c4:c4-rel-2:relationship', 'c4:c4-rel-3:relationship', 'c4:c4-rel-4:relationship',
    ])
    expect(scene.parts.slice(-4).map(part => part.id)).toEqual([
      'c4:a:card', 'c4:b:card', 'c4:c4:c4-rel-1:relationship:card', 'svg-close',
    ])
    const routes = scene.parts.filter(part => part.kind === 'connector')
    expect(routes.map(route => [route.identity?.id, route.endpoints.from, route.endpoints.to, route.labels[0]?.id])).toEqual([
      ['c4-rel-1', 'a', 'b', 'edge:a->b#0:label'], ['c4-rel-2', 'a', 'b', 'edge:a->b#1:label'],
      ['c4-rel-3', 'b', 'a', 'edge:b->a#0:label'], ['c4-rel-4', 'b', 'b', 'edge:b->b#0:label'],
    ])
    expect(routes.map(route => route.labels[0]?.visual)).toEqual([
      { kind: 'companion', markId: 'c4:c4-rel-1:label-text' }, { kind: 'companion', markId: 'c4:c4-rel-2:label-text' },
      { kind: 'companion', markId: 'c4:c4-rel-3:label-text' }, { kind: 'companion', markId: 'c4:c4-rel-4:label-text' },
    ])
    expect(routes[0]?.labels[0]?.text).toBe('1: First request\n[tags: async]')
    expect(routes[0]?.labels[0]?.paint).toEqual({ fill: 'maroon' })
    for (const route of routes.slice(0, 2)) {
      expect(route.stroke).toMatchObject({ color: 'navy', dash: { array: '1 3' }, lineCap: 'butt', lineJoin: 'miter', miterLimit: 4, nonScaling: false })
      expect(route.hit).toMatchObject({ closed: false, strokeWidth: 6, pointerEvents: 'stroke' })
      expect(route.route).toMatchObject({ ownership: 'layout', closed: false })
      expect(route.labels[0]?.visual?.kind).toBe('companion')
    }
    const definitions = scene.parts.find(part => part.id === 'defs')
    if (definitions?.kind !== 'document') throw new Error('Expected C4 definitions')
    for (const route of routes) expect(definitions.markerResources).toContainEqual(route.markers.end!)
  })

  test('nested boundary endpoints reach actual frames while routes and labels clear leaf cards and header bands', () => {
    const model = parseC4Diagram(NESTED), positioned = layoutC4Diagram(model), frames = groups(positioned.groups)
    for (const edge of positioned.edges) {
      for (const [id, point] of [[edge.source, edge.points[0]!], [edge.target, edge.points.at(-1)!]] as const) {
        const frame = frames.find(frame => frame.id === id)
        if (frame) expect(point.x === frame.x || point.x === frame.x + frame.width || point.y === frame.y || point.y === frame.y + frame.height).toBe(true)
      }
      for (const node of positioned.nodes.filter(node => node.id !== edge.source && node.id !== edge.target)) for (let i = 1; i < edge.points.length; i++) expect(crosses(edge.points[i - 1]!, edge.points[i]!, node)).toBe(false)
      const block = edge.labelBlock!, at = edge.labelPosition!, label = { x: at.x - block.width / 2 - 10, y: at.y - block.height / 2 - 8, width: block.width + 20, height: block.height + 16 }
      for (const obstacle of [...positioned.nodes, ...frames.map(frame => ({ ...frame, height: frame.headerHeight! }))]) expect(intersects(label, obstacle)).toBe(false)
    }
    const terminal = renderMermaidASCIIWithMeta(NESTED, { colorMode: 'none' })
    expect(terminal.regions.find(region => region.id === 'host' && region.kind === 'cluster')).toMatchObject({ parentId: 'zone', members: ['api', 'db'] })
    expect(terminal.regions.find(region => region.id === 'empty' && region.kind === 'cluster')!.ownedCellSpans!.length).toBeGreaterThan(0)
    for (const relation of model.relationships) expect(terminal.regions.find(region => region.id === relation.id)).toMatchObject({ from: relation.source, to: relation.target })
    expect(terminal.warnings.filter(w => /COLLISION|OVERLAP|FAILED/.test(w.code))).toEqual([])
    const svg = renderMermaidSVG(NESTED)
    expect(svg).toContain('data-alignment="left"')
    expect(svg).toContain('data-alignment="right"')
    expect(svg).toContain('<ellipse')
  })

  test('mixed directional constraints and row counts change both independent allocations', () => {
    const source = 'C4Context\nSystem(a,"A")\nSystem(b,"B")\nSystem(c,"C")\nRel_R(a,b,"Right")\nRel_D(b,c,"Down")'
    const p = layoutC4Diagram(parseC4Diagram(source)), a = center(p.nodes[0]!), b = center(p.nodes[1]!), c = center(p.nodes[2]!)
    expect(b.x).toBeGreaterThan(a.x); expect(c.y).toBeGreaterThan(b.y)
    const rows = 'C4Context\nSystem(a,"A")\nSystem(b,"B")\nSystem(c,"C")\nUpdateLayoutConfig($c4ShapeInRow="1")'
    const one = layoutC4Diagram(parseC4Diagram(rows)), three = layoutC4Diagram(parseC4Diagram(rows.replace('="1"', '="3"')))
    expect(one.height).toBeGreaterThan(three.height)
    expect(renderMermaidASCII(rows).split('\n').length).toBeGreaterThan(renderMermaidASCII(rows.replace('="1"', '="3"')).split('\n').length)
  })

  test('literal display, effective safe links, styles and tag legends survive public rendering', () => {
    const source = `C4Container
AddElementTag("critical", $bgColor="#ffeeee", $legendText="Critical service")
ContainerDb(db,"資料 #lt;b#gt;literal#lt;/b#gt;", "SQL", "First<br/>Second", $tags="critical", $link="https://example.com/old")
System_Ext(client,"Client")
Rel(client,db,"Reads", $link="https://example.com/relation")
AddElementLink(db,"https://example.com/current")
UpdateElementStyle(db,$borderColor="blue",$fontColor="navy",$techn="PostgreSQL")
UpdateRelStyle(client,db,$lineColor="blue",$textColor="navy")
SHOW_LEGEND()`
    const svg = renderMermaidSVG(source), text = renderMermaidASCII(source, { colorMode: 'none' })
    expect(svg).toContain('data-href="https://example.com/current" role="link" tabindex="0"')
    expect(svg).toMatch(/<polyline class="edge"[^>]* data-href="https:\/\/example\.com\/relation" tabindex="0"[^>]* data-role="edge"/)
    expect(svg).toContain('fill="navy"')
    expect(svg).toContain('stroke="blue"')
    for (const phrase of ['Critical service', 'PostgreSQL', '[tags: critical]', 'First', 'Second']) { expect(svg).toContain(phrase); expect(text).toContain(phrase) }
    expect(text).toContain('<b>literal</b>')
    expect(svg).toContain('&lt;b&gt;literal&lt;/b&gt;')
    expect(renderMermaidSVG(source, { security: 'strict' })).not.toContain('data-href=')
    expect(renderMermaidSVG(source.replaceAll('https://example.com/current', 'javascript:alert(1)'))).not.toContain('data-href="javascript:')
  })

  test('large authored label offsets remain inside the final canvas', () => {
    const source = 'C4Context\nSystem(a,"A")\nSystem(b,"B")\nRel(a,b,"Calls")\nUpdateRelStyle(a,b,$offsetX="-1000",$offsetY="-1000")'
    const positioned = layoutC4Diagram(parseC4Diagram(source)), edge = positioned.edges[0]!, at = edge.labelPosition!, block = edge.labelBlock!
    expect(at.x - block.width / 2 - 10).toBeGreaterThanOrEqual(0)
    expect(at.y - block.height / 2 - 8).toBeGreaterThanOrEqual(0)
    expect(at.x + block.width / 2 + 10).toBeLessThanOrEqual(positioned.width)
    expect(at.y + block.height / 2 + 8).toBeLessThanOrEqual(positioned.height)
    expect(renderMermaidSVG(source)).toContain('Calls')
  })

  test('frontmatter title is drawn once by the native terminal document', () => {
    const source = '---\ntitle: Heading\n---\nC4Context\nSystem(a,"A")'
    expect(renderMermaidASCII(source).match(/Heading/g)).toHaveLength(1)
  })

  test('invalid element and relationship colors fail consistently before either projection draws', () => {
    for (const directive of ['UpdateElementStyle(a,$bgColor="#12345")', 'UpdateRelStyle(a,b,$lineColor="url(https://example.com/x)")']) {
      const source = `C4Context\nSystem(a,"A")\nSystem(b,"B")\nRel(a,b,"Uses")\n${directive}`
      expect(() => renderMermaidSVG(source)).toThrow('is not a CSS color')
      expect(() => renderMermaidASCII(source)).toThrow('is not a CSS color')
    }
  })
})
