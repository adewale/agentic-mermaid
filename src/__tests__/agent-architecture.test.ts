// BUILD-17: architecture structured mutation (promoting architecture-beta from
// opaque-only fallback semantics, following the BUILD-15 journey pilot). Parse /
// narrow / mutate / verify / serialize, the structured-or-opaque fallback, and
// round-trip identity.

import { afterAll, describe, test, expect } from 'bun:test'
import fc from 'fast-check'
import { fcParameters } from './helpers/fc-parameters.ts'
import { parseRegisteredMermaid as parseMermaid } from '../agent/parse.ts'
import { serializeMermaid } from '../agent/serialize.ts'
import { mutate } from '../agent/mutate.ts'
import { verifyMermaid } from '../agent/verify.ts'
import { asArchitecture } from '../agent/types.ts'
import { renderMermaidSVG } from '../agent/index.ts'
import type { ArchitectureValidDiagram, ArchitectureMutationOp } from '../agent/types.ts'
import { parseArchitectureDiagram } from '../architecture/parser.ts'
import { layoutArchitectureDiagram } from '../architecture/layout.ts'
import { renderMermaidASCII } from '../agent/index.ts'
import { startUpstreamMermaid } from './helpers/upstream-mermaid.ts'

const upstream = startUpstreamMermaid()
afterAll(() => upstream.close())

test('literal service icons preserve text, reserve their full footprint and support typed edits', () => {
  const source = 'architecture-beta\ngroup g(cloud)[Group]\nservice a "<b>日本 API</b>\\nSecond line" [Backend] in g\nservice b(database)[Storage]\na:R-->L:b'
  const parsed = parseMermaid(source)
  expect(parsed.ok).toBe(true)
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.error))
  const typed = asArchitecture(parsed.value)
  expect(typed?.body.services[0]?.iconText).toBe('<b>日本 API</b>\nSecond line')
  if (!typed) throw new Error('Expected editable text icon')
  const positioned = layoutArchitectureDiagram(parseArchitectureDiagram(source.split('\n')))
  const service = positioned.services.find(item => item.id === 'a')!
  const icon = service.iconTextBlock!
  expect(service.labelPosition!.x).toBeGreaterThanOrEqual(service.x + icon.width)
  expect(service.labelPosition!.x + service.labelBlock!.width).toBeLessThan(service.x + service.width)
  expect(icon.height).toBeLessThan(service.height)
  const svg = renderMermaidSVG(source)
  expect(svg).toContain('&lt;b&gt;日本 API&lt;/b&gt;')
  expect(svg).not.toContain('<b>日本 API</b>')
  expect(renderMermaidASCII(source)).toContain('Second line')
  const changed = mutate(typed, { kind: 'set_service_icon_text', id: 'a', text: 'SQL' })
  expect(changed.ok).toBe(true)
  if (!changed.ok) throw new Error(changed.error.message)
  expect(serializeMermaid(changed.value)).toContain('"SQL"')
  const named = mutate(changed.value, { kind: 'set_service_icon', id: 'a', icon: 'server' })
  expect(named.ok).toBe(true)
  if (!named.ok) throw new Error(named.error.message)
  expect(asArchitecture(named.value)?.body.services[0]?.iconText).toBeUndefined()
  expect(serializeMermaid(named.value)).toContain('a(server)')
  const added = mutate(typed, { kind: 'add_service', id: 'worker', label: 'Worker', iconText: 'jobs' })
  expect(added.ok).toBe(true)
  if (!added.ok) throw new Error(added.error.message)
  expect(asArchitecture(added.value)?.body.services.find(service => service.id === 'worker')?.iconText).toBe('jobs')
  expect(renderMermaidSVG(added.value)).toContain('jobs')
  expect(mutate(typed, { kind: 'add_service', id: 'worker', icon: 'server', iconText: 'jobs' }).ok).toBe(false)
})

const SRC = `architecture-beta
  group api(cloud)[API Layer]
  service gateway(server)[Gateway] in api
  service db(database)[Database]
  service web(server)[Web]
  web:R --> L:gateway
  gateway:B -[reads]-> T:db
`

function architecture(src: string = SRC): ArchitectureValidDiagram {
  const r = parseMermaid(src)
  if (!r.ok) throw new Error('parse: ' + JSON.stringify(r.error))
  const a = asArchitecture(r.value)
  if (!a) throw new Error('not a structured architecture: ' + r.value.body.kind)
  return a
}

function apply(d: ArchitectureValidDiagram, op: ArchitectureMutationOp): ArchitectureValidDiagram {
  const r = mutate(d, op)
  if (!r.ok) throw new Error('mutate: ' + JSON.stringify(r.error))
  return r.value
}

