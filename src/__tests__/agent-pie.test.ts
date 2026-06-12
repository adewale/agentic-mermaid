// Pie structured mutation (promoting the pie family from source-level-only,
// following the journey/architecture/xychart pilots). Parse / narrow / mutate /
// verify / serialize, the structured-or-opaque fallback, round-trip identity,
// and a differential check that the canonical source we emit re-parses
// identically under the legacy renderer's parsePieChart.

import { describe, test, expect } from 'bun:test'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import fc from 'fast-check'
import { parseMermaid } from '../agent/parse.ts'
import { serializeMermaid } from '../agent/serialize.ts'
import { mutate } from '../agent/mutate.ts'
import { verifyMermaid } from '../agent/verify.ts'
import { asPie } from '../agent/types.ts'
import type { PieValidDiagram, PieMutationOp } from '../agent/types.ts'
import { parsePieChart } from '../pie/parser.ts'
import { normalizeMermaidSource } from '../mermaid-source.ts'

const SRC = `pie showData
  title Pets adopted by volunteers
  "Dogs" : 386
  "Cats" : 85
  "Rats" : 15
`

function pie(src: string = SRC): PieValidDiagram {
  const r = parseMermaid(src)
  if (!r.ok) throw new Error('parse: ' + JSON.stringify(r.error))
  const p = asPie(r.value)
  if (!p) throw new Error('not a structured pie: ' + r.value.body.kind)
  return p
}

function apply(d: PieValidDiagram, op: PieMutationOp): PieValidDiagram {
  const r = mutate(d, op)
  if (!r.ok) throw new Error('mutate: ' + JSON.stringify(r.error))
  return r.value
}

describe('pie structured parse', () => {
  test('models showData, title, and labelled positive-valued slices', () => {
    const d = pie()
    expect(d.kind).toBe('pie')
    expect(d.body.kind).toBe('pie')
    expect(d.body.showData).toBe(true)
    expect(d.body.title).toBe('Pets adopted by volunteers')
    expect(d.body.slices.map(s => s.label)).toEqual(['Dogs', 'Cats', 'Rats'])
    expect(d.body.slices.map(s => s.value)).toEqual([386, 85, 15])
  })

  test('inline header title, standalone title, and bare pie header all parse', () => {
    expect(pie('pie title Inline\n  "A" : 1').body.title).toBe('Inline')
    expect(pie('pie showData title Both\n  "A" : 1').body).toMatchObject({ showData: true, title: 'Both' })
    const bare = pie('pie\n  "A" : 1\n  "B" : 2')
    expect(bare.body.showData).toBe(false)
    expect(bare.body.title).toBeUndefined()
    expect(bare.body.slices).toHaveLength(2)
  })

  test('escaped quotes in a label decode and re-encode losslessly', () => {
    const d = pie('pie\n  "say \\"hi\\"" : 3')
    expect(d.body.slices[0]!.label).toBe('say "hi"')
    const d2 = pie(serializeMermaid(d))
    expect(d2.body.slices[0]!.label).toBe('say "hi"')
  })

  test('round-trips to canonical source and re-parses identically', () => {
    const d = pie()
    const out = serializeMermaid(d)
    const d2 = pie(out)
    expect(d2.body).toEqual(d.body)
    expect(serializeMermaid(d2)).toBe(out)
  })
})

describe('pie differential vs legacy parsePieChart', () => {
  // The canonical source the structured serializer emits must re-parse to the
  // SAME semantics under the legacy renderer's parsePieChart.
  const samples = [
    SRC,
    'pie\n  "A" : 1\n  "B" : 2.5',
    'pie showData title T\n  "Only" : 99',
  ]
  for (const [i, src] of samples.entries()) {
    test(`sample ${i}: structured + legacy agree on canonical output`, () => {
      const d = pie(src)
      const out = serializeMermaid(d)
      const legacy = parsePieChart(normalizeMermaidSource(out).lines)
      expect(legacy.title).toBe(d.body.title)
      expect(legacy.showData).toBe(d.body.showData)
      expect(legacy.entries.map(e => e.label)).toEqual(d.body.slices.map(s => s.label))
      expect(legacy.entries.map(e => e.value)).toEqual(d.body.slices.map(s => s.value))
    })
  }
})

