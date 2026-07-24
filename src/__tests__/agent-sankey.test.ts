import { describe, expect, test } from 'bun:test'
import type { SankeyBody, SankeyMutationOp, SankeyValidDiagram } from '../agent/index.ts'
import { asSankey, buildMermaid, createMermaid, mutate, parseRegisteredMermaid as parseMermaid, serializeMermaid } from '../agent/index.ts'
import type { SankeyRuntimeConfig } from '../index.ts'
import { SDK_DECLARATION } from '../mcp/sdk-decl.ts'

const BASIC = 'sankey-beta\n  Coal,Electricity,127.93\n  Gas,Electricity,80\n  Electricity,Homes,120'

function sankey(src: string): SankeyValidDiagram {
  const p = parseMermaid(src)
  expect(p.ok).toBe(true)
  if (!p.ok) throw new Error('parse failed')
  const s = asSankey(p.value)
  expect(s).not.toBeNull()
  return s!
}

describe('sankey agent surface · parse and narrow', () => {
  test('parses to a structured sankey body and narrows via asSankey', () => {
    const d = sankey(BASIC)
    expect(d.body.kind).toBe('sankey')
    expect(d.body.links).toEqual([
      { source: 'Coal', target: 'Electricity', value: 127.93 },
      { source: 'Gas', target: 'Electricity', value: 80 },
      { source: 'Electricity', target: 'Homes', value: 120 },
    ])
  })

  test('round-trips to canonical source and re-parses identically', () => {
    const d = sankey(BASIC)
    const canonical = serializeMermaid(d)
    expect(canonical).toBe('sankey-beta\n  Coal,Electricity,127.93\n  Gas,Electricity,80\n  Electricity,Homes,120\n')
    const again = sankey(canonical)
    expect(again.body).toEqual(d.body)
    expect(serializeMermaid(again)).toBe(canonical)
  })

  test('canonical serialization quotes only when content demands it', () => {
    const d = sankey('sankey-beta\n  Pumped heat,"Heating, ""homes""",193.026')
    expect(serializeMermaid(d)).toBe('sankey-beta\n  Pumped heat,"Heating, ""homes""",193.026\n')
  })

  test('accessibility directives ride in meta and survive serialization (structured body)', () => {
    const p = parseMermaid('sankey-beta\naccTitle: T\nA,B,1')
    expect(p.ok).toBe(true)
    if (p.ok) {
      expect(p.value.body.kind).toBe('sankey')
      expect(p.value.meta.accessibility).toEqual({ title: 'T' })
      expect(serializeMermaid(p.value)).toContain('accTitle: T')
    }
  })

  test('malformed rows fall back to a lossless opaque body', () => {
    for (const source of ['sankey-beta\nA,B', 'sankey-beta\nA,B,10\nB,A,2']) {
      const p = parseMermaid(source)
      expect(p.ok).toBe(true)
      if (p.ok) {
        expect(p.value.body.kind).toBe('opaque')
        expect(asSankey(p.value)).toBeNull()
      }
    }
  })
})