describe('architecture structured parse', () => {
  test('a service after an accessibility closing brace survives editing, reload, and rendering', () => {
    const source = 'architecture-beta\n  accDescr { API traffic } service api(server)[API]'
    const original = architecture(source)
    expect(original.body.accessibilityDescription).toBe('API traffic')
    expect(original.body.services).toEqual([{ id: 'api', label: 'API', icon: 'server', parentId: undefined }])
    const edited = apply(original, { kind: 'set_service_label', id: 'api', label: 'Updated API' })
    const reloaded = architecture(serializeMermaid(edited))
    expect(reloaded.body.accessibilityDescription).toBe('API traffic')
    expect(reloaded.body.services).toEqual([{ id: 'api', label: 'Updated API', icon: 'server', parentId: undefined }])
    for (const [diagram, label] of [[original, 'API'], [reloaded, 'Updated API']] as const) {
      const svg = renderMermaidSVG(diagram)
      expect(svg).toMatch(/<desc\b[^>]*>API traffic<\/desc>/)
      expect(svg).toMatch(new RegExp(`<text\\b[^>]*>${label}</text>`))
    }
  })

  test('models a standalone visible title, including a title-only diagram', () => {
    const d = architecture('architecture-beta\n  title Simple Architecture Diagram')
    expect(d.body.title).toBe('Simple Architecture Diagram')
    expect(serializeMermaid(d)).toBe('architecture-beta\n  title Simple Architecture Diagram\n')
    expect(verifyMermaid(d).ok).toBe(true)
  })

  test('models groups, services, junctions, and edges with sides + labels', () => {
    const d = architecture()
    expect(d.kind).toBe('architecture')
    expect(d.body.groups.map(g => g.id)).toEqual(['api'])
    expect(d.body.groups[0]!.label).toBe('API Layer')
    expect(d.body.services.map(s => s.id)).toEqual(['gateway', 'db', 'web'])
    expect(d.body.services[0]!.parentId).toBe('api')
    expect(d.body.edges[1]).toEqual({
      source: { id: 'gateway', side: 'B' },
      target: { id: 'db', side: 'T' },
      label: 'reads',
      hasArrowStart: false,
      hasArrowEnd: true,
    })
  })

  test('a quoted title across lines keeps its line break through the writer', () => {
    const d = architecture('architecture-beta\n  group g(cloud)["G\n    H"]\n  service a(server)[\'line1\n    line2\'] in g\n  service b(server)[B] in g\n  a:R -["multi\n    line"]- L:b')
    expect(d.body.groups.map(g => g.label)).toEqual(['G\nH'])
    expect(d.body.services.map(s => s.label)).toEqual(['line1\nline2', 'B'])
    expect(d.body.edges.map(e => e.label)).toEqual(['multi\nline'])
    expect(architecture(serializeMermaid(d)).body).toEqual(d.body)
  })

  test('junctions and nested groups parse structurally', () => {
    const d = architecture('architecture-beta\n  group outer(cloud)[Outer]\n  group inner(server)[Inner] in outer\n  junction q in inner\n  service api(server)[API] in inner\n  api:R --> L:q')
    expect(d.body.groups.map(g => g.parentId)).toEqual([undefined, 'outer'])
    expect(d.body.junctions).toEqual([{ id: 'q', parentId: 'inner' }])
    expect(d.body.edges[0]!.target.id).toBe('q')
  })

  test('round-trips to canonical source and re-parses identically', () => {
    const d = architecture()
    const out = serializeMermaid(d)
    const d2 = architecture(out)
    // Authored facts are the oracle: two equally lossy parses would still be
    // equal to each other and produce a stable canonical string.
    for (const body of [d.body, d2.body]) {
      expect(body.groups.map(({ id, label, icon }) => ({ id, label, icon }))).toEqual([
        { id: 'api', label: 'API Layer', icon: 'cloud' },
      ])
      expect(body.services.map(({ id, label, parentId }) => ({ id, label, parentId }))).toEqual([
        { id: 'gateway', label: 'Gateway', parentId: 'api' },
        { id: 'db', label: 'Database', parentId: undefined },
        { id: 'web', label: 'Web', parentId: undefined },
      ])
      expect(body.edges.map(({ source, target, label, hasArrowStart, hasArrowEnd }) => ({ source, target, label, hasArrowStart, hasArrowEnd }))).toEqual([
        { source: { id: 'web', side: 'R' }, target: { id: 'gateway', side: 'L' }, label: undefined, hasArrowStart: false, hasArrowEnd: true },
        { source: { id: 'gateway', side: 'B' }, target: { id: 'db', side: 'T' }, label: 'reads', hasArrowStart: false, hasArrowEnd: true },
      ])
    }
    expect(d2.body).toEqual(d.body)
    expect(serializeMermaid(d2)).toBe(out)
  })

  test('models accessibility directives and group-boundary endpoints without whole-body opacity', () => {
    const d = architecture(`architecture-beta
  accTitle: Storage topology
  accDescr {
    Database traffic crosses
    the storage boundary
  }
  group store(cloud)[Store]
  service db(database)[DB] in store
  service cache(disk)[Cache]
  db{group}:R -[replicates]-> L:cache`)
    expect(d.body.accessibilityTitle).toBe('Storage topology')
    expect(d.body.accessibilityDescription).toBe('Database traffic crosses\nthe storage boundary')
    expect(d.body.edges[0]).toMatchObject({
      source: { id: 'db', side: 'R', boundary: 'group' },
      target: { id: 'cache', side: 'L' },
    })
    const out = serializeMermaid(d)
    expect(out).toContain('accTitle: Storage topology')
    expect(out).toContain('db{group}:R -[replicates]-> L:cache')
    expect(architecture(out).body).toEqual(d.body)
  })
})

