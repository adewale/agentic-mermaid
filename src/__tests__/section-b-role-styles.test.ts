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
import { BINDABLE_SCENE_ROLES, EXACT_ROLE_STYLE_CONTRACT } from '../scene/role-style-contract.ts'
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
      if (descriptor.traits.styleConsumption === 'fallback-only') {
        expect(definition, descriptor.role).toBeUndefined()
        expect(schema.properties.roles.properties[descriptor.role], descriptor.role).toBeUndefined()
      } else {
        expect(Object.keys(definition.properties).sort(), descriptor.role)
          .toEqual([...descriptor.style.applicableProperties].sort())
      }
    }
    expect(validateStyleSpec({ roles: { title: {} } })).toContain('scene role "title" is fallback-only; set roles.label instead')
    expect(validateStyleSpec({ roles: { title: { fontSize: 20 } } })).toContain('scene role "title" is fallback-only; set roles.label instead')
    expect(validateStyleSpec({ roles: { node: { fontWeight: 0 } } })).toContain('"roles.node.fontWeight" must be between 1 and 1000')
    expect(validateStyleSpec({ roles: { node: { fillColor: 'url(https://example.test/x)' } } })).toContain('"roles.node.fillColor" must be a safe non-fetching CSS paint')
  })

  test('every role descriptor owns closed applicability and deterministic fallback', () => {
    expect(SCENE_ROLE_DESCRIPTORS.filter(role => role.traits.styleConsumption === 'exact').map(role => String(role.role)))
      .toEqual(Object.keys(EXACT_ROLE_STYLE_CONTRACT))
    expect(SCENE_ROLE_DESCRIPTORS.filter(role => role.traits.styleBindingFamilies.length > 0).map(role => String(role.role)))
      .toEqual([...BINDABLE_SCENE_ROLES])
    for (const descriptor of SCENE_ROLE_DESCRIPTORS) {
      const exact = EXACT_ROLE_STYLE_CONTRACT[descriptor.role as keyof typeof EXACT_ROLE_STYLE_CONTRACT]
      if (exact) {
        expect(descriptor.style.applicableProperties, descriptor.role).toEqual(exact.properties)
        expect(descriptor.traits.styleBindingFamilies, descriptor.role).toEqual('bindingFamilies' in exact ? exact.bindingFamilies : [])
      }
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

  // "A Look's exported record is equivalent to selecting it by name" is decided
  // by the RESOLVER, not by any renderer: `style` reaches the renderer only as
  // resolveStyleStack's output, so equal resolutions render equally by
  // construction. Establishing it by rendering the full 16 Look x 15 family
  // cross-product cost 960 render calls (~20s) to learn a fact about 16 pairs
  // of values, and rendering is ~90% ELK layout (measured: parse 2.4ms, layout
  // ~28ms, full SVG ~26ms), so the call count — not the renderer — was the cost.
  //
  // Checking the resolver directly is both ~1000x cheaper and STRICTLY
  // STRONGER: it catches a divergence at the point it occurs, where rendering
  // can only catch divergences that survive all the way to output bytes.
  //
  // Verified against the old exhaustive form over all 240 cells: the cheap
  // check never says "equal" where rendering says "differ" — zero missed
  // regressions. The 15 disagreements are all `crisp` (below), where the cheap
  // check is conservative rather than wrong.
  const BUILT_IN_LOOKS = () => knownStyleDescriptors().filter(descriptor => descriptor.kind === 'look')
  // Two families, because the string-vs-record entry path is family-independent
  // (resolution happens before family dispatch) and one witness would already
  // prove it; the second is cheap insurance against that assumption changing.
  const WITNESS_FAMILIES = ['flowchart', 'pie'] as const

  test('every built-in Look exports a record that resolves identically to its name', () => {
    const looks = BUILT_IN_LOOKS()
    expect(looks.length).toBeGreaterThanOrEqual(16)
    for (const { inputName: name } of looks) {
      const exported = getStyle(name)
      expect(exported, `${name}: exported record`).toBeDefined()
      // `crisp` is the default Look: selecting it BY NAME resolves to undefined
      // (no override) while its record resolves to itself. That is a semantic
      // equivalence the resolver cannot express, so it is not asserted here —
      // it is discharged by the render sweep below, which is derived from this
      // same comparison rather than hardcoding the exception.
      if (resolveStyleStack(name) === undefined) continue
      expect(resolveStyleStack(exported!), `${name}: record resolves like the name`)
        .toEqual(resolveStyleStack(name))
    }
  })

  // The renderer accepts `style` as a string OR a record. Resolver identity does
  // not by itself prove the two ENTRY paths agree — a branch on `typeof style`
  // would slip past it — so every Look is still rendered both ways, on a witness
  // family rather than all fifteen. 16 Looks x 2 families x 2 formats x 2
  // variants = 128 calls, against 960 before.
  test('both public style entry paths agree for every Look on the render witness', () => {
    for (const { inputName: name } of BUILT_IN_LOOKS()) {
      const exported = getStyle(name)!
      for (const family of WITNESS_FAMILIES) {
        const source = getFamily(family)!.example
        expect(renderMermaidSVG(source, { style: name, seed: 7 }), `${name}/${family}/svg`)
          .toBe(renderMermaidSVG(source, { style: exported, seed: 7 }))
        expect(renderMermaidASCII(source, { style: name }), `${name}/${family}/terminal`)
          .toBe(renderMermaidASCII(source, { style: exported }))
      }
    }
  }, 60_000)

  // The residue: Looks the resolver cannot prove equivalent (today only the
  // default `crisp`, whose name resolves to undefined) keep the full family
  // sweep, because rendering is the only thing that can decide them. Derived
  // from the resolver, so a future Look with the same shape is swept
  // automatically instead of silently losing coverage.
  test('Looks the resolver cannot equate are swept across every family', async () => {
    const unresolvable = BUILT_IN_LOOKS().filter(({ inputName }) => resolveStyleStack(inputName) === undefined)
    expect(unresolvable.map(look => look.inputName)).toEqual(['crisp'])
    for (const { inputName: name } of unresolvable) {
      const exported = getStyle(name)!
      for (const family of knownBuiltinFamilies()) {
        const source = getFamily(family)!.example
        expect(renderMermaidSVG(source, { style: name, seed: 7 }), `${name}/${family}/svg`)
          .toBe(renderMermaidSVG(source, { style: exported, seed: 7 }))
        expect(renderMermaidASCII(source, { style: name }), `${name}/${family}/terminal`)
          .toBe(renderMermaidASCII(source, { style: exported }))
        expect(await renderMermaidPNG(source, { style: name, seed: 7 }), `${name}/${family}/png`)
          .toEqual(await renderMermaidPNG(source, { style: exported, seed: 7 }))
      }
    }
  }, 120_000)

  // The PNG path is a separate rasteriser (resvg), so it gets its own entry-path
  // witness for the same reason as the SVG/ASCII one above. The property is
  // still resolver-decided, so this is a witness rather than a sweep: 16 Looks x
  // 1 family x 2 variants = 32 PNG renders, against 480 before. `crisp` is
  // covered across every family by the sweep above.
  test('both public style entry paths agree for every Look on the PNG witness', async () => {
    const source = getFamily(WITNESS_FAMILIES[0])!.example
    for (const { inputName: name } of BUILT_IN_LOOKS()) {
      const exported = getStyle(name)!
      expect(await renderMermaidPNG(source, { style: name, seed: 7 }), `${name}/png`)
        .toEqual(await renderMermaidPNG(source, { style: exported, seed: 7 }))
    }
  }, 120_000)

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
