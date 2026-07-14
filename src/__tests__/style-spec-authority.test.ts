import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  STYLE_COLOR_TOKEN_DESCRIPTORS,
  STYLE_SPEC_FIELD_DESCRIPTORS,
  knownStyleDescriptors,
  knownStyles,
  resolveStyleStack,
  styleSpecFieldReferenceMarkdown,
  styleSpecJsonSchema,
  validateStyleSpec,
} from '../scene/style-registry.ts'

const ROOT = join(import.meta.dir, '..', '..')

describe('StyleSpec has one projected field authority', () => {
  test('the checked JSON Schema is the canonical descriptor projection', () => {
    const checked = JSON.parse(readFileSync(join(ROOT, 'docs', 'schemas', 'style-spec.schema.json'), 'utf8'))
    expect(checked).toEqual(styleSpecJsonSchema())
    expect(checked.required).toBeUndefined()
    expect(checked.properties.passes).toMatchObject({ type: 'integer', minimum: 1, maximum: 8 })
    expect(checked.properties.strokeWidth).toMatchObject({ type: 'number', exclusiveMinimum: 0, maximum: 20 })
    expect(checked.properties.colors.properties.bg['x-agentic-mermaid-runtime-validator']).toBe('safeCssColor')
    expect(Object.keys(checked.properties)).toEqual(Object.keys(STYLE_SPEC_FIELD_DESCRIPTORS))
    expect(Object.keys(checked.properties.colors.properties)).toEqual(Object.keys(STYLE_COLOR_TOKEN_DESCRIPTORS))
  })

  test('callers cannot mutate the authority through descriptors or schema projections', () => {
    expect(Object.isFrozen(STYLE_SPEC_FIELD_DESCRIPTORS)).toBe(true)
    expect(Object.isFrozen(STYLE_SPEC_FIELD_DESCRIPTORS.stroke.values)).toBe(true)
    expect(Object.isFrozen(STYLE_COLOR_TOKEN_DESCRIPTORS.bg)).toBe(true)

    const projected = styleSpecJsonSchema() as any
    projected.properties.stroke.enum.push('injected')
    expect(validateStyleSpec({ stroke: 'injected' })).toContain('"stroke" must be one of crisp | jittered | freehand')
    expect((styleSpecJsonSchema() as any).properties.stroke.enum).toEqual(['crisp', 'jittered', 'freehand'])
  })

  test('the authoring field table is the canonical descriptor projection', () => {
    const docs = readFileSync(join(ROOT, 'docs', 'style-authoring.md'), 'utf8')
    const expected = `<!-- BEGIN GENERATED STYLE SPEC FIELDS -->\n${styleSpecFieldReferenceMarkdown()}\n<!-- END GENERATED STYLE SPEC FIELDS -->`
    expect(docs).toContain(expected)
  })

  test('runtime validation enforces the projected ranges and plain-record boundary', () => {
    expect(validateStyleSpec(Object.create(null))).toEqual([])
    expect(validateStyleSpec(new Date())).toEqual(['style spec must be a plain object'])
    expect(validateStyleSpec({ passes: 1.5 })).toContain('"passes" must be an integer from 1 through 8')
    expect(validateStyleSpec({ strokeWidth: 0 })).toContain('"strokeWidth" must be greater than 0 and at most 20')
    expect(validateStyleSpec({ colors: { bg: 'url(https://example.test/x)' } })).toContain('color token "bg" must be a safe non-fetching CSS color')
    expect(validateStyleSpec({ font: 'Inter\" onload=\"alert(1)' })).toContain('"font" must be a safe non-fetching CSS font family or stack')

    for (const inheritedName of ['constructor', 'toString', '__proto__']) {
      const topLevel = JSON.parse(`{"${inheritedName}": true}`)
      const color = JSON.parse(`{"colors":{"${inheritedName}":"red"}}`)
      expect(validateStyleSpec(topLevel)).toContain(`unknown field "${inheritedName}"`)
      expect(validateStyleSpec(color)).toContain(`unknown color token "${inheritedName}"`)
    }
  })

  test('normalization owns formatVersion even when an input explicitly supplies undefined', () => {
    expect(resolveStyleStack({ formatVersion: undefined, colors: { bg: '#fff' } })?.formatVersion).toBe(1)
  })

  test('crisp and every picker choice come from registered descriptors', () => {
    const descriptors = knownStyleDescriptors()
    const crisp = descriptors.find(descriptor => descriptor.identity.id === 'look:crisp')
    expect(crisp?.identity.kind).toBe('look')
    expect(crisp?.inputName).toBe('crisp')
    expect(crisp?.isDefault).toBe(true)
    expect(crisp?.aliases.map(alias => alias.alias)).toContain('default')
    expect(knownStyles().filter(name => name === 'crisp')).toHaveLength(1)

    const tuftePalette = descriptors.find(descriptor => descriptor.identity.id === 'palette:tufte')
    expect(tuftePalette).toMatchObject({
      inputName: 'palette:tufte',
      displayLabel: 'Tufte',
      kind: 'palette',
      isDefault: false,
    })

    const editorGenerator = readFileSync(join(ROOT, 'scripts', 'site', 'editor.ts'), 'utf8')
    expect(editorGenerator).toContain('knownStyleDescriptors()')
    expect(editorGenerator).not.toContain('THEME_LABELS')
    expect(editorGenerator).not.toContain('STYLE_LABELS')
    expect(editorGenerator).not.toContain("import { THEMES }")

    for (const relative of ['src/cli/index.ts', 'src/mcp/hosted-server.ts', 'website/build.ts']) {
      const consumer = readFileSync(join(ROOT, relative), 'utf8')
      expect({ relative, canonical: consumer.includes('knownStyleDescriptors') }).toEqual({ relative, canonical: true })
      expect({ relative, legacy: consumer.includes('knownStyles()') }).toEqual({ relative, legacy: false })
    }
    expect(readFileSync(join(ROOT, 'website', 'build.ts'), 'utf8')).not.toContain('STYLE_THEME_LABELS')
  })

  test('deprecated alias metadata stays discoverable without becoming public API', () => {
    for (const relative of ['src/index.ts', 'src/agent/core.ts']) {
      expect(readFileSync(join(ROOT, relative), 'utf8')).not.toContain('TUFTE_STYLE_ALIAS')
    }
    const tufte = knownStyleDescriptors().find(descriptor => descriptor.identity.id === 'look:tufte')!
    expect(tufte.aliases).toContainEqual(expect.objectContaining({
      alias: 'tufte',
      diagnostic: expect.objectContaining({ code: 'STYLE_ALIAS_DEPRECATED' }),
    }))
  })

  test('CLI discovery publishes only Look/Palette kind plus explicit default state', () => {
    const result = Bun.spawnSync(['bun', 'run', join(ROOT, 'bin/am.ts'), 'styles', '--json'], { cwd: ROOT })
    expect(result.exitCode).toBe(0)
    const rows = JSON.parse(result.stdout.toString()) as Array<{ kind: string; isDefault: boolean; canonicalId: string }>
    expect(new Set(rows.map(row => row.kind))).toEqual(new Set(['look', 'palette']))
    expect(rows.find(row => row.canonicalId === 'look:crisp')).toMatchObject({ kind: 'look', isDefault: true })
    expect(rows.filter(row => row.isDefault)).toHaveLength(1)
  })
})
