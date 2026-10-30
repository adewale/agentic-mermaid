import { afterAll, describe, expect, test } from 'bun:test'
import fc from 'fast-check'
import { fcParameters } from './helpers/fc-parameters.ts'
import { parseRegisteredMermaid as parseMermaid, serializeMermaid, verifyMermaid, mutate, mutateChecked, asRadar, createMermaid, buildMermaid, synthesizeFromGraph, renderMermaidSVG as renderDiagramSVG, renderMermaidASCII as renderDiagramASCII } from '../agent/index.ts'
import { parseRadarChart } from '../radar/parser.ts'
import { layoutRadarChart } from '../radar/layout.ts'
import { normalizeMermaidSource } from '../mermaid-source.ts'
import type { RadarBody, RadarMutationOp, RadarValidDiagram, SankeyValidDiagram } from '../agent/index.ts'
import type { RadarRuntimeConfig } from '../index.ts'
import { renderMermaidASCII, renderMermaidSVG } from '../index.ts'
import { startUpstreamMermaid } from './helpers/upstream-mermaid.ts'

const upstream = startUpstreamMermaid()
afterAll(() => upstream.close())

const BASIC = 'radar-beta\n  title Skills\n  axis speed["Speed"], power["Power"], range["Range"]\n  curve now["Current"]{4, 3, 5}\n  curve goal["Target"]{5, 5, 4}\n  max 5'

function radar(src: string): RadarValidDiagram {
  const p = parseMermaid(src)
  expect(p.ok).toBe(true)
  if (!p.ok) throw new Error('parse failed')
  const r = asRadar(p.value)
  expect(r).not.toBeNull()
  return r!
}

