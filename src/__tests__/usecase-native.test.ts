import { afterAll, describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { buildMermaid, layoutMermaid, mutate, parseRegisteredMermaid, parseUsecaseModel, renderMermaidASCII, renderMermaidSVG, renderMermaidSVGWithReceipt, renderResolvedScene, serializeMermaid, verifyMermaid } from '../agent/core.ts'
import { normalizeMermaidSource } from '../mermaid-source.ts'
import { type ParserObservation, withParserObservation } from '../shared/parser-observation.ts'
import { layoutUsecaseDiagram } from '../usecase/layout.ts'
import { parseUsecaseDiagram } from '../usecase/parser.ts'
import { serializeUsecase } from '../usecase/serializer.ts'
import { startUpstreamMermaid } from './helpers/upstream-mermaid.ts'
import fixture from './testdata/usecase/docs.json'

const upstream = startUpstreamMermaid()
afterAll(() => upstream.close())
const familyBody = (source: string) => {
  const normalized = normalizeMermaidSource(source)
  return normalized.authoredFamilyBody ?? normalized.familyBody
}
const source = `usecase-beta
direction LR
actor Customer("Customer")
systemBoundary Store["Storefront"]
  Browse("Browse catalogue")
  Checkout("Checkout")
end
Customer --> Checkout
Checkout ..> : include Browse
Browse ..> : extend Checkout
actor Admin
Admin --|> Customer`

// Adapted owning-boundary version of Mermaid12.2 usecase.docs.spec.ts. The
// imported examples retain pinned file/revision/license provenance in docs.json.
describe('pinned UseCase documentation', () => {
  for (const [index, example] of fixture.sources.entries())
    test(`example ${index + 1} retains typed meaning through writer and both renderers`, async () => {
      const body = parseUsecaseDiagram(familyBody(example)),
        written = serializeUsecase(body, false)
      expect(parseUsecaseDiagram(written)).toEqual(body)
      expect(await upstream.publicAccepts(written)).toBe(true)
      const parsed = parseRegisteredMermaid(example)
      if (!parsed.ok || parsed.value.body.kind !== 'usecase') throw new Error('Expected native UseCase')
      expect(renderMermaidSVG(parsed.value)).toBe(renderMermaidSVG(example))
      expect(renderMermaidASCII(parsed.value)).toBe(renderMermaidASCII(example))
    })
})

describe('native UseCase meaning and editing', () => {
  test('first source occurrences order final node kinds across references, groups and repeated declarations', () => {
    const body = parseUsecaseDiagram(`usecase-beta
note for Later "First reference"
Early --> Later
systemBoundary Store["Store"]
  Inside("Inside")
  Other("Other")
end
actor Later("Person")@{ icon: "fa:user" }
actor Start
Inside("Inside")
Later@{ icon: "fa:final" }
Early --> Inside`)
    expect(body.nodes.map(node => [node.id, node.kind, node.label, node.parentId])).toEqual([
      ['Later', 'actor', 'Person', undefined], ['Early', 'usecase', 'Early', undefined],
      ['Inside', 'usecase', 'Inside', 'Store'], ['Other', 'usecase', 'Other', 'Store'], ['Start', 'actor', 'Start', undefined],
    ])
    expect(body.nodes[0]).toMatchObject({ type: 'icon', icon: 'fa:final', business: false })
    expect(body.boundaries[0]?.members).toEqual(['Inside', 'Other'])
  })
  test('actors, boundary members, directed relationships and UML relation types remain distinct', () => {
    const body = parseUsecaseDiagram(source)
    expect(body.nodes.map(node => [node.id, node.kind, node.label, node.parentId])).toEqual([
      ['Customer', 'actor', 'Customer', undefined],
      ['Browse', 'usecase', 'Browse catalogue', 'Store'],
      ['Checkout', 'usecase', 'Checkout', 'Store'],
      ['Admin', 'actor', 'Admin', undefined],
    ])
    expect(body.boundaries).toMatchObject([{ id: 'Store', label: 'Storefront', members: ['Browse', 'Checkout'] }])
    expect(body.relationships.map(edge => [edge.source, edge.target, edge.type])).toEqual([
      ['Customer', 'Checkout', 'association'],
      ['Checkout', 'Browse', 'include'],
      ['Browse', 'Checkout', 'extend'],
      ['Admin', 'Customer', 'generalization'],
    ])
  })
  test('terminal placement honors the authored direction while retaining actor roles and associations', () => {
    for (const direction of ['LR', 'RL', 'TB', 'BT']) {
      const text = renderMermaidASCII(`usecase-beta\ndirection ${direction}\nactor A("Alpha")\nB("Beta")\nA --> B`),
        lines = text.split('\n'),
        alphaY = lines.findIndex(line => line.includes('Alpha')), betaY = lines.findIndex(line => line.includes('Beta')),
        alphaX = lines[alphaY]!.indexOf('Alpha'), betaX = lines[betaY]!.indexOf('Beta')
      expect(text).toContain('[actor]')
      if (direction === 'LR') expect(alphaX).toBeLessThan(betaX)
      else if (direction === 'RL') expect(alphaX).toBeGreaterThan(betaX)
      else if (direction === 'TB') expect(alphaY).toBeLessThan(betaY)
      else expect(alphaY).toBeGreaterThan(betaY)
    }
  })
  test('source grammar rejects unsupported constructs and clears failed parse state', () => {
    for (const unknown of ['package Foo', 'actor User\nnewpage', 'systemBoundary Store\nA\n', 'actor User@{ unexpected: true }', '"actor"']) {
      const source = `usecase-beta\n${unknown}`,
        parsed = parseRegisteredMermaid(source)
      expect(parsed.ok && parsed.value.body).toMatchObject({ kind: 'opaque', family: 'usecase' })
      if (parsed.ok) expect(serializeMermaid(parsed.value)).toBe(source.trimEnd() + '\n')
    }
    expect(parseUsecaseDiagram('usecase-beta\nactor Valid').nodes.map(node => node.id)).toEqual(['Valid'])
  })
  test('atomic native edits preserve boundaries and reject broken references', async () => {
    const parsed = parseRegisteredMermaid(source)
    if (!parsed.ok || parsed.value.body.kind !== 'usecase') throw new Error('Expected native UseCase')
    const original = serializeMermaid(parsed.value)
    expect(mutate(parsed.value, { kind: 'add_relationship', from: 'Missing', to: 'Browse' }).ok).toBe(false)
    expect(mutate(parsed.value, { kind: 'remove_node', id: 'Browse' }).ok).toBe(false)
    expect(serializeMermaid(parsed.value)).toBe(original)
    const edited = mutate(parsed.value, { kind: 'set_label', id: 'Browse', label: 'Browse "quotes" %%{ #35; safely' })
    if (!edited.ok || edited.value.body.kind !== 'usecase') throw new Error('Expected successful native label edit')
    expect(edited.value.body.nodes.find(node => node.id === 'Browse')).toMatchObject({ label: 'Browse "quotes" %%{ #35; safely', parentId: 'Store' })
    expect(await upstream.publicAccepts(serializeMermaid(edited.value))).toBe(true)
    const moved = mutate(edited.value, { kind: 'move_node', id: 'Browse', parentId: null })
    if (!moved.ok || moved.value.body.kind !== 'usecase') throw new Error('Expected native move')
    expect(moved.value.body.boundaries[0]!.members).toEqual(['Checkout'])
    const removed = mutate(parsed.value, { kind: 'remove_node', id: 'Store', cascade: true })
    if (!removed.ok || removed.value.body.kind !== 'usecase') throw new Error('Expected cascade removal')
    expect(removed.value.body.nodes.map(node => node.id)).toEqual(['Customer', 'Admin'])
    expect(removed.value.body.relationships.map(edge => edge.type)).toEqual(['generalization'])
  })
  test('final ellipse contacts lie on drawn outlines for parallel and reciprocal boundary edges', () => {
    const body = parseUsecaseDiagram(familyBody(fixture.sources[1]!)),
      chart = layoutUsecaseDiagram(body)
    expect(layoutUsecaseDiagram(body)).toEqual(chart)
    const nodes = new Map(chart.nodes.map(node => [node.id, node]))
    for (const edge of chart.edges)
      for (const [id, point] of [
        [edge.source, edge.points[0]!],
        [edge.target, edge.points.at(-1)!],
      ] as const) {
        const node = nodes.get(id)
        if (node?.shape !== 'ellipse') continue
        const dx = (point.x - node.x - node.width / 2) / (node.width / 2),
          dy = (point.y - node.y - node.height / 2) / (node.height / 2)
        expect(dx * dx + dy * dy).toBeCloseTo(1, 7)
      }
    for (const node of chart.nodes) expect(node.x + node.width).toBeLessThanOrEqual(chart.width)
    const verified = verifyMermaid(source)
    expect(verified.warnings.some(warning => warning.code === 'RENDER_FAILED')).toBe(false)
  })
  test('actor ports meet owned ink and avoid captions for parallel, reciprocal and self links in every direction', () => {
    const disclosed = layoutUsecaseDiagram(parseUsecaseDiagram('usecase-beta\nactor A\nB\nA --> B'))
    expect(disclosed.actors.get('A')!.boundary).toMatchObject({ kind: 'none', reason: expect.any(String) })
    expect(disclosed.certification).toBeUndefined()
    expect(disclosed.edges[0]!.routeCertificate).toBeUndefined()
    type P = { x: number; y: number }
    const cross = (a: P, b: P) => a.x * b.y - a.y * b.x
    const triangleContains = (p: P, triangle: P[]) => {
      const signs = triangle.map((a, index) => { const b = triangle[(index + 1) % 3]!; return cross({ x: b.x - a.x, y: b.y - a.y }, { x: p.x - a.x, y: p.y - a.y }) })
      return signs.every(sign => sign > 1e-8) || signs.every(sign => sign < -1e-8)
    }
    for (const direction of ['LR', 'RL', 'TB', 'BT']) for (const actor of ['actor A', 'actor A("Person responsible for customer support and escalation")@{ icon: "fa:user" }', 'actor A("Hollow actor")@{ type: hollow }']) {
      const source = `usecase-beta\ndirection ${direction}\nsystemBoundary Store["Store"]\n${actor}\nend\nB("Browse")\nA --> B\nB --> A\nA --> B\nA --> A`,
        options = { style: { roles: { node: { lineWidth: 6 } } } },
        parsed = parseRegisteredMermaid(source)
      if (!parsed.ok || parsed.value.body.kind !== 'usecase') throw new Error('Expected native UseCase')
      const scene = renderResolvedScene(source, options), layout = layoutMermaid(parsed.value, options),
        artwork = scene.svg.match(/<g\b[^>]*data-id="A"[^>]*>([\s\S]*?)<\/g>/)![1]!,
        circle = artwork.match(/<circle\b[^>]*>/)![0]!,
        attr = (tag: string, name: string) => Number(tag.match(new RegExp(`\\s${name}="([^"]+)"`))![1]),
        head = { x: attr(circle, 'cx'), y: attr(circle, 'cy'), r: attr(circle, 'r') },
        halfStroke = attr(circle, 'stroke-width') / 2,
        path = artwork.match(/<path\b[^>]*\sd="([^"]+)"/)![1]!,
        tokens = path.match(/[MLHV]|[-+]?(?:\d*\.)?\d+(?:e[-+]?\d+)?/gi)!,
        segments: [{ x: number; y: number }, { x: number; y: number }][] = []
      let cursor = { x: 0, y: 0 }
      for (let at = 0; at < tokens.length;) {
        const command = tokens[at++]!, next = command === 'H' ? { x: Number(tokens[at++]!), y: cursor.y } : command === 'V' ? { x: cursor.x, y: Number(tokens[at++]!) } : { x: Number(tokens[at++]!), y: Number(tokens[at++]!) }
        if (command !== 'M') segments.push([cursor, next])
        cursor = next
      }
      const [leftFoot, hip] = segments[2]!, rightFoot = segments[3]![1],
        first = { x: hip.x - leftFoot.x, y: hip.y - leftFoot.y }, second = { x: rightFoot.x - hip.x, y: rightFoot.y - hip.y },
        left = { x: hip.x + first.y / Math.hypot(first.x, first.y) * halfStroke, y: hip.y - first.x / Math.hypot(first.x, first.y) * halfStroke },
        right = { x: hip.x + second.y / Math.hypot(second.x, second.y) * halfStroke, y: hip.y - second.x / Math.hypot(second.x, second.y) * halfStroke },
        t = cross({ x: right.x - left.x, y: right.y - left.y }, second) / cross(first, second),
        miter = { x: left.x + t * first.x, y: left.y + t * first.y }
      const insidePaint = (p: P) => Math.hypot(p.x - head.x, p.y - head.y) < head.r + halfStroke
        || triangleContains(p, [leftFoot, hip, rightFoot]) || triangleContains(p, [left, miter, right])
        || segments.some(([a, b]) => {
          const dx = b.x - a.x, dy = b.y - a.y, length = Math.hypot(dx, dy), along = ((p.x - a.x) * dx + (p.y - a.y) * dy) / length, perpendicular = ((p.x - a.x) * dy - (p.y - a.y) * dx) / length
          return along > 0 && along < length && Math.abs(perpendicular) < halfStroke
        })
      const caption = layout.nodes.find(node => node.id === 'A')!.labelBounds!, ports = new Set<string>()
      for (const part of scene.parts) if (part.node.kind === 'connector') {
        const edge = part.node
        const route = edge.route.geometry
        if (route.kind !== 'polyline') throw new Error('Expected orthogonal family route')
        const projected = layout.edges.find(candidate => candidate.id === edge.id)!
        for (const [end, id, point, adjacent, exposed] of [
          ['start', edge.endpoints.from, route.points[0]!, route.points[1]!, projected.path[0]!],
          ['end', edge.endpoints.to, route.points.at(-1)!, route.points.at(-2)!, projected.path.at(-1)!],
        ] as const) if (id === 'A') {
          const anchor = edge.endpoints[end]!
          // Independently reconstruct the final SVG's filled head/legs,
          // butt-capped strokes and hip miter. A step outward must leave ink;
          // a step inward must enter it, including the full six-pixel stroke.
          const length = Math.hypot(adjacent.x - point.x, adjacent.y - point.y), dx = (adjacent.x - point.x) / length * 0.001, dy = (adjacent.y - point.y) / length * 0.001
          expect(insidePaint({ x: point.x - dx, y: point.y - dy })).toBe(true)
          expect(insidePaint({ x: point.x + dx, y: point.y + dy })).toBe(false)
          expect(anchor.owner).toEqual({ id: 'A', role: 'node' })
          expect(anchor.portId).toMatch(/^actor:/)
          expect(ports.has(anchor.portId!)).toBe(false)
          ports.add(anchor.portId!)
          expect(anchor.point).toEqual(point)
          expect(exposed[0]).toBeCloseTo(point.x, 6)
          expect(exposed[1]).toBeCloseTo(point.y, 6)
        }
        for (let at = 1; at < route.points.length; at++) {
          const a = route.points[at - 1]!, b = route.points[at]!
          expect(a.x === b.x || a.y === b.y).toBe(true)
          const entersCaption = a.x === b.x ? a.x > caption.x - 3 && a.x < caption.x + caption.w + 3 && Math.max(a.y, b.y) > caption.y - 3 && Math.min(a.y, b.y) < caption.y + caption.h + 3
            : a.y > caption.y - 3 && a.y < caption.y + caption.h + 3 && Math.max(a.x, b.x) > caption.x - 3 && Math.min(a.x, b.x) < caption.x + caption.w + 3
          expect(entersCaption).toBe(false)
        }
      }
      expect(ports.size).toBe(5)
      const terminal = renderMermaidASCII(source)
      expect(terminal).toContain('[actor]')
      expect(terminal).toContain('Browse')
    }
  })
  test('integer JSON property order, actor metadata and explicit edge identity survive export', () => {
    const jsonBody = parseUsecaseDiagram(familyBody(fixture.sources[16]!))
    expect(jsonBody.jsonNodes[0]!.propertyOrder[0]).toEqual(['', ['2', '1', 'enabled', 'count', 'missing', 'colors', 'address', 'items', 'emptyObject', 'emptyArray']])
    const iconBody = parseUsecaseDiagram(familyBody(fixture.sources[4]!))
    expect(parseUsecaseDiagram(serializeUsecase(iconBody, false)).nodes.find(node => node.id === 'Icon')).toMatchObject({ kind: 'actor', type: 'icon', icon: 'fa:user' })
    const edgeBody = parseUsecaseDiagram(familyBody(fixture.sources[14]!))
    expect(parseUsecaseDiagram(serializeUsecase(edgeBody, false)).relationships).toMatchObject([
      { id: 'opens', explicitId: true, animation: 'fast' },
      { id: 'payment', explicitId: true, type: 'include' },
    ])
  })
})

