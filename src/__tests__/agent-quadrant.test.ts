// Quadrant structured mutation (promoting quadrantChart from opaque-only
// fallback semantics, following the journey/architecture/xychart pilots). Parse
// / narrow / mutate / verify / serialize, the structured-or-opaque fallback,
// round-trip identity, and a differential check that the canonical source we
// emit re-parses identically under the legacy renderer's parseQuadrantChart.

import { describe, test, expect } from 'bun:test'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import fc from 'fast-check'
import { parseMermaid } from '../agent/parse.ts'
import { serializeMermaid } from '../agent/serialize.ts'
import { mutate } from '../agent/mutate.ts'
import { verifyMermaid } from '../agent/verify.ts'
import { asQuadrant } from '../agent/types.ts'
import type { QuadrantValidDiagram, QuadrantMutationOp } from '../agent/types.ts'
import { parseQuadrantChart } from '../quadrant/parser.ts'
import { normalizeMermaidSource } from '../mermaid-source.ts'

const SRC = `quadrantChart
  title Reach and engagement of campaigns
  x-axis Low Reach --> High Reach
  y-axis Low Engagement --> High Engagement
  quadrant-1 We should expand
  quadrant-2 Need to promote
  quadrant-3 Re-evaluate
  quadrant-4 May be improved
  Campaign A: [0.3, 0.6]
  Campaign B: [0.45, 0.23]
`

function quadrant(src: string = SRC): QuadrantValidDiagram {
  const r = parseMermaid(src)
  if (!r.ok) throw new Error('parse: ' + JSON.stringify(r.error))
  const q = asQuadrant(r.value)
  if (!q) throw new Error('not a structured quadrant: ' + r.value.body.kind)
  return q
}

function apply(d: QuadrantValidDiagram, op: QuadrantMutationOp): QuadrantValidDiagram {
  const r = mutate(d, op)
  if (!r.ok) throw new Error('mutate: ' + JSON.stringify(r.error))
  return r.value
}

describe('quadrant structured parse', () => {
  test('models title, axes, 1..4 quadrant labels, and [0,1] points', () => {
    const d = quadrant()
    expect(d.kind).toBe('quadrant')
    expect(d.body.title).toBe('Reach and engagement of campaigns')
    expect(d.body.xAxis).toEqual({ near: 'Low Reach', far: 'High Reach' })
    expect(d.body.yAxis).toEqual({ near: 'Low Engagement', far: 'High Engagement' })
    // Mermaid numbering: index n-1 holds quadrant-n.
    expect(d.body.quadrants).toEqual(['We should expand', 'Need to promote', 'Re-evaluate', 'May be improved'])
    expect(d.body.points).toEqual([
      { label: 'Campaign A', x: 0.3, y: 0.6 },
      { label: 'Campaign B', x: 0.45, y: 0.23 },
    ])
  })

  test('axis without a far side and a bare header parse structurally', () => {
    const d = quadrant('quadrantChart\n  x-axis Left\n  A: [0, 1]')
    expect(d.body.xAxis).toEqual({ near: 'Left' })
    expect(d.body.yAxis).toBeUndefined()
    const bare = quadrant('quadrantChart')
    expect(bare.body.points).toHaveLength(0)
    expect(bare.body.quadrants).toEqual([undefined, undefined, undefined, undefined])
  })

  test('round-trips to canonical source and re-parses identically', () => {
    const d = quadrant()
    const out = serializeMermaid(d)
    const d2 = quadrant(out)
    expect(d2.body).toEqual(d.body)
    expect(serializeMermaid(d2)).toBe(out)
  })
})

describe('quadrant differential vs legacy parseQuadrantChart', () => {
  const samples = [
    SRC,
    'quadrantChart\n  title T\n  x-axis L --> R\n  A: [0.1, 0.9]',
    'quadrantChart\n  quadrant-1 Q1\n  quadrant-3 Q3\n  P: [0.5, 0.5]',
  ]
  for (const [i, src] of samples.entries()) {
    test(`sample ${i}: structured + legacy agree on canonical output`, () => {
      const d = quadrant(src)
      const out = serializeMermaid(d)
      const legacy = parseQuadrantChart(normalizeMermaidSource(out).lines)
      expect(legacy.title).toBe(d.body.title)
      expect(legacy.xAxis).toEqual(d.body.xAxis)
      expect(legacy.yAxis).toEqual(d.body.yAxis)
      expect(legacy.quadrants).toEqual(d.body.quadrants)
      expect(legacy.points).toEqual(d.body.points)
    })
  }
})

