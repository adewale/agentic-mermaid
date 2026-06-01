// Loop 8 P: PNG export — basic validity tests.

import { describe, test, expect } from 'bun:test'
import { renderMermaidPNG } from '../agent/png.ts'

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
    const { parseMermaid } = await import('../agent/parse.ts')
    const r = parseMermaid('flowchart LR\n  A --> B')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const png = await renderMermaidPNG(r.value)
    expect(checkMagic(png)).toBe(true)
  })

  test('background option works', async () => {
    // We can't easily assert color from PNG bytes without a decoder,
    // but two different backgrounds must produce different PNGs.
    const white = await renderMermaidPNG('flowchart LR\n  A --> B', { background: 'white' })
    const black = await renderMermaidPNG('flowchart LR\n  A --> B', { background: 'black' })
    expect(white).not.toEqual(black)
  })
})
