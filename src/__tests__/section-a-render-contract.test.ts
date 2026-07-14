import { describe, expect, test } from 'bun:test'
import {
  ALL_RENDER_FIELDS_ACCOUNTED_FOR,
  CLI_RENDER_FORMATS,
  RENDER_OUTPUT_DESCRIPTORS,
  RENDER_TRANSPORT_SURFACES,
  SHARED_RENDER_OPTION_FIELD_DESCRIPTORS,
  SHARED_RENDER_OPTION_FIELDS,
  receiptOf,
  resolveAppearance,
  resolveRenderRequest,
  resolvedFamilyRenderContextOf,
  resolvedRenderExecutionPlanOf,
  sharedRenderOptionsJsonSchema,
  styleInputJsonSchema,
  type SharedRenderOptionField,
  validateSerializableRenderOptions,
} from '../render-contract.ts'
import { SDK_DECLARATION } from '../mcp/sdk-decl.ts'
import { BUILTIN_FAMILY_METADATA } from '../agent/families.ts'
import { HOSTED_TOOLS } from '../mcp/hosted-server.ts'
import { LOCAL_TOOLS } from '../mcp/server.ts'
import {
  MCP_PNG_RENDER_OPTION_CONVENIENCES,
  MCP_SVG_RENDER_OPTION_CONVENIENCES,
  projectMcpRenderOptions,
} from '../mcp/tool-surface.ts'
import { applyOutputSecurityPolicy, verifyNoExternalRefs } from '../output-security.ts'
import { detectColorMode } from '../ascii/ansi.ts'
import { renderMermaidASCII, renderMermaidASCIIWithReceipt } from '../ascii/index.ts'
import { projectTerminalStyle } from '../terminal-style.ts'
import { renderMermaidPNG } from '../agent/png.ts'
import { inspectPngColorProfile, OUTPUT_COLOR_PROFILE } from '../output-color-profile.ts'
import { normalizeMermaidSource } from '../mermaid-source.ts'
import { renderMermaidSVGWithReceipt } from '../index.ts'
import { DEFAULT_ARCHITECTURE_VISUAL } from '../architecture/config.ts'
import type { RenderOptions } from '../types.ts'
import type { DiagramKind } from '../agent/types.ts'

const SOURCE = 'flowchart LR\n  A[Start] --> B[Finish]'

const EXPECTED_BUILTIN_OPTION_APPLICABILITY = {
  padding: ['flowchart', 'state', 'architecture'],
  nodeSpacing: ['flowchart', 'state', 'class', 'er', 'architecture'],
  layerSpacing: ['flowchart', 'state', 'class', 'er', 'architecture'],
  wrappingWidth: ['flowchart'],
  componentSpacing: [],
  interactive: ['xychart', 'pie', 'quadrant'],
  shadow: [
    'flowchart', 'state', 'sequence', 'timeline', 'class', 'er', 'journey',
    'xychart', 'pie', 'quadrant', 'gantt', 'mindmap', 'gitgraph',
  ],
  class: ['class'],
  architecture: ['architecture'],
  timeline: ['timeline'],
  journey: ['journey'],
  gantt: ['gantt'],
  ganttToday: ['gantt'],
} as const satisfies Partial<Record<SharedRenderOptionField, readonly DiagramKind[]>>

const FAMILY_SCOPED_OPTION_VALUES = {
  padding: 12,
  nodeSpacing: 77,
  layerSpacing: 91,
  wrappingWidth: 120,
  componentSpacing: 66,
  interactive: true,
  shadow: true,
  class: { hierarchicalNamespaces: false },
  architecture: { visual: { groupCornerRadius: 12 } },
  timeline: { maxWidth: 300 },
  journey: { experienceCurve: false },
  gantt: { dependencyArrows: true, criticalPath: true },
  ganttToday: '2026-01-08',
} as const satisfies Record<keyof typeof EXPECTED_BUILTIN_OPTION_APPLICABILITY, unknown>