test('public UseCase construction allocates portable relationship identities', async () => {
  const built = buildMermaid('usecase', [
    { kind: 'add_actor', id: 'Customer', label: 'Customer' },
    { kind: 'add_usecase', id: 'Checkout', label: 'Checkout' },
    { kind: 'add_relationship', from: 'Customer', to: 'Checkout' },
  ])
  if (!built.ok || built.value.body.kind !== 'usecase') throw new Error(JSON.stringify(built))
  expect(built.value.body.relationships[0]!.id).toBe('relationship_0')
  expect(await upstream.publicAccepts(serializeMermaid(built.value))).toBe(true)
  expect(verifyMermaid(built.value).ok).toBe(true)
})

test('actors retain one measured wrapped label through layout, projection and SVG', () => {
  const source = 'usecase-beta\nactor A("label </text><script>inert</script>\uE000")'
  const body = parseUsecaseDiagram(source),
    placed = layoutUsecaseDiagram(body, { style: 'crisp', seed: 0 })
  const node = placed.nodes[0]!
  expect(node.labelBlock!.width).toBeLessThan(node.width)
  expect(node.labelBlock!.lines.length).toBeGreaterThan(1)
  const parsed = parseRegisteredMermaid(source)
  if (!parsed.ok) throw new Error('Expected UseCase')
  expect(renderMermaidSVG(parsed.value, { style: 'crisp', seed: 0, embedFontImport: false })).toContain('&lt;/text&gt;')
})

