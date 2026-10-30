import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { RoleStyles, SemanticBinding } from '../scene/style-registry.ts'
import {
  EXACT_ROLE_STYLE_CONTRACT,
  STYLE_COLOR_TOKEN_DESCRIPTORS,
  STYLE_SPEC_FIELD_DESCRIPTORS,
  getStyle,
  knownStyleDescriptors,
  knownStyles,
  registerStyle,
  resolveStyleReference,
  resolveStyleStack,
  styleSpecJsonSchema,
  styleSpecTypeScriptDeclaration,
  validateStyleSpec,
} from '../scene/style-registry.ts'
import { BUILTIN_PALETTE_DEFINITIONS, type BuiltinPaletteDefinition } from '../palette-catalog.ts'
import { renderResolvedScene } from '../index.ts'
import { wcagCssContrastRatio } from '../shared/color-math.ts'
import fc from 'fast-check'
import { fcParameters } from './helpers/fc-parameters.ts'
import { useTempDirs } from './helpers/temp-dir.ts'
import { useTestChildren } from './helpers/test-child.ts'

const runChild = useTestChildren(20_000)

const temp = useTempDirs()

const ROOT = join(import.meta.dir, '..', '..')
// Registered only inside child processes by site-probe.preload.ts.
const PROBE_LOOK = 'look:registry-authority-probe'
const PROBE_PALETTE = 'palette:registry-authority-probe'

