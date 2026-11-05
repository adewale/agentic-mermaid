import { afterAll, describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { buildMermaid, mutate, parseRegisteredMermaid, renderMermaidASCII, renderMermaidSVG, renderMermaidSVGWithReceipt, serializeMermaid, verifyMermaid } from '../agent/core.ts'
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
        expect(parseUsecaseDiagram('usecase-beta\nactor CallbackOnly').nodes[0]!.id).toBe('CallbackOnly')
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