test('UseCase title edits survive the benchmark parse/edit/export/reparse strict-render path', async () => {
  const fixture = readFileSync(new URL('../../eval/layout-compare/fixtures/usecase-native.mmd', import.meta.url), 'utf8')
  for (const source of [fixture, '---\n# Keep the wrapper configuration\ntitle: Old family title\nconfig:\n  theme: default\n---\n' + fixture]) {
    const parsed = parseRegisteredMermaid(source)
    if (!parsed.ok || parsed.value.body.kind !== 'usecase') throw new Error('Expected UseCase fixture')
    const edited = mutate(parsed.value, { kind: 'set_title', title: 'Edited family title' })
    if (!edited.ok || edited.value.body.kind !== 'usecase') throw new Error(JSON.stringify(edited))
    const written = serializeMermaid(edited.value),
      again = parseRegisteredMermaid(written)
    expect(edited.value.meta.frontmatter?.title).toBe('Edited family title')
    expect(edited.value.canonicalSource).toContain('Edited family title')
    if (!again.ok || again.value.body.kind !== 'usecase') throw new Error('Expected native title roundtrip')
    expect(again.value.body.title).toBe('Edited family title')
    expect(renderMermaidSVGWithReceipt(written, { security: 'strict' }).svg).toContain('Edited family title')
    expect(await upstream.publicAccepts(written)).toBe(true)
    if (source.startsWith('---')) expect(written).toContain('# Keep the wrapper configuration')
    const removed = mutate(edited.value, { kind: 'set_title', title: null })
    if (!removed.ok || removed.value.body.kind !== 'usecase') throw new Error('Expected title removal')
    const without = serializeMermaid(removed.value),
      reloaded = parseRegisteredMermaid(without)
    if (!reloaded.ok || reloaded.value.body.kind !== 'usecase') throw new Error('Expected native title removal roundtrip')
    expect(reloaded.value.body.title).toBeUndefined()
    expect(renderMermaidSVGWithReceipt(without, { security: 'strict' }).svg).not.toContain('Edited family title')
  }
})