describe('architecture structured-or-opaque fallback', () => {
  test.each([
    ['a port token as a service id', 'service L(server)[Load balancer]\n  service db(database)[Database]\n  L:R --> L:db', 'architecture_id', 3],
    ['a keyword as a group id', 'group group(cloud)[Application]\n  service api(server)[API] in group', 'architecture_id', 3],
    ['the parent keyword as a service id', 'service a(server)[Aa]\n  service in(server)[aa]', 'architecture_id', 4],
    ['a port token prefix as a junction id', 'junction Right', 'architecture_id', 3],
    ['a title token prefix as an id', 'service titleWorker(server)[Worker]', 'architecture_id', 3],
    ['a trailing dash in an id', 'service api-(server)[API]', 'architecture_id', 3],
    ['a dotted service icon', 'service api(custom.server)[API]', 'architecture_icon', 3],
    ['a dotted group icon', 'group app(custom.cloud)[Application]', 'architecture_icon', 3],
  ])('%s stays renderable and source-preserved instead of generating rejected source', async (_name, statement, syntax, line) => {
    const source = `%% preserved comment\narchitecture-beta\n  ${statement}\n`
    expect(await upstream.accepts(source)).toBe(false)
    const parsed = parseMermaid(source)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) throw new Error(JSON.stringify(parsed.error))
    expect(parsed.value.body.kind).toBe('opaque')
    expect(serializeMermaid(parsed.value)).toBe(source)
    expect(renderMermaidSVG(parsed.value)).toBe(renderMermaidSVG(source))
    expect(renderMermaidASCII(parsed.value)).toBe(renderMermaidASCII(source))
    expect(verifyMermaid(parsed.value).warnings).toContainEqual(expect.objectContaining({
      code: 'UNSUPPORTED_SYNTAX', syntax, line,
    }))
    const edited = mutate(parsed.value, { kind: 'set_title', title: 'Changed' })
    expect(edited.ok).toBe(false)
    if (!edited.ok) expect(edited.error.code).toBe('INVALID_OP')
  })

  test('portable neighbours keep typed editing, including keyword prefixes and normalized icons', async () => {
    const diagram = architecture('architecture-beta\n  group group1( cloud )[Application]\n  service rowspan( server )[Rowspan] in group1\n  service columnar( )[Columnar]\n  service inside(server)[Inside]\n  junction l1\n  rowspan:R --> L:columnar')
    expect(diagram.body.groups[0]?.icon).toBe('cloud')
    expect(diagram.body.services.map(service => service.icon)).toEqual(['server', undefined, 'server'])
    expect(apply(diagram, { kind: 'set_title', title: 'Portable' }).body.title).toBe('Portable')
    expect(verifyMermaid(diagram).warnings.filter(warning => warning.code === 'UNSUPPORTED_SYNTAX')).toEqual([])
    expect(await upstream.accepts(serializeMermaid(diagram))).toBe(true)
  })

  test.each([
    ['parent declared later', 'architecture-beta\n  service api(server)[API] in g\n  group g(cloud)[G]\n'],
    ['edge endpoint declared later', 'architecture-beta\n  service api(server)[API]\n  api:R --> L:db\n  service db(database)[DB]\n'],
  ])('%s cannot be silently repaired by typed serialization', (_name, source) => {
    const result = parseMermaid(source)
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error(JSON.stringify(result.error))
    expect(result.value.body.kind).toBe('opaque')
    expect(serializeMermaid(result.value)).toBe(source)
    expect(verifyMermaid(result.value).warnings.map(warning => warning.code)).toContain('RENDER_FAILED')
  })
  const opaqueCases: Array<[string, string]> = [
    ['unknown in-parent group', 'architecture-beta\n  service db(database)[DB] in nowhere'],
    ['edge to undeclared item', 'architecture-beta\n  service api(server)[API]\n  api:R --> L:ghost'],
    ['header suffix', 'architecture-beta EXTRA\n  service api(server)[API]'],
  ]
  for (const [name, src] of opaqueCases) {
    test(`${name} falls back to opaque and round-trips verbatim`, () => {
      const r = parseMermaid(src)
      expect(r.ok).toBe(true)
      if (!r.ok) return
      expect(r.value.body.kind).toBe('opaque')
      expect(asArchitecture(r.value)).toBeNull()
      expect(serializeMermaid(r.value).trimEnd()).toBe(src)
    })
  }
})

