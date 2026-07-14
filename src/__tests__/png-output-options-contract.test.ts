import { describe, expect, test } from 'bun:test'

import { renderMermaidPNGWithReceipt } from '../agent/png.ts'
import {
  canonicalizeConcreteCssColor,
  MAX_PNG_FONT_DIRECTORIES,
  NATIVE_PNG_HOST_ONLY_OPTION_FIELDS,
  NATIVE_PNG_OUTPUT_POLICY_FIELDS,
  PNG_ARTIFACT_BACKGROUND_UNRESOLVED,
  PNG_DEFAULT_SCALE,
  PNG_OUTPUT_POLICY_VERSION,
  PNG_OUTPUT_OPTION_FIELDS,
  PNG_OUTPUT_OPTION_FIELD_DESCRIPTORS,
  PORTABLE_PNG_OUTPUT_OPTION_FIELDS,
  normalizePortablePngBackground,
  omitPngOutputOptions,
  pngOutputOptionsJsonSchema,
  projectNativePngOutputPolicyInput,
  projectPortablePngOutputOptions,
  resolvePngOutputPolicy,
  resolvePortablePngOutputPolicy,
  assertHostedPngRasterBudget,
  assertPngRasterBudget,
  svgIntrinsicDimensions,
} from '../png-contract.ts'
import { renderPngGraphicalProjection, renderPortablePngGraphicalProjection } from '../png-graphical.ts'
import { decodePng } from './helpers/png-pixels.ts'
import { createRenderPngTool, validateMcpToolArguments } from '../mcp/tool-surface.ts'
import { PNG_CLI_FLAG_BINDINGS } from '../cli/index.ts'

const SOURCE = 'flowchart LR\n  A[Start] --> B[Finish]'