describe('Section A canonical render contracts', () => {
  test('the manifest accounts for every RenderOptions field and generates the adapter schema', () => {
    expect(ALL_RENDER_FIELDS_ACCOUNTED_FOR).toBe(true)
    const schema = sharedRenderOptionsJsonSchema() as { additionalProperties: boolean; properties: Record<string, unknown> }
    expect(schema.additionalProperties).toBe(false)
    expect(Object.keys(schema.properties)).toEqual(expect.arrayContaining(['style', 'mermaidConfig', 'security', 'idPrefix']))
  })

  test('family-limited options publish one applicability authority and diagnose unsupported built-ins', () => {
    const schema = sharedRenderOptionsJsonSchema() as {
      properties: Record<string, Record<string, unknown>>
    }
    const scopedFields = SHARED_RENDER_OPTION_FIELDS.filter(field =>
      'applicableBuiltinFamilies' in SHARED_RENDER_OPTION_FIELD_DESCRIPTORS[field])
    const expectedFields = Object.keys(EXPECTED_BUILTIN_OPTION_APPLICABILITY) as Array<keyof typeof EXPECTED_BUILTIN_OPTION_APPLICABILITY>
    expect(scopedFields).toEqual(expectedFields)

    for (const field of SHARED_RENDER_OPTION_FIELDS) {
      const descriptor = SHARED_RENDER_OPTION_FIELD_DESCRIPTORS[field]
      if (!('applicableBuiltinFamilies' in descriptor)) {
        expect(schema.properties[field]).not.toHaveProperty('x-agentic-mermaid-applicable-builtin-families')
        continue
      }
      const applicable: readonly DiagramKind[] = descriptor.applicableBuiltinFamilies
      const scopedField = field as keyof typeof EXPECTED_BUILTIN_OPTION_APPLICABILITY
      const expected = EXPECTED_BUILTIN_OPTION_APPLICABILITY[scopedField]
      expect(applicable, field).toEqual(expected)
      expect(Object.isFrozen(applicable), field).toBe(true)
      expect(new Set(applicable).size, field).toBe(applicable.length)
      expect(applicable.every(id => BUILTIN_FAMILY_METADATA.some(family => family.id === id)), field).toBe(true)
      expect(schema.properties[field]?.['x-agentic-mermaid-applicable-builtin-families'], field)
        .toEqual([...applicable])
      const applicability = applicable.length === 0
        ? 'No built-in family currently consumes this option.'
        : `Applicable built-in families: ${applicable.join(', ')}.`

      for (const family of BUILTIN_FAMILY_METADATA) {
        const request = resolveRenderRequest(family.example, {
          [field]: FAMILY_SCOPED_OPTION_VALUES[scopedField],
        } as RenderOptions)
        const diagnostics = (receiptOf(request).diagnostics ?? []).filter(diagnostic =>
          diagnostic.code === 'RENDER_OPTION_NOT_APPLICABLE'
          && diagnostic.feature === `render-option:${field}`)
        if (applicable.includes(family.id)) {
          expect(diagnostics, `${field}/${family.id}`).toEqual([])
          expect(request.resolutionDiagnostics, `${field}/${family.id}`).toBeUndefined()
          continue
        }
        expect(diagnostics, `${field}/${family.id}`).toEqual([{
          code: 'RENDER_OPTION_NOT_APPLICABLE',
          feature: `render-option:${field}`,
          message: `Render option "${field}" does not apply to built-in Mermaid family "${family.id}". ${applicability}`,
        }])
        expect(Object.isFrozen(request.resolutionDiagnostics), `${field}/${family.id}`).toBe(true)
        expect(Object.isFrozen(request.resolutionDiagnostics?.[0]), `${field}/${family.id}`).toBe(true)
      }
    }
  })

  test('idPrefix schema and runtime admission enforce the same SVG-id alphabet', () => {
    const schema = sharedRenderOptionsJsonSchema() as { properties: { idPrefix: { pattern?: string } } }
    expect(schema.properties.idPrefix.pattern).toBe('^[A-Za-z0-9_.:-]*$')
    expect(validateSerializableRenderOptions({ idPrefix: '' })).toEqual([])
    expect(validateSerializableRenderOptions({ idPrefix: 'diagram_1.2:-' })).toEqual([])
    expect(validateSerializableRenderOptions({ idPrefix: 'bad" onload="x-' }))
      .toEqual([expect.stringContaining('ASCII letters, digits, underscore, hyphen, dot, and colon')])
  })

  test('geometry schemas reject impossible shared and architecture metrics at admission', () => {
    for (const options of [
      { padding: -1 },
      { nodeSpacing: -1 },
      { layerSpacing: -1 },
      { componentSpacing: -1 },
      { wrappingWidth: 0 },
      { timeline: { maxWidth: 0 } },
    ]) {
      expect(validateSerializableRenderOptions(options).join(' '), JSON.stringify(options))
        .toMatch(/non-negative|positive|greater than 0/)
    }

    expect(validateSerializableRenderOptions({
      architecture: { visual: { groupHeaderHeight: 28 } },
    })).toEqual([])
    expect(validateSerializableRenderOptions({
      architecture: {
        visual: { serviceCornerRadius: -1 },
      },
    }).join(' ')).toMatch(/at least 0/)
    expect(validateSerializableRenderOptions({
      architecture: {
        visual: { groupFontWeight: 1_001 },
      },
    }).join(' ')).toMatch(/at most 1000/)
    expect(validateSerializableRenderOptions({
      architecture: {
        visual: {
          ...DEFAULT_ARCHITECTURE_VISUAL,
          junctionOuterRadius: 4,
          junctionInnerRadius: 5,
        },
      },
    }).join(' ')).toMatch(/must not exceed junctionOuterRadius/)
  })

  test('output descriptors derive CLI aliases and the Code Mode render declaration', () => {
    expect(CLI_RENDER_FORMATS).toEqual(['svg', 'ascii', 'unicode', 'png', 'json'])
    const html = RENDER_OUTPUT_DESCRIPTORS.find(descriptor => descriptor.id === 'html')!
    const layout = RENDER_OUTPUT_DESCRIPTORS.find(descriptor => descriptor.id === 'layout')!
    expect(html.transports.library).toMatchObject({ availability: 'projected', entrypoint: 'renderMermaidASCII' })
    expect(html.transports.cli).toMatchObject({ availability: 'unavailable', entrypoint: 'none' })
    expect(typeof html.transports.cli.reason).toBe('string')
    expect(html.transports.codeMode).toMatchObject({ availability: 'projected', method: 'renderMermaidASCIIWithReceipt' })
    expect(html.transports.hostedMcp).toMatchObject({ availability: 'indirect', entrypoint: 'execute' })
    expect(html.transports.editor).toMatchObject({ availability: 'unavailable', entrypoint: 'none' })
    expect(html.transports.website).toMatchObject({ availability: 'unavailable', entrypoint: 'none' })
    expect(layout.transports.cli).toMatchObject({ availability: 'direct', format: 'json' })
    expect(layout.transports.codeMode).toMatchObject({ availability: 'direct', method: 'layoutMermaidWithReceipt' })
    expect(layout.transports.localMcp).toMatchObject({ availability: 'indirect', entrypoint: 'execute' })
    expect(RENDER_OUTPUT_DESCRIPTORS.flatMap(descriptor =>
      RENDER_TRANSPORT_SURFACES.map(surface => descriptor.transports[surface]))).toHaveLength(42)
    for (const descriptor of RENDER_OUTPUT_DESCRIPTORS) {
      expect(Object.keys(descriptor.transports)).toEqual([...RENDER_TRANSPORT_SURFACES])
      for (const surface of RENDER_TRANSPORT_SURFACES) {
        const transport = descriptor.transports[surface]
        expect(transport.entrypoint, `${descriptor.id}/${surface} entrypoint`).not.toBe('')
        expect(transport.evidence.length, `${descriptor.id}/${surface} evidence`).toBeGreaterThan(0)
        expect(Object.isFrozen(transport.evidence), `${descriptor.id}/${surface} evidence frozen`).toBe(true)
      }
    }
    expect(SDK_DECLARATION.match(/renderMermaidSVG\(input/g) ?? []).toHaveLength(1)
    expect(SDK_DECLARATION.match(/renderMermaidASCII\(input/g) ?? []).toHaveLength(1)
    expect(SDK_DECLARATION.match(/renderMermaidSVGWithReceipt\(input/g) ?? []).toHaveLength(1)
    expect(SDK_DECLARATION.match(/renderMermaidASCIIWithReceipt\(input/g) ?? []).toHaveLength(1)
    expect(SDK_DECLARATION.match(/layoutMermaidWithReceipt\(input/g) ?? []).toHaveLength(1)
    expect(SDK_DECLARATION).toContain("html: colorMode: 'html' (terminal projection; not a standalone CLI format)")
    for (const field of SHARED_RENDER_OPTION_FIELDS) {
      expect(SDK_DECLARATION).toContain(`  ${field}?:`)
    }
    expect(SDK_DECLARATION).toContain('interface ArchitectureVisualOverrides {')
    expect(SDK_DECLARATION).toContain('  groupHeaderHeight?: number')
    expect(SDK_DECLARATION).toContain('  groupFont?: string')
  })

  test('the Code Mode family roster and adapters project the canonical descriptors', () => {
    const kindDeclaration = /type DiagramKind = ([^\n]+)/.exec(SDK_DECLARATION)?.[1] ?? ''
    const declaredKinds = Array.from(kindDeclaration.matchAll(/'([^']+)'/g), match => match[1])
    expect(declaredKinds).toEqual(BUILTIN_FAMILY_METADATA.map(family => family.id))

    const apiBlock = SDK_DECLARATION.split('declare const mermaid: {')[1]?.split('\n}')[0] ?? ''
    const declaredNarrowers = Array.from(apiBlock.matchAll(/^  (as[A-Z]\w+)\(d: ValidDiagram\):/gm), match => match[1])
    expect(declaredNarrowers).toEqual(BUILTIN_FAMILY_METADATA.map(family => family.narrower))
    for (const family of BUILTIN_FAMILY_METADATA) {
      const stem = family.narrower.slice(2)
      expect(SDK_DECLARATION).toContain(`type ${stem}ValidDiagram = ValidDiagram & { body:`)
      expect(apiBlock).toContain(`mutate(d: ${stem}ValidDiagram, op: ${stem}MutationOp)`)
    }
  })

  test('every direct render tool exposes the canonical shared option schema', () => {
    const expected = [...SHARED_RENDER_OPTION_FIELDS]
    for (const tool of [...HOSTED_TOOLS, ...LOCAL_TOOLS].filter(tool =>
      tool.name === 'render_svg' || tool.name === 'render_ascii' || tool.name === 'render_png')) {
      const properties = tool.inputSchema.properties as Record<string, { properties?: Record<string, unknown> }>
      expect(Object.keys(properties.options?.properties ?? {}), tool.name).toEqual(expected)
    }
  })

  test('MCP convenience style fields project the canonical shared-field schema', () => {
    const withoutDescription = (schema: Record<string, unknown>) => {
      const { description: _description, ...rest } = schema
      return rest
    }
    const sharedProperties = (sharedRenderOptionsJsonSchema() as {
      properties: Record<string, Record<string, unknown>>
    }).properties
    const expected = withoutDescription(sharedProperties.style!)
    expect(styleInputJsonSchema()).toEqual(SHARED_RENDER_OPTION_FIELD_DESCRIPTORS.style.schema)
    for (const tool of [...HOSTED_TOOLS, ...LOCAL_TOOLS].filter(tool =>
      (tool.name === 'render_svg' || tool.name === 'render_png')
      && (tool.inputSchema.properties as Record<string, unknown>)?.style !== undefined)) {
      const properties = tool.inputSchema.properties as Record<string, Record<string, unknown>>
      expect(withoutDescription(properties.style!), tool.name).toEqual(expected)
    }
  })

  test('MCP compatibility conveniences derive schema and precedence from one projection', () => {
    const canonical = (sharedRenderOptionsJsonSchema() as {
      properties: Record<string, Record<string, unknown>>
    }).properties
    const profiles = [
      [HOSTED_TOOLS.find(tool => tool.name === 'render_svg')!, MCP_SVG_RENDER_OPTION_CONVENIENCES],
      [HOSTED_TOOLS.find(tool => tool.name === 'render_png')!, MCP_PNG_RENDER_OPTION_CONVENIENCES],
      [LOCAL_TOOLS.find(tool => tool.name === 'render_png')!, MCP_PNG_RENDER_OPTION_CONVENIENCES],
    ] as const
    for (const [tool, fields] of profiles) {
      const properties = tool.inputSchema.properties as Record<string, Record<string, unknown>>
      for (const field of fields) {
        const withoutDescription = ({ description: _description, ...schema }: Record<string, unknown>) => schema
        expect(withoutDescription(properties[field]!), `${tool.name}.${field}`)
          .toEqual(withoutDescription(canonical[field]!))
      }
    }

    expect(projectMcpRenderOptions({
      options: { bg: '#ffffff', fg: '#111111', seed: 1 },
      bg: '#000000',
      seed: 3,
    }, MCP_SVG_RENDER_OPTION_CONVENIENCES, { fg: '#222222' })).toEqual({
      bg: '#000000',
      fg: '#222222',
      seed: 3,
    })
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

  test('deprecated Style aliases emit one structured, time-bounded receipt diagnostic', () => {
    const { receipt } = renderMermaidSVGWithReceipt(SOURCE, { style: ['tufte', 'tufte'] })
    const diagnostics = receipt.diagnostics ?? []
    expect(diagnostics).toContainEqual({
      code: 'STYLE_ALIAS_DEPRECATED',
      message: 'Style alias "tufte" resolves to "look:tufte"; use "palette:tufte" for the palette-only style.',
      input: 'tufte',
      canonicalId: 'look:tufte',
      removal: { release: '0.3.0', date: '2027-01-31' },
    })
    expect(diagnostics.filter(diagnostic => diagnostic.code === 'STYLE_ALIAS_DEPRECATED')).toHaveLength(1)
    expect(Object.isFrozen(diagnostics)).toBe(true)
    expect(Object.isFrozen(diagnostics.find(diagnostic => diagnostic.code === 'STYLE_ALIAS_DEPRECATED')?.removal)).toBe(true)
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
    const requests = (['svg', 'png', 'unicode', 'layout'] as const)
      .map(output => resolveRenderRequest(source, {}, output))

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
    const options = { mermaidConfig: { themeVariables: { primaryTextColor: 'url(https://evil.invalid/x)' } } }
    const svg = resolveRenderRequest(encoded, options, 'svg')
    const layout = resolveRenderRequest(encoded, options, 'layout')
    const terminal = resolveRenderRequest(encoded, options, 'unicode')
    expect(svg.source.text).toContain('Tom & Jerry')
    expect(svg.source.originalText).toBe(encoded)
    expect(svg.sharedRequestDigest).toBe(layout.sharedRequestDigest)
    expect(svg.sharedRequestDigest).toBe(terminal.sharedRequestDigest)
    expect(svg.appearance.digest).toBe(terminal.appearance.digest)
    expect(svg.appearance.colors.fg).not.toContain('url(')
    const raw = resolveRenderRequest(encoded.replace('&amp;', '&'), options, 'svg')
    expect(raw.source.text).toBe(svg.source.text)
    expect(raw.source.originalText).not.toBe(svg.source.originalText)
    expect(raw.sharedRequestDigest).not.toBe(svg.sharedRequestDigest)
  })

  test('advanced adapters reject null, functions, prototype keys, and unknown fields', () => {
    expect(validateSerializableRenderOptions({ style: null })).toContain('render option "style" must be omitted instead of null')
    expect(validateSerializableRenderOptions({ nope: true })).toContain('unknown render option "nope"')
    expect(validateSerializableRenderOptions({ mermaidConfig: { value: () => 1 } }).length).toBeGreaterThan(0)
    const hostile = JSON.parse('{"mermaidConfig":{"__proto__":{"polluted":true}}}')
    expect(validateSerializableRenderOptions(hostile).length).toBeGreaterThan(0)
    expect(validateSerializableRenderOptions({ backendPolicy: { selected: 'backend:probe' } }))
      .toContain('unknown render option "backendPolicy"')
    expect(SDK_DECLARATION).not.toContain('backendPolicy')
    for (const tool of [...HOSTED_TOOLS, ...LOCAL_TOOLS]) {
      expect(JSON.stringify(tool.inputSchema), tool.name).not.toContain('backendPolicy')
    }
  })

  test('output security rejects active content in every mode and strict rejects external references', () => {
    const unsafe = '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script><image href="https://evil.invalid/x"/><rect onclick="x()" style="fill:url(javascript:boom)"/></svg>'
    expect(() => applyOutputSecurityPolicy(unsafe, 'default')).toThrow('rejected active content')
    expect(() => applyOutputSecurityPolicy(unsafe, 'strict')).toThrow('rejected active content')
    expect(() => applyOutputSecurityPolicy('<svg xmlns="http://www.w3.org/2000/svg"><image href="https://evil.invalid/x"/></svg>', 'strict'))
      .toThrow('strict verification failed')
    expect(() => applyOutputSecurityPolicy('<svg><g></svg>', 'strict'))
      .toThrow('invalid SVG document envelope')
    expect(() => applyOutputSecurityPolicy(
      '<svg xmlns="http://www.w3.org/2000/svg"><script><script>x</script></script><rect/></svg>',
      'strict',
    ))
      .toThrow('rejected active content')
  })

  test('output-security decisions remain visible in the artifact receipt', () => {
    const defaultArtifact = renderMermaidSVGWithReceipt(SOURCE)
    expect(defaultArtifact.receipt.diagnostics).toContainEqual(expect.objectContaining({ code: 'EXTERNAL_REFERENCE' }))
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
      style: 'risograph', shadow: true, colorMode: 'none',
    })
    const diagnostics = rendered.receipt.diagnostics ?? []
    expect(diagnostics).toContainEqual(expect.objectContaining({
      code: 'TERMINAL_FILL_PROJECTED', feature: 'fill-treatment',
    }))
    expect(diagnostics).toContainEqual(expect.objectContaining({
      code: 'TERMINAL_ROLE_PAINT_PROJECTED', feature: 'role-paint',
    }))
    expect(diagnostics).toContainEqual(expect.objectContaining({
      code: 'TERMINAL_ELEVATION_PROJECTED', feature: 'elevation',
    }))
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
    expect(diagnostics).toContainEqual(expect.objectContaining({
      code: 'TERMINAL_FILL_PROJECTED', feature: 'role-surface-fill',
    }))
    expect(diagnostics).toContainEqual(expect.objectContaining({
      code: 'TERMINAL_ELEVATION_PROJECTED', feature: 'elevation',
    }))
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