describe('architecture mutation ops', () => {
  test.each([
    { kind: 'add_service', id: 'L', label: 'Load balancer' },
    { kind: 'add_group', id: 'group', label: 'Application' },
    { kind: 'add_junction', id: 'Right' },
    { kind: 'rename_service', from: 'web', to: 'titleWorker' },
  ] satisfies ArchitectureMutationOp[])('refuses a nonportable id in $kind', op => {
    const result = mutate(architecture(), op)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('INVALID_OP')
  })

  test('set_title adds, updates, and removes the visible title', () => {
    let d = apply(architecture(), { kind: 'set_title', title: 'System Map' })
    expect(d.body.title).toBe('System Map')
    expect(d.canonicalSource).toContain('title System Map')
    d = apply(d, { kind: 'set_title', title: null })
    expect(d.body.title).toBeUndefined()
  })

  test('add_service (root + into group) extends the diagram', () => {
    let d = apply(architecture(), { kind: 'add_service', id: 'cache', label: 'Cache', icon: 'disk' })
    expect(d.body.services.map(s => s.id)).toContain('cache')
    expect(d.body.services.find(s => s.id === 'cache')!.parentId).toBeUndefined()
    d = apply(d, { kind: 'add_service', id: 'queue', label: 'Queue', icon: 'server', group: 'api' })
    expect(d.body.services.find(s => s.id === 'queue')!.parentId).toBe('api')
    // canonicalSource is rebuilt after mutation — never stale.
    expect(d.canonicalSource).toContain('service queue(server)[Queue] in api')
  })

  test('remove_service cascades its edges', () => {
    const d = apply(architecture(), { kind: 'remove_service', id: 'gateway' })
    expect(d.body.services.map(s => s.id)).not.toContain('gateway')
    // Both edges touched gateway, so both are gone.
    expect(d.body.edges).toHaveLength(0)
  })

  test('rename_service updates anchored edges', () => {
    const d = apply(architecture(), { kind: 'rename_service', from: 'gateway', to: 'gw' })
    expect(d.body.services.map(s => s.id)).toContain('gw')
    expect(d.body.edges[0]!.target.id).toBe('gw')
    expect(d.body.edges[1]!.source.id).toBe('gw')
  })

  test('set_service_label / set_service_icon / move_service', () => {
    let d = apply(architecture(), { kind: 'set_service_label', id: 'db', label: 'Primary DB' })
    expect(d.body.services.find(s => s.id === 'db')!.label).toBe('Primary DB')
    d = apply(d, { kind: 'set_service_icon', id: 'db', icon: 'cylinder' })
    expect(d.body.services.find(s => s.id === 'db')!.icon).toBe('cylinder')
    d = apply(d, { kind: 'set_service_icon', id: 'db', icon: null })
    expect(d.body.services.find(s => s.id === 'db')!.icon).toBeUndefined()
    d = apply(d, { kind: 'move_service', id: 'db', group: 'api' })
    expect(d.body.services.find(s => s.id === 'db')!.parentId).toBe('api')
    d = apply(d, { kind: 'move_service', id: 'db', group: null })
    expect(d.body.services.find(s => s.id === 'db')!.parentId).toBeUndefined()
  })

  test('add_group / set_group_label / remove_group (empty)', () => {
    let d = apply(architecture(), { kind: 'add_group', id: 'data', label: 'Data', icon: 'cloud' })
    expect(d.body.groups.map(g => g.id)).toContain('data')
    d = apply(d, { kind: 'set_group_label', id: 'data', label: 'Data Plane' })
    expect(d.body.groups.find(group => group.id === 'data')!.label).toBe('Data Plane')
    d = apply(d, { kind: 'remove_group', id: 'data' })
    expect(d.body.groups.map(g => g.id)).not.toContain('data')
  })

  test('adds, renames, moves, and removes junctions with coherent references', () => {
    let d = apply(architecture(), { kind: 'add_junction', id: 'bus', group: 'api' })
    d = apply(d, { kind: 'add_edge', from: 'gateway', to: 'bus', fromSide: 'R', toSide: 'L' })
    d = apply(d, { kind: 'rename_junction', from: 'bus', to: 'spine' })
    expect(d.body.junctions).toEqual([{ id: 'spine', parentId: 'api' }])
    expect(d.body.edges.at(-1)!.target.id).toBe('spine')
    d = apply(d, { kind: 'move_junction', id: 'spine', group: null })
    expect(d.body.junctions[0]!.parentId).toBeUndefined()
    d = apply(d, { kind: 'remove_junction', id: 'spine' })
    expect(d.body.junctions).toEqual([])
    expect(d.body.edges.some(edge => edge.target.id === 'spine')).toBe(false)
  })

  test('add_edge / update_edge / remove_edge supports group boundaries in place', () => {
    let d = apply(architecture(), { kind: 'move_service', id: 'db', group: 'api' })
    d = apply(d, {
      kind: 'add_edge', from: 'db', to: 'web', fromSide: 'R', toSide: 'L',
      fromBoundary: 'group', label: 'streams',
    })
    expect(d.body.edges.at(-1)!.source.boundary).toBe('group')
    d = apply(d, {
      kind: 'update_edge', index: d.body.edges.length - 1,
      fromSide: 'B', toSide: 'T', fromBoundary: 'item', label: 'events',
      hasArrowStart: true, hasArrowEnd: false,
    })
    expect(d.body.edges.at(-1)).toMatchObject({
      source: { id: 'db', side: 'B' },
      target: { id: 'web', side: 'T' },
      label: 'events', hasArrowStart: true, hasArrowEnd: false,
    })
    expect(d.body.edges.at(-1)!.source.boundary).toBeUndefined()
    expect(d.canonicalSource).toContain('db:B <-[events]- T:web')
    d = apply(d, { kind: 'remove_edge', index: d.body.edges.length - 1 })
    expect(d.body.edges.map(edge => edge.label)).not.toContain('events')
  })

  test('refuses to orphan a modeled group-boundary endpoint when moving a service to root', () => {
    let d = apply(architecture(), { kind: 'move_service', id: 'db', group: 'api' })
    d = apply(d, { kind: 'add_edge', from: 'db', to: 'web', fromSide: 'R', toSide: 'L', fromBoundary: 'group' })
    const rejected = mutate(d, { kind: 'move_service', id: 'db', group: null })
    expect(rejected).toMatchObject({ ok: false, error: { code: 'INVALID_OP' } })
    expect(rejected.ok ? '' : rejected.error.message).toContain('update the edge boundary')
  })

  // A `{group}` endpoint names its group's boundary, so an edit must not leave
  // the other end inside that group (Mermaid rejects the same-group case).
  test('refuses edits that point a group-boundary endpoint into its own group', async () => {
    const source = `architecture-beta
  group cloud(cloud)[Cloud]
  group private(server)[Private] in cloud
  group storage(disk)[Storage] in cloud
  group vault(disk)[Vault] in private
  service db(database)[DB] in private
  service api(server)[API] in private
  service disk1(disk)[Disk] in storage
  service key(disk)[Key] in vault
  junction hub in cloud
  api:R --> L:db
  db{group}:B <--> T:disk1
`
    const base = architecture(source)
    const refused: ArchitectureMutationOp[] = [
      { kind: 'move_service', id: 'disk1', group: 'private' },
      { kind: 'move_service', id: 'disk1', group: 'vault' },
      { kind: 'add_edge', from: 'db', to: 'api', fromSide: 'R', toSide: 'L', fromBoundary: 'group' },
      { kind: 'add_edge', from: 'key', to: 'db', fromSide: 'T', toSide: 'B', toBoundary: 'group' },
      { kind: 'add_edge', from: 'db', to: 'key', fromSide: 'B', toSide: 'T', fromBoundary: 'group', toBoundary: 'group' },
      { kind: 'update_edge', index: 0, fromBoundary: 'group' },
      { kind: 'update_edge', index: 1, to: 'api' },
    ]
    for (const op of refused) {
      const result = mutate(base, op)
      expect({ op, ok: result.ok, code: result.ok ? null : result.error.code }).toEqual({ op, ok: false, code: 'INVALID_OP' })
      expect(result.ok ? '' : result.error.message, JSON.stringify(op)).toMatch(/would join group "(private|vault)" to "\w+", which is inside it/)
    }
    // Leading out of the group stays editable, including into a sibling group.
    for (const op of [
      { kind: 'move_service', id: 'disk1', group: 'cloud' },
      { kind: 'add_edge', from: 'key', to: 'db', fromSide: 'R', toSide: 'L', fromBoundary: 'group' },
      { kind: 'add_edge', from: 'db', to: 'hub', fromSide: 'L', toSide: 'R', fromBoundary: 'group' },
    ] satisfies ArchitectureMutationOp[]) {
      const result = mutate(base, op)
      if (!result.ok) throw new Error(`${JSON.stringify(op)}: ${result.error.message}`)
      expect(await upstream.publicAccepts(serializeMermaid(result.value)), JSON.stringify(op)).toBe(true)
    }
    // An authored conflict stays reported rather than blocking unrelated edits.
    const authored = architecture(source.replace('in storage', 'in private'))
    expect(mutate(authored, { kind: 'set_service_label', id: 'api', label: 'Gateway' }).ok).toBe(true)
  })

  test('sets and clears accessibility metadata through typed ops', () => {
    let d = apply(architecture(), { kind: 'set_accessibility_title', title: 'System topology' })
    d = apply(d, { kind: 'set_accessibility_description', description: 'Line one\nLine two' })
    expect(d.body.accessibilityTitle).toBe('System topology')
    expect(d.body.accessibilityDescription).toBe('Line one\nLine two')
    expect(d.canonicalSource).toContain('accDescr {\n    Line one\n    Line two\n  }')
    d = apply(d, { kind: 'set_accessibility_title', title: null })
    d = apply(d, { kind: 'set_accessibility_description', description: null })
    expect(d.body.accessibilityTitle).toBeUndefined()
    expect(d.body.accessibilityDescription).toBeUndefined()
  })

  test('add_edge / remove_edge by index and by id', () => {
    let d = apply(architecture(), { kind: 'add_edge', from: 'db', to: 'web', fromSide: 'L', toSide: 'B', label: 'streams' })
    expect(d.body.edges).toHaveLength(3)
    expect(d.body.edges[2]).toMatchObject({ source: { id: 'db', side: 'L' }, target: { id: 'web', side: 'B' }, label: 'streams' })
    d = apply(d, { kind: 'remove_edge', index: 0 })
    expect(d.body.edges).toHaveLength(2)
    d = apply(d, { kind: 'remove_edge', id: 'db->web' })
    expect(d.body.edges.map(e => `${e.source.id}->${e.target.id}`)).not.toContain('db->web')
  })

  test('error paths: missing targets, bad ids, non-empty group, invalid sides', () => {
    const cases: Array<[ArchitectureMutationOp, import('../agent/types.ts').MutationError['code']]> = [
      [{ kind: 'remove_service', id: 'ghost' }, 'SERVICE_NOT_FOUND'],
      [{ kind: 'set_service_label', id: 'ghost', label: 'X' }, 'SERVICE_NOT_FOUND'],
      [{ kind: 'move_service', id: 'db', group: 'nogroup' }, 'GROUP_NOT_FOUND'],
      [{ kind: 'add_service', id: 'db', label: 'Dup' }, 'INVALID_OP'],
      [{ kind: 'add_service', id: 'bad id', label: 'X' }, 'INVALID_OP'],
      [{ kind: 'remove_group', id: 'api' }, 'INVALID_OP'],
      [{ kind: 'remove_group', id: 'ghost' }, 'GROUP_NOT_FOUND'],
      [{ kind: 'add_edge', from: 'web', to: 'ghost', fromSide: 'R', toSide: 'L' }, 'SERVICE_NOT_FOUND'],
      [{ kind: 'add_edge', from: 'db', to: 'web', fromSide: 'R', toSide: 'L', fromBoundary: 'group' }, 'INVALID_OP'],
      [{ kind: 'add_edge', from: 'web', to: 'db', fromSide: 'X' as never, toSide: 'L' }, 'INVALID_OP'],
      [{ kind: 'remove_junction', id: 'ghost' }, 'SERVICE_NOT_FOUND'],
      [{ kind: 'update_edge', index: 9, label: 'missing' }, 'EDGE_NOT_FOUND'],
      [{ kind: 'remove_edge', index: 9 }, 'EDGE_NOT_FOUND'],
      [{ kind: 'remove_edge', id: 'no->edge' }, 'EDGE_NOT_FOUND'],
    ]
    for (const [op, code] of cases) {
      const r = mutate(architecture(), op)
      expect({ op: op.kind, ok: r.ok, code: r.ok ? null : r.error.code }).toEqual({ op: op.kind, ok: false, code })
    }
  })

  test('mutation does not alias the input diagram', () => {
    const d = architecture()
    apply(d, { kind: 'set_service_label', id: 'db', label: 'Changed' })
    expect(d.body.services.find(s => s.id === 'db')!.label).toBe('Database')
  })
})

