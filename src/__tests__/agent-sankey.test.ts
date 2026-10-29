import { describe, expect, test } from 'bun:test'
import fc from 'fast-check'
import { fcParameters } from './helpers/fc-parameters.ts'
import { decodeXML } from 'entities'
import type { SankeyBody, SankeyMutationOp, SankeyValidDiagram } from '../agent/index.ts'
import { asSankey, buildMermaid, createMermaid, mutate, parseRegisteredMermaid as parseMermaid, renderMermaidASCII, renderMermaidSVG, serializeMermaid, verifyMermaid } from '../agent/index.ts'
import type { SankeyRuntimeConfig } from '../index.ts'

const BASIC = 'sankey-beta\n  Coal,Electricity,127.93\n  Gas,Electricity,80\n  Electricity,Homes,120'

test('Sankey repeated headers share one direct and typed CSV reading', async () => {
  const { renderMermaidSVG: directSVG, renderMermaidASCII: directASCII } = await import('../index.ts')
  const { startUpstreamMermaid } = await import('./helpers/upstream-mermaid.ts')
  const upstream = startUpstreamMermaid()
  try {
    const source = 'sankey\nsankey-beta\nA,B,2\nsankey\n"sankey",B,3'
    expect(() => directSVG(source)).not.toThrow()
    const parsed = sankey(source)
    expect(parsed.body.links).toEqual([{ source: 'A', target: 'B', value: 2 }, { source: 'sankey', target: 'B', value: 3 }])
    expect(directSVG(source)).toBe(renderMermaidSVG(parsed))
    expect(directASCII(source)).toBe(renderMermaidASCII(parsed))
    expect(verifyMermaid(source).warnings).toContainEqual(expect.objectContaining({ code: 'UNSUPPORTED_SYNTAX', syntax: 'sankey_repeated_header' }))
    const written = serializeMermaid(parsed)
    expect(await upstream.publicAccepts(written)).toBe(true)
    expect(sankey(written).body.links).toEqual(parsed.body.links)
    const { parseSankeyDiagram } = await import('../sankey/parser.ts')
    const quoted = 'sankey\n"North\nsankey\nAmerica",B,1'
    expect(parseSankeyDiagram(quoted.split('\n')).nodes).toContain('North\nsankey\nAmerica')
    expect(verifyMermaid(quoted).warnings.some(warning => warning.code === 'UNSUPPORTED_SYNTAX' && warning.syntax === 'sankey_repeated_header')).toBe(false)
  } finally { upstream.close() }
})

test('Sankey restored empty comments remain portable beside CSV and accessibility metadata', async () => {
  const { startUpstreamMermaid } = await import('./helpers/upstream-mermaid.ts')
  const upstream = startUpstreamMermaid()
  try {
    for (const source of [
      'sankey\n%%\nn,o,2',
      'sankey\n%%\nBio-corsion,Losses,26.862\n\nBio-conversion,Solid,280.322\n\nBio-conversion,Gas,81.144',
      'sankey-beta\n%%\nA,_,0',
      'sankey-beta\naccTitle: Flows\n%%\nA,B,1\n%% detail\nB,C,1\n%%',
    ]) {
      const parsed = sankey(source)
      const written = serializeMermaid(parsed)
      expect(await upstream.publicAccepts(written), written).toBe(true)
      const reloaded = sankey(written)
      expect(reloaded.body).toEqual(parsed.body)
      expect(reloaded.meta.accessibility).toEqual(parsed.meta.accessibility)
      expect(reloaded.meta.bodyComments?.map(comment => comment.raw.trimEnd())).toEqual(parsed.meta.bodyComments?.map(comment => comment.raw.trimEnd()))
      expect(serializeMermaid(reloaded)).toBe(written)
      expect(renderMermaidSVG(written)).toBe(renderMermaidSVG(source))
      const edited = mutate(parsed, { kind: 'set_link_value', source: parsed.body.links[0]!.source, target: parsed.body.links[0]!.target, value: 3 })
      if (!edited.ok) throw new Error(edited.error.message)
      expect(await upstream.publicAccepts(serializeMermaid(edited.value))).toBe(true)
    }
  } finally { upstream.close() }
})