describe('canonical PNG output-option authority', () => {
  test('projects exact portable, native-policy, and native-host field sets', () => {
    expect(PNG_OUTPUT_OPTION_FIELDS).toEqual([
      'scale', 'background', 'fitTo', 'fontDirs', 'loadSystemFonts', 'onWarning',
    ])
    expect(PORTABLE_PNG_OUTPUT_OPTION_FIELDS).toEqual(['scale', 'background', 'fitTo'])
    expect(NATIVE_PNG_OUTPUT_POLICY_FIELDS).toEqual([
      'scale', 'background', 'fitTo', 'fontDirs', 'loadSystemFonts',
    ])
    expect(NATIVE_PNG_HOST_ONLY_OPTION_FIELDS).toEqual(['fontDirs', 'loadSystemFonts', 'onWarning'])
    expect(Object.isFrozen(PNG_OUTPUT_OPTION_FIELD_DESCRIPTORS)).toBe(true)
    expect(PNG_OUTPUT_OPTION_FIELD_DESCRIPTORS.onWarning).toMatchObject({
      scope: 'native-host-only',
      input: 'callback',
      policy: 'excluded',
      receipt: 'excluded',
    })

    const portable = pngOutputOptionsJsonSchema('portable') as {
      additionalProperties: boolean
      properties: Record<string, unknown>
    }
    const native = pngOutputOptionsJsonSchema('native') as {
      additionalProperties: boolean
      properties: Record<string, unknown>
    }
    expect(portable.additionalProperties).toBe(false)
    expect((portable as Record<string, unknown>).$id).toContain(`v${PNG_OUTPUT_POLICY_VERSION}-portable`)
    expect(Object.keys(portable.properties)).toEqual([...PORTABLE_PNG_OUTPUT_OPTION_FIELDS])
    expect(native.additionalProperties).toBe(false)
    expect(Object.keys(native.properties)).toEqual([...NATIVE_PNG_OUTPUT_POLICY_FIELDS])
    expect(native.properties).not.toHaveProperty('onWarning')
    expect(portable.properties.fitTo).toMatchObject({
      type: 'object',
      additionalProperties: false,
      oneOf: [{ required: ['width'] }, { required: ['height'] }],
    })
    expect(portable.properties.fitTo).toHaveProperty('properties.width.type', 'integer')
    expect(portable.properties.background).toHaveProperty('x-agentic-mermaid-runtime-validator', 'portablePngBackground')
  })

  test('admits only closed plain objects with substrate-appropriate fields', () => {
    const invalidRoots: unknown[] = [null, [], 'png', 1, Object.create({ inherited: true })]
    for (const input of invalidRoots) {
      expect(() => resolvePngOutputPolicy(input as never)).toThrow('plain object')
      expect(() => resolvePortablePngOutputPolicy(input as never)).toThrow('plain object')
    }

    for (const input of [
      { surprise: true },
      { onWarning: () => {} },
      { fitTo: [] },
      { fitTo: {} },
      { fitTo: { width: 10, height: 20 } },
      { fitTo: { width: 10, surprise: true } },
      { fitTo: { width: '10' } },
      { fitTo: { width: 10.5 } },
      { background: 42 },
      { scale: '2' },
      { fontDirs: 'fonts' },
      { fontDirs: [''] },
      { fontDirs: Array(MAX_PNG_FONT_DIRECTORIES + 1).fill('/tmp/fonts') },
      { loadSystemFonts: 'yes' },
    ]) {
      expect(() => resolvePngOutputPolicy(input as never), JSON.stringify(input)).toThrow()
    }

    const sparse: string[] = []
    sparse.length = 1
    expect(() => resolvePngOutputPolicy({ fontDirs: sparse })).toThrow(/dense array/)

    for (const hostOnly of [
      { fontDirs: ['/tmp/fonts'] },
      { loadSystemFonts: true },
      { onWarning: () => {} },
    ]) {
      expect(() => resolvePortablePngOutputPolicy(hostOnly as never)).toThrow('unknown option')
    }

    const native = resolvePngOutputPolicy({
      scale: 1.5,
      background: '#123456',
      fitTo: { height: 72 },
      fontDirs: ['/tmp/fonts'],
      loadSystemFonts: true,
    })
    expect(native).toMatchObject({
      scale: PNG_DEFAULT_SCALE,
      background: { mode: 'explicit', value: '#123456' },
      fitTo: { mode: 'height', value: 72 },
      fonts: { callerDirectories: ['/tmp/fonts'], loadSystemFonts: true },
    })
    expect(Object.isFrozen(native.fonts.callerDirectories)).toBe(true)
  })

  test('projects the canonical substrate schemas into both MCP surfaces', () => {
    for (const [mode, substrate, fields] of [
      ['hosted', 'portable', PORTABLE_PNG_OUTPUT_OPTION_FIELDS],
      ['local', 'native', NATIVE_PNG_OUTPUT_POLICY_FIELDS],
    ] as const) {
      const tool = createRenderPngTool(mode)
      const properties = tool.inputSchema.properties as Record<string, Record<string, unknown>>
      const actual = Object.fromEntries(fields.map(field => {
        return [field, { ...properties[field] }]
      }))
      const expected = (pngOutputOptionsJsonSchema(substrate).properties ?? {}) as Record<string, Record<string, unknown>>
      expect(actual).toEqual(expected)
      expect(properties).not.toHaveProperty('onWarning')
    }
  })

  test('accounts for every canonical PNG option in the CLI projection', () => {
    expect(Object.keys(PNG_CLI_FLAG_BINDINGS)).toEqual([...PNG_OUTPUT_OPTION_FIELDS])
    expect(PNG_CLI_FLAG_BINDINGS).toEqual({
      scale: ['scale'],
      background: ['bg'],
      fitTo: ['fit-width', 'fit-height'],
      fontDirs: ['font-dirs'],
      loadSystemFonts: ['system-fonts'],
      onWarning: [],
    })
  })

  test('MCP admission enforces the canonical fit and native-font shapes', () => {
    const hosted = createRenderPngTool('hosted')
    const local = createRenderPngTool('local')
    expect(validateMcpToolArguments(hosted, { source: SOURCE, fitTo: {} }).join(' ')).toMatch(/exactly one/)
    expect(validateMcpToolArguments(hosted, {
      source: SOURCE,
      fitTo: { width: 100, height: 100 },
    }).join(' ')).toMatch(/exactly one/)
    expect(validateMcpToolArguments(hosted, { source: SOURCE, fitTo: { width: 100 } })).toEqual([])
    expect(validateMcpToolArguments(hosted, { source: SOURCE, fitTo: { width: 100.5 } }).join(' ')).toMatch(/integer/)
    expect(validateMcpToolArguments(hosted, { source: SOURCE, background: 'oklch(50% 0.2 30)' }).join(' ')).toMatch(/portable basic color/)
    expect(validateMcpToolArguments(hosted, { source: SOURCE, background: '#AbC' })).toEqual([])
    expect(validateMcpToolArguments(local, { source: SOURCE, fontDirs: ['   '] }).join(' ')).toMatch(/must match/)
    expect(validateMcpToolArguments(local, { source: SOURCE, fontDirs: ['/tmp/fonts'] })).toEqual([])
  })

  test('normalizes the closed portable background intersection and descriptor projections', () => {
    expect(normalizePortablePngBackground('#AbC')).toBe('#aabbcc')
    expect(normalizePortablePngBackground('#abcd')).toBe('#aabbccdd')
    expect(normalizePortablePngBackground('WHITE')).toBe('#ffffff')
    expect(normalizePortablePngBackground('transparent')).toBe('#00000000')
    expect(normalizePortablePngBackground('rebeccapurple')).toBeUndefined()
    expect(normalizePortablePngBackground('rgb(1 2 3)')).toBeUndefined()
    expect(canonicalizeConcreteCssColor('rgb(255 0 0)')).toBe('#ff0000')
    expect(canonicalizeConcreteCssColor('rgba(255, 0, 0, 0.5)')).toBe('#ff000080')
    expect(canonicalizeConcreteCssColor('hsl(0 100% 50%)')).toBe('#ff0000')
    expect(canonicalizeConcreteCssColor('transparent')).toBe('#00000000')
    expect(canonicalizeConcreteCssColor('var(--brand-bg)')).toBeUndefined()
    expect(canonicalizeConcreteCssColor('color-mix(in srgb, #f00 50%, #00f)')).toBeUndefined()

    const combined = {
      scale: 3,
      background: '#ABC',
      fitTo: { width: 64 },
      fontDirs: ['/tmp/fonts'],
      loadSystemFonts: true,
      onWarning: () => {},
      style: 'crisp',
    }
    expect(projectPortablePngOutputOptions(combined)).toEqual({
      scale: 3,
      background: '#ABC',
      fitTo: { width: 64 },
    })
    expect(projectNativePngOutputPolicyInput(combined)).toEqual({
      scale: 3,
      background: '#ABC',
      fitTo: { width: 64 },
      fontDirs: ['/tmp/fonts'],
      loadSystemFonts: true,
    })
    expect(omitPngOutputOptions(combined)).toEqual({ style: 'crisp' })

    const fitted = resolvePortablePngOutputPolicy({ scale: 9, fitTo: { width: 64 } })
    expect(fitted.scale).toBe(PNG_DEFAULT_SCALE)
    expect(fitted.fitTo).toEqual({ mode: 'width', value: 64 })
  })

  test('native rasterization applies width, height, and explicit background', () => {
    const width = decodePng(renderMermaidPNGWithReceipt(SOURCE, {
      fitTo: { width: 96 },
      background: '#123456',
      onWarning: () => {},
    }).png)
    const height = decodePng(renderMermaidPNGWithReceipt(SOURCE, {
      fitTo: { height: 72 },
      background: '#654321',
      onWarning: () => {},
    }).png)

    expect(width.width).toBe(96)
    expect([...width.rgba.slice(0, 4)]).toEqual([0x12, 0x34, 0x56, 0xff])
    expect(height.height).toBe(72)
    expect([...height.rgba.slice(0, 4)]).toEqual([0x65, 0x43, 0x21, 0xff])

    const onePixelWide = decodePng(renderMermaidPNGWithReceipt(SOURCE, {
      fitTo: { width: 1 },
      onWarning: () => {},
    }).png)
    expect(onePixelWide.width).toBe(1)
    expect(onePixelWide.height).toBeGreaterThanOrEqual(1)
  })

  test('all graphical PNG substrates share a concrete artifact background and receipt identity', () => {
    const options = { bg: 'hsl(0 100% 50%)', security: 'strict' } as const
    const native = renderPngGraphicalProjection(SOURCE, options, { scale: 0.1 })
    const portable = renderPortablePngGraphicalProjection(SOURCE, options, { scale: 0.1 })

    expect(native.rasterBackground).toBe('#ff0000')
    expect(portable.rasterBackground).toBe(native.rasterBackground)
    expect(portable.receipt).toEqual(native.receipt)
  })

  test('native rasterization paints valid rgb() artifact backgrounds and rejects unresolved paints', () => {
    const red = decodePng(renderMermaidPNGWithReceipt(SOURCE, {
      bg: 'rgb(255 0 0)',
      scale: 0.1,
      onWarning: () => {},
    }).png)
    expect([...red.rgba.slice(0, 4)]).toEqual([0xff, 0x00, 0x00, 0xff])

    for (const paint of ['var(--brand-bg)', 'color-mix(in srgb, #f00 50%, #00f)']) {
      let unresolved: unknown
      try {
        renderMermaidPNGWithReceipt(SOURCE, {
          bg: paint,
          scale: 0.1,
          onWarning: () => {},
        })
      } catch (error) {
        unresolved = error
      }
      expect(unresolved).toMatchObject({ code: PNG_ARTIFACT_BACKGROUND_UNRESOLVED, paint })
      expect(String(unresolved)).toContain(PNG_ARTIFACT_BACKGROUND_UNRESOLVED)
    }

    const transparent = decodePng(renderMermaidPNGWithReceipt(SOURCE, {
      bg: 'var(--brand-bg)',
      background: 'transparent',
      scale: 0.1,
      onWarning: () => {},
    }).png)
    expect([...transparent.rgba.slice(0, 4)]).toEqual([0, 0, 0, 0])
  })

  test('responsive SVG roots use their finite viewBox as the raster intrinsic size', () => {
    const responsive = '<svg viewBox="0 0 700 500" width="100%" height="100%"></svg>'
    expect(svgIntrinsicDimensions(responsive)).toEqual({ width: 700, height: 500 })
    for (const ambiguous of [
      '<svg viewBox="0 0 700 500" width="50%" height="50%"></svg>',
      '<svg viewBox="0 0 700 500" width="100%" height="500"></svg>',
    ]) {
      expect(() => svgIntrinsicDimensions(ambiguous)).toThrow(/absolute pixel length/)
    }
  })

  test('native rasterization rejects an extreme finite scale before allocation', () => {
    expect(() => renderMermaidPNGWithReceipt(SOURCE, {
      scale: 1e308,
      onWarning: () => {},
    })).toThrow(/budget/)
    expect(() => renderMermaidPNGWithReceipt(SOURCE, {
      onWarning: 'ignore' as never,
    })).toThrow('onWarning must be a function')
  })

  test('raster budget helpers reject malformed direct-call inputs with controlled errors', () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 10 10"></svg>'
    for (const output of [null, {}, { scale: 1, fitTo: null }, { scale: Number.NaN, fitTo: { mode: 'zoom', value: 1 } }]) {
      expect(() => assertPngRasterBudget(svg, output as never)).toThrow(RangeError)
    }
    expect(() => assertPngRasterBudget(null as never, 1)).toThrow('SVG input must be a string')
    expect(() => assertHostedPngRasterBudget(null as never)).toThrow(RangeError)
    expect(() => assertHostedPngRasterBudget({ width: 1, height: 1, pixels: 2 })).toThrow(RangeError)
  })
})
