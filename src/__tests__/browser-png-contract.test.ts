import { describe, expect, test } from 'bun:test'
import { renderMermaidPNGInBrowserWithReceipt } from '../browser-png.ts'
import { verifyNoExternalRefs } from '../output-security.ts'
import { renderPngGraphicalProjection } from '../png-graphical.ts'

const ONE_PIXEL_PNG = new Uint8Array(Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
))

describe('canonical browser PNG adapter', () => {
  test('gates secured SVG, PNG bytes, receipt identity, diagnostics, and sRGB profile', async () => {
    const artifact = await renderMermaidPNGInBrowserWithReceipt(
      'flowchart LR\n  A --> B',
      { security: 'strict', padding: 19 },
      3,
      async (svg, context) => {
        expect(verifyNoExternalRefs(svg).ok).toBe(true)
        expect(context.receipt.output).toBe('png')
        expect(context.scale).toBe(3)
        return {
          png: ONE_PIXEL_PNG,
          diagnostics: [{ code: 'EDITOR_FONT_FETCH_FAILED', message: 'font unavailable' }],
        }
      },
    )
    expect(artifact.receipt.output).toBe('png')
    expect(artifact.receipt).toEqual(renderPngGraphicalProjection(
      'flowchart LR\n  A --> B',
      { security: 'strict', padding: 19 },
      { scale: 3 },
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
      async () => ({ png: ONE_PIXEL_PNG, fontSources: ['embedded-data-uri'] }),
    )
    expect(embedded.runtime.fontSources).toEqual(['embedded-data-uri'])

    const partial = await renderMermaidPNGInBrowserWithReceipt(
      'flowchart LR\n A --> B',
      {},
      1,
      async () => ({
        png: ONE_PIXEL_PNG,
        fontSources: ['embedded-data-uri', 'unavailable', 'embedded-data-uri'],
      }),
    )
    expect(partial.runtime.fontSources).toEqual(['embedded-data-uri', 'unavailable'])
  })

  test('rejects invalid scales, callback shapes, and non-PNG bytes', async () => {
    await expect(renderMermaidPNGInBrowserWithReceipt('flowchart LR\n A --> B', {}, 0, async () => ({ png: ONE_PIXEL_PNG }))).rejects.toThrow('positive finite')
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
    await expect(renderMermaidPNGInBrowserWithReceipt('flowchart LR\n A --> B', {}, 1, async () => ({ png: ONE_PIXEL_PNG, fontSources: [] }))).rejects.toThrow('non-empty array')
    await expect(renderMermaidPNGInBrowserWithReceipt('flowchart LR\n A --> B', {}, 1, async () => ({ png: ONE_PIXEL_PNG, fontSources: ['caller-directories'] as never }))).rejects.toThrow('invalid font source')
  })
})
