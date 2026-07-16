import { describe, expect, test } from 'bun:test'
import { renderMermaidPNGInBrowserWithReceipt } from '../browser-png.ts'
import { createMermaidBrowserPNGRenderer } from '../browser-png.ts'
import { verifyNoExternalRefs } from '../output-security.ts'
import { PNG_ARTIFACT_BACKGROUND_UNRESOLVED } from '../png-contract.ts'
import { renderPngGraphicalProjection } from '../png-graphical.ts'
import { DefaultBackend, registerBackend } from '../scene/backend.ts'
import { pngFixture } from './helpers/png-fixture.ts'

const ONE_PIXEL_PNG = pngFixture(1, 1)

describe('canonical browser PNG adapter', () => {
  test('gates secured SVG, PNG bytes, receipt identity, diagnostics, and sRGB profile', async () => {
    const artifact = await renderMermaidPNGInBrowserWithReceipt(
      'flowchart LR\n  A --> B',
      { security: 'strict', padding: 19 },
      { scale: 3, background: '#fefefe', fitTo: { width: 640 } },
      async (svg, context) => {
        expect(verifyNoExternalRefs(svg).ok).toBe(true)
        expect(context.receipt.output).toBe('png')
        expect(context.outputPolicy).toMatchObject({
          scale: 2,
          background: { mode: 'explicit', value: '#fefefe' },
          fitTo: { mode: 'width', value: 640 },
        })
        expect(context.rasterDimensions.width).toBe(640)
        expect(context.rasterBackground).toBe('#fefefe')
        expect(svg).toContain('width="640"')
        expect(svg).toContain(`height="${context.rasterDimensions.height}"`)
        expect(svg).toContain('width:640px!important')
        return {
          png: pngFixture(context.rasterDimensions.width, context.rasterDimensions.height),
          diagnostics: [{ code: 'EDITOR_FONT_FETCH_FAILED', message: 'font unavailable' }],
        }
      },
    )
    expect(artifact.receipt.output).toBe('png')
    expect(artifact.receipt).toEqual(renderPngGraphicalProjection(
      'flowchart LR\n  A --> B',
      { security: 'strict', padding: 19 },
      { scale: 3, background: '#fefefe', fitTo: { width: 640 } },
    ).receipt)
    expect(artifact.diagnostics).toEqual([{ code: 'EDITOR_FONT_FETCH_FAILED', message: 'font unavailable' }])
    expect(artifact.colorProfile.profile).toBe('srgb')
    expect(artifact.colorProfile.cICP).toEqual([1, 13, 0, 1])
    expect(artifact.colorProfile.hasICC).toBe(false)
    expect(artifact.runtime).toEqual({
      engine: 'canvas',
      binding: 'browser',
      fontSources: ['unavailable'],
      reproducibility: 'host-dependent',
    })
  })

  test('records only font inputs explicitly reported by the browser host', async () => {
    const embedded = await renderMermaidPNGInBrowserWithReceipt(
      'flowchart LR\n A --> B',
      {},
      1,
      async (_svg, context) => ({
        png: pngFixture(context.rasterDimensions.width, context.rasterDimensions.height),
        fontSources: ['embedded-data-uri'],
      }),
    )
    expect(embedded.runtime.fontSources).toEqual(['embedded-data-uri'])

    const partial = await renderMermaidPNGInBrowserWithReceipt(
      'flowchart LR\n A --> B',
      {},
      1,
      async (_svg, context) => ({
        png: pngFixture(context.rasterDimensions.width, context.rasterDimensions.height),
        fontSources: ['embedded-data-uri', 'unavailable', 'embedded-data-uri'],
      }),
    )
    expect(partial.runtime.fontSources).toEqual(['embedded-data-uri', 'unavailable'])
  })

  test('resolves nested custom-property font fallbacks only in raster CSS', async () => {
    const authored = 'var(--font, Courier)'
    await renderMermaidPNGInBrowserWithReceipt(
      `flowchart LR\n A["${authored}"] --> B`,
      { font: 'var(--brand-font, Courier)' },
      { scale: 0.1 },
      async (svg, context) => {
        expect(svg).toContain('font-family: Courier')
        expect(svg).toContain(`>${authored}</text>`)
        return { png: pngFixture(context.rasterDimensions.width, context.rasterDimensions.height) }
      },
    )
  })

  test('accepts the numeric scale overload and passes height/background policy intact', async () => {
    const policies: unknown[] = []
    await renderMermaidPNGInBrowserWithReceipt(
      'flowchart LR\n A --> B', {}, 1.25,
      async (_svg, context) => {
        policies.push(context.outputPolicy)
        return { png: pngFixture(context.rasterDimensions.width, context.rasterDimensions.height) }
      },
    )
    await renderMermaidPNGInBrowserWithReceipt(
      'flowchart LR\n A --> B', {}, { scale: 3, fitTo: { height: 72 }, background: '#123456' },
      async (_svg, context) => {
        policies.push(context.outputPolicy)
        return { png: pngFixture(context.rasterDimensions.width, context.rasterDimensions.height) }
      },
    )
    expect(policies).toEqual([
      expect.objectContaining({ scale: 1.25, fitTo: { mode: 'zoom', value: 1.25 } }),
      expect.objectContaining({
        scale: 2,
        fitTo: { mode: 'height', value: 72 },
        background: { mode: 'explicit', value: '#123456' },
      }),
    ])
  })

  test('receives the shared concrete artifact background and rejects unresolved paint before rasterization', async () => {
    const backgrounds: string[] = []
    await renderMermaidPNGInBrowserWithReceipt(
      'flowchart LR\n A --> B',
      { bg: 'rgb(255 0 0)' },
      { scale: 0.1 },
      async (_svg, context) => {
        backgrounds.push(context.rasterBackground)
        return { png: pngFixture(context.rasterDimensions.width, context.rasterDimensions.height) }
      },
    )
    expect(backgrounds).toEqual(['#ff0000'])

    let rasterCalls = 0
    let unresolved: unknown
    try {
      await renderMermaidPNGInBrowserWithReceipt(
        'flowchart LR\n A --> B',
        { bg: 'var(--brand-bg)' },
        { scale: 0.1 },
        async (_svg, context) => {
          rasterCalls++
          return { png: pngFixture(context.rasterDimensions.width, context.rasterDimensions.height) }
        },
      )
    } catch (error) {
      unresolved = error
    }
    expect(unresolved).toMatchObject({
      code: PNG_ARTIFACT_BACKGROUND_UNRESOLVED,
      paint: 'var(--brand-bg)',
    })
    expect(rasterCalls).toBe(0)
  })

  test('forces offline security before invoking a rasterizer even when a backend is conditionally unsafe', async () => {
    const id = 'backend:test/conditional-external-image'
    const triggerSeed = 991_337
    const unregister = registerBackend({
      ...DefaultBackend,
      id,
      capabilities: DefaultBackend.capabilities.map(claim => ({ ...claim, target: id })),
      render(document, context) {
        const svg = DefaultBackend.render(document, context)
        return context.seed === triggerSeed
          ? svg.replace('</svg>', '<image href="https://example.invalid/tracker.png"/></svg>')
          : svg
      },
    }, {
      compatibility: { core: '^0.1.1', scene: '^2.0.0' },
      provenance: { owner: 'browser-png-contract-test', source: 'test' },
    })
    let rasterCalls = 0
    try {
      const renderer = createMermaidBrowserPNGRenderer({
        backendPolicy: { selectBackend: () => id },
        async rasterize(_svg, context) {
          rasterCalls++
          return { png: pngFixture(context.rasterDimensions.width, context.rasterDimensions.height) }
        },
      })
      await expect(renderer.renderMermaidPNG(
        'flowchart LR\n A --> B',
        { style: 'hand-drawn', seed: triggerSeed, security: 'default' },
        { scale: 0.1 },
      )).rejects.toThrow(/strict verification failed/i)
      expect(rasterCalls).toBe(0)
    } finally {
      unregister()
    }
  })

  test('keeps quoted greater-than root attributes intact through accessibility and PNG sizing', async () => {
    const id = 'backend:test/quoted-root-attribute'
    const unregister = registerBackend({
      ...DefaultBackend,
      id,
      capabilities: DefaultBackend.capabilities.map(claim => ({ ...claim, target: id })),
      render(document, context) {
        return DefaultBackend.render(document, context)
          .replace('<svg ', '<svg data-comparison="1 > 0" ')
      },
    }, {
      compatibility: { core: '^0.1.1', scene: '^2.0.0' },
      provenance: { owner: 'browser-png-contract-test', source: 'test' },
    })
    try {
      const renderer = createMermaidBrowserPNGRenderer({
        backendPolicy: { selectBackend: () => id },
        async rasterize(svg, context) {
          expect(svg).toContain('data-comparison="1 > 0"')
          expect(svg).toContain('aria-labelledby="svg-title"')
          expect(svg).toContain('<title id="svg-title">Quoted root</title>')
          expect(svg).toContain(`width="${context.rasterDimensions.width}"`)
          expect(svg).toContain(`height="${context.rasterDimensions.height}"`)
          return { png: pngFixture(context.rasterDimensions.width, context.rasterDimensions.height) }
        },
      })
      await renderer.renderMermaidPNG(
        'flowchart LR\n accTitle: Quoted root\n accDescr: Root scanner stays quote-aware\n A --> B',
        { style: 'hand-drawn' },
        { scale: 0.1 },
      )
    } finally {
      unregister()
    }
  })

  test('rejects invalid scales, callback shapes, and non-PNG bytes', async () => {
    await expect(renderMermaidPNGInBrowserWithReceipt('flowchart LR\n A --> B', {}, 0, async () => ({ png: ONE_PIXEL_PNG }))).rejects.toThrow('positive finite')
    await expect(renderMermaidPNGInBrowserWithReceipt('flowchart LR\n A --> B', {}, { fitTo: { width: 1, height: 1 } } as never, async () => ({ png: ONE_PIXEL_PNG }))).rejects.toThrow('width or height')
    for (const invalid of [
      null,
      [],
      { surprise: true },
      { fontDirs: ['/tmp/fonts'] },
      { loadSystemFonts: true },
      { fitTo: [] },
      { fitTo: {} },
      { fitTo: { width: 10, surprise: true } },
    ]) {
      await expect(renderMermaidPNGInBrowserWithReceipt(
        'flowchart LR\n A --> B', {}, invalid as never, async () => ({ png: ONE_PIXEL_PNG }),
      )).rejects.toThrow()
    }
    let oversizedRasterCalls = 0
    await expect(renderMermaidPNGInBrowserWithReceipt(
      'flowchart LR\n A --> B', {}, 1e308, async () => {
        oversizedRasterCalls++
        return { png: ONE_PIXEL_PNG }
      },
    )).rejects.toThrow(/budget/)
    expect(oversizedRasterCalls).toBe(0)
    await expect(renderMermaidPNGInBrowserWithReceipt(
      'flowchart LR\n A --> B', {}, 0.01,
      async () => ({ png: new Uint8Array(2_000_000) }),
    )).rejects.toThrow(/allocation-derived limit/)
    let pngGetterReads = 0
    const accessorArtifact = await renderMermaidPNGInBrowserWithReceipt(
      'flowchart LR\n A --> B', {}, 0.01,
      async (_svg, context) => {
        const bounded = pngFixture(context.rasterDimensions.width, context.rasterDimensions.height)
        const result: Record<string, unknown> = {}
        Object.defineProperty(result, 'png', {
          enumerable: true,
          get() {
            pngGetterReads++
            // Before the result snapshot, the third read reached PNG parsing
            // without passing the allocation-derived pre-parser budget.
            return pngGetterReads < 3 ? bounded : new Uint8Array(2_000_000)
          },
        })
        return result as unknown as { png: Uint8Array }
      },
    )
    expect(pngGetterReads).toBe(1)
    expect(accessorArtifact.png.byteLength).toBeGreaterThan(0)
    let parserReached = false
    class LyingOversizedPng extends Uint8Array {
      override get byteLength(): number { return 0 }
      override get length(): number {
        parserReached = true
        throw new Error('PNG parser reached oversized callback bytes')
      }
    }
    await expect(renderMermaidPNGInBrowserWithReceipt(
      'flowchart LR\n A --> B', {}, 0.01,
      async () => ({ png: new LyingOversizedPng(2_000_000) }),
    )).rejects.toThrow(/allocation-derived limit/)
    expect(parserReached).toBe(false)
    await expect(renderMermaidPNGInBrowserWithReceipt('flowchart LR\n A --> B', {}, 1, async () => ({ png: 'not bytes' as never }))).rejects.toThrow('Uint8Array')
    await expect(renderMermaidPNGInBrowserWithReceipt('flowchart LR\n A --> B', {}, 1, async () => ({ png: new Uint8Array([1, 2, 3]) }))).rejects.toThrow('Expected a PNG')
    const signatureAndFakeIhdr = new Uint8Array([
      137, 80, 78, 71, 13, 10, 26, 10,
      0, 0, 0, 0, 73, 72, 68, 82, 169, 115, 208, 15,
    ])
    await expect(renderMermaidPNGInBrowserWithReceipt('flowchart LR\n A --> B', {}, 1, async () => ({ png: signatureAndFakeIhdr }))).rejects.toThrow()
    const truncated = ONE_PIXEL_PNG.slice(0, ONE_PIXEL_PNG.length - 12)
    await expect(renderMermaidPNGInBrowserWithReceipt('flowchart LR\n A --> B', {}, 1, async () => ({ png: truncated }))).rejects.toThrow('IEND')
    const badCrc = ONE_PIXEL_PNG.slice()
    badCrc[badCrc.length - 1] = badCrc[badCrc.length - 1]! ^ 0xff
    await expect(renderMermaidPNGInBrowserWithReceipt('flowchart LR\n A --> B', {}, 1, async () => ({ png: badCrc }))).rejects.toThrow('CRC')
    await expect(renderMermaidPNGInBrowserWithReceipt('flowchart LR\n A --> B', {}, 1, async (_svg, context) => ({ png: pngFixture(context.rasterDimensions.width, context.rasterDimensions.height), fontSources: [] }))).rejects.toThrow('non-empty array')
    await expect(renderMermaidPNGInBrowserWithReceipt('flowchart LR\n A --> B', {}, 1, async (_svg, context) => ({ png: pngFixture(context.rasterDimensions.width, context.rasterDimensions.height), fontSources: ['caller-directories'] as never }))).rejects.toThrow('invalid font source')
  })

  test('rejects a browser rasterizer whose IHDR dimensions differ from the approved allocation', async () => {
    await expect(renderMermaidPNGInBrowserWithReceipt(
      'flowchart LR\n A --> B',
      {},
      { fitTo: { width: 64 } },
      async () => ({ png: ONE_PIXEL_PNG }),
    )).rejects.toThrow(/returned 1×1; expected 64×/)
  })
})
