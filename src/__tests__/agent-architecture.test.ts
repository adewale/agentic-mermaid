// BUILD-17: architecture structured mutation (promoting the architecture-beta
// family from source-level-only, following the BUILD-15 journey pilot). Parse /
// narrow / mutate / verify / serialize, the structured-or-opaque fallback, and
// round-trip identity.

import { describe, test, expect } from 'bun:test'
import fc from 'fast-check'
import { parseMermaid } from '../agent/parse.ts'
import { serializeMermaid } from '../agent/serialize.ts'
import { mutate } from '../agent/mutate.ts'
import { verifyMermaid } from '../agent/verify.ts'
import { asArchitecture } from '../agent/types.ts'
import type { ArchitectureValidDiagram, ArchitectureMutationOp } from '../agent/types.ts'

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
    expect(d2.body).toEqual(d.body)
    expect(serializeMermaid(d2)).toBe(out)
  })
})

describe('architecture structured-or-opaque fallback', () => {
  const opaqueCases: Array<[string, string]> = [
    ['accTitle line', 'architecture-beta\n  accTitle: System overview\n  service api(server)[API]'],
    ['accDescr block', 'architecture-beta\n  accDescr {\n    description\n  }\n  service api(server)[API]'],
    ['{group} boundary edge', 'architecture-beta\n  group store(cloud)[Store]\n  service db(database)[DB] in store\n  service cache(disk)[Cache]\n  db{group}:R -[r]-> L:cache'],
    ['unknown in-parent group', 'architecture-beta\n  service db(database)[DB] in nowhere'],
    ['edge to undeclared item', 'architecture-beta\n  service api(server)[API]\n  api:R --> L:ghost'],
    ['header suffix', 'architecture-beta EXTRA\n  service api(server)[API]'],
    ['empty diagram (header only)', 'architecture-beta'],
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

  test('add_group / remove_group (empty)', () => {
    let d = apply(architecture(), { kind: 'add_group', id: 'data', label: 'Data', icon: 'cloud' })
    expect(d.body.groups.map(g => g.id)).toContain('data')
    d = apply(d, { kind: 'remove_group', id: 'data' })
    expect(d.body.groups.map(g => g.id)).not.toContain('data')
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

  test('error paths: missing targets, bad ids, non-empty group, invalid sides, emptying floor', () => {
    const cases: Array<[ArchitectureMutationOp, import('../agent/types.ts').MutationError['code']]> = [
      [{ kind: 'remove_service', id: 'ghost' }, 'SERVICE_NOT_FOUND'],
      [{ kind: 'set_service_label', id: 'ghost', label: 'X' }, 'SERVICE_NOT_FOUND'],
      [{ kind: 'move_service', id: 'db', group: 'nogroup' }, 'GROUP_NOT_FOUND'],
      [{ kind: 'add_service', id: 'db', label: 'Dup' }, 'INVALID_OP'],
      [{ kind: 'add_service', id: 'bad id', label: 'X' }, 'INVALID_OP'],
      [{ kind: 'remove_group', id: 'api' }, 'INVALID_OP'],
      [{ kind: 'remove_group', id: 'ghost' }, 'GROUP_NOT_FOUND'],
      [{ kind: 'add_edge', from: 'web', to: 'ghost', fromSide: 'R', toSide: 'L' }, 'SERVICE_NOT_FOUND'],
      [{ kind: 'add_edge', from: 'web', to: 'db', fromSide: 'X' as never, toSide: 'L' }, 'INVALID_OP'],
      [{ kind: 'remove_edge', index: 9 }, 'EDGE_NOT_FOUND'],
      [{ kind: 'remove_edge', id: 'no->edge' }, 'EDGE_NOT_FOUND'],
    ]
    for (const [op, code] of cases) {
      const r = mutate(architecture(), op)
      expect({ op: op.kind, ok: r.ok, code: r.ok ? null : r.error.code }).toEqual({ op: op.kind, ok: false, code })
    }
    // The floor: an architecture diagram must keep at least one node.
    const single = architecture('architecture-beta\n  service only(server)[Only]')
    const r = mutate(single, { kind: 'remove_service', id: 'only' })
    expect(r.ok).toBe(false)
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

describe('architecture round-trip property', () => {
  const idArb = fc.stringMatching(/^[a-z][a-z0-9]{0,7}$/)
  const labelArb = fc.stringMatching(/^[A-Za-z][A-Za-z ]{0,18}[A-Za-z]$/)
  const iconArb = fc.constantFrom('server', 'database', 'cloud', 'disk')
  const sideArb = fc.constantFrom('L', 'R', 'T', 'B')

  test('parse(render(parse(src))) is identity on generated architectures', () => {
    fc.assert(
      fc.property(
        fc.uniqueArray(idArb, { minLength: 2, maxLength: 5 }),
        fc.array(fc.record({ label: labelArb, icon: iconArb }), { minLength: 2, maxLength: 5 }),
        fc.array(fc.record({ from: fc.nat(), to: fc.nat(), fromSide: sideArb, toSide: sideArb, label: fc.option(labelArb, { nil: undefined }) }), { maxLength: 4 }),
        (ids, meta, rawEdges) => {
          const services = ids.map((id, i) => ({ id, ...(meta[i] ?? { label: id, icon: 'server' }) }))
          const lines = ['architecture-beta', ...services.map(s => `  service ${s.id}(${s.icon})[${s.label}]`)]
          for (const e of rawEdges) {
            const from = services[e.from % services.length]!.id
            const to = services[e.to % services.length]!.id
            const arrow = e.label ? `-[${e.label}]->` : '-->'
            lines.push(`  ${from}:${e.fromSide} ${arrow} ${e.toSide}:${to}`)
          }
          const d = architecture(lines.join('\n'))
          const out = serializeMermaid(d)
          const d2 = architecture(out)
          expect(d2.body).toEqual(d.body)
          expect(serializeMermaid(d2)).toBe(out)
        },
      ),
      { numRuns: 50 },
    )
  })
})