describe('architecture verify + render', () => {
  test('verify passes on a healthy diagram and serializes after the loop', () => {
    let d = architecture()
    d = apply(d, { kind: 'add_service', id: 'cache', label: 'Cache', icon: 'disk' })
    const v = verifyMermaid(d)
    expect(v.ok).toBe(true)
    expect(serializeMermaid(d)).toContain('service cache(disk)[Cache]')
  })

  test('reports a group-boundary edge whose other end is inside that group', async () => {
    const groups = 'architecture-beta\n  group private(server)[Private]\n  group vault(disk)[Vault] in private\n  service db(database)[DB] in private\n  service key(disk)[Key] in vault\n  service web(internet)[Web]\n'
    const cases: Array<[string, string | undefined, boolean]> = [
      ['  db{group}:B <--> T:web\n', undefined, true],
      ['  db:R --> L:key\n', undefined, true],
      ['  key{group}:L --> R:db\n', undefined, true],
      ['  db{group}:B --> T:key\n', 'private', true],
      ['  key{group}:T --> B:db{group}\n', 'private', true],
      ['  service api(server)[API] in private\n  api:R --> L:db{group}\n', 'private', false],
    ]
    for (const [edges, group, mermaidAccepts] of cases) {
      const source = groups + edges
      const warnings = verifyMermaid(architecture(source)).warnings.filter(warning => warning.code === 'UNSUPPORTED_SYNTAX')
      expect(warnings.map(warning => warning.code === 'UNSUPPORTED_SYNTAX' && warning.syntax), edges).toEqual(group ? ['architecture_group_edge_inside_group'] : [])
      if (!group) continue
      const message = warnings[0]!.code === 'UNSUPPORTED_SYNTAX' ? warnings[0]!.message : ''
      expect(message, edges).toContain(`group "${group}"`)
      // The Mermaid claim matches the pinned reference.
      expect(await upstream.publicAccepts(source), edges).toBe(mermaidAccepts)
      expect(message.includes('Pinned Mermaid rejects this edge'), edges).toBe(!mermaidAccepts)
    }
  })

  test('EMPTY_DIAGRAM fires on a header-only (opaque) diagram', () => {
    const v = verifyMermaid('architecture-beta')
    expect(v.warnings.map(w => w.code)).toContain('EMPTY_DIAGRAM')
    expect(v.ok).toBe(false)
  })

  test('LABEL_OVERFLOW fires on an over-cap service label', () => {
    const long = 'X'.repeat(80)
    const d = architecture(`architecture-beta\n  service svc(server)[${long}]`)
    const v = verifyMermaid(d)
    const overflow = v.warnings.find(w => w.code === 'LABEL_OVERFLOW')
    expect(overflow).toBeDefined()
    expect(overflow).toMatchObject({ code: 'LABEL_OVERFLOW', limit: 40 })
  })

  test('mutated architecture renders through the legacy renderer', async () => {
    const { renderMermaidSVG } = await import('../agent/index.ts')
    const d = apply(architecture(), { kind: 'add_service', id: 'cache', label: 'Cache', icon: 'disk' })
    const svg = renderMermaidSVG(d)
    expect(svg).toContain('<svg')
    expect(svg).toContain('Cache')
  })
})