describe('radar agent surface', () => {
  test('a repeated Radar header stays source-only and reports its raw rendering failure', () => {
    for (const source of ['radar-beta radar-beta\naxis A["A"],B', 'radar-beta\nradar-beta\naxis A["A"],B']) {
      const parsed = parseMermaid(source)
      if (!parsed.ok) throw Error('Radar source must be preserved')
      expect(parsed.value.body.kind).toBe('opaque')
      expect(serializeMermaid(parsed.value).trimEnd()).toBe(source)
      expect(verifyMermaid(source).warnings).toContainEqual(expect.objectContaining({ code: 'RENDER_FAILED' }))
      expect(() => renderMermaidSVG(source)).toThrow('radar-beta')
      expect(mutate(parsed.value, { kind: 'set_title', title: 'Changed' }).ok).toBe(false)
    }
    const control = radar('radar-beta\naxis A["A"],B')
    expect(control.body.axes.map(axis => axis.id)).toEqual(['A', 'B'])
    expect(() => renderMermaidSVG(serializeMermaid(control))).not.toThrow()
  })
  test('parses to a structured radar body and narrows via asRadar', () => {
    const d = radar(BASIC)
    expect(d.body.kind).toBe('radar')
    expect(d.body.axes.map(a => a.id)).toEqual(['speed', 'power', 'range'])
    expect(d.body.curves.map(c => c.values)).toEqual([[4, 3, 5], [5, 5, 4]])
  })

  test('round-trips to canonical source and re-parses identically (stability, not byte-verbatim)', () => {
    const d = radar(BASIC)
    const out = serializeMermaid(d)
    const re = parseMermaid(out)
    expect(re.ok).toBe(true)
    if (!re.ok) return
    expect(re.value.body).toEqual(d.body)
    expect(serializeMermaid(re.value)).toBe(out)
  })

  test('canonical source re-parses identically under the legacy renderer parser (anti-drift)', () => {
    const d = radar(BASIC)
    const out = serializeMermaid(d)
    const legacy = parseRadarChart(normalizeMermaidSource(out).lines)
    expect(legacy.axes.map(a => a.id)).toEqual(d.body.axes.map(a => a.id))
    expect(legacy.curves.map(c => c.values)).toEqual(d.body.curves.map(c => c.values))
    expect(legacy.max).toBe(d.body.max)
  })

  test('promotes order-independent multiline grammar and preserves escaped labels', () => {
    const d = radar('radar-beta\n  curve x["A \\"quoted\\" curve"]{\n    b: 2,\n    a: 1 %% trailing comment\n  }\n  %% between statements\n  axis a["A \\"quoted\\" axis"], b\n  max 5')
    expect(d.body.axes[0]!.label).toBe('A "quoted" axis')
    expect(d.body.curves[0]).toEqual({ id: 'x', label: 'A "quoted" curve', values: [1, 2] })
    const canonical = serializeMermaid(d)
    expect(radar(canonical).body).toEqual(d.body)
  })

  test('typed labels serialize quoted delimiters and multiline text without losing closure', () => {
    const changed = expectOk(mutate(radar(BASIC), { kind: 'set_axis_label', id: 'speed', label: 'A "quoted"]<br/>axis' }))
    expect(changed.body.axes[0]!.label).toBe('A "quoted"]\naxis')
    const canonical = serializeMermaid(changed)
    expect(radar(canonical).body).toEqual(changed.body)
  })

  test('accessibility directives ride the universal envelope; malformed lines fall back to a lossless opaque body', () => {
    // Universal accessibility (accTitle/accDescr) is extracted by the envelope
    // before the family grammar, so radar stays structured and round-trips the
    // directive — the same contract pie/quadrant/xychart carry.
    const withAcc = 'radar-beta\n  accTitle: My radar\n  axis a, b\n  curve x{1, 2}'
    const accParsed = parseMermaid(withAcc)
    expect(accParsed.ok).toBe(true)
    if (!accParsed.ok) return
    expect(accParsed.value.body.kind).toBe('radar')
    expect(asRadar(accParsed.value)).not.toBeNull()
    expect(serializeMermaid(accParsed.value).trimEnd()).toBe(withAcc)

    // Unmodeled family syntax still degrades to a lossless opaque body.
    const malformed = 'radar-beta\n  axis a, b\n  garbage line here!!!\n  curve x{1, 2}'
    const opaque = parseMermaid(malformed)
    expect(opaque.ok).toBe(true)
    if (!opaque.ok) return
    expect(opaque.value.body.kind).toBe('opaque')
    expect(serializeMermaid(opaque.value).trimEnd()).toBe(malformed)
    expect(asRadar(opaque.value)).toBeNull()
  })

  test('an accessibility directive after a statement on its line joins the envelope, as authored', () => {
    const cases: Array<[string, { title?: string; descr?: string }]> = [
      ['radar-beta\n  axis a, b accTitle: x\n  curve c{1, 2}', { title: 'x' }],
      ['radar-beta\n  axis a, b accDescr: x\n  curve c{1, 2}', { descr: 'x' }],
      ['radar-beta\n  curve c{1, 2} accTitle: a<br>b\n  axis a, b', { title: 'a<br>b' }],
      ['radar-beta\n  accTitle: x\n  axis a, b accTitle: x\n  curve c{1, 2}', { title: 'x' }],
      ['radar-beta\n  axis a, b accDescr { x\n    y }\n  curve c{1, 2}', { descr: 'x\ny' }],
    ]
    const named = (svg: string) => [svg.match(/<title\b[^>]*>([^<]*)<\/title>/)?.[1], svg.match(/<desc\b[^>]*>([^<]*)<\/desc>/)?.[1]]
    for (const [source, accessibility] of cases) {
      const d = radar(source)
      expect(d.meta.accessibility, source).toEqual(accessibility)
      expect(d.body.axes.map(axis => axis.id), source).toEqual(['a', 'b'])
      const output = serializeMermaid(d)
      const reparsed = radar(output)
      expect(reparsed.meta.accessibility, source).toEqual(accessibility)
      expect(reparsed.body, source).toEqual(d.body)
      // The output's drawing names the chart as the source's does.
      expect(named(renderMermaidSVG(output)), source).toEqual(named(renderMermaidSVG(source)))
    }
    // Beside another value on a line of its own, Mermaid keeps the one written
    // last, which the envelope cannot order: the source is kept, the one on
    // its own line is drawn whichever comes first, as in XYChart, and said so.
    for (const source of ['radar-beta\n  axis a, b accTitle: x\n  accTitle: y\n  curve c{1, 2}\n', 'radar-beta\n  accTitle: y\n  axis a, b accTitle: x\n  curve c{1, 2}\n']) {
      const parsed = parseMermaid(source)
      expect(parsed.ok && parsed.value.body.kind).toBe('opaque')
      if (parsed.ok) expect(serializeMermaid(parsed.value)).toBe(source)
      expect(named(renderMermaidSVG(source))[0], source).toBe('y')
      expect(verifyMermaid(source).warnings.filter(w => w.code === 'UNSUPPORTED_SYNTAX').map(w => w.syntax), source).toEqual(['radar_accessibility_order'])
    }
  })

  test('model-gap guard: mismatched or duplicate identities cannot enter the typed radar body', () => {
    for (const src of [
      'radar-beta\n  axis a, b, c\n  curve x{1,2}\n  max 5',
      'radar-beta\n  axis a, a\n  curve x{1,2}\n  max 5',
      'radar-beta\n  axis a, b\n  curve x{1,2}\n  curve x{2,1}\n  max 5',
    ]) {
      const parsed = parseMermaid(src)
      expect(parsed.ok).toBe(true)
      if (parsed.ok) expect(asRadar(parsed.value)).toBeNull()
    }
  })

  test.each([
    ['a numeric axis', 'axis 0, A\ncurve sample{1, 2}', '0', 'axis'],
    ['a numeric curve prefix', 'axis A, B\ncurve 2a["Series"]{1, 2}', '2a', 'curve'],
    ['an option keyword axis', 'axis ticks, A\ncurve sample{1, 2}', 'ticks', 'axis'],
    ['a boolean token prefix in a keyed axis', 'axis false1["First"], A\ncurve sample{A: 2, false1: 1}', 'false1', 'axis'],
    ['a graticule token prefix as a curve', 'axis A, B\ncurve polygonal{1, 2}', 'polygonal', 'curve'],
    ['a title token prefix as an axis', 'axis titleWorker, A\ncurve sample{1, 2}', 'titleWorker', 'axis'],
  ])('%s stays readable and source-preserved when its identity has no portable spelling', async (_name, body, id, role) => {
    const source = `%% keep this source\nradar-beta\n${body}\n`
    expect(await upstream.accepts(source)).toBe(false)
    const native = parseRadarChart(normalizeMermaidSource(source).lines)
    expect(role === 'axis' ? native.axes[0]?.id : native.curves[0]?.id).toBe(id)
    expect(native.curves[0]?.values).toEqual([1, 2])
    const parsed = expectOk(parseMermaid(source))
    expect(parsed.body.kind).toBe('opaque')
    expect(serializeMermaid(parsed)).toBe(source)
    expect(renderDiagramSVG(parsed)).toBe(renderMermaidSVG(source))
    expect(renderDiagramASCII(parsed)).toBe(renderMermaidASCII(source))
    for (const input of [source, parsed]) expect(verifyMermaid(input).warnings).toContainEqual(expect.objectContaining({
      code: 'UNSUPPORTED_SYNTAX', syntax: 'radar_id', node: id,
    }))
    expect(mutate(parsed, { kind: 'set_title', title: 'Changed' }).ok).toBe(false)
  })

  test('portable ID neighbours keep structured identity through editing and pinned reload', async () => {
    const diagram = radar('radar-beta\naxis a1, _1, axis1, ticks1, Title, True\ncurve sample{1, 2, 3, 4, 5, 6}')
    const changed = expectOk(mutate(diagram, { kind: 'rename_curve', from: 'sample', to: 'Curve1' }))
    const serialized = serializeMermaid(changed)
    expect(await upstream.accepts(serialized)).toBe(true)
    expect(radar(serialized).body).toEqual(changed.body)
    expect(verifyMermaid(changed).warnings.filter(warning => warning.code === 'UNSUPPORTED_SYNTAX')).toEqual([])
  })

  test('synthesizeFromGraph rejects malformed typed radar payloads before constructing ValidDiagram', () => {
    const malformed: RadarBody = {
      kind: 'radar',
      axes: [{ id: 'a', label: 'A' }],
      curves: [{ id: 'x', label: 'X', values: [1, 2] }],
      min: 0,
      max: 3,
      ticks: 5,
      graticule: 'circle',
      showLegend: true,
    }
    const result = synthesizeFromGraph({ kind: 'radar', body: malformed })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error[0]).toEqual(expect.objectContaining({ code: 'INVALID_PAYLOAD', message: expect.stringContaining('exactly 1 value') }))
  })

  test.each(['axis', 'curve'] as const)('synthesizeFromGraph refuses a nonportable %s identity', role => {
    const body = structuredClone(radar(BASIC).body)
    if (role === 'axis') body.axes[0]!.id = '0'
    else body.curves[0]!.id = 'polygon'
    const result = synthesizeFromGraph({ kind: 'radar', body })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error[0]?.code).toBe('INVALID_PAYLOAD')
  })

  // Type precision is a compile-time contract: `bun run typecheck` fails if an
  // accepted case stops compiling or a @ts-expect-error case starts compiling.
  function compileTimeRadarContract(): void {
    const config: RadarRuntimeConfig = { width: 480, tickLabels: true }
    // @ts-expect-error tickLabels is a boolean switch, not free text.
    const badConfig: RadarRuntimeConfig = { tickLabels: 'yes' }
    const created: RadarValidDiagram = createMermaid('radar')
    // @ts-expect-error the radar overload returns a radar diagram, not the generic union.
    const notSankey: SankeyValidDiagram = createMermaid('radar')
    const op: RadarMutationOp = { kind: 'add_axis', id: 'quality' }
    // @ts-expect-error add_axis requires an axis id.
    const badOp: RadarMutationOp = { kind: 'add_axis' }
    const body: RadarBody = created.body
    const built = buildMermaid('radar', [op, { kind: 'add_curve', id: 'now', values: [1] }, { kind: 'set_config', max: 5 }])
    void [config, badConfig, notSankey, badOp, body, built]
  }
  void compileTimeRadarContract

  describe('mutation', () => {
    test.each([
      { kind: 'add_axis', id: '0' },
      { kind: 'rename_axis', from: 'speed', to: 'false1' },
      { kind: 'add_curve', id: 'polygonal', values: [1, 2, 3] },
      { kind: 'rename_curve', from: 'now', to: 'curve' },
    ] satisfies RadarMutationOp[])('refuses a nonportable id in $kind', op => {
      const result = mutate(radar(BASIC), op)
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.error.code).toBe('INVALID_OP')
    })

    test('set_title / set_curve_value / set_config', () => {
      let d = radar(BASIC)
      d = expectOk(mutate(d, { kind: 'set_title', title: 'Renamed' }))
      expect(d.body.title).toBe('Renamed')
      d = expectOk(mutate(d, { kind: 'set_curve_value', curve: 'now', axis: 'power', value: 1 }))
      expect(d.body.curves[0]!.values).toEqual([4, 1, 5])
      d = expectOk(mutate(d, { kind: 'set_config', graticule: 'polygon', ticks: 4 }))
      expect(d.body.graticule).toBe('polygon')
      expect(d.body.ticks).toBe(4)
    })

    test('add_axis / remove_axis / reorder_axis preserve exact axis-value coupling', () => {
      let d = radar(BASIC)
      d = expectOk(mutate(d, { kind: 'add_axis', id: 'tech', label: 'Tech', fill: 2 }))
      expect(d.body.axes.map(axis => axis.id)).toEqual(['speed', 'power', 'range', 'tech'])
      expect(d.body.curves.map(curve => curve.values)).toEqual([[4, 3, 5, 2], [5, 5, 4, 2]])

      d = expectOk(mutate(d, { kind: 'reorder_axis', from: 0, to: 3 }))
      expect(d.body.axes.map(axis => axis.id)).toEqual(['power', 'range', 'tech', 'speed'])
      expect(d.body.curves.map(curve => curve.values)).toEqual([[3, 5, 2, 4], [5, 4, 2, 5]])

      d = expectOk(mutate(d, { kind: 'remove_axis', id: 'tech' }))
      expect(d.body.axes.map(axis => axis.id)).toEqual(['power', 'range', 'speed'])
      expect(d.body.curves.map(curve => curve.values)).toEqual([[3, 5, 4], [5, 4, 5]])
    })

    test('add_curve / remove_curve / set_curve_values enforce the axis-count invariant', () => {
      let d = radar(BASIC)
      const bad = mutate(d, { kind: 'add_curve', id: 'z', values: [1, 2] }) // 2 != 3 axes
      expect(bad.ok).toBe(false)
      d = expectOk(mutate(d, { kind: 'add_curve', id: 'z', label: 'New', values: [1, 2, 3] }))
      expect(d.body.curves).toHaveLength(3)
      const bad2 = mutate(d, { kind: 'set_curve_values', id: 'z', values: [9] })
      expect(bad2.ok).toBe(false)
      d = expectOk(mutate(d, { kind: 'remove_curve', id: 'z' }))
      expect(d.body.curves).toHaveLength(2)
    })

    test('remaining identity, label, and curve-order operations mutate exact targets', () => {
      let d = radar(BASIC)
      d = expectOk(mutate(d, { kind: 'rename_axis', from: 'speed', to: 'velocity' }))
      d = expectOk(mutate(d, { kind: 'set_axis_label', id: 'velocity', label: 'Velocity' }))
      d = expectOk(mutate(d, { kind: 'rename_curve', from: 'now', to: 'current' }))
      d = expectOk(mutate(d, { kind: 'set_curve_label', id: 'current', label: 'Current state' }))
      d = expectOk(mutate(d, { kind: 'reorder_curve', from: 1, to: 0 }))
      expect(d.body.axes[0]).toEqual({ id: 'velocity', label: 'Velocity' })
      expect(d.body.curves.map(curve => ({ id: curve.id, label: curve.label }))).toEqual([
        { id: 'goal', label: 'Target' },
        { id: 'current', label: 'Current state' },
      ])
      expect(serializeMermaid(d)).toContain('axis velocity["Velocity"]')
    })

    test('untyped boundaries accept documented null resets', () => {
      // The untyped mutateChecked boundary widens to MutableValidDiagram; re-narrow to read radar fields.
      const reset = expectOk(mutateChecked(radar(BASIC), { kind: 'set_config', max: null, min: null, ticks: null, graticule: null, showLegend: null }))
      const d = asRadar(reset)!
      expect({ min: d.body.min, max: d.body.max, ticks: d.body.ticks, graticule: d.body.graticule, showLegend: d.body.showLegend })
        .toEqual({ min: 0, max: undefined, ticks: 5, graticule: 'circle', showLegend: true })
    })

    test('rejects unknown ids, invalid insertion indices, invalid terminal states, and a degenerate scale', () => {
      const d = radar(BASIC)
      expect(mutate(d, { kind: 'remove_axis', id: 'nope' }).ok).toBe(false)
      expect(mutate(d, { kind: 'remove_curve', id: 'nope' }).ok).toBe(false)
      expect(mutate(d, { kind: 'add_axis', id: 'bad', index: -1 }).ok).toBe(false)
      expect(mutate(d, { kind: 'add_curve', id: 'bad', values: [1, 2, 3], index: 99 }).ok).toBe(false)
      expect(mutate(d, { kind: 'set_config', min: 5 }).ok).toBe(false) // 5 >= max 5

      const one = radar('radar-beta\n  axis only\n  curve x{1}\n  max 2')
      expect(mutate(one, { kind: 'remove_axis', id: 'only' }).ok).toBe(false)
    })

    test('a mutated diagram verifies and renders', () => {
      const d = expectOk(mutate(radar(BASIC), { kind: 'set_config', graticule: 'polygon' }))
      expect(verifyMermaid(serializeMermaid(d)).ok).toBe(true)
    })
  })

  test('property: generated axes and every curve value survive parse and canonical round-trip', () => {
    const axisId = fc.stringMatching(/^axis_[a-z0-9]{1,5}$/)
    fc.assert(fc.property(
      fc.uniqueArray(axisId, { minLength: 2, maxLength: 5 }),
      fc.array(fc.array(fc.integer({ min: 0, max: 100 }), { minLength: 2, maxLength: 5 }), { minLength: 1, maxLength: 3 }),
      (axes, curveValues) => {
        const src = [
          'radar-beta',
          `  axis ${axes.join(', ')}`,
          ...curveValues.map((vals, i) => `  curve c${i}{${axes.map((_a, k) => vals[k % vals.length]).join(', ')}}`),
          '  max 100',
        ].join('\n')
        const p = parseMermaid(src)
        const parsed = expectOk(p)
        const body = asRadar(parsed)?.body
        if (!body) throw new Error(`not a structured radar: ${parsed.body.kind}`)
        // These values come from the generated source, not a first parse of it:
        // byte stability alone also passes when both parses lose the same curve.
        const expected = {
          axes: axes.map(id => ({ id, label: id })),
          curves: curveValues.map((values, i) => ({
            id: `c${i}`, label: `c${i}`,
            values: axes.map((_axis, k) => values[k % values.length]!),
          })),
        }
        expect({ axes: body.axes, curves: body.curves }).toEqual(expected)
        const s1 = serializeMermaid(parsed)
        const reparsed = expectOk(parseMermaid(s1))
        const secondBody = asRadar(reparsed)?.body
        if (!secondBody) throw new Error(`not a structured radar: ${reparsed.body.kind}`)
        expect({ axes: secondBody.axes, curves: secondBody.curves }).toEqual(expected)
        expect(serializeMermaid(reparsed)).toBe(s1)
      },
    ), fcParameters({ numRuns: 60 }))
  })
})

