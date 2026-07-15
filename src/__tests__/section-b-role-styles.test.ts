import { describe, expect, test } from 'bun:test'
import fc from 'fast-check'
import {
  getStyle,
  knownStyleDescriptors,
  renderMermaidASCII,
  renderMermaidSVG,
  resolveStyleStack,
  styleSpecJsonSchema,
  validateStyleSpec,
} from '../index.ts'
import { SCENE_ROLE_DESCRIPTORS } from '../scene/roles.ts'
import { getFamily, knownBuiltinFamilies } from '../agent/families.ts'
import { renderMermaidPNG } from '../agent/png.ts'

describe('Section B public semantic role Styles', () => {
  test('role records are strict boundary-parsed data projected into JSON Schema', () => {
    const schema = styleSpecJsonSchema() as any
    expect(schema.properties.roles.additionalProperties).toBe(false)
    expect(schema.properties.roles.properties.node).toEqual({ $ref: '#/$defs/roleStyle-node' })
    expect(schema.properties.bindings.items.properties.slot.not.enum).toEqual(['__proto__', 'constructor', 'prototype'])
    expect(schema.$defs['roleStyle-node'].properties.fontWeight).toMatchObject({
      type: 'number', minimum: 1, maximum: 1000,
    })
    expect(validateStyleSpec({ roles: { node: { fontWeight: 700, fillColor: '#123456' } } })).toEqual([])
    expect(validateStyleSpec({ roles: { madeUp: { fontWeight: 700 } } })).toContain('unknown scene role "madeUp"')
    expect(validateStyleSpec({ roles: { node: { madeUp: true } } })).toContain('unknown role style field "node.madeUp"')
    expect(validateStyleSpec({ roles: { label: { paddingX: 4 } } })).toContain('role style field "label.paddingX" is not applicable to label roles')
    expect(validateStyleSpec({ roles: { node: { fontFamily: 'Georgia', lineHeight: 2, elevation: 'high', cue: 'pattern' } } })).toEqual(expect.arrayContaining([
      'role style field "node.fontFamily" is not applicable to node roles',
      'unknown role style field "node.lineHeight"',
      'unknown role style field "node.elevation"',
      'role style field "node.cue" is not applicable to node roles',
    ]))
    expect(schema.$defs['roleStyle-label'].properties.paddingX).toBeUndefined()
    for (const descriptor of SCENE_ROLE_DESCRIPTORS) {
      const definition = schema.$defs[`roleStyle-${descriptor.role}`]
      expect(Object.keys(definition.properties).sort(), descriptor.role)
        .toEqual([...descriptor.style.applicableProperties].sort())
    }
    expect(validateStyleSpec({ roles: { title: { fontSize: 20 } } })).toContain('role style field "title.fontSize" is not applicable to title roles')
    expect(validateStyleSpec({ roles: { node: { fontWeight: 0 } } })).toContain('"roles.node.fontWeight" must be between 1 and 1000')
    expect(validateStyleSpec({ roles: { node: { fillColor: 'url(https://example.test/x)' } } })).toContain('"roles.node.fillColor" must be a safe non-fetching CSS paint')
  })

  test('every role descriptor owns closed applicability and deterministic fallback', () => {
    for (const descriptor of SCENE_ROLE_DESCRIPTORS) {
      const fallback = SCENE_ROLE_DESCRIPTORS.find(candidate => candidate.role === descriptor.style.fallbackRole)
      expect(fallback, descriptor.role).toBeDefined()
      if (descriptor.traits.styleConsumption === 'exact') {
        expect(descriptor.style.applicableProperties.length, descriptor.role).toBeGreaterThan(0)
      } else {
        expect(descriptor.style.applicableProperties, descriptor.role).toEqual([])
        expect(fallback!.style.applicableProperties.length, descriptor.role).toBeGreaterThan(0)
      }
      for (const family of descriptor.traits.styleBindingFamilies) {
        expect(getFamily(family), `${descriptor.role}/${family}`).toBeDefined()
        expect(getFamily(family)!.semanticRoles, `${descriptor.role}/${family}`).toContain(descriptor.role)
        expect(descriptor.traits.styleConsumption, `${descriptor.role}/${family}`).toBe('exact')
      }
    }
  })

  test('every exact role contract has a real renderer witness rather than an admitted no-op', () => {
    const witnesses: Record<string, { source: string; style: Record<string, unknown> }> = {
      node: { source: 'flowchart LR\n  A[alpha] --> B[beta]', style: { fillColor: '#ff00ff' } },
      edge: { source: 'flowchart LR\n  A[alpha] -- ships --> B[beta]', style: { strokeColor: '#ff00ff' } },
      group: { source: 'flowchart LR\n  subgraph G[lower group]\n    A[alpha]\n  end', style: { fillColor: '#ff00ff' } },
      label: { source: 'flowchart LR\n  A[alpha] --> B[beta]', style: { textColor: '#ff00ff' } },
      actor: { source: 'sequenceDiagram\n  participant A as Alpha\n  participant B as Beta\n  A->>B: ping', style: { fillColor: '#ff00ff' } },
      relationship: { source: 'erDiagram\n  CUSTOMER ||--o{ ORDER : places', style: { strokeColor: '#ff00ff' } },
      'pie-slice': { source: 'pie\n  "Alpha" : 3\n  "Beta" : 2', style: { fillColor: '#ff00ff' } },
      point: { source: 'radar-beta\n  axis a, b, c\n  curve Current{4,3,5}\n  max 5', style: { fillColor: '#ff00ff' } },
      legend: { source: 'radar-beta\n  axis a, b, c\n  curve Current{4,3,5}\n  max 5', style: { textColor: '#ff00ff' } },
      bar: { source: 'xychart-beta\n  x-axis [A, B]\n  y-axis 0 --> 5\n  bar [4, 3]', style: { fillColor: '#ff00ff' } },
      series: { source: 'xychart-beta\n  x-axis [A, B]\n  y-axis 0 --> 5\n  line [4, 3]', style: { strokeColor: '#ff00ff' } },
      'group-header': { source: 'journey\n  section Browse\n    Find product: 4: Shopper', style: { fillColor: '#ff00ff' } },
      task: { source: 'gantt\n  dateFormat YYYY-MM-DD\n  section Build\n  Work :a, 2026-01-01, 2d', style: { fillColor: '#ff00ff' } },
      milestone: { source: 'gantt\n  dateFormat YYYY-MM-DD\n  section Build\n  Ship :milestone, 2026-01-01, 0d', style: { fillColor: '#ff00ff' } },
    }
    const exactRoles = SCENE_ROLE_DESCRIPTORS
      .filter(descriptor => descriptor.traits.styleConsumption === 'exact')
      .map(descriptor => descriptor.role)
      .sort()
    expect(Object.keys(witnesses).sort()).toEqual(exactRoles)
    const leafValues: Record<string, unknown> = {
      fontFamily: 'Georgia', fontSize: 23, fontWeight: 900, letterSpacing: 4,
      textTransform: 'uppercase', textColor: '#ff00ff', paddingX: 42, paddingY: 31,
      cornerRadius: 19, lineWidth: 8, bendRadius: 24, fillColor: '#ff00ff',
      borderColor: '#00aa00', strokeColor: '#ff00ff', headerFillColor: '#00ffff',
      cue: 'pattern',
    }
    for (const role of exactRoles) {
      const witness = witnesses[role]!
      const baseline = renderMermaidSVG(witness.source)
      const descriptor = SCENE_ROLE_DESCRIPTORS.find(candidate => candidate.role === role)!
      for (const property of descriptor.style.applicableProperties) {
        const style = { roles: { [role]: { [property]: leafValues[property] } } }
        expect(validateStyleSpec(style), `${role}.${property}`).toEqual([])
        const rendered = renderMermaidSVG(witness.source, { style: style as any })
        expect(rendered, `${role}.${property}`).not.toBe(baseline)
        if (descriptor.traits.domIdentity) {
          expect(rendered, `${role}.${property}.target-role`).toContain(`data-role="${role}"`)
        }
        if (property === 'fontFamily') expect(rendered).toContain('Georgia')
        if (property === 'fontSize') expect(rendered).toContain('font-size="23"')
        if (property === 'fontWeight') expect(rendered).toContain('font-weight="900"')
        if (property === 'letterSpacing') expect(rendered).toContain('letter-spacing="4"')
        if (property === 'cue') expect(rendered).toContain('data-brand-cue="pattern"')
        if (property.endsWith('Color')) expect(rendered).toContain(String(leafValues[property]))
      }
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
    const looks = knownStyleDescriptors().filter(descriptor => descriptor.kind === 'look')
    expect(looks.length).toBeGreaterThanOrEqual(16)
    for (const { inputName: name } of looks) {
      const exported = getStyle(name)!
      for (const family of knownBuiltinFamilies()) {
        const source = getFamily(family)!.example
        expect(renderMermaidSVG(source, { style: name, seed: 7 }), `${name}/${family}/svg`)
          .toBe(renderMermaidSVG(source, { style: exported, seed: 7 }))
        expect(renderMermaidASCII(source, { style: name }), `${name}/${family}/terminal`)
          .toBe(renderMermaidASCII(source, { style: exported }))
      }
    }
  }, 30_000)

  test('every built-in Look export is equivalent across every family on the public PNG path', async () => {
    for (const { inputName: name } of knownStyleDescriptors().filter(descriptor => descriptor.kind === 'look')) {
      const exported = getStyle(name)!
      for (const family of knownBuiltinFamilies()) {
        const source = getFamily(family)!.example
        expect(await renderMermaidPNG(source, { style: name, seed: 7 }), `${name}/${family}`)
          .toEqual(await renderMermaidPNG(source, { style: exported, seed: 7 }))
      }
    }
  }, 30_000)

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