// Upstream v11.16.0 align directives (PR #7708; plan §Architecture 2, probe
// p8). Parsed and modeled once (src/architecture/align.ts), preserved
// losslessly through serialization, and honored as a placement constraint, so
// verify no longer raises the UNSUPPORTED_SYNTAX lint it once used to announce
// them.
describe('architecture align directives (upstream v11.16.0)', () => {
  const ALIGN_SRC = `architecture-beta
  group api(cloud)[API]
  service db1(database)[DB1] in api
  service db2(database)[DB2] in api
  service db3(database)[DB3] in api
  service mcp(server)[MCP] in api
  db1:R --> L:mcp
  db2:R --> L:mcp
  db3:R --> L:mcp
  align column db1 db2 db3
`

  test('align sources parse structurally and model alignments', () => {
    const d = architecture(ALIGN_SRC)
    expect(d.body.alignments).toEqual([{ axis: 'column', members: ['db1', 'db2', 'db3'] }])
    expect(d.body.services.map(s => s.id)).toEqual(['db1', 'db2', 'db3', 'mcp'])
  })

  test('align statements survive serialize→re-parse byte-verbatim (canonical form)', () => {
    const d = architecture(ALIGN_SRC)
    const out = serializeMermaid(d)
    expect(out).toContain('align column db1 db2 db3')
    const d2 = architecture(out)
    expect(d2.body).toEqual(d.body)
    expect(serializeMermaid(d2)).toBe(out)
  })

  test('verify passes without an unsupported-syntax lint now that placement is honored', () => {
    const v = verifyMermaid(architecture(ALIGN_SRC))
    expect(v.ok).toBe(true)
    expect(v.warnings).not.toContainEqual(expect.objectContaining({
      code: 'UNSUPPORTED_SYNTAX', syntax: 'architecture_align',
    }))
  })

  test('multiple align directives round-trip in declaration order', () => {
    const d = architecture(`architecture-beta
  service a(server)[A]
  service b(server)[B]
  service c(server)[C]
  align row a b
  align column b c
`)
    expect(d.body.alignments).toEqual([
      { axis: 'row', members: ['a', 'b'] },
      { axis: 'column', members: ['b', 'c'] },
    ])
    const out = serializeMermaid(d)
    expect(out.indexOf('align row a b')).toBeLessThan(out.indexOf('align column b c'))
  })

  test('rename_service rewrites alignment members', () => {
    const d = apply(architecture(ALIGN_SRC), { kind: 'rename_service', from: 'db2', to: 'replica' })
    expect(d.body.alignments).toEqual([{ axis: 'column', members: ['db1', 'replica', 'db3'] }])
    expect(d.canonicalSource).toContain('align column db1 replica db3')
  })

  test('remove_service drops the member and dissolves sub-minimum alignments', () => {
    let d = apply(architecture(ALIGN_SRC), { kind: 'remove_service', id: 'db3' })
    expect(d.body.alignments).toEqual([{ axis: 'column', members: ['db1', 'db2'] }])
    // One member left after the next removal — the directive dissolves (an
    // align needs at least two members to be renderable upstream).
    d = apply(d, { kind: 'remove_service', id: 'db2' })
    expect(d.body.alignments ?? []).toEqual([])
    expect(d.canonicalSource).not.toContain('align')
  })

  test('align members must be declared before the directive', () => {
    const source = `architecture-beta
  align row a b
  service a(server)[A]
  service b(server)[B]`
    const parsed = parseMermaid(source)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(parsed.value.body.kind).toBe('opaque')
    expect(serializeMermaid(parsed.value)).toBe(source + '\n')
    expect(verifyMermaid(parsed.value).warnings.some(warning => warning.code === 'RENDER_FAILED')).toBe(true)
  })

  test('invalid align directives fall back to opaque (upstream rejects them too)', () => {
    const cases = [
      ['unknown member', 'architecture-beta\n  service a(server)[A]\n  service b(server)[B]\n  align row a ghost'],
      ['single member', 'architecture-beta\n  service a(server)[A]\n  service b(server)[B]\n  align row a'],
      ['duplicate member', 'architecture-beta\n  service a(server)[A]\n  service b(server)[B]\n  align row a a'],
      ['group member', 'architecture-beta\n  group g(cloud)[G]\n  service a(server)[A] in g\n  service b(server)[B]\n  align column a g'],
    ] as const
    for (const [name, src] of cases) {
      const r = parseMermaid(src)
      expect({ name, ok: r.ok }).toEqual({ name, ok: true })
      if (!r.ok) continue
      expect({ name, kind: r.value.body.kind }).toEqual({ name, kind: 'opaque' })
      // Render parity keeps the failure honest: the render parser rejects
      // exactly what upstream rejects, so verify reports RENDER_FAILED.
      const v = verifyMermaid(r.value)
      expect({ name, ok: v.ok, codes: v.warnings.some(w => w.code === 'RENDER_FAILED') })
        .toEqual({ name, ok: false, codes: true })
    }
  })

  test('align sources render through the legacy renderer', async () => {
    const { renderMermaidSVG } = await import('../agent/index.ts')
    const svg = renderMermaidSVG(architecture(ALIGN_SRC))
    expect(svg).toContain('<svg')
    expect(svg).toContain('DB1')
  })
})