test('Sankey directive-like identities remain source-preserved extensions', async () => {
  const { startUpstreamMermaid } = await import('./helpers/upstream-mermaid.ts')
  const upstream = startUpstreamMermaid()
  try {
    for (const [body, syntax] of [
      ['source,%%{target,1', 'sankey_directive_text'],
      ['source%%{name,target,1', 'sankey_directive_text'],
    ]) {
      const source = `sankey-beta\n${body}\n`
      expect(await upstream.accepts(source)).toBe(false)
      const parsed = parseMermaid(source)
      if (!parsed.ok) throw Error(JSON.stringify(parsed.error))
      expect(parsed.value.body.kind).toBe('opaque')
      expect(serializeMermaid(parsed.value)).toBe(source)
      expect(renderMermaidSVG(parsed.value)).toBe(renderMermaidSVG(source))
      expect(renderMermaidASCII(parsed.value)).toBe(renderMermaidASCII(source))
      expect(verifyMermaid(parsed.value).warnings).toContainEqual(expect.objectContaining({ code: 'UNSUPPORTED_SYNTAX', syntax }))
      expect(mutate(parsed.value, { kind: 'rename_node', from: 'source', to: 'changed' }).ok).toBe(false)
    }
    for (const op of [
      { kind: 'add_link', source: '%%{new', target: 'Homes', value: 1 },
      { kind: 'rename_node', from: 'Coal', to: '%%{renamed' },
    ] satisfies SankeyMutationOp[]) expect(mutate(sankey(BASIC), op).ok).toBe(false)
    const portable = sankey('sankey-beta\nsource,%target,1')
    expect(await upstream.accepts(serializeMermaid(portable))).toBe(true)
  } finally { upstream.close() }
})

// Quoting is independent of the production serializer. Distinct prefixes
// construct acyclic inputs without filtering punctuation or Unicode.
const csv = (text: string): string => `"${text.replaceAll('"', '""')}"`
const csvTextArb = fc.oneof(
  fc.string({ unit: 'grapheme', maxLength: 32 }),
  fc.array(fc.constantFrom(',', '"', ' ', ';', '#', '&', '<b>literal</b>', '東京', '👩‍💻', 'é'), { maxLength: 12 }).map(parts => parts.join('')),
)

