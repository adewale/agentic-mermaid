import { describe, expect, test } from 'bun:test'
import fc from 'fast-check'
import {
  renderMermaidSVG,
  resolveStyleStack,
  validateStyleSpec,
} from '../index.ts'
import { verifyMermaid } from '../agent/index.ts'
import { resolveStyleStackWithFace, resolveRoleStyle } from '../scene/style-registry.ts'

const SLOT = { fillColor: '#ff00ff', borderColor: '#007700', lineWidth: 3 } as const
const BINDING = { channel: 'category', value: 'Beta', slot: 'selected', role: 'pie-slice' } as const

function policyStyle() {
  return {
    semanticSlots: { selected: SLOT },
    bindings: [BINDING],
  } as const
}

describe('Section B semantic policy', () => {
  test('strict admission rejects illegal selectors, names, fields, unsafe paints, and invalid constraints', () => {
    expect(validateStyleSpec(policyStyle())).toEqual([])
    expect(validateStyleSpec(JSON.parse('{"semanticSlots":{"__proto__":{"fillColor":"#fff"}}}'))).toContain('invalid semantic slot name "__proto__"')
    expect(validateStyleSpec({ semanticSlots: { selected: { fillColor: 'url(https://evil.test/x)' } } })).toContain('"semanticSlots.selected.fillColor" must be a safe non-fetching CSS paint')
    expect(validateStyleSpec({ bindings: [{ channel: 'emphasis', value: 'true', slot: 'selected' }] })).toContain('"bindings[0].channel" must be one of category | status | route | class | tag | metadata')
    expect(validateStyleSpec({ bindings: [{ channel: 'category', value: 'Beta', slot: 'selected', query: '*' }] })).toContain('unknown binding field "bindings[0].query"')
    expect(validateStyleSpec({ constraints: [{ kind: 'contrast', action: 'repair' }] })).toContain('"constraints[0].action" must be one of warn | error')
    expect(validateStyleSpec({ constraints: [{ kind: 'made-up', action: 'warn' }] })).toContain('"constraints[0].kind" must be one of contrast | accent-area | mono-role')
  })

  test('final stack rejects dangling slots and slot leaves inapplicable to a restricted role', () => {
    expect(() => resolveStyleStack({ bindings: [BINDING] } as any)).toThrow(/binding 1 references missing semantic slot "selected"/)
    expect(() => resolveStyleStack({
      semanticSlots: { bad: { paddingX: 4 } },
      bindings: [{ channel: 'category', value: 'Beta', slot: 'bad', role: 'label' }],
    } as any)).toThrow(/semantic slot "bad" field "paddingX" is not applicable to role "label"/)
  })

  test('policy merge is deterministic, right-biased, associative, and idempotent', () => {
    fc.assert(fc.property(fc.array(fc.constantFrom(...'0123456789abcdef'), { minLength: 6, maxLength: 6 }).map(chars => chars.join('')), hex => {
      const a = policyStyle()
      const b = { semanticSlots: { selected: { fillColor: `#${hex}` } } } as const
      const once = resolveStyleStack([a, b])
      const twice = resolveStyleStack([a, b, a, b])
      expect(once).toEqual(twice)
      expect(once).toEqual(resolveStyleStack([resolveStyleStack(a)!, b]))
      expect(once?.semanticSlots?.selected?.fillColor).toBe(`#${hex}`)
      expect(once?.bindings).toEqual([BINDING])
    }), { numRuns: 40 })
  })

  test('ordered category binding resolves beneath exact role defaults', () => {
    const { face } = resolveStyleStackWithFace({
      roles: { 'pie-slice': { lineWidth: 2 } },
      semanticSlots: { selected: { fillColor: '#ff00ff', lineWidth: 4 } },
      bindings: [BINDING],
    } as any)
    expect(resolveRoleStyle(face, 'pie-slice', { category: 'Alpha' })).toMatchObject({ lineWidth: 2 })
    expect(resolveRoleStyle(face, 'pie-slice', { category: 'Beta' })).toMatchObject({ fillColor: '#ff00ff', lineWidth: 4 })
  })

  test('Pie binding changes paint but not authored emphasis, geometry, or non-color cue', () => {
    const source = `---\nconfig:\n  pie:\n    highlightSlice: Beta\n---\npie\n  "Alpha" : 3\n  "Beta" : 2`
    const baseline = renderMermaidSVG(source)
    const branded = renderMermaidSVG(source, { style: policyStyle() as any })
    const paths = (svg: string) => [...svg.matchAll(/class="pie-slice[^\"]*"[^>]*d="([^"]+)"/g)].map(match => match[1])
    expect(paths(branded)).toEqual(paths(baseline))
    expect(branded).toContain('data-label="Beta"')
    expect(branded).toContain('fill="#ff00ff"')
    expect(branded.match(/data-highlighted="true"/g)).toHaveLength(1)
    expect(branded).toContain('.pie-slice.highlighted { stroke: #27272A;')
  })

  test('central constraints diagnose without repainting and error action flips ok', () => {
    const source = 'flowchart LR\n  A[Alpha] --> B[Beta]'
    const low = {
      roles: { label: { textColor: '#dddddd' } },
      constraints: [{ kind: 'contrast', action: 'warn', minimum: 4.5 }],
    } as any
    const before = renderMermaidSVG(source, { style: low })
    const warned = verifyMermaid(source, { renderOptions: { style: low } })
    expect(warned.warnings).toContainEqual(expect.objectContaining({
      code: 'BRAND_CONSTRAINT_WARNING', constraint: 'contrast', measurement: 'measurable', minimum: 4.5,
    }))
    expect(renderMermaidSVG(source, { style: low })).toBe(before)
    const errored = verifyMermaid(source, { renderOptions: { style: { ...low, constraints: [{ kind: 'contrast', action: 'error', minimum: 4.5 }] } } })
    expect(errored.ok).toBe(false)
    expect(errored.warnings).toContainEqual(expect.objectContaining({ code: 'BRAND_CONSTRAINT_ERROR', constraint: 'contrast' }))
  })

  test('transparent contrast is unmeasurable and never fabricates a ratio', () => {
    const source = 'flowchart LR\n  A[Alpha] --> B[Beta]'
    const result = verifyMermaid(source, { renderOptions: {
      transparent: true,
      style: { constraints: [{ kind: 'contrast', action: 'warn', minimum: 4.5 }] } as any,
    } })
    const warning = result.warnings.find(item => item.code === ('BRAND_CONSTRAINT_WARNING' as any)) as any
    expect(warning).toMatchObject({ constraint: 'contrast', measurement: 'unmeasurable' })
    expect(warning.ratio).toBeUndefined()
    expect(warning.background).toBeUndefined()
  })
})