describe('architecture round-trip property', () => {
  // A stable non-keyword prefix constructs portable IDs even when the suffix
  // is a grammar word such as `in` or starts with the title token.
  const idArb = fc.stringMatching(/^[a-z][a-z0-9]{0,7}$/).map(suffix => `svc_${suffix}`)
  const labelArb = fc.stringMatching(/^[A-Za-z][A-Za-z ]{0,18}[A-Za-z]$/)
  const iconArb = fc.constantFrom('server', 'database', 'cloud', 'disk')
  const sideArb = fc.constantFrom('L', 'R', 'T', 'B')

  test('generated service and edge meaning survives parsing and serialization', () => {
    fc.assert(
      fc.property(
        fc.uniqueArray(idArb, { minLength: 2, maxLength: 5 }),
        fc.array(fc.record({ label: labelArb, icon: iconArb }), { minLength: 2, maxLength: 5 }),
        fc.array(fc.record({ from: fc.nat(), to: fc.nat(), fromSide: sideArb, toSide: sideArb, label: fc.option(labelArb, { nil: undefined }) }), { maxLength: 4 }),
        (ids, meta, rawEdges) => {
          const services = ids.map((id, i) => ({ id, ...(meta[i] ?? { label: id, icon: 'server' }) }))
          const lines = ['architecture-beta', ...services.map(s => `  service ${s.id}(${s.icon})[${s.label}]`)]
          const expectedEdges = rawEdges.map(e => ({
            source: { id: services[e.from % services.length]!.id, side: e.fromSide },
            target: { id: services[e.to % services.length]!.id, side: e.toSide },
            label: e.label,
            hasArrowStart: false,
            hasArrowEnd: true,
          }))
          for (const e of rawEdges) {
            const from = services[e.from % services.length]!.id
            const to = services[e.to % services.length]!.id
            const arrow = e.label ? `-[${e.label}]->` : '-->'
            lines.push(`  ${from}:${e.fromSide} ${arrow} ${e.toSide}:${to}`)
          }
          const d = architecture(lines.join('\n'))
          const out = serializeMermaid(d)
          const d2 = architecture(out)
          for (const { body } of [d, d2]) {
            expect(body.services.map(({ id, label, icon }) => ({ id, label, icon }))).toEqual(services)
            expect(body.edges).toEqual(expectedEdges)
            expect(body.groups).toEqual([])
            expect(body.junctions).toEqual([])
          }
          expect(serializeMermaid(d2)).toBe(out)
        },
      ),
      fcParameters({ numRuns: 50 }),
    )
  })
})