describe('pie structured-or-opaque fallback', () => {
  const opaqueCases: Array<[string, string]> = [
    ['accTitle line', 'pie\n  accTitle: Accessible\n  "A" : 1'],
    ['accDescr block', 'pie\n  accDescr {\n    desc\n  }\n  "A" : 1'],
    ['unquoted label', 'pie\n  Dogs : 3'],
    ['negative value', 'pie\n  "A" : -3'],
    ['zero value', 'pie\n  "A" : 0'],
    ['non-numeric value', 'pie\n  "A" : lots'],
    ['no entries', 'pie title Empty'],
    ['header EXTRA suffix', 'pie EXTRA\n  "A" : 1'],
  ]
  for (const [name, src] of opaqueCases) {
    test(`${name} falls back to opaque and round-trips verbatim`, () => {
      const r = parseMermaid(src)
      expect(r.ok).toBe(true)
      if (!r.ok) return
      expect(r.value.body.kind).toBe('opaque')
      expect(asPie(r.value)).toBeNull()
      expect(serializeMermaid(r.value).trimEnd()).toBe(src)
    })
  }
})

describe('pie mutation ops', () => {
  test('set_title / clear title', () => {
    expect(apply(pie(), { kind: 'set_title', title: 'New' }).body.title).toBe('New')
    expect(apply(pie(), { kind: 'set_title', title: null }).body.title).toBeUndefined()
  })

  test('set_show_data toggles the flag and rewrites the header', () => {
    const off = apply(pie(), { kind: 'set_show_data', showData: false })
    expect(off.body.showData).toBe(false)
    expect(off.canonicalSource).toContain('pie\n')
    expect(off.canonicalSource).not.toContain('pie showData')
    const on = apply(off, { kind: 'set_show_data', showData: true })
    expect(on.canonicalSource).toContain('pie showData')
  })

  test('add_slice / remove_slice / set_slice_value / rename_slice', () => {
    let d = apply(pie(), { kind: 'add_slice', label: 'Birds', value: 12 })
    expect(d.body.slices).toHaveLength(4)
    expect(d.body.slices[3]).toMatchObject({ label: 'Birds', value: 12 })
    expect(d.canonicalSource).toContain('"Birds" : 12')
    d = apply(d, { kind: 'set_slice_value', label: 'Birds', value: 20 })
    expect(d.body.slices.find(s => s.label === 'Birds')!.value).toBe(20)
    d = apply(d, { kind: 'rename_slice', from: 'Birds', to: 'Parrots' })
    expect(d.body.slices.map(s => s.label)).toContain('Parrots')
    d = apply(d, { kind: 'remove_slice', label: 'Parrots' })
    expect(d.body.slices.map(s => s.label)).not.toContain('Parrots')
  })

  test('reorder_slice moves a slice', () => {
    const d = apply(pie(), { kind: 'reorder_slice', from: 0, to: 2 })
    expect(d.body.slices.map(s => s.label)).toEqual(['Cats', 'Rats', 'Dogs'])
  })

  test('error paths: not-found, duplicate, bad value, emptying floor', () => {
    const cases: Array<[PieMutationOp, import('../agent/types.ts').MutationError['code']]> = [
      [{ kind: 'remove_slice', label: 'Nope' }, 'SLICE_NOT_FOUND'],
      [{ kind: 'set_slice_value', label: 'Nope', value: 1 }, 'SLICE_NOT_FOUND'],
      [{ kind: 'rename_slice', from: 'Nope', to: 'X' }, 'SLICE_NOT_FOUND'],
      [{ kind: 'add_slice', label: 'Dogs', value: 1 }, 'INVALID_OP'],
      [{ kind: 'rename_slice', from: 'Dogs', to: 'Cats' }, 'INVALID_OP'],
      [{ kind: 'add_slice', label: 'X', value: 0 }, 'INVALID_OP'],
      [{ kind: 'add_slice', label: 'X', value: -1 }, 'INVALID_OP'],
      [{ kind: 'add_slice', label: 'X', value: Number.NaN }, 'INVALID_OP'],
      [{ kind: 'add_slice', label: '', value: 1 }, 'INVALID_OP'],
      [{ kind: 'reorder_slice', from: 0, to: 9 }, 'SLICE_NOT_FOUND'],
    ]
    for (const [op, code] of cases) {
      const r = mutate(pie(), op)
      expect({ op: op.kind, ok: r.ok, code: r.ok ? null : r.error.code }).toEqual({ op: op.kind, ok: false, code })
    }
    // The floor: a pie must keep at least one slice.
    const single = pie('pie\n  "Only" : 1')
    expect(mutate(single, { kind: 'remove_slice', label: 'Only' }).ok).toBe(false)
  })

  test('mutation does not alias the input diagram', () => {
    const d = pie()
    apply(d, { kind: 'set_slice_value', label: 'Dogs', value: 1 })
    expect(d.body.slices[0]!.value).toBe(386)
  })
})