function expectOk<T>(r: { ok: true; value: T } | { ok: false; error: unknown }): T {
  expect(r.ok).toBe(true)
  if (!r.ok) throw new Error(`mutation failed: ${JSON.stringify(r.error)}`)
  return r.value
}


test('reports truncated radar baselines and clipped authored values', () => {
  const source = 'radar-beta\n axis a["A"], b["B"], c["C"]\n curve sample["Sample"]{85, 95, 150}\n min 90\n max 100'
  const result = verifyMermaid(source)
  expect(result.warnings).toContainEqual(expect.objectContaining({ code: 'VALUES_OUTSIDE_RANGE', series: 'sample', values: [85, 150], range: { min: 90, max: 100 } }))
  expect(result.warnings).toContainEqual(expect.objectContaining({ code: 'SCALE_RANGE_EXCLUDES_ZERO', range: { min: 90, max: 100 } }))
})

test('radar baseline warnings use the rendered auto-range below one', () => {
  const source = 'radar-beta\n axis a,b,c\n curve sample{0.2,0.4,0.6}\n min 0.1'
  expect(verifyMermaid(source).warnings).toContainEqual(expect.objectContaining({
    code: 'SCALE_RANGE_EXCLUDES_ZERO', range: { min: 0.1, max: 0.6 },
  }))
})

