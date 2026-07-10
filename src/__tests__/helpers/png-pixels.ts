// Tiny PNG pixel-inspection helper for raster tests. Wraps upng-js (already a
// devDependency, used by the sketch-prototype scripts) so tests can decode
// renderMermaidPNG output and scan for glyph ink without adding dependencies.

// @ts-expect-error - upng-js ships no types
import UPNG from 'upng-js'

export interface DecodedPng {
  width: number
  height: number
  /** RGBA8, row-major, 4 bytes per pixel. */
  rgba: Uint8Array
}

export function decodePng(png: Uint8Array): DecodedPng {
  const img = UPNG.decode(png.buffer.slice(png.byteOffset, png.byteOffset + png.byteLength))
  const rgba = new Uint8Array(UPNG.toRGBA8(img)[0] as ArrayBuffer)
  return { width: img.width as number, height: img.height as number, rgba }
}

/**
 * Columns in [x0, x1) that contain at least one "ink" pixel (mean RGB below
 * `threshold`) within rows [y0, y1). Near-black text ink scores ~0–60; white
 * background and the pastel section/box fills score far above 100.
 */
export function inkColumns(img: DecodedPng, x0: number, x1: number, y0: number, y1: number, threshold = 100): number[] {
  const cols: number[] = []
  const yStart = Math.max(0, Math.floor(y0))
  const yEnd = Math.min(img.height, Math.ceil(y1))
  for (let x = Math.max(0, Math.floor(x0)); x < Math.min(img.width, Math.ceil(x1)); x++) {
    for (let y = yStart; y < yEnd; y++) {
      const i = (y * img.width + x) * 4
      if ((img.rgba[i]! + img.rgba[i + 1]! + img.rgba[i + 2]!) / 3 < threshold) {
        cols.push(x)
        break
      }
    }
  }
  return cols
}
