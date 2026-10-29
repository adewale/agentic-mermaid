import { KNOWN_EXTENSION_CONTRACT_VERSIONS } from '../shared/extension-identity.ts'
// Loop 8 P: PNG export — basic validity tests.

import { describe, test, expect } from 'bun:test'
import { createMermaidPNGRenderer, renderMermaidPNG } from '../agent/png.ts'
import { DefaultBackend, registerBackend } from '../scene/backend.ts'
import { decodePng } from './helpers/png-pixels.ts'
import { colorPixelBoxInRaster, redPixel } from './helpers/raster.ts'

const PNG_MAGIC = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]

function checkMagic(png: Uint8Array): boolean {
  return PNG_MAGIC.every((b, i) => png[i] === b)
}

/** Read big-endian uint32 from PNG IHDR (bytes 16..20 = width, 20..24 = height). */
function readPngDimensions(png: Uint8Array): { width: number; height: number } {
  const dv = new DataView(png.buffer, png.byteOffset, png.byteLength)
  return { width: dv.getUint32(16), height: dv.getUint32(20) }
}

describe('renderMermaidPNG', () => {
  test('checks font-projected raster input before native PNG rendering', () => {
    const id = 'backend:test/native-png-font-joining'
    const triggerSeed = 991_339
    const unregister = registerBackend({
      ...DefaultBackend,
      id,
      capabilities: DefaultBackend.capabilities.map(claim => ({ ...claim, target: id })),
      render(document, context) {
        const svg = DefaultBackend.render(document, context)
        return context.seed === triggerSeed
          ? svg.replace('</svg>', '<style>.probe{font-family:var(--font, java)script:alert(1)}</style></svg>')
          : svg
      },
    }, {
      compatibility: { core: KNOWN_EXTENSION_CONTRACT_VERSIONS.core, scene: '^2.0.0' },
      provenance: { owner: 'native-png-contract-test', source: 'test' },
    })
    try {
      const renderer = createMermaidPNGRenderer({ backendPolicy: { selectBackend: () => id } })
      expect(checkMagic(renderer.renderMermaidPNG('flowchart LR\n A --> B', {
        style: 'hand-drawn', scale: 0.1, onWarning: () => {},
      }))).toBe(true)
      for (const security of ['default', 'strict'] as const) {
        expect(() => renderer.renderMermaidPNG('flowchart LR\n A --> B', {
          style: 'hand-drawn', seed: triggerSeed, security, scale: 0.1, onWarning: () => {},
        })).toThrow('OutputSecurityPolicy rejected active content')
      }
    } finally {
      unregister()
    }
  })

  test('Class and Sequence source markers occupy the node-facing side of the shaft, not the node interior', () => {
    for (const [source, left, top, bottom] of [
      ['classDiagram\ndirection LR\nA *-- B', 160, 55, 74],
      ['sequenceDiagram\nA<<->>B: hello', 70, 90, 102],
    ] as const) {
      const png = decodePng(renderMermaidPNG(source, { scale: 1, style: { roles: { edge: { strokeColor: '#ff0000' } } } }))
      const ink = colorPixelBoxInRaster({ ...png, pixels: png.rgba }, redPixel, { left: left - 20, right: left + 25, top, bottom })
      // Explicit source fixtures have their contacts at x=160 (class) and 70
      // (sequence). Reversed markers must extend right, away from that surface.
      expect(ink.left).toBeGreaterThanOrEqual(left - 1)
      expect(ink.height).toBeGreaterThan(2)
    }
  })
  test('produces valid PNG bytes with magic header', async () => {
    const png = await renderMermaidPNG('flowchart LR\n  A --> B')
    expect(checkMagic(png)).toBe(true)
    expect(png).toBeInstanceOf(Uint8Array)
  })

  test('PNG size is reasonable (between 100B and 1MB for a small graph)', async () => {
    const png = await renderMermaidPNG('flowchart LR\n  A --> B --> C')
    expect(png.length).toBeGreaterThan(100)
    expect(png.length).toBeLessThan(1024 * 1024)
  })

  test('default scale is 2x (retina)', async () => {
    const png1 = await renderMermaidPNG('flowchart LR\n  A --> B', { scale: 1 })
    const png2 = await renderMermaidPNG('flowchart LR\n  A --> B') // default
    const d1 = readPngDimensions(png1)
    const d2 = readPngDimensions(png2)
    expect(d2.width).toBe(d1.width * 2)
    expect(d2.height).toBe(d1.height * 2)
  })

  test('explicit scale produces proportional output', async () => {
    const png1 = await renderMermaidPNG('flowchart LR\n  A --> B', { scale: 1 })
    const png4 = await renderMermaidPNG('flowchart LR\n  A --> B', { scale: 4 })
    const d1 = readPngDimensions(png1)
    const d4 = readPngDimensions(png4)
    expect(d4.width).toBe(d1.width * 4)
    expect(d4.height).toBe(d1.height * 4)
  })

  test('accepts ValidDiagram input as well as string', async () => {
    const { parseRegisteredMermaid: parseMermaid } = await import('../agent/parse.ts')
    const r = parseMermaid('flowchart LR\n  A --> B')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const png = await renderMermaidPNG(r.value)
    // The parsed diagram and its source string rasterize to the same bytes.
    expect(Buffer.from(png).equals(Buffer.from(await renderMermaidPNG('flowchart LR\n  A --> B')))).toBe(true)
  })

  test('background option paints the canvas in the requested colour', async () => {
    const corner = async (background: string) =>
      Array.from(decodePng(await renderMermaidPNG('flowchart LR\n  A --> B', { background })).rgba.slice(0, 4))
    expect({ white: await corner('white'), black: await corner('black'), red: await corner('#ff0000') })
      .toEqual({ white: [255, 255, 255, 255], black: [0, 0, 0, 255], red: [255, 0, 0, 255] })
  })
})