// One generated scale (min, max, sample values) feeds three independent
// contracts below, each with its own property.
const radarScaleArb = fc.tuple(fc.integer({ min: -3, max: 3 }), fc.integer({ min: 0, max: 5 }), fc.integer({ min: 1, max: 10 }), fc.boolean())
  .map(([exponent, lower, span, explicitMax]) => {
    const unit = 10 ** exponent
    const min = lower * unit / 10
    const max = (lower + span) * unit / 10
    const values = [min / 2, min, (min + max) / 2, max, explicitMax ? max * 1.5 : max]
    const source = `radar-beta\naxis a,b,c,d,e\ncurve sample{${values.join(',')}}\nmin ${min}${explicitMax ? `\nmax ${max}` : ''}`
    return { min, max, values, source }
  })
const radarScaleExamples: Array<[{ min: number; max: number; values: number[]; source: string }]> = [[{ min: 0.1, max: 0.6, values: [0.05, 0.1, 0.35, 0.6, 0.6], source: 'radar-beta\naxis a,b,c,d,e\ncurve sample{0.05,0.1,0.35,0.6,0.6}\nmin 0.1' }]]

test('generated radar scales: verify reports exactly the clipped values and a range excluding zero', () => {
  fc.assert(fc.property(radarScaleArb, ({ min, max, values, source }) => {
    const result = verifyMermaid(source)
    const outside = values.filter(value => value < min || value > max)
    const clipped = result.warnings.filter(warning => warning.code === 'VALUES_OUTSIDE_RANGE')
    expect(clipped.map(({ series, values, range }) => ({ series, values, range }))).toEqual(outside.length ? [{ series: 'sample', values: outside, range: { min, max } }] : [])
    expect(result.warnings.flatMap(warning => warning.code === 'SCALE_RANGE_EXCLUDES_ZERO' ? [warning.range] : [])).toEqual(min > 0 ? [{ min, max }] : [])
  }), fcParameters({ numRuns: 150, examples: radarScaleExamples }))
}, 30000)

test('generated radar scales: each vertex sits at its clamped share of the radius', () => {
  fc.assert(fc.property(radarScaleArb, ({ min, max, values, source }) => {
    const positioned = layoutRadarChart(parseRadarChart(normalizeMermaidSource(source).lines))
    for (const [index, vertex] of positioned.curves[0]!.vertices.entries()) {
      const ratio = values[index]! < min ? 0 : values[index]! > max ? 1 : (values[index]! - min) / (max - min)
      // Pixel coordinates are rounded to two decimals at the layout boundary.
      expect(Math.abs(Math.hypot(vertex.x - positioned.cx, vertex.y - positioned.cy) - ratio * positioned.radius)).toBeLessThanOrEqual(0.015)
    }
    expect(positioned.rings.at(-1)!.value).toBeCloseTo(max, 9)
  }), fcParameters({ numRuns: 150, examples: radarScaleExamples }))
}, 30000)

test('generated radar scales: the terminal names the scale', () => {
  fc.assert(fc.property(radarScaleArb, ({ min, max, source }) => {
    expect(renderMermaidASCII(source)).toContain(`scale: ${min} .. ${max}`)
  }), fcParameters({ numRuns: 150, examples: radarScaleExamples }))
}, 30000)
