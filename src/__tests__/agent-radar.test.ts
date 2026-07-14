import { describe, expect, test } from 'bun:test'
import fc from 'fast-check'
import { parseMermaid, serializeMermaid, verifyMermaid, mutate, mutateChecked, asRadar, createMermaid, buildMermaid } from '../agent/index.ts'
import { parseRadarChart } from '../radar/parser.ts'
import { normalizeMermaidSource } from '../mermaid-source.ts'
import type { RadarBody, RadarMutationOp, RadarValidDiagram } from '../agent/index.ts'
import type { RadarRuntimeConfig } from '../index.ts'
import { SDK_DECLARATION } from '../mcp/sdk-decl.ts'

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

  test('public radar types, config, and blank-slate overloads stay precise', () => {
    const config: RadarRuntimeConfig = { width: 480, tickLabels: true }
    const created: RadarValidDiagram = createMermaid('radar')
    const op: RadarMutationOp = { kind: 'add_axis', id: 'quality' }
    const body: RadarBody = created.body
    const built = buildMermaid('radar', [op, { kind: 'add_curve', id: 'now', values: [1] }, { kind: 'set_config', max: 5 }])
    expect(config.width).toBe(480)
    expect(body.kind).toBe('radar')
    expect(built.ok).toBe(true)
    expect(SDK_DECLARATION).toContain('radar?: {')
  })

  describe('mutation', () => {
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

  test('property: parse → serialize → parse → serialize is byte-stable', () => {
    const axisId = fc.stringMatching(/^[a-z][a-z0-9]{0,4}$/)
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
        expect(p.ok).toBe(true)
        if (!p.ok) return
        expect(p.value.body.kind).toBe('radar')
        if (p.value.body.kind !== 'radar') return
        expect(p.value.body.axes.map(axis => axis.id)).toEqual(axes)
        expect(p.value.body.curves.every(curve => curve.values.length === axes.length)).toBe(true)
        const s1 = serializeMermaid(p.value)
        const p2 = parseMermaid(s1)
        expect(p2.ok).toBe(true)
        if (p2.ok) expect(serializeMermaid(p2.value)).toBe(s1)
      },
    ), { numRuns: 60 })
  })
})

function expectOk<T>(r: { ok: true; value: T } | { ok: false; error: unknown }): T {
  expect(r.ok).toBe(true)
  if (!r.ok) throw new Error(`mutation failed: ${JSON.stringify(r.error)}`)
  return r.value
}