describe('pie verify + render', () => {
  test('verify passes on a healthy chart and serializes after the loop', () => {
    const d = apply(pie(), { kind: 'add_slice', label: 'Fish', value: 7 })
    const v = verifyMermaid(d)
    expect(v.ok).toBe(true)
    expect(v.warnings).toHaveLength(0)
    expect(serializeMermaid(d)).toContain('"Fish" : 7')
  })

  test('EMPTY_DIAGRAM fires on a header-only (opaque) chart', () => {
    const v = verifyMermaid('pie')
    expect(v.warnings.map(w => w.code)).toContain('EMPTY_DIAGRAM')
    expect(v.ok).toBe(false)
  })

  test('LABEL_OVERFLOW fires on an over-cap title and slice label', () => {
    const long = 'X'.repeat(80)
    const title = verifyMermaid(pie(`pie title ${long}\n  "A" : 1`))
    expect(title.warnings.find(w => w.code === 'LABEL_OVERFLOW')).toMatchObject({ target: 'title', limit: 40 })
    const slice = verifyMermaid(pie(`pie\n  "${long}" : 1`))
    expect(slice.warnings.find(w => w.code === 'LABEL_OVERFLOW')).toBeDefined()
  })

  test('mutated chart renders through the legacy renderer', async () => {
    const { renderMermaidSVG } = await import('../agent/index.ts')
    const d = apply(pie(), { kind: 'set_title', title: 'Rendered' })
    const svg = renderMermaidSVG(d)
    expect(svg).toContain('<svg')
    expect(svg).toContain('Rendered')
  })
})

describe('pie corpus round-trip (every testdata sample)', () => {
  // testdata files are `<source>\n---\n<expected render>`; we round-trip only
  // the source half. Structured bodies normalize to canonical source, so the
  // contract here is canonical round-trip STABILITY (serialize(parse(...)) is
  // idempotent), matching the cross-family corpus gate. Opaque samples would
  // round-trip byte-verbatim instead.
  const TESTDATA = join(import.meta.dir, 'testdata')
  const samples: Array<[string, string]> = []
  for (const variant of ['ascii', 'unicode']) {
    const dir = join(TESTDATA, variant)
    for (const f of readdirSync(dir).filter(n => /^pie_/.test(n))) {
      const raw = readFileSync(join(dir, f), 'utf8')
      const src = raw.split(/^---$/m)[0]!.replace(/\n+$/, '\n')
      samples.push([`${variant}/${f}`, src])
    }
  }

  test('at least three pie samples are present', () => {
    expect(samples.length).toBeGreaterThanOrEqual(3)
  })

  for (const [name, src] of samples) {
    test(`${name}: parses structured, verifies, round-trips stably`, () => {
      const r = parseMermaid(src)
      expect(r.ok).toBe(true)
      if (!r.ok) return
      expect(r.value.body.kind).toBe('pie')
      const s1 = serializeMermaid(r.value)
      const r2 = parseMermaid(s1)
      expect(r2.ok).toBe(true)
      if (!r2.ok) return
      // Idempotent canonical round-trip + structurally identical body.
      expect(serializeMermaid(r2.value)).toBe(s1)
      expect(r2.value.body).toEqual(r.value.body)
    })
  }
})

describe('pie round-trip property', () => {
  const labelArb = fc.stringMatching(/^[A-Za-z][A-Za-z0-9 ]{0,12}[A-Za-z0-9]$/)
  const valueArb = fc.oneof(
    fc.integer({ min: 1, max: 1000 }),
    fc.constantFrom(0.1, 2.5, 3.14, 99.99, 0.5),
  )

  test('parse(render(parse(src))) is identity on generated charts', () => {
    fc.assert(
      fc.property(
        fc.boolean(),
        fc.option(labelArb, { nil: undefined }),
        fc.uniqueArray(fc.record({ label: labelArb, value: valueArb }), {
          minLength: 1, maxLength: 6, selector: s => s.label,
        }),
        (showData, title, slices) => {
          const lines = [showData ? 'pie showData' : 'pie']
          if (title) lines.push(`  title ${title}`)
          for (const s of slices) lines.push(`  "${s.label}" : ${s.value}`)
          const d = pie(lines.join('\n'))
          const out = serializeMermaid(d)
          const d2 = pie(out)
          expect(d2.body).toEqual(d.body)
          expect(serializeMermaid(d2)).toBe(out)
        },
      ),
      { numRuns: 50 },
    )
  })

  test('canonical number format survives 0.1, integers, and decimals', () => {
    const d = pie('pie\n  "a" : 0.1\n  "b" : 42\n  "c" : 3.14')
    const out = serializeMermaid(d)
    expect(out).toContain('"a" : 0.1')
    expect(pie(out).body.slices.map(s => s.value)).toEqual([0.1, 42, 3.14])
  })
})
