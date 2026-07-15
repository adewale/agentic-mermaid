import { describe, expect, test } from 'bun:test'
import fc from 'fast-check'
import {
  getStyle,
  renderMermaidASCII,
  renderMermaidSVG,
  resolveStyleStack,
  styleSpecJsonSchema,
  validateStyleSpec,
} from '../index.ts'
import { SCENE_ROLE_DESCRIPTORS } from '../scene/roles.ts'

describe('Section B public semantic role Styles', () => {
  test('role records are strict boundary-parsed data projected into JSON Schema', () => {
    const schema = styleSpecJsonSchema() as any
    expect(schema.properties.roles.additionalProperties).toBe(false)
    expect(schema.properties.roles.properties.node).toEqual({ $ref: '#/$defs/roleStyle-node' })
    expect(schema.$defs['roleStyle-node'].properties.fontWeight).toMatchObject({
      type: 'number', minimum: 1, maximum: 1000,
    })
    expect(validateStyleSpec({ roles: { node: { fontWeight: 700, fillColor: '#123456' } } })).toEqual([])
    expect(validateStyleSpec({ roles: { madeUp: { fontWeight: 700 } } })).toContain('unknown scene role "madeUp"')
    expect(validateStyleSpec({ roles: { node: { madeUp: true } } })).toContain('unknown role style field "node.madeUp"')
    expect(validateStyleSpec({ roles: { label: { paddingX: 4 } } })).toContain('role style field "label.paddingX" is not applicable to label roles')
    expect(schema.$defs['roleStyle-label'].properties.paddingX).toBeUndefined()
    expect(validateStyleSpec({ roles: { node: { fontWeight: 0 } } })).toContain('"roles.node.fontWeight" must be between 1 and 1000')
    expect(validateStyleSpec({ roles: { node: { fillColor: 'url(https://example.test/x)' } } })).toContain('"roles.node.fillColor" must be a safe non-fetching CSS paint')
  })

  test('every role descriptor owns closed applicability and deterministic fallback', () => {
    for (const descriptor of SCENE_ROLE_DESCRIPTORS) {
      expect(descriptor.style.applicableProperties.length, descriptor.role).toBeGreaterThan(0)
      expect(SCENE_ROLE_DESCRIPTORS.some(candidate => candidate.role === descriptor.style.fallbackRole), descriptor.role).toBe(true)
    }
  })

  test('nested role merge obeys identity, associativity, right bias, locality, and idempotence', () => {
    fc.assert(fc.property(
      fc.integer({ min: 8, max: 40 }),
      fc.integer({ min: 100, max: 900 }),
      fc.integer({ min: 0, max: 40 }),
      (fontSize, fontWeight, paddingX) => {
        const a = { roles: { node: { fontSize } } } as const
        const b = { roles: { node: { fontWeight }, group: { paddingX } } } as const
        const c = { roles: { node: { paddingX } } } as const
        const empty = resolveStyleStack({})
        expect(resolveStyleStack([a, {}])).toEqual(resolveStyleStack(a))
        expect(resolveStyleStack([a, b, c])).toEqual(resolveStyleStack([resolveStyleStack([a, b])!, c]))
        expect(resolveStyleStack([a, b])?.roles?.node).toMatchObject({ fontSize, fontWeight })
        expect(resolveStyleStack([a, b])?.roles?.group?.paddingX).toBe(paddingX)
        expect(resolveStyleStack([a, a])).toEqual(resolveStyleStack(a))
        expect(empty?.roles).toBeUndefined()
      },
    ), { numRuns: 50 })
  })

  test('every built-in Look exports an ordinary record equivalent to selecting its name', () => {
    for (const name of ['tufte', 'accessible-high-contrast', 'patent-drawing', 'status-dashboard', 'ops-schematic', 'chalkboard', 'risograph', 'architectural-plan', 'publication-figure']) {
      const exported = getStyle(name)!
      expect(exported.roles, name).toBeDefined()
      const source = 'flowchart LR\n  A[Alpha] --> B[Beta]' 
      expect(renderMermaidSVG(source, { style: name, seed: 7 })).toBe(renderMermaidSVG(source, { style: exported, seed: 7 }))
      expect(renderMermaidASCII(source, { style: name })).toBe(renderMermaidASCII(source, { style: exported }))
    }
  })

  test('conflicting Pie role defaults never select emphasis or change quantitative geometry', () => {
    const source = `---\nconfig:\n  pie:\n    highlightSlice: Beta\n---\npie\n  "Alpha" : 3\n  "Beta" : 2`
    const style = { roles: { 'pie-slice': { fillColor: '#ff00ff', borderColor: '#00ff00', lineWidth: 9 } } } as const
    const baseline = renderMermaidSVG(source)
    const branded = renderMermaidSVG(source, { style })
    const paths = (svg: string) => [...svg.matchAll(/class="pie-slice[^\"]*"[^>]*d="([^"]+)"/g)].map(match => match[1])
    expect(paths(branded)).toEqual(paths(baseline))
    expect(branded.match(/class="pie-slice highlighted"/g)).toHaveLength(1)
    expect(branded).toContain('.pie-slice.highlighted { stroke: #27272A;')
    expect(branded).not.toContain('.pie-slice.highlighted { stroke: #00ff00;')
  })
})