test('UseCase observation records consumed statements and actual publication writes without changing reentrant parsing', () => {
  const source = 'usecase-beta\nactor A\nA --> Browse\nBrowse@{ business: true }',
    events: ParserObservation[] = []
  let nested = false
  const body = withParserObservation(
    'usecase',
    event => {
      events.push(event)
      if (!nested && event.unit === 'statement') {
        nested = true
        expect(parseUsecaseModel('usecase-beta\nactor CallbackOnly').actors.get('CallbackOnly')?.id).toBe('CallbackOnly')
      }
    },
    () => parseUsecaseDiagram(source),
  )
  expect(nested).toBe(true)
  expect(body).toEqual(parseUsecaseDiagram(source))
  for (const event of events.filter(event => event.unit === 'statement')) {
    if (event.text === undefined || event.source?.offset === undefined || event.source.endOffset === undefined) throw Error('UseCase statement observation lacks its consumed source span')
    expect(source.slice(event.source.offset, event.source.endOffset)).toBe(event.text)
  }
  const publications = events.filter(event => event.kind === 'publish-usecase').map(event => event.value)
  expect(publications).toContainEqual(expect.objectContaining({ id: 'Browse', business: false }))
  expect(publications).toContainEqual(expect.objectContaining({ id: 'Browse', business: true }))
})