describe('sankey generated CSV and mutation contracts', () => {
  test('quoted labels and parallel row values survive parse and canonical serialization', () => {
    fc.assert(fc.property(csvTextArb, csvTextArb, fc.double({ min: 0, noNaN: true, noDefaultInfinity: true }), (a, b, value) => {
      const sourceLabel = `left ${a}`.trim()
      const targetLabel = `right ${b}`.trim()
      const expected = [
        { source: sourceLabel, target: targetLabel, value },
        { source: sourceLabel, target: targetLabel, value: 2 },
      ]
      const source = `sankey-beta\n${csv(`  ${sourceLabel}  `)},${csv(`  ${targetLabel}  `)},${value}\n${csv(sourceLabel)},${csv(targetLabel)},2`
      const parsed = sankey(source)
      expect(parsed.body.links).toEqual(expected)
      const canonical = serializeMermaid(parsed)
      expect(sankey(canonical).body.links).toEqual(expected)
      expect(serializeMermaid(sankey(canonical))).toBe(canonical)
    }), fcParameters({ numRuns: 1000 }))
  })

  test('malformed numeric rows stay lossless and are rejected by rendering', () => {
    const invalidValue = fc.oneof(
      fc.integer({ min: -2147483648, max: -1 }).map(String),
      fc.constantFrom('NaN', 'Infinity', '-Infinity', '1junk', '', '1e999'),
    )
    fc.assert(fc.property(csvTextArb, invalidValue, (label, value) => {
      const source = `sankey-beta\n${csv(`left ${label}`)},right,${value}`
      const parsed = parseMermaid(source)
      expect(parsed.ok).toBe(true)
      if (!parsed.ok) throw new Error(JSON.stringify(parsed.error))
      expect(parsed.value.body.kind).toBe('opaque')
      expect(serializeMermaid(parsed.value)).toBe(`${source}\n`)
      expect(() => renderMermaidSVG(parsed.value)).toThrow(/invalid value/)
    }), fcParameters({ numRuns: 1000 }))
  })

  test('rendering an edited parsed diagram paints the new identity without changing its input', () => {
    const paintedLabels = (svg: string): string[] => [...svg.matchAll(/<text\b[^>]*\bclass="sankey-node-label"[^>]*>([\s\S]*?)<\/text>/g)]
      .map(match => decodeXML(match[1]!.replace(/<[^>]+>/g, '')))
    fc.assert(fc.property(csvTextArb, suffix => {
      const oldLabel = `old-label ${suffix}`.trim()
      const newLabel = `new-label ${suffix}`.trim()
      const original = sankey(`sankey-beta\n${csv(oldLabel)},sink,1`)
      const before = paintedLabels(renderMermaidSVG(original))
      expect(before).toHaveLength(2)
      expect(before.filter(label => label.startsWith('old-label'))).toHaveLength(1)
      const edited = mutate(original, { kind: 'rename_node', from: oldLabel, to: newLabel })
      expect(edited.ok).toBe(true)
      if (!edited.ok) throw new Error(JSON.stringify(edited.error))
      expect(edited.value.body.links).toEqual([{ source: newLabel, target: 'sink', value: 1 }])
      expect(original.body.links).toEqual([{ source: oldLabel, target: 'sink', value: 1 }])
      // Only the plain prefix changes. Preserve the entire displayed suffix,
      // including formatting/entities, without reimplementing display parsing.
      expect(paintedLabels(renderMermaidSVG(edited.value))).toEqual(before.map(label => label.replace(/^old-label/, 'new-label')))
    }), fcParameters({ numRuns: 100, examples: [['old-label'], ['<b>old-label</b>'], ['#111;ld-label'], ['東京👩‍💻é']] }))
  })
})

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

  test('accessibility directives stay editable through native metadata comments', () => {
    const p = parseMermaid('sankey-beta\naccTitle: T\nA,B,1')
    expect(p.ok).toBe(true)
    if (p.ok) {
      expect(p.value.body.kind).toBe('sankey')
      expect(p.value.meta.accessibility).toEqual({ title: 'T' })
      expect(serializeMermaid(p.value)).toBe('sankey-beta\n  %% agentic-mermaid accTitle: "T"\n  A,B,1\n')
    }
  })

  test('malformed rows fall back to a lossless opaque body', () => {
    for (const source of ['sankey-beta\nA,B\n', 'sankey-beta\nA,B,10\nB,A,2\n']) {
      const p = parseMermaid(source)
      if (!p.ok) throw new Error(`parse failed: ${JSON.stringify(p.error)}`)
      expect(p.value.body.kind, source).toBe('opaque')
      expect(asSankey(p.value), source).toBeNull()
      expect(serializeMermaid(p.value), source).toBe(source)
      expect(() => renderMermaidSVG(p.value), source).toThrow()
      expect(verifyMermaid(p.value).warnings.map(warning => warning.code), source).toContain('RENDER_FAILED')
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

  // Type precision is a compile-time contract: `bun run typecheck` fails if an
  // accepted case stops compiling or a @ts-expect-error case starts compiling.
  function compileTimeSankeyConfig(): void {
    const config: SankeyRuntimeConfig = { nodeAlignment: 'left', showValues: false, nodeWidth: 12 }
    // @ts-expect-error nodeAlignment is the closed d3-sankey alignment union.
    const badAlignment: SankeyRuntimeConfig = { nodeAlignment: 'diagonal' }
    // @ts-expect-error nodeWidth is numeric.
    const badWidth: SankeyRuntimeConfig = { nodeWidth: '12' }
    void [config, badAlignment, badWidth]
  }
  void compileTimeSankeyConfig

  test('source map anchors every link row (sankey:link#i)', () => {
    // canonicalSource is the trimmed authored text, so rows anchor at col 1.
    const d = sankey(BASIC)
    expect(d.source.labels.get('sankey:link#0')).toEqual({ line: 2, col: 1 })
    expect(d.source.labels.get('sankey:link#2')).toEqual({ line: 4, col: 1 })
  })
})