describe('quadrant structured-or-opaque fallback', () => {
  const opaqueCases: Array<[string, string]> = [
    ['accTitle line', 'quadrantChart\n  accTitle: Accessible\n  A: [0, 0]'],
    ['classDef styling', 'quadrantChart\n  classDef foo color:#fff\n  A: [0, 0]'],
    ['class assignment :::', 'quadrantChart\n  A: [0, 0] ::: foo'],
    ['out-of-range coord', 'quadrantChart\n  A: [1.5, 0]'],
    ['negative coord', 'quadrantChart\n  A: [-0.1, 0]'],
    ['non-numeric coord', 'quadrantChart\n  A: [x, 0]'],
    ['missing brackets', 'quadrantChart\n  A: 0.5, 0.5'],
    ['duplicate point label', 'quadrantChart\n  A: [0, 0]\n  A: [1, 1]'],
    ['header EXTRA suffix', 'quadrantChart EXTRA\n  A: [0, 0]'],
  ]
  for (const [name, src] of opaqueCases) {
    test(`${name} falls back to opaque and round-trips verbatim`, () => {
      const r = parseMermaid(src)
      expect(r.ok).toBe(true)
      if (!r.ok) return
      expect(r.value.body.kind).toBe('opaque')
      expect(asQuadrant(r.value)).toBeNull()
      expect(serializeMermaid(r.value).trimEnd()).toBe(src)
    })
  }
})

describe('quadrant mutation ops', () => {
  test('set_title / clear title', () => {
    expect(apply(quadrant(), { kind: 'set_title', title: 'New' }).body.title).toBe('New')
    expect(apply(quadrant(), { kind: 'set_title', title: null }).body.title).toBeUndefined()
  })

  test('set_axis_labels sets, replaces far, and clears axes', () => {
    let d = apply(quadrant(), { kind: 'set_axis_labels', axis: 'x', near: 'A', far: 'B' })
    expect(d.body.xAxis).toEqual({ near: 'A', far: 'B' })
    d = apply(d, { kind: 'set_axis_labels', axis: 'x', near: 'Only' })
    expect(d.body.xAxis).toEqual({ near: 'Only' })
    d = apply(d, { kind: 'set_axis_labels', axis: 'y', near: null })
    expect(d.body.yAxis).toBeUndefined()
  })

  test('set_quadrant_label by 1..4 and clear', () => {
    let d = apply(quadrant(), { kind: 'set_quadrant_label', quadrant: 1, label: 'Top right' })
    expect(d.body.quadrants[0]).toBe('Top right')
    d = apply(d, { kind: 'set_quadrant_label', quadrant: 3, label: null })
    expect(d.body.quadrants[2]).toBeUndefined()
  })

  test('add_point / move_point / rename_point / remove_point', () => {
    let d = apply(quadrant(), { kind: 'add_point', label: 'Campaign C', x: 0.7, y: 0.2 })
    expect(d.body.points).toHaveLength(3)
    expect(d.canonicalSource).toContain('Campaign C: [0.7, 0.2]')
    d = apply(d, { kind: 'move_point', label: 'Campaign C', x: 0.1, y: 0.1 })
    expect(d.body.points.find(p => p.label === 'Campaign C')).toMatchObject({ x: 0.1, y: 0.1 })
    d = apply(d, { kind: 'rename_point', from: 'Campaign C', to: 'Campaign D' })
    expect(d.body.points.map(p => p.label)).toContain('Campaign D')
    d = apply(d, { kind: 'remove_point', label: 'Campaign D' })
    expect(d.body.points).toHaveLength(2)
  })

  test('error paths: not-found, duplicate, range, numbering, syntax-breaking labels', () => {
    const cases: Array<[QuadrantMutationOp, import('../agent/types.ts').MutationError['code']]> = [
      [{ kind: 'remove_point', label: 'Nope' }, 'POINT_NOT_FOUND'],
      [{ kind: 'move_point', label: 'Nope', x: 0, y: 0 }, 'POINT_NOT_FOUND'],
      [{ kind: 'rename_point', from: 'Nope', to: 'X' }, 'POINT_NOT_FOUND'],
      [{ kind: 'add_point', label: 'Campaign A', x: 0, y: 0 }, 'INVALID_OP'],
      [{ kind: 'rename_point', from: 'Campaign A', to: 'Campaign B' }, 'INVALID_OP'],
      [{ kind: 'add_point', label: 'X', x: 1.5, y: 0 }, 'INVALID_OP'],
      [{ kind: 'add_point', label: 'X', x: -0.1, y: 0 }, 'INVALID_OP'],
      [{ kind: 'add_point', label: 'has: colon', x: 0, y: 0 }, 'INVALID_OP'],
      [{ kind: 'add_point', label: 'has [bracket]', x: 0, y: 0 }, 'INVALID_OP'],
      [{ kind: 'set_quadrant_label', quadrant: 0, label: 'X' }, 'INVALID_OP'],
      [{ kind: 'set_quadrant_label', quadrant: 5, label: 'X' }, 'INVALID_OP'],
      [{ kind: 'set_axis_labels', axis: 'x', near: 'has --> arrow' }, 'INVALID_OP'],
    ]
    for (const [op, code] of cases) {
      const r = mutate(quadrant(), op)
      expect({ op: op.kind, ok: r.ok, code: r.ok ? null : r.error.code }).toEqual({ op: op.kind, ok: false, code })
    }
  })

  test('mutation does not alias the input diagram', () => {
    const d = quadrant()
    apply(d, { kind: 'move_point', label: 'Campaign A', x: 0, y: 0 })
    expect(d.body.points[0]).toMatchObject({ x: 0.3, y: 0.6 })
  })
})

