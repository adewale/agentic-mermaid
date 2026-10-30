import { describe, expect, test } from 'bun:test'
import fc from 'fast-check'
import { fcParameters } from './helpers/fc-parameters.ts'
import { BUILTIN_FAMILY_METADATA } from '../agent/families.ts'
import { renderMermaidPNG } from '../agent/png.ts'
import type { DiagramKind } from '../agent/types.ts'
import { DEFAULT_ARCHITECTURE_VISUAL } from '../architecture/config.ts'
import { detectColorMode } from '../ascii/ansi.ts'
import { renderMermaidASCII, renderMermaidASCIIWithReceipt } from '../ascii/index.ts'
import { renderMermaidSVGWithReceipt } from '../index.ts'
import { HOSTED_TOOLS } from '../mcp/hosted-server.ts'
import { LOCAL_TOOLS } from '../mcp/server.ts'
import { projectMcpRenderOptions } from '../mcp/tool-surface.ts'
import { normalizeMermaidSource } from '../mermaid-source.ts'
import { inspectPngColorProfile, OUTPUT_COLOR_PROFILE } from '../output-color-profile.ts'
import { applyOutputSecurityPolicy, verifyNoExternalRefs } from '../output-security.ts'
import {
  CLI_RENDER_FORMATS,
  deferredRenderContractDigest,
  renderContractDigest,
  RENDER_OUTPUT_DESCRIPTORS,
  receiptOf,
  resolveAppearance,
  resolvedFamilyRenderContextOf,
  resolvedRenderExecutionPlanOf,
  resolveRenderRequest,
  SHARED_RENDER_OPTION_FIELD_DESCRIPTORS,
  SHARED_RENDER_OPTION_FIELDS,
  type SharedRenderOptionField,
  sharedRenderOptionsJsonSchema,
  styleInputJsonSchema,
  validateSerializableRenderOptions,
} from '../render-contract.ts'
import { projectTerminalStyle } from '../terminal-style.ts'
import type { RenderOptions } from '../types.ts'

const SOURCE = 'flowchart LR\n  A[Start] --> B[Finish]'

// Construct the admitted JSON subset; forbidden-key and resource-budget cases
// remain with the existing JSON admission and render-authority tests.
function configJsonKeys(value: fc.JsonValue): fc.JsonValue {
  if (Array.isArray(value)) return value.map(configJsonKeys)
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, child]) => [`k${key}`, configJsonKeys(child!)]))
  }
  return value
}

const recursiveConfigJson = fc.jsonValue({ stringUnit: 'binary' }).map(configJsonKeys)

// One admissible value per family-scoped option; the descriptor is the only
// applicability authority.
const FAMILY_SCOPED_OPTION_VALUES = {
  layoutHints: { ranks: { A: 0, B: 1 } },
  graphLayout: { backend: 'elk' },
  padding: 12,
  nodeSpacing: 77,
  layerSpacing: 91,
  wrappingWidth: 120,
  componentSpacing: 66,
  interactive: true,
  shadow: true,
  class: { hierarchicalNamespaces: false },
  kanban: { maxWidth: 600 },
  pie: { maxWidth: 360 },
  radar: { maxWidth: 360 },
  architecture: { visual: { groupCornerRadius: 12 } },
  timeline: { maxWidth: 300 },
  journey: { experienceCurve: false },
  gantt: { dependencyArrows: true, criticalPath: true },
  ganttToday: '2026-01-08',
} as const satisfies Partial<Record<SharedRenderOptionField, unknown>>