function compileTimeRoleContract(): void {
  const valid: RoleStyles = { node: { paddingX: 4 }, 'pie-slice': { cue: 'pattern' } }
  void valid
  // @ts-expect-error node fontFamily is rejected by the exact public role type.
  const invalidNode: RoleStyles = { node: { fontFamily: 'Georgia' } }
  // @ts-expect-error label padding is rejected by the exact public role type.
  const invalidLabel: RoleStyles = { label: { paddingX: 4 } }
  // @ts-expect-error fallback-only roles inherit their archetype and cannot own inert exact records.
  const invalidFallback: RoleStyles = { title: {} }
  // @ts-expect-error fallback-only role keys are absent even when a caller supplies undefined.
  const invalidFallbackUndefined: RoleStyles = { title: undefined }
  const validBinding: SemanticBinding = { channel: 'category', value: 'Free', slot: 'selected', role: 'pie-slice' }
  // @ts-expect-error roles without an executable binding family are not public binding targets.
  const inertBinding: SemanticBinding = { channel: 'category', value: '0', slot: 'selected', role: 'node' }
  void invalidNode
  void invalidLabel
  void invalidFallback
  void invalidFallbackUndefined
  void validBinding
  void inertBinding
}
void compileTimeRoleContract

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

  test('agent declarations expose the exact closed Style contract', () => {
    const declaration = styleSpecTypeScriptDeclaration()
    expect(declaration).toContain('type SemanticBindingChannel = "category"')
    expect(declaration).toContain('"pie-slice"?: Readonly<StyleRole_pie_slice>')
    expect(declaration).not.toContain('"title"?: Readonly<StyleRole_title>')
    expect(declaration).toContain('type SceneStyleRole = ')
    expect(styleSpecTypeScriptDeclaration({ compact: true })).toContain('type RoleStyleFor<R extends ExactSceneStyleRole>=')
    expect(styleSpecTypeScriptDeclaration({ compact: true })).not.toContain('Partial<Record<SceneStyleRole,Readonly<RoleStyleSpec>>>')
    expect(declaration).not.toContain('{ [key: string]: unknown }')
  })

  test('callers cannot mutate the authority through descriptors or schema projections', () => {
    expect(Object.isFrozen(STYLE_SPEC_FIELD_DESCRIPTORS)).toBe(true)
    expect(Object.isFrozen(STYLE_SPEC_FIELD_DESCRIPTORS.stroke.values)).toBe(true)
    expect(Object.isFrozen(STYLE_COLOR_TOKEN_DESCRIPTORS.bg)).toBe(true)
    expect(Object.isFrozen(EXACT_ROLE_STYLE_CONTRACT)).toBe(true)
    expect(Object.isFrozen(EXACT_ROLE_STYLE_CONTRACT.actor)).toBe(true)
    expect(Object.isFrozen(EXACT_ROLE_STYLE_CONTRACT.actor.bindingFamilies)).toBe(true)

    const projected = styleSpecJsonSchema() as any
    projected.properties.stroke.enum.push('injected')
    expect(validateStyleSpec({ stroke: 'injected' })).toContain('"stroke" must be one of crisp | jittered | freehand')
    expect((styleSpecJsonSchema() as any).properties.stroke.enum).toEqual(['crisp', 'jittered', 'freehand'])
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

  test('admission snapshots nested arrays once and bounds hostile JSON shapes', () => {
    let reads = 0
    const binding = {
      get channel() { reads++; return reads === 1 ? 'category' : 'route' },
      value: 'Beta',
      slot: 'selected',
      role: 'pie-slice',
    }
    const unregister = registerStyle({
      name: 'look:array-snapshot-test',
      semanticSlots: { selected: { fillColor: '#ff00ff' } },
      bindings: [binding],
    } as any)
    try {
      expect(reads).toBe(1)
      expect(getStyle('look:array-snapshot-test')?.bindings?.[0]?.channel).toBe('category')
      expect(reads).toBe(1)
    } finally {
      unregister()
    }

    const cyclic: Record<string, unknown> = {}
    cyclic.self = cyclic
    expect(() => resolveStyleStack(cyclic as any)).toThrow('Style input must be acyclic')
    const sparse = Array(2)
    sparse[1] = { channel: 'category', value: 'Beta', slot: 'selected' }
    expect(() => resolveStyleStack({ bindings: sparse } as any)).toThrow('Style arrays must not be sparse')
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
    expect(resolveStyleReference('default')).toBeUndefined()
    expect(knownStyles().filter(name => name === 'crisp')).toHaveLength(1)

    expect(descriptors.find(descriptor => descriptor.identity.id === 'palette:tufte')).toBeUndefined()
    expect(knownStyles()).not.toContain('palette:tufte')
  })

  test('a newly registered Look and Palette reach CLI, hosted MCP, and editor picker discovery', async () => {
    // The probe registers before any consumer module loads. A consumer with a
    // hand-maintained roster cannot list styles it has never heard of.
    const preload = join(ROOT, 'src', '__tests__', 'site-probe.preload.ts')
    const probeEnv = { ...process.env, AM_TEST_PROBE_STYLES: '1' }
    const probeLabel = 'Registry Authority Probe'
    const run = async (args: string[], env: Record<string, string | undefined>) => {
      const result = await runChild('bun', ['--preload', preload, ...args], { cwd: ROOT, env })
      expect({ args, exitCode: result.status, stderr: result.status === 0 ? '' : result.stderr.toString() })
        .toEqual({ args, exitCode: 0, stderr: '' })
      return result.stdout.toString()
    }

    const cliRows = async (env: Record<string, string | undefined>) =>
      JSON.parse(await run([join(ROOT, 'bin', 'am.ts'), 'styles', '--json'], env)) as Array<{ canonicalId: string; kind: string; label: string; isDefault: boolean }>
    expect((await cliRows(probeEnv)).filter(row => row.canonicalId.endsWith(':registry-authority-probe'))).toEqual([
      expect.objectContaining({ canonicalId: PROBE_LOOK, kind: 'look', label: probeLabel, isDefault: false }),
      expect.objectContaining({ canonicalId: PROBE_PALETTE, kind: 'palette', label: probeLabel, isDefault: false }),
    ])
    // Control: the same command without registration does not mention the probe.
    expect((await cliRows({ ...process.env })).some(row => row.canonicalId.endsWith(':registry-authority-probe'))).toBe(false)

    const hostedTools = JSON.parse(await run(['-e', `const { HOSTED_TOOLS } = await import(${JSON.stringify(join(ROOT, 'src', 'mcp', 'hosted-server.ts'))}); console.log(JSON.stringify(HOSTED_TOOLS))`], probeEnv)) as Array<{ name: string }>
    const renderSvg = JSON.stringify(hostedTools.find(tool => tool.name === 'render_svg'))
    expect(renderSvg).toMatch(new RegExp(`registered Look \\([^)]*${PROBE_LOOK}[^)]*\\)`))
    expect(renderSvg).toMatch(new RegExp(`Palette \\([^)]*${PROBE_PALETTE}[^)]*\\)`))

    const out = join(temp.dir('am-style-authority-'), 'editor.html')
    await run([join(ROOT, 'scripts', 'site', 'editor.ts')], { ...probeEnv, AM_TEST_REDIRECT_WRITE: out })
    const html = readFileSync(out, 'utf8')
    const styleItems = Array.from(html.matchAll(/<button class="theme-dropdown-item[^"]*"[^>]*data-style="([^"]+)"[^>]*>([^<]*)<\/button>/g), match => [match[1], match[2]])
    const themeItems = Array.from(html.matchAll(/<button class="theme-dropdown-item[^"]*"[^>]*data-theme="([^"]*)"[^>]*>(?:<span[^>]*><\/span>)?([^<]*)<\/button>/g), match => [match[1], match[2]])
    expect(styleItems).toContainEqual([PROBE_LOOK, probeLabel])
    expect(themeItems).toContainEqual([PROBE_PALETTE, probeLabel])
    // Kind routing: a Look is never offered as a palette and vice versa.
    expect(styleItems.map(item => item[0])).not.toContain(PROBE_PALETTE)
    expect(themeItems.map(item => item[0])).not.toContain(PROBE_LOOK)
  }, 60_000)

  // A Palette layered over a Look (the documented `hand-drawn,dracula`) used
  // to keep the Look's ink chosen for its own page: hand-drawn's #26262b
  // border on dracula's #282a36 (1.06:1), and data ink such as Gantt bars
  // painted from it (#26262b bars on zinc-dark, white blueprint bars on
  // zinc-light).
  test('a Palette layered over any built-in Look draws ink chosen for the Palette\'s page', () => {
    const looks = knownStyleDescriptors().filter(descriptor => descriptor.kind === 'look' && descriptor.inputName !== 'crisp')
    for (const look of looks) for (const palette of BUILTIN_PALETTE_DEFINITIONS as readonly BuiltinPaletteDefinition[]) {
      const colors = resolveStyleStack([look.inputName, palette.inputName])!.colors!
      const pair = `${look.inputName} × ${palette.inputName}`
      expect([colors.bg, colors.fg], pair).toEqual([palette.colors.bg, palette.colors.fg])
      for (const token of ['line', 'accent', 'muted', 'border'] as const) {
        if (palette.colors[token] !== undefined) expect(colors[token], `${pair}: ${token}`).toBe(palette.colors[token])
        // Ink the Palette leaves to the Look must read on the Palette's page.
        else if (colors[token] !== undefined) expect(wcagCssContrastRatio(colors[token]!, palette.colors.bg), `${pair}: ${token} ${colors[token]}`).toBeGreaterThanOrEqual(3)
      }
    }
    const gantt = 'gantt\n  dateFormat YYYY-MM-DD\n  section S\n  T1 :a1, 2024-01-01, 3d\n  T2 :after a1, 2d'
    for (const look of looks) for (const palette of ['zinc-light', 'zinc-dark']) {
      const scene = renderResolvedScene(gantt, { style: [look.inputName, palette] })
      const tasks = scene.parts.filter(part => part.role === 'task')
      expect(tasks.length).toBe(2)
      for (const task of tasks) {
        const inks = task.primitives.flatMap(primitive => primitive.kind === 'text' ? [] : [primitive.paint.fill, primitive.paint.stroke])
        const contrast = Math.max(...inks.map(ink => wcagCssContrastRatio(ink, scene.colors.bg) ?? 0))
        expect(contrast, `${look.inputName} × ${palette}: Gantt bar ink`).toBeGreaterThanOrEqual(3)
      }
    }
  })

  test('a layer that moves the page keeps earlier ink that reads there and makes the rest read', () => {
    const hex = fc.tuple(fc.integer({ min: 0, max: 255 }), fc.integer({ min: 0, max: 255 }), fc.integer({ min: 0, max: 255 }))
      .map(channels => `#${channels.map(channel => channel.toString(16).padStart(2, '0')).join('')}`)
    const ink = fc.record({ line: hex, accent: hex, muted: hex, border: hex })
    fc.assert(fc.property(hex, hex, ink, hex, hex, (bg, fg, authored, page, pageFg) => {
      fc.pre(bg !== page)
      const colors = resolveStyleStack([{ colors: { bg, fg, ...authored } }, { colors: { bg: page, fg: pageFg } }])!.colors!
      for (const token of ['line', 'accent', 'muted', 'border'] as const) {
        const carried = colors[token]
        if (carried === undefined) continue // re-derived from the new page
        if (wcagCssContrastRatio(authored[token], page)! >= 3) expect(carried).toBe(authored[token])
        else expect(wcagCssContrastRatio(carried, page)!).toBeGreaterThanOrEqual(3)
      }
    }), fcParameters({
      numRuns: 300,
      // The documented stack's border, and a page whose foreground cannot reach 3:1.
      examples: [
        ['#f7f5ef', '#1a1a1e', { line: '#26262b', accent: '#26262b', muted: '#26262b', border: '#26262b' }, '#282a36', '#f8f8f2'],
        ['#ffffff', '#000000', { line: '#777777', accent: '#777777', muted: '#777777', border: '#777777' }, '#767676', '#808080'],
      ],
    }))
  })

  test('removed Tufte and default bare inputs have no metadata or public resolution', () => {
    expect(knownStyleDescriptors().some(descriptor => descriptor.identity.id === 'look:tufte')).toBe(true)
    expect(getStyle('palette:tufte')).toBeUndefined()
    expect(getStyle('tufte')).toBeUndefined()
    expect(getStyle('look:tufte')?.name).toBe('look:tufte')
    expect(getStyle('default')).toBeUndefined()
    expect(() => resolveStyleStack('default')).toThrow(/Unknown style "default"/)
  })

  test('CLI rejects removed bare inputs while retaining canonical Looks', async () => {
    const input = join(ROOT, 'eval/layout-compare/fixtures/flowchart-basic.mmd')
    const removed = await runChild('bun', ['run', join(ROOT, 'bin/am.ts'), 'render', input, '--style', 'palette:tufte'], { cwd: ROOT })
    expect(removed.status).toBe(2)
    expect(removed.stderr.toString()).toContain('Unknown style "palette:tufte"')
    expect(removed.stdout.toString()).toBe('')

    for (const removedName of ['tufte', 'default']) {
      const removedBare = await runChild('bun', ['run', join(ROOT, 'bin/am.ts'), 'render', input, '--style', removedName], { cwd: ROOT })
      expect(removedBare.status).toBe(2)
      expect(removedBare.stderr.toString()).toContain(`Unknown style "${removedName}"`)
      expect(removedBare.stdout.toString()).toBe('')
    }

    const retained = await runChild('bun', ['run', join(ROOT, 'bin/am.ts'), 'render', input, '--style', 'look:tufte'], { cwd: ROOT })
    expect(retained.status, retained.stderr.toString()).toBe(0)
    expect(retained.stdout.toString()).toContain('<svg')
  })

  test('CLI discovery publishes only Look/Palette kind plus explicit default state', async () => {
    const result = await runChild('bun', ['run', join(ROOT, 'bin/am.ts'), 'styles', '--json'], { cwd: ROOT })
    expect(result.status).toBe(0)
    const rows = JSON.parse(result.stdout.toString()) as Array<{ kind: string; isDefault: boolean; canonicalId: string }>
    expect(new Set(rows.map(row => row.kind))).toEqual(new Set(['look', 'palette']))
    expect(rows.find(row => row.canonicalId === 'look:crisp')).toMatchObject({ kind: 'look', isDefault: true })
    expect(rows.filter(row => row.isDefault)).toHaveLength(1)
  })
})
