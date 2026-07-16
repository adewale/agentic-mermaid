import { describe, expect, test } from 'bun:test'
import fc from 'fast-check'
import {
  BRAND_CONSTRAINT_DESCRIPTORS,
  renderMermaidSVG,
  resolveStyleStack,
  SEMANTIC_BINDING_CHANNELS,
  styleSpecJsonSchema,
  validateStyleSpec,
} from '../index.ts'
import { verifyMermaid } from '../agent/index.ts'
import { renderMermaidASCIIWithReceipt } from '../ascii/index.ts'
import { resolveStyleStackWithFace, resolveRoleStyle } from '../scene/style-registry.ts'
import { STYLE_OWNED_PAINT_VARIABLES } from '../scene/style-spec.ts'
import { evaluateBrandConstraints } from '../scene/brand-constraints.ts'
import { resolveRenderRequestForExecution } from '../render-contract.ts'
import type { SceneDoc, SceneNode } from '../scene/ir.ts'

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
    expect(SEMANTIC_BINDING_CHANNELS).toEqual(['category'])
    expect(Object.keys(BRAND_CONSTRAINT_DESCRIPTORS)).toEqual(['contrast', 'accent-area', 'mono-role'])
    expect(validateStyleSpec(policyStyle())).toEqual([])
    expect(validateStyleSpec(JSON.parse('{"semanticSlots":{"__proto__":{"fillColor":"#fff"}}}'))).toContain('invalid semantic slot name "__proto__"')
    expect(validateStyleSpec({ semanticSlots: { selected: { fillColor: 'url(https://evil.test/x)' } } })).toContain('"semanticSlots.selected.fillColor" must be a safe non-fetching CSS paint')
    expect(validateStyleSpec({ roles: { node: { fillColor: 'var(--remote-paint)' } } })).toContain('"roles.node.fillColor" must be a safe non-fetching CSS paint')
    expect(validateStyleSpec({ roles: { node: { fillColor: 'var(--_node-fill)', textColor: 'var(--fg)' } } })).toEqual([])
    expect(validateStyleSpec({ bindings: [{ channel: 'emphasis', value: 'true', slot: 'selected' }] })).toContain('"bindings[0].channel" must be one of category')
    expect(validateStyleSpec({ bindings: [{ channel: 'category', value: 'Beta', slot: 'selected', query: '*' }] })).toContain('unknown binding field "bindings[0].query"')
    expect(validateStyleSpec({ bindings: [{ channel: 'category', value: 'Beta', slot: 'selected', role: 'node' }] })).toEqual(expect.arrayContaining([
      expect.stringContaining('"bindings[0].role" must be a SceneRole with an executable category-binding consumer'),
    ]))
    expect(() => resolveStyleStack({
      semanticSlots: { selected: { fillColor: '#ff0000' } },
      bindings: [{ channel: 'category', value: '0', slot: 'selected', role: 'node' }],
    } as any)).toThrow(/executable category-binding consumer/)
    expect(validateStyleSpec({ constraints: [{ kind: 'contrast', action: 'repair' }] })).toContain('"constraints[0].action" must be one of warn | error')
    expect(validateStyleSpec({ constraints: [{ kind: 'made-up', action: 'warn' }] })).toContain('"constraints[0].kind" must be one of contrast | accent-area | mono-role')
  })

  test('constraint TypeScript/runtime/Schema payloads project from one descriptor record', () => {
    const variants = (styleSpecJsonSchema() as any).properties.constraints.items.oneOf
    for (const [kind, descriptor] of Object.entries(BRAND_CONSTRAINT_DESCRIPTORS) as Array<[string, any]>) {
      const schema = variants.find((candidate: any) => candidate.properties.kind.const === kind)
      expect(Object.keys(schema.properties)).toEqual(['kind', 'action', ...Object.keys(descriptor.properties)])
      expect(schema.required).toEqual(['kind', 'action', ...Object.entries(descriptor.properties)
        .filter(([, field]: any) => field.required === true)
        .map(([field]) => field)])
      for (const [field, contract] of Object.entries(descriptor.properties) as Array<[string, any]>) {
        if (contract.kind === 'number') expect(schema.properties[field]).toMatchObject({
          type: 'number', minimum: contract.minimum, maximum: contract.maximum,
        })
      }
    }
  })

  test('final stack rejects dangling and permanently inert semantic bindings', () => {
    expect(() => resolveStyleStack({ bindings: [BINDING] } as any)).toThrow(/binding 1 references missing semantic slot "selected"/)
    expect(() => resolveStyleStack({
      semanticSlots: { bad: { paddingX: 4 } },
      bindings: [{ channel: 'category', value: 'Beta', slot: 'bad', role: 'bar' }],
    } as any)).toThrow(/semantic slot "bad" has no field applicable to role "bar"/)
    for (const semanticSlots of [{ inert: {} }, { inert: { headerFillColor: '#f00' } }]) {
      expect(() => resolveStyleStack({
        semanticSlots,
        bindings: [{ channel: 'category', value: 'Browse', slot: 'inert' }],
      } as any)).toThrow(/no field applicable to any executable category-binding role/)
    }
    expect(() => resolveStyleStack([
      { bindings: [{ channel: 'category', value: 'Browse', slot: 'active' }] },
      { semanticSlots: { active: { paddingX: 4 } } },
    ] as any)).not.toThrow()
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
      semanticSlots: {
        selected: { fillColor: '#ff00ff', lineWidth: 4 },
        later: { fillColor: '#00ffff' },
      },
      bindings: [BINDING, { ...BINDING, slot: 'later' }],
    } as any)
    expect(resolveRoleStyle(face, 'pie-slice', { category: 'Alpha' })).toMatchObject({ lineWidth: 2 })
    expect(resolveRoleStyle(face, 'pie-slice', { category: 'Beta' })).toMatchObject({ fillColor: '#00ffff', lineWidth: 4 })
    expect(resolveRoleStyle(face, 'pie-slice', { category: 'Missing' })).toEqual({ lineWidth: 2 })
    expect(resolveRoleStyle(face, 'bar', { category: 'Beta' })).toBeUndefined()
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

  test('Pie binding projects a non-color cue to SVG and no-color terminal output', () => {
    const source = 'pie\n  "Alpha" : 3\n  "Beta" : 2'
    const withCue = (cue: 'outline' | 'pattern') => ({
      semanticSlots: { selected: { cue } },
      bindings: [BINDING],
    }) as const
    const outlineSvg = renderMermaidSVG(source, { style: withCue('outline') as any })
    const patternSvg = renderMermaidSVG(source, { style: withCue('pattern') as any })
    const paths = (svg: string) => [...svg.matchAll(/class="pie-slice[^\"]*"[^>]*d="([^"]+)"/g)].map(match => match[1])
    expect(paths(patternSvg)).toEqual(paths(outlineSvg))
    expect(patternSvg).toContain('data-brand-cue="pattern"')
    expect(patternSvg).toContain('stroke-dasharray="3 2"')
    const outline = renderMermaidASCIIWithReceipt(source, { colorMode: 'none', style: withCue('outline') as any })
    const pattern = renderMermaidASCIIWithReceipt(source, { colorMode: 'none', style: withCue('pattern') as any })
    expect(outline.text).toContain('◇ Beta')
    expect(pattern.text).toContain('░ Beta')
    expect(pattern.text).not.toBe(outline.text)
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
      message: expect.stringContaining(BRAND_CONSTRAINT_DESCRIPTORS.contrast.recovery),
    }))
    expect(renderMermaidSVG(source, { style: low })).toBe(before)
    const errored = verifyMermaid(source, { renderOptions: { style: { ...low, constraints: [{ kind: 'contrast', action: 'error', minimum: 4.5 }] } } })
    expect(errored.ok).toBe(false)
    expect(errored.warnings).toContainEqual(expect.objectContaining({ code: 'BRAND_CONSTRAINT_ERROR', constraint: 'contrast' }))
  })

  test('contrast inspects each effective semantic surface and selects the worst text mark', () => {
    const source = `flowchart LR
  A[Pass] --> B[Fail]
  style A fill:#ffffff,color:#000000
  style B fill:#111111,color:#111111`
    const style = {
      constraints: [{ kind: 'contrast', action: 'warn', minimum: 4.5 }],
    } as any
    const result = verifyMermaid(source, { renderOptions: { style } })
    expect(result.warnings).toContainEqual(expect.objectContaining({
      code: 'BRAND_CONSTRAINT_WARNING',
      constraint: 'contrast',
      measurement: 'measurable',
      mark: 'node-label:B',
      foreground: '#111111',
      background: '#111111',
      ratio: 1,
    }))
  })

  test('nested text inherits the nearest preceding containing surface for contrast', () => {
    const shape: SceneNode = {
      kind: 'shape', id: 'surface', role: 'node', crisp: '',
      geometry: { kind: 'rect', x: 0, y: 0, width: 100, height: 60 },
      paint: { fill: '#111111' },
    }
    const text: SceneNode = {
      kind: 'text', id: 'nested-label', role: 'label', crisp: '',
      text: 'Nested', x: 50, y: 30, fontSize: 12, anchor: 'middle',
      paint: { fill: '#111111' },
    }
    const inner: SceneNode = {
      kind: 'group', id: 'inner', role: 'group', crisp: '', open: '<g>', close: '</g>', join: '\n',
      children: [{ node: text, indent: 0 }],
    }
    const outer: SceneNode = {
      kind: 'group', id: 'outer', role: 'group', crisp: '', open: '<g>', close: '</g>', join: '\n',
      children: [{ node: shape, indent: 0 }, { node: inner, indent: 0 }],
    }
    const scene: SceneDoc = {
      family: 'flowchart', width: 100, height: 60, colors: { bg: '#ffffff', fg: '#111111' }, parts: [outer],
    }
    const request = resolveRenderRequestForExecution('flowchart TD\n  A', {
      style: { constraints: [{ kind: 'contrast', action: 'error', minimum: 4.5 }] },
    }, 'svg')
    expect(evaluateBrandConstraints(scene, request)).toContainEqual(expect.objectContaining({
      code: 'BRAND_CONSTRAINT_ERROR', constraint: 'contrast', measurement: 'measurable',
      mark: 'nested-label', foreground: '#111111', background: '#111111', ratio: 1,
    }))
  })

  test('accent-area and mono-role rules fail closed without changing paint', () => {
    const source = 'flowchart LR\n  A[Alpha] --> B[Beta]'
    const style = {
      colors: { accent: '#7C3AED' },
      roles: {
        node: { fillColor: 'rgb(124, 58, 237)' },
        edge: { strokeColor: '#ff0000' },
      },
      constraints: [
        { kind: 'accent-area', action: 'warn', maxFraction: 0.1 },
        { kind: 'mono-role', action: 'warn', role: 'edge' },
      ],
    } as any
    const svg = renderMermaidSVG(source, { style })
    const result = verifyMermaid(source, { renderOptions: { style } })
    expect(result.warnings).toContainEqual(expect.objectContaining({
      code: 'BRAND_CONSTRAINT_WARNING', constraint: 'accent-area', measurement: 'measurable',
    }))
    expect(result.warnings).toContainEqual(expect.objectContaining({
      code: 'BRAND_CONSTRAINT_WARNING', constraint: 'mono-role', measurement: 'measurable', foreground: '#ff0000',
    }))
    expect(renderMermaidSVG(source, { style })).toBe(svg)
  })

  test('every admitted style-owned paint variable has an executable constraint projection', () => {
    const source = 'flowchart LR\n  A[Alpha]'
    for (const variable of STYLE_OWNED_PAINT_VARIABLES) {
      const result = verifyMermaid(source, { renderOptions: { style: {
        roles: {
          node: { fillColor: `var(${variable})` },
          label: { textColor: `var(${variable})` },
        },
        constraints: [{ kind: 'contrast', action: 'warn', role: 'label', minimum: 4.5 }],
      } as any } })
      expect(result.warnings, variable).toContainEqual(expect.objectContaining({
        constraint: 'contrast', measurement: 'measurable', role: 'label',
      }))
    }

    for (const colors of [
      { fg: 'rgb(255, 0, 0)', bg: 'white' },
      { fg: 'navy', bg: 'white' },
      { fg: 'hsl(240 100% 25%)', bg: 'rgb(255 255 255)' },
    ]) {
      const result = verifyMermaid(source, { renderOptions: { style: {
        colors,
        roles: {
          node: { fillColor: 'var(--_group-hdr)' },
          label: { textColor: 'var(--_group-hdr)' },
        },
        constraints: [{ kind: 'contrast', action: 'warn', role: 'label', minimum: 4.5 }],
      } as any } })
      expect(result.warnings, JSON.stringify(colors)).toContainEqual(expect.objectContaining({
        constraint: 'contrast', measurement: 'measurable', ratio: 1,
      }))
    }
  })

  test('constraint measurement covers alpha composition, unresolved paint, and not-applicable roles', () => {
    const source = 'flowchart LR\n  A[Alpha]'
    const alpha = verifyMermaid(source, { renderOptions: { style: {
      roles: { node: { textColor: 'rgba(0,0,0,0.5)', fillColor: '#ffffff' } },
      constraints: [{ kind: 'contrast', action: 'warn', minimum: 4.5 }],
    } as any } })
    expect(alpha.warnings).toContainEqual(expect.objectContaining({
      constraint: 'contrast', measurement: 'measurable', ratio: 3.95,
      foreground: 'rgba(0,0,0,0.5)', background: '#ffffff',
    }))

    const unresolved = verifyMermaid(source, { renderOptions: { style: {
      roles: { node: { textColor: 'color-mix(in srgb, #000 50%, #fff)' } },
      constraints: [{ kind: 'contrast', action: 'warn', minimum: 4.5 }],
    } as any } })
    expect(unresolved.warnings).toContainEqual(expect.objectContaining({
      constraint: 'contrast', measurement: 'unmeasurable',
    }))

    const notApplicable = verifyMermaid(source, { renderOptions: { style: {
      constraints: [{ kind: 'contrast', action: 'warn', role: 'axis', minimum: 4.5 }],
    } as any } })
    expect(notApplicable.warnings).toContainEqual(expect.objectContaining({
      constraint: 'contrast', measurement: 'not-applicable', role: 'axis',
    }))
  })

  test('constraint edge cases never fabricate invalid colors or filled area', () => {
    const source = 'flowchart LR\n  A[Alpha]'
    const alpha = verifyMermaid(source, { renderOptions: { style: {
      colors: { fg: '#abcd', bg: '#fff' },
      constraints: [{ kind: 'contrast', action: 'warn', minimum: 4.5 }],
    } as any } })
    expect(JSON.stringify(alpha.warnings)).not.toContain('NaN')

    const noFill = verifyMermaid(source, { renderOptions: { style: {
      colors: { accent: '#ff0000' },
      roles: { node: { fillColor: 'none' } },
      constraints: [{ kind: 'accent-area', action: 'warn', maxFraction: 0 }],
    } as any } })
    expect(noFill.warnings).toContainEqual(expect.objectContaining({
      code: 'BRAND_CONSTRAINT_WARNING', constraint: 'accent-area', measurement: 'not-applicable',
    }))
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