describe('Section A canonical render contracts', () => {
  test('deferred evidence captures mutable accessors once and rejects invalid data immediately', () => {
    const data = { label: 'captured' }
    let reads = 0
    const digest = deferredRenderContractDigest({ get data() { reads++; return data } })
    expect(reads).toBe(1)
    data.label = 'changed after admission'
    expect(digest()).toBe(renderContractDigest({ data: { label: 'captured' } }))
    expect(digest()).toBe(digest())
    expect(reads).toBe(1)
    const cycle: { next?: unknown } = {}
    cycle.next = cycle
    expect(() => deferredRenderContractDigest(cycle)).toThrow(TypeError)
    expect(() => deferredRenderContractDigest({ value: Number.POSITIVE_INFINITY })).toThrow(TypeError)
  })

  test('the public render-option schema is closed and exposes shared options', () => {
    const schema = sharedRenderOptionsJsonSchema() as { additionalProperties: boolean; properties: Record<string, unknown> }
    expect(schema.additionalProperties).toBe(false)
    expect(Object.keys(schema.properties)).toEqual(expect.arrayContaining(['style', 'mermaidConfig', 'security', 'idPrefix']))
  })

  test('editing an exported schema cannot change runtime admission or later exports', () => {
    const exported = sharedRenderOptionsJsonSchema() as {
      properties: { padding: { minimum: number } }
      $defs: { jsonValue: { anyOf: unknown[] } }
    }
    exported.properties.padding.minimum = -100
    exported.$defs.jsonValue.anyOf.length = 0

    expect(validateSerializableRenderOptions({ padding: -1 })).toEqual([
      expect.stringContaining('non-negative'),
    ])
    expect(validateSerializableRenderOptions({
      mermaidConfig: { c4: { personFontSize: 13 }, themeVariables: { primaryColor: '#123456' } },
    })).toEqual([])
    const fresh = sharedRenderOptionsJsonSchema() as typeof exported
    expect(fresh.properties.padding.minimum).toBe(0)
    expect(fresh.$defs.jsonValue.anyOf).toHaveLength(6)
  })

  test('family-limited options publish one applicability authority and diagnose unsupported built-ins', () => {
    const schema = sharedRenderOptionsJsonSchema() as {
      properties: Record<string, Record<string, unknown>>
    }
    const scopedFields = SHARED_RENDER_OPTION_FIELDS.filter(field => 'applicableBuiltinFamilies' in SHARED_RENDER_OPTION_FIELD_DESCRIPTORS[field])
    expect(scopedFields.filter(field => !(field in FAMILY_SCOPED_OPTION_VALUES)), 'scoped options without a probe value').toEqual([])

    for (const field of SHARED_RENDER_OPTION_FIELDS) {
      const descriptor = SHARED_RENDER_OPTION_FIELD_DESCRIPTORS[field]
      if (!('applicableBuiltinFamilies' in descriptor)) {
        expect(schema.properties[field]).not.toHaveProperty('x-agentic-mermaid-applicable-builtin-families')
        continue
      }
      const applicable: readonly DiagramKind[] = descriptor.applicableBuiltinFamilies
      const scopedField = field as keyof typeof FAMILY_SCOPED_OPTION_VALUES
      expect(Object.isFrozen(applicable), field).toBe(true)
      expect(new Set(applicable).size, field).toBe(applicable.length)
      expect(
        applicable.every(id => BUILTIN_FAMILY_METADATA.some(family => family.id === id)),
        field,
      ).toBe(true)
      expect(schema.properties[field]?.['x-agentic-mermaid-applicable-builtin-families'], field).toEqual([...applicable])
      const applicability = applicable.length === 0 ? 'No built-in family currently consumes this option.' : `Applicable built-in families: ${applicable.join(', ')}.`

      for (const family of BUILTIN_FAMILY_METADATA) {
        const request = resolveRenderRequest(family.example, {
          [field]: FAMILY_SCOPED_OPTION_VALUES[scopedField],
        } as RenderOptions)
        const diagnostics = (receiptOf(request).diagnostics ?? []).filter(diagnostic => diagnostic.code === 'RENDER_OPTION_NOT_APPLICABLE' && diagnostic.feature === `render-option:${field}`)
        if (applicable.includes(family.id)) {
          expect(diagnostics, `${field}/${family.id}`).toEqual([])
          expect(request.resolutionDiagnostics, `${field}/${family.id}`).toBeUndefined()
          continue
        }
        expect(diagnostics, `${field}/${family.id}`).toEqual([
          {
            code: 'RENDER_OPTION_NOT_APPLICABLE',
            feature: `render-option:${field}`,
            message: `Render option "${field}" does not apply to built-in Mermaid family "${family.id}". ${applicability}`,
          },
        ])
        expect(Object.isFrozen(request.resolutionDiagnostics), `${field}/${family.id}`).toBe(true)
        expect(Object.isFrozen(request.resolutionDiagnostics?.[0]), `${field}/${family.id}`).toBe(true)
      }
    }
  })

  test('idPrefix schema and runtime admission enforce the same SVG-id alphabet', () => {
    const schema = sharedRenderOptionsJsonSchema() as { properties: { idPrefix: { pattern?: string } } }
    expect(schema.properties.idPrefix.pattern).toBe('^[A-Za-z0-9_.:-]+$')
    expect(validateSerializableRenderOptions({ idPrefix: '' })).toEqual([expect.stringContaining('non-empty')])
    expect(validateSerializableRenderOptions({ idPrefix: 'diagram_1.2:-' })).toEqual([])
    expect(validateSerializableRenderOptions({ idPrefix: 'bad" onload="x-' })).toEqual([expect.stringContaining('ASCII letters, digits, underscore, hyphen, dot, and colon')])
  })

  test('geometry schemas reject impossible shared and architecture metrics at admission', () => {
    for (const options of [{ padding: -1 }, { nodeSpacing: -1 }, { layerSpacing: -1 }, { componentSpacing: -1 }, { wrappingWidth: 0 }, { timeline: { maxWidth: 0 } }]) {
      expect(validateSerializableRenderOptions(options).join(' '), JSON.stringify(options)).toMatch(/non-negative|positive|greater than 0/)
    }

    expect(
      validateSerializableRenderOptions({
        architecture: { visual: { groupHeaderHeight: 28 } },
      }),
    ).toEqual([])
    expect(
      validateSerializableRenderOptions({
        architecture: {
          visual: { serviceCornerRadius: -1 },
        },
      }).join(' '),
    ).toMatch(/at least 0/)
    expect(
      validateSerializableRenderOptions({
        architecture: {
          visual: { groupFontWeight: 1_001 },
        },
      }).join(' '),
    ).toMatch(/at most 1000/)
    expect(
      validateSerializableRenderOptions({
        architecture: {
          visual: {
            ...DEFAULT_ARCHITECTURE_VISUAL,
            junctionOuterRadius: 4,
            junctionInnerRadius: 5,
          },
        },
      }).join(' '),
    ).toMatch(/must not exceed junctionOuterRadius/)
  })

  test('output descriptors publish CLI aliases and transport availability', () => {
    expect(CLI_RENDER_FORMATS).toEqual(['svg', 'ascii', 'unicode', 'png', 'layout'])
    const html = RENDER_OUTPUT_DESCRIPTORS.find(descriptor => descriptor.id === 'html')!
    const layout = RENDER_OUTPUT_DESCRIPTORS.find(descriptor => descriptor.id === 'layout')!
    expect(html.transports.library).toMatchObject({ availability: 'projected', entrypoint: 'renderMermaidASCII' })
    expect(html.transports.cli).toMatchObject({ availability: 'unavailable', entrypoint: 'none' })
    expect(typeof html.transports.cli.reason).toBe('string')
    expect(html.transports.codeMode).toMatchObject({ availability: 'projected', method: 'renderMermaidASCIIWithReceipt' })
    expect(html.transports.hostedMcp).toMatchObject({ availability: 'indirect', entrypoint: 'execute' })
    expect(html.transports.editor).toMatchObject({ availability: 'unavailable', entrypoint: 'none' })
    expect(html.transports.website).toMatchObject({ availability: 'unavailable', entrypoint: 'none' })
    expect(layout.transports.cli).toMatchObject({ availability: 'direct', format: 'layout' })
    expect(layout.transports.codeMode).toMatchObject({ availability: 'direct', method: 'layoutMermaidWithReceipt' })
    expect(layout.transports.localMcp).toMatchObject({ availability: 'indirect', entrypoint: 'execute' })

  })

  test('every direct render tool exposes the canonical shared option schema', () => {
    const expected = [...SHARED_RENDER_OPTION_FIELDS]
    for (const tool of [...HOSTED_TOOLS, ...LOCAL_TOOLS].filter(tool => tool.name === 'render_svg' || tool.name === 'render_ascii' || tool.name === 'render_png')) {
      const properties = tool.inputSchema.properties as Record<string, { properties?: Record<string, unknown> }>
      expect(Object.keys(properties.options?.properties ?? {}), tool.name).toEqual(expected)
    }
  })

  test('MCP render schemas expose shared fields only through canonical nested options', () => {
    // The public projection carries the StyleSpec definitions its $refs name.
    const { $defs: styleDefinitions, ...styleProjection } = styleInputJsonSchema() as Record<string, unknown>
    expect(styleProjection).toEqual(SHARED_RENDER_OPTION_FIELD_DESCRIPTORS.style.schema)
    expect(Object.keys(styleDefinitions as object)).toContain('styleSpec')
    for (const tool of [...HOSTED_TOOLS, ...LOCAL_TOOLS].filter(tool => tool.name === 'render_svg' || tool.name === 'render_png')) {
      const properties = tool.inputSchema.properties as Record<string, Record<string, unknown>>
      expect(properties.options, `${tool.name}.options`).toBeDefined()
      for (const field of ['bg', 'fg', 'style', 'seed']) expect(properties[field], `${tool.name}.${field}`).toBeUndefined()
    }
    expect(projectMcpRenderOptions({ options: { bg: '#ffffff', fg: '#111111', seed: 1 } })).toEqual({
      bg: '#ffffff',
      fg: '#111111',
      seed: 1,
    })
  })

  test.each([
    { name: 'valid first field', bg: '#123456', nullOptions: false, containerChanges: false, error: undefined },
    { name: 'invalid first field', bg: 'url(https://invalid.example/first)', nullOptions: false, containerChanges: false, error: 'render option "bg" must be a safe, non-fetching CSS paint' },
    { name: 'valid first container', bg: '#123456', nullOptions: false, containerChanges: true, error: undefined },
    { name: 'invalid first container', bg: '#123456', nullOptions: true, containerChanges: true, error: 'render options must be a plain JSON object' },
  ])('MCP projection validates captured values: $name', ({ bg, nullOptions, containerChanges, error }) => {
    let reads = 0
    const options = Object.defineProperty({}, 'bg', {
      enumerable: true,
      get() { return ++reads === 1 ? bg : bg.startsWith('url(') ? '#abcdef' : 'url(https://invalid.example/changed)' },
    })
    let optionReads = 0
    const args = Object.defineProperty({}, 'options', {
      get() {
        optionReads++
        if (!containerChanges) return options
        return optionReads === 1 ? (nullOptions ? null : options) : (nullOptions ? options : null)
      },
    })
    if (error) {
      expect(() => projectMcpRenderOptions(args)).toThrow(error)
    } else {
      const projected = projectMcpRenderOptions(args)
      expect(projected).toEqual({ bg })
      expect(resolveRenderRequest(SOURCE, projected).appearance.colors.bg).toBe(bg)
    }
    expect({ optionReads, valueReads: reads }).toEqual({ optionReads: 1, valueReads: nullOptions ? 0 : 1 })
  })

  test('one appearance receipt survives graphical and terminal output choices', () => {
    const options = { style: ['hand-drawn', { colors: { accent: '#005fcc' } }], seed: 4 }
    const svg = resolveRenderRequest(SOURCE, options, 'svg')
    const png = resolveRenderRequest(SOURCE, options, 'png', { scale: 2 })
    const terminal = resolveRenderRequest(SOURCE, options, 'unicode', { colorMode: 'none' })
    expect(svg.appearance.digest).toBe(png.appearance.digest)
    expect(svg.appearance.digest).toBe(terminal.appearance.digest)
    expect(new Set([svg.requestDigest, png.requestDigest, terminal.requestDigest]).size).toBe(3)
    expect(Object.isFrozen(svg)).toBe(true)
    expect(Object.isFrozen(svg.appearance)).toBe(true)
    expect(Object.isFrozen(svg.renderOptions)).toBe(true)
  })

  test('removed Style aliases fail instead of producing compatibility diagnostics', () => {
    expect(() => renderMermaidSVGWithReceipt(SOURCE, { style: 'default' })).toThrow('Unknown style "default"')
  })

  test('appearance is a pure projection and family code receives one explicit resolved context', () => {
    const options = Object.freeze({ style: 'accessible-high-contrast' as const, seed: 4 })
    const request = resolveRenderRequest(SOURCE, options, 'svg')
    const family = resolvedRenderExecutionPlanOf(request).family
    const direct = resolveAppearance({
      family,
      source: request.source,
      options,
      style: request.appearance.style,
      styleFace: request.appearance.face,
    })
    expect(direct.appearance.digest).toBe(request.appearance.digest)
    expect(direct.renderOptions).toEqual(request.renderOptions)
    expect(options).toEqual({ style: 'accessible-high-contrast', seed: 4 })

    const context = resolvedFamilyRenderContextOf(request)
    expect(context).toEqual({
      renderOptions: request.renderOptions,
      styleFace: request.appearance.face,
      paintBackendId: 'backend:default',
    })
    expect(Object.isFrozen(context)).toBe(true)
    expect(Object.getOwnPropertySymbols(request.renderOptions)).toEqual([])
  })

  test('family appearance and config are resolved once and retain cross-output receipt parity', () => {
    const source = `---
config:
  themeVariables:
    xyChart:
      backgroundColor: "#123456"
  xyChart:
    width: 640
---
xychart-beta
  x-axis [a, b]
  y-axis 0 --> 5
  bar [1, 2]`
    const requests = (['svg', 'png', 'unicode', 'layout'] as const).map(output => resolveRenderRequest(source, {}, output))

    expect(new Set(requests.map(request => request.sharedRequestDigest)).size).toBe(1)
    expect(new Set(requests.map(request => request.appearance.digest)).size).toBe(1)
    for (const request of requests) {
      expect(request.appearance.colors.bg).toBe('#123456')
      expect(request.appearance.family).toEqual({ theme: { backgroundColor: '#123456' } })
      expect(request.familyConfig).toEqual({ config: { width: 640 } })
      expect(Object.isFrozen(request.appearance.family)).toBe(true)
      expect(Object.isFrozen(request.familyConfig)).toBe(true)
    }
    expect(resolveRenderRequest(source, { bg: '#abcdef' }, 'svg').appearance.colors.bg).toBe('#abcdef')
  })

  test('entity normalization and Mermaid theme safety are shared across outputs', () => {
    const encoded = 'flowchart LR\n  A[Tom &amp; Jerry] --> B'
    const options = { mermaidConfig: { themeVariables: { primaryTextColor: '#123456' } } }
    const svg = resolveRenderRequest(encoded, options, 'svg')
    const layout = resolveRenderRequest(encoded, options, 'layout')
    const terminal = resolveRenderRequest(encoded, options, 'unicode')
    expect(svg.source.text).toContain('Tom & Jerry')
    expect(svg.source.originalText).toBe(encoded)
    expect(svg.sharedRequestDigest).toBe(layout.sharedRequestDigest)
    expect(svg.sharedRequestDigest).toBe(terminal.sharedRequestDigest)
    expect(svg.appearance.digest).toBe(terminal.appearance.digest)
    expect(svg.appearance.colors.fg).toBe('#123456')
    const raw = resolveRenderRequest(encoded.replace('&amp;', '&'), options, 'svg')
    expect(raw.source.text).toBe(svg.source.text)
    expect(raw.source.originalText).not.toBe(svg.source.originalText)
    expect(raw.sharedRequestDigest).not.toBe(svg.sharedRequestDigest)
    const invalid = { mermaidConfig: { themeVariables: { primaryTextColor: 'url(https://evil.invalid/x)' } } }
    for (const output of ['svg', 'layout', 'unicode'] as const) {
      expect(() => resolveRenderRequest(encoded, invalid, output))
        .toThrow('themeVariables.primaryTextColor: "url(https://evil.invalid/x)" is not a CSS color')
    }
  })

  test('advanced adapters reject null, functions, prototype keys, and unknown fields', () => {
    expect(validateSerializableRenderOptions({ style: null })).toContain('render option "style" must be omitted instead of null')
    expect(validateSerializableRenderOptions({ nope: true })).toContain('unknown render option "nope"')
    expect(validateSerializableRenderOptions({ mermaidConfig: { value: () => 1 } }).length).toBeGreaterThan(0)
    const hostile = JSON.parse('{"mermaidConfig":{"__proto__":{"polluted":true}}}')
    expect(validateSerializableRenderOptions(hostile).length).toBeGreaterThan(0)
    expect(validateSerializableRenderOptions({ backendPolicy: { selected: 'backend:probe' } })).toContain('unknown render option "backendPolicy"')
    for (const tool of [...HOSTED_TOOLS, ...LOCAL_TOOLS]) {
      expect(JSON.stringify(tool.inputSchema), tool.name).not.toContain('backendPolicy')
    }
  })

  test('recursive Mermaid JSON admits finite values and repeated shared subtrees', () => {
    fc.assert(fc.property(recursiveConfigJson, value => {
      expect(validateSerializableRenderOptions({ mermaidConfig: { extensionData: { first: value, second: value } } })).toEqual([])
    }), fcParameters({ numRuns: 2_000 }))
  })

  test('recursive Mermaid JSON rejection identifies an injected non-JSON leaf', () => {
    const invalidLeaf = fc.constantFrom(
      { value: undefined, message: 'must be a JSON value, not undefined' },
      { value: () => true, message: 'must be a JSON value, not function' },
      { value: Symbol('invalid'), message: 'must be a JSON value, not symbol' },
      { value: 1n, message: 'must be a JSON value, not bigint' },
      { value: Number.NaN, message: 'must be a finite number' },
      { value: Number.POSITIVE_INFINITY, message: 'must be a finite number' },
      { value: Number.NEGATIVE_INFINITY, message: 'must be a finite number' },
    )
    fc.assert(fc.property(fc.array(recursiveConfigJson), invalidLeaf, (siblings, invalid) => {
      const options = { mermaidConfig: { extensionData: [...siblings, { badLeaf: invalid.value }] } }
      expect(validateSerializableRenderOptions(options)).toEqual([
        `render option "mermaidConfig.extensionData[${siblings.length}].badLeaf" ${invalid.message}`,
      ])
    }), fcParameters({ numRuns: 2_000 }))
  })

  test.each([
    ['contrast lower bound', { kind: 'contrast', action: 'error', minimum: 0.5 }, '"constraints[0].minimum" must be between 1 and 21'],
    ['contrast upper bound', { kind: 'contrast', action: 'warn', minimum: 22 }, '"constraints[0].minimum" must be between 1 and 21'],
    ['accent-area lower bound', { kind: 'accent-area', action: 'error', maxFraction: -0.1 }, '"constraints[0].maxFraction" must be between 0 and 1'],
    ['accent-area upper bound', { kind: 'accent-area', action: 'warn', maxFraction: 1.1 }, '"constraints[0].maxFraction" must be between 0 and 1'],
    ['mono-role domain', { kind: 'mono-role', action: 'error', role: 'not-a-role' }, '"constraints[0].role" must be a registered built-in SceneRole'],
    ['required mono-role field', { kind: 'mono-role', action: 'warn' }, '"constraints[0].role" is required for mono-role'],
    ['constraint action', { kind: 'contrast', action: 'repair' }, '"constraints[0].action" must be one of warn | error'],
    ['constraint kind', { kind: 'unknown', action: 'error' }, '"constraints[0].kind" must be one of contrast | accent-area | mono-role'],
  ])('style constraint diagnostics identify %s in inline and stacked input', (_name, constraint, diagnostic) => {
    const spec = { constraints: [constraint] }
    for (const style of [spec, ['hand-drawn', spec]]) {
      expect(validateSerializableRenderOptions({ style })).toEqual([
        `render option "style" is invalid: Invalid style spec: ${diagnostic}`,
      ])
    }
  })

  test.each([
    { kind: 'contrast', minimum: 1 },
    { kind: 'contrast', minimum: 21 },
    { kind: 'contrast' },
    { kind: 'accent-area', maxFraction: 0 },
    { kind: 'accent-area', maxFraction: 1 },
    { kind: 'mono-role', role: 'node' },
    { kind: 'mono-role', role: 'edge' },
  ])('style constraints admit valid limits and roles: %j', constraint => {
    for (const action of ['warn', 'error']) {
      const spec = { constraints: [{ ...constraint, action }] }
      for (const style of [spec, ['hand-drawn', spec]]) {
        expect(validateSerializableRenderOptions({ style })).toEqual([])
      }
    }
  })

  test('output security rejects active content in every mode and strict rejects external references', () => {
    const unsafe = '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script><image href="https://evil.invalid/x"/><rect onclick="x()" style="fill:url(javascript:boom)"/></svg>'
    expect(() => applyOutputSecurityPolicy(unsafe, 'default')).toThrow('rejected active content')
    expect(() => applyOutputSecurityPolicy(unsafe, 'strict')).toThrow('rejected active content')
    expect(() => applyOutputSecurityPolicy('<svg xmlns="http://www.w3.org/2000/svg"><image href="https://evil.invalid/x"/></svg>', 'strict')).toThrow('strict verification failed')
    expect(() => applyOutputSecurityPolicy('<svg><g></svg>', 'strict')).toThrow('invalid SVG document envelope')
    expect(() => applyOutputSecurityPolicy('<svg xmlns="http://www.w3.org/2000/svg"><script><script>x</script></script><rect/></svg>', 'strict')).toThrow('rejected active content')
  })

  test('output-security decisions remain visible in the artifact receipt', () => {
    const defaultArtifact = renderMermaidSVGWithReceipt(SOURCE)
    expect(defaultArtifact.receipt.diagnostics).toEqual([])
    const importingArtifact = renderMermaidSVGWithReceipt(SOURCE, { embedFontImport: true })
    expect(importingArtifact.receipt.diagnostics).toContainEqual(expect.objectContaining({ code: 'EXTERNAL_REFERENCE' }))
    const strictArtifact = renderMermaidSVGWithReceipt(SOURCE, { security: 'strict' })
    expect(strictArtifact.receipt.diagnostics).toEqual([])
    expect(verifyNoExternalRefs(strictArtifact.svg).ok).toBe(true)
  })

  test('terminal auto mode honors TTY disable signals before color hints', () => {
    expect(detectColorMode({ isTTY: false, env: { COLORTERM: 'truecolor' } })).toBe('none')
    expect(detectColorMode({ isTTY: true, env: { TERM: 'dumb', COLORTERM: 'truecolor' } })).toBe('none')
    expect(detectColorMode({ isTTY: true, env: { TERM: 'xterm-256color', NO_COLOR: '' } })).toBe('none')
    expect(detectColorMode({ isTTY: true, env: { TERM: 'xterm-256color' } })).toBe('ansi256')
    expect(detectColorMode({ browser: true })).toBe('html')
  })

  test('terminal projection carries the graphical palette and names losses', () => {
    const request = resolveRenderRequest(SOURCE, { style: 'hand-drawn' }, 'unicode')
    const terminal = projectTerminalStyle(request, 'none')
    expect(terminal.theme.bg).toBe(request.appearance.colors.bg)
    expect(terminal.semanticFallbacks).toEqual(['labels', 'symbols', 'markers', 'line-patterns'])
    expect(terminal.diagnostics.map(diagnostic => diagnostic.code)).toContain('TERMINAL_STROKE_CHARACTER_PROJECTED')
    const observed: string[] = []
    expect(renderMermaidASCII(SOURCE, { style: 'hand-drawn', colorMode: 'none', onProjectionDiagnostic: d => observed.push(d.code) })).toContain('Start')
    expect(observed).toContain('TERMINAL_STROKE_CHARACTER_PROJECTED')
  })

  test('terminal receipts diagnose rendered treatments, role paints, and explicit elevation', () => {
    const rendered = renderMermaidASCIIWithReceipt(SOURCE, {
      style: 'risograph',
      shadow: true,
      colorMode: 'none',
    })
    const diagnostics = rendered.receipt.diagnostics ?? []
    expect(diagnostics).toContainEqual(
      expect.objectContaining({
        code: 'TERMINAL_FILL_PROJECTED',
        feature: 'fill-treatment',
      }),
    )
    expect(diagnostics).toContainEqual(
      expect.objectContaining({
        code: 'TERMINAL_ROLE_PAINT_PROJECTED',
        feature: 'role-paint',
      }),
    )
    expect(diagnostics).toContainEqual(
      expect.objectContaining({
        code: 'TERMINAL_ELEVATION_PROJECTED',
        feature: 'elevation',
      }),
    )
    expect(rendered.receipt.diagnostics).toEqual(rendered.terminalStyle.diagnostics)
  })

  test('terminal projection diagnoses private role-surface paint without a product Style fixture', () => {
    const request = resolveRenderRequest(SOURCE, {}, 'unicode')
    const fixture = {
      ...request,
      appearance: {
        ...request.appearance,
        face: {
          node: { fillColor: 'var(--surface)' },
          group: { headerFillColor: 'var(--bg)' },
        },
      },
    }
    const diagnostics = projectTerminalStyle(fixture, 'none').diagnostics
    expect(diagnostics).toContainEqual(
      expect.objectContaining({
        code: 'TERMINAL_FILL_PROJECTED',
        feature: 'role-surface-fill',
      }),
    )
    expect(diagnostics).toContainEqual(
      expect.objectContaining({
        code: 'TERMINAL_ELEVATION_PROJECTED',
        feature: 'elevation',
      }),
    )
  })

  test('PNG declares one sRGB policy with cICP precedence and no conflicting ICC chunk', () => {
    const png = renderMermaidPNG(SOURCE, { scale: 0.25, bg: '#123456', security: 'strict' })
    const receipt = inspectPngColorProfile(png)
    expect(receipt.sRGBRenderingIntent).toBe(OUTPUT_COLOR_PROFILE.png.sRGBRenderingIntent)
    expect(receipt.cICP).toEqual([...OUTPUT_COLOR_PROFILE.png.cICP])
    expect(receipt.hasICC).toBe(false)
    expect(receipt.chunks.indexOf('cICP')).toBeLessThan(receipt.chunks.indexOf('IDAT'))
  })

  test('the universal source envelope accepts both compact and spaced accessibility syntax', () => {
    const compact = normalizeMermaidSource('flowchart LR\n  accTitle:Compact title\n  accDescr:Compact description\n  A --> B')
    const spaced = normalizeMermaidSource('flowchart LR\n  accTitle Spaced title\n  accDescr Spaced description\n  A --> B')
    expect(compact.accessibility).toEqual({ title: 'Compact title', descr: 'Compact description' })
    expect(spaced.accessibility).toEqual({ title: 'Spaced title', descr: 'Spaced description' })
  })
})