test.each(['\n', '\r\n'])('UseCase source-map reuse keeps canonical and authored positions with %j lines', newline => {
  const source = ['---', 'title: Positions', '---', 'usecase-beta', '', 'accTitle: Plan', 'accDescr {', '  Accessible', '  catalogue', '}',
    'actor User("`Customer', '  member`")', 'systemBoundary Store["Store"]', '  Browse("Catalogue")', 'end', 'User transfer@--> Browse'].join(newline)
  const parsed = parseRegisteredMermaid(source)
  if (!parsed.ok || parsed.value.body.kind !== 'usecase') throw new Error('Expected native UseCase source map')
  const { source: map, canonicalSource } = parsed.value
  const tokenAt = (point: { line: number; col: number } | undefined, token: string) => {
    if (!point) throw new Error(`Missing source location for ${token}`)
    return canonicalSource.split('\n')[point.line - 1]!.slice(point.col - 1, point.col - 1 + token.length)
  }
  expect(tokenAt(map.nodes.get('User'), 'User')).toBe('User')
  expect(tokenAt(map.nodes.get('Browse'), 'Browse')).toBe('Browse')
  expect(tokenAt(map.groups.get('Store'), 'Store')).toBe('Store')
  expect(tokenAt(map.edges.get('transfer'), 'User')).toBe('User')
  expect(source.slice(map.spans!.nodes.get('User')!.start.offset, map.spans!.nodes.get('User')!.end.offset)).toContain('User')
  expect(parsed.value.body.nodes.find(node => node.id === 'User')?.label).toBe('Customer\n  member')
  const again = parseRegisteredMermaid(source)
  if (!again.ok) throw new Error('Expected repeat source parse')
  expect(again.value.source).toEqual(map)
})

test('UseCase dependency stereotypes retain visibly dashed carrier paint', () => {
  const svg = renderMermaidSVG('usecase-beta\nA("Checkout")\nB("Authorize payment")\nA ..> : include B')
  const carrier = svg.match(/<polyline\b[^>]*data-relationship="include"[^>]*>/)?.[0]
  expect(carrier).toBeDefined()
  expect(carrier!).toContain('stroke-dasharray=')
})