describe('sankey agent surface · typed mutation', () => {
  test('add_link appends by default and honors index', () => {
    const d = sankey(BASIC)
    const appended = mutate(d, { kind: 'add_link', source: 'Electricity', target: 'Losses', value: 87.93 })
    expect(appended.ok).toBe(true)
    if (appended.ok) expect(appended.value.body.links.at(-1)).toEqual({ source: 'Electricity', target: 'Losses', value: 87.93 })
    const inserted = mutate(d, { kind: 'add_link', source: 'Solar', target: 'Electricity', value: 5, index: 0 })
    expect(inserted.ok).toBe(true)
    if (inserted.ok) {
      expect(inserted.value.body.links[0]).toEqual({ source: 'Solar', target: 'Electricity', value: 5 })
      expect(inserted.value.canonicalSource.startsWith('sankey-beta\n  Solar,Electricity,5\n')).toBe(true)
    }
  })

  test('set_link_value and remove_link address parallel duplicates by occurrence', () => {
    const d = sankey('sankey-beta\n  A,B,1\n  A,B,2')
    const set = mutate(d, { kind: 'set_link_value', source: 'A', target: 'B', value: 9, occurrence: 1 })
    expect(set.ok).toBe(true)
    if (set.ok) expect(set.value.body.links.map(l => l.value)).toEqual([1, 9])
    const removed = mutate(d, { kind: 'remove_link', source: 'A', target: 'B' })
    expect(removed.ok).toBe(true)
    if (removed.ok) expect(removed.value.body.links).toEqual([{ source: 'A', target: 'B', value: 2 }])
    const missing = mutate(d, { kind: 'remove_link', source: 'A', target: 'B', occurrence: 5 })
    expect(missing.ok).toBe(false)
    if (!missing.ok) expect(missing.error.code).toBe('LINK_NOT_FOUND')
  })

  test('rename_node rewrites every occurrence and rejects merges', () => {
    const d = sankey(BASIC)
    const renamed = mutate(d, { kind: 'rename_node', from: 'Electricity', to: 'Grid' })
    expect(renamed.ok).toBe(true)
    if (renamed.ok) {
      expect(renamed.value.body.links.map(l => `${l.source}->${l.target}`)).toEqual(['Coal->Grid', 'Gas->Grid', 'Grid->Homes'])
    }
    const merge = mutate(d, { kind: 'rename_node', from: 'Coal', to: 'Gas' })
    expect(merge.ok).toBe(false)
    if (!merge.ok) expect(merge.error.message).toContain('merge')
    const missing = mutate(d, { kind: 'rename_node', from: 'Nope', to: 'X' })
    expect(missing.ok).toBe(false)
    if (!missing.ok) expect(missing.error.code).toBe('NODE_NOT_FOUND')
  })

  test('invariants reject self-loops, cycles, and negative values through ops', () => {
    const d = sankey(BASIC)
    const selfLoop = mutate(d, { kind: 'add_link', source: 'Coal', target: 'Coal', value: 1 })
    expect(selfLoop.ok).toBe(false)
    const cycle = mutate(d, { kind: 'add_link', source: 'Homes', target: 'Coal', value: 1 })
    expect(cycle.ok).toBe(false)
    if (!cycle.ok) expect(cycle.error.message).toContain('cycle')
    const negative = mutate(d, { kind: 'add_link', source: 'X', target: 'Y', value: -1 })
    expect(negative.ok).toBe(false)
  })

  test('mutation rebuilds canonicalSource (no stale source)', () => {
    const d = sankey(BASIC)
    const r = mutate(d, { kind: 'set_link_value', source: 'Gas', target: 'Electricity', value: 99 })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.value.canonicalSource).toContain('Gas,Electricity,99')
  })
})

describe('sankey agent surface · blank-slate authoring and SDK projection', () => {
  test('createMermaid/buildMermaid produce a valid diagram from typed ops alone', () => {
    const created: SankeyValidDiagram = createMermaid('sankey')
    expect(created.body).toEqual({ kind: 'sankey', links: [] })
    const ops: SankeyMutationOp[] = [
      { kind: 'add_link', source: 'Leads', target: 'Qualified', value: 120 },
      { kind: 'add_link', source: 'Qualified', target: 'Won', value: 45 },
      { kind: 'rename_node', from: 'Won', to: 'Closed won' },
    ]
    const built = buildMermaid('sankey', ops)
    expect(built.ok).toBe(true)
    if (built.ok) {
      const body: SankeyBody = built.value.body
      expect(body.links.at(-1)).toEqual({ source: 'Qualified', target: 'Closed won', value: 45 })
      expect(parseMermaid(serializeMermaid(built.value)).ok).toBe(true)
    }
  })

  test('public sankey types, config, and the Code Mode SDK declaration stay precise', () => {
    const config: SankeyRuntimeConfig = { nodeAlignment: 'left', showValues: false, nodeWidth: 12 }
    expect(config.nodeAlignment).toBe('left')
    expect(SDK_DECLARATION).toContain("interface SankeyBody { kind: 'sankey'; links: SankeyBodyLink[] }")
    expect(SDK_DECLARATION).toContain('type SankeyMutationOp =')
    expect(SDK_DECLARATION).toContain('asSankey(d: ValidDiagram): SankeyValidDiagram | null')
    expect(SDK_DECLARATION).toContain('sankey?: {')
  })

  test('source map anchors every link row (sankey:link#i)', () => {
    // canonicalSource is the trimmed authored text, so rows anchor at col 1.
    const d = sankey(BASIC)
    expect(d.source.labels.get('sankey:link#0')).toEqual({ line: 2, col: 1 })
    expect(d.source.labels.get('sankey:link#2')).toEqual({ line: 4, col: 1 })
  })
})