describe('quadrant verify + render', () => {
  test('verify passes on a healthy chart and serializes after the loop', () => {
    const d = apply(quadrant(), { kind: 'add_point', label: 'Campaign C', x: 0.5, y: 0.5 })
    const v = verifyMermaid(d)
    expect(v.ok).toBe(true)
    expect(v.warnings).toHaveLength(0)
    expect(serializeMermaid(d)).toContain('Campaign C: [0.5, 0.5]')
  })

  test('EMPTY_DIAGRAM fires on a header-only (opaque/empty) chart', () => {
    const v = verifyMermaid('quadrantChart')
    expect(v.warnings.map(w => w.code)).toContain('EMPTY_DIAGRAM')
    expect(v.ok).toBe(false)
  })

  test('LABEL_OVERFLOW fires on an over-cap title, axis, quadrant, and point label', () => {
    const long = 'X'.repeat(80)
    expect(verifyMermaid(quadrant(`quadrantChart\n  title ${long}\n  A: [0, 0]`))
      .warnings.find(w => w.code === 'LABEL_OVERFLOW')).toMatchObject({ target: 'title' })
    expect(verifyMermaid(quadrant(`quadrantChart\n  x-axis ${long}\n  A: [0, 0]`))
      .warnings.find(w => w.code === 'LABEL_OVERFLOW')).toBeDefined()
    expect(verifyMermaid(quadrant(`quadrantChart\n  quadrant-1 ${long}\n  A: [0, 0]`))
      .warnings.find(w => w.code === 'LABEL_OVERFLOW')).toBeDefined()
  })

  test('styled Mermaid-docs quadrant stays opaque/source-preserved but still verifies and renders', async () => {
    const { renderMermaidSVG, renderMermaidASCII } = await import('../agent/index.ts')
    const src = `quadrantChart
  Campaign A: [0.9, 0.0] radius: 12
  Campaign B:::class1: [0.8, 0.1] color: #ff3300, radius: 10
  classDef class1 color: #109060
`
    const parsed = parseMermaid(src)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(parsed.value.body.kind).toBe('opaque')
    expect(serializeMermaid(parsed.value)).toBe(src)
    const verify = verifyMermaid(parsed.value)
    expect(verify.ok).toBe(true)
    expect(verify.warnings.map(w => w.code)).toContain('UNSUPPORTED_SYNTAX')
    expect(renderMermaidSVG(parsed.value)).toContain('Campaign B')
    expect(renderMermaidASCII(parsed.value)).toContain('Campaign A')
  })

  test('mutated chart renders through the legacy renderer', async () => {
    const { renderMermaidSVG } = await import('../agent/index.ts')
    const d = apply(quadrant(), { kind: 'set_title', title: 'Rendered' })
    const svg = renderMermaidSVG(d)
    expect(svg).toContain('<svg')
    expect(svg).toContain('Rendered')
  })
})

describe('quadrant corpus round-trip (every testdata sample)', () => {
  // See agent-pie.test.ts for the canonical round-trip-stability contract.
  const TESTDATA = join(import.meta.dir, 'testdata')
  const samples: Array<[string, string]> = []
  for (const variant of ['ascii', 'unicode']) {
    const dir = join(TESTDATA, variant)
    for (const f of readdirSync(dir).filter(n => /^quadrant_/.test(n))) {
      const raw = readFileSync(join(dir, f), 'utf8')
      const src = raw.split(/^---$/m)[0]!.replace(/\n+$/, '\n')
      samples.push([`${variant}/${f}`, src])
    }
  }

  test('at least two quadrant samples are present', () => {
    expect(samples.length).toBeGreaterThanOrEqual(2)
  })

  for (const [name, src] of samples) {
    test(`${name}: parses structured, verifies, round-trips stably`, () => {
      const r = parseMermaid(src)
      expect(r.ok).toBe(true)
      if (!r.ok) return
      expect(r.value.body.kind).toBe('quadrant')
      const s1 = serializeMermaid(r.value)
      const r2 = parseMermaid(s1)
      expect(r2.ok).toBe(true)
      if (!r2.ok) return
      expect(serializeMermaid(r2.value)).toBe(s1)
      expect(r2.value.body).toEqual(r.value.body)
    })
  }
})

describe('quadrant round-trip property', () => {
  const labelArb = fc.stringMatching(/^[A-Za-z][A-Za-z0-9 ]{0,12}[A-Za-z0-9]$/)
  const axisArb = fc.stringMatching(/^[A-Za-z][A-Za-z0-9 ]{0,12}[A-Za-z0-9]$/)
  const coordArb = fc.oneof(
    fc.constantFrom(0, 1, 0.5, 0.25, 0.3, 0.6, 0.45, 0.23, 0.9, 0.1),
    fc.integer({ min: 0, max: 100 }).map(n => n / 100),
  )

  test('parse(render(parse(src))) is identity on generated charts', () => {
    fc.assert(
      fc.property(
        fc.option(axisArb, { nil: undefined }),
        fc.uniqueArray(fc.record({ label: labelArb, x: coordArb, y: coordArb }), {
          minLength: 1, maxLength: 5, selector: p => p.label,
        }),
        (title, points) => {
          const lines = ['quadrantChart']
          if (title) lines.push(`  title ${title}`)
          for (const p of points) lines.push(`  ${p.label}: [${p.x}, ${p.y}]`)
          const d = quadrant(lines.join('\n'))
          const out = serializeMermaid(d)
          const d2 = quadrant(out)
          expect(d2.body).toEqual(d.body)
          expect(serializeMermaid(d2)).toBe(out)
        },
      ),
      { numRuns: 50 },
    )
  })

  test('canonical coordinate format survives 0, 1, and decimals', () => {
    const d = quadrant('quadrantChart\n  a: [0, 1]\n  b: [0.25, 0.5]')
    const out = serializeMermaid(d)
    expect(out).toContain('a: [0, 1]')
    expect(out).toContain('b: [0.25, 0.5]')
    expect(quadrant(out).body.points.map(p => [p.x, p.y])).toEqual([[0, 1], [0.25, 0.5]])
  })
})
