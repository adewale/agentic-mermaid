import { Resvg } from '@resvg/resvg-js'

export interface RenderedRaster {
  width: number
  height: number
  pixels: Uint8Array
}

export interface PixelBox {
  left: number
  top: number
  right: number
  bottom: number
  width: number
  height: number
}

export interface PixelRegion {
  left: number
  top: number
  right: number
  bottom: number
}

export type PixelPredicate = (r: number, g: number, b: number, a: number) => boolean

export const redPixel: PixelPredicate = (r, g, b, a) => a > 0 && r > 180 && g < 90 && b < 90
export const bluePixel: PixelPredicate = (r, g, b, a) => a > 0 && r < 100 && g < 160 && b > 180

export function hexPixel(hex: string, tolerance = 16): PixelPredicate {
  const clean = hex.startsWith('#') ? hex.slice(1) : hex
  if (!/^[0-9a-fA-F]{6}$/.test(clean)) throw new Error(`expected #rrggbb color, got ${hex}`)
  const rr = parseInt(clean.slice(0, 2), 16)
  const gg = parseInt(clean.slice(2, 4), 16)
  const bb = parseInt(clean.slice(4, 6), 16)
  return (r, g, b, a) =>
    a > 0 &&
    Math.abs(r - rr) <= tolerance &&
    Math.abs(g - gg) <= tolerance &&
    Math.abs(b - bb) <= tolerance
}

export function renderSvgPixels(svg: string): RenderedRaster {
  const rendered = new Resvg(svg, { background: '#ffffff' }).render()
  return { width: rendered.width, height: rendered.height, pixels: rendered.pixels }
}

export function colorPixelBox(
  svg: string,
  isColor: PixelPredicate,
  region?: PixelRegion,
): PixelBox {
  return colorPixelBoxInRaster(renderSvgPixels(svg), isColor, region)
}

export function colorPixelBoxInRaster(
  rendered: RenderedRaster,
  isColor: PixelPredicate,
  region?: PixelRegion,
): PixelBox {
  let left = Number.POSITIVE_INFINITY
  let top = Number.POSITIVE_INFINITY
  let right = Number.NEGATIVE_INFINITY
  let bottom = Number.NEGATIVE_INFINITY

  const scan = region ?? { left: 0, top: 0, right: rendered.width, bottom: rendered.height }
  for (let y = Math.max(0, scan.top); y < Math.min(rendered.height, scan.bottom); y++) {
    for (let x = Math.max(0, scan.left); x < Math.min(rendered.width, scan.right); x++) {
      const offset = (y * rendered.width + x) * 4
      const r = rendered.pixels[offset]!
      const g = rendered.pixels[offset + 1]!
      const b = rendered.pixels[offset + 2]!
      const a = rendered.pixels[offset + 3]!
      if (!isColor(r, g, b, a)) continue
      left = Math.min(left, x)
      top = Math.min(top, y)
      right = Math.max(right, x)
      bottom = Math.max(bottom, y)
    }
  }

  if (!Number.isFinite(left)) throw new Error('expected at least one matching pixel')
  return { left, top, right, bottom, width: right - left + 1, height: bottom - top + 1 }
}

export function colorPixelCount(
  svg: string,
  isColor: PixelPredicate,
  region?: PixelRegion,
): number {
  return colorPixelCountInRaster(renderSvgPixels(svg), isColor, region)
}

export function colorPixelCountInRaster(
  rendered: RenderedRaster,
  isColor: PixelPredicate,
  region?: PixelRegion,
): number {
  let count = 0
  const scan = region ?? { left: 0, top: 0, right: rendered.width, bottom: rendered.height }
  for (let y = Math.max(0, scan.top); y < Math.min(rendered.height, scan.bottom); y++) {
    for (let x = Math.max(0, scan.left); x < Math.min(rendered.width, scan.right); x++) {
      const offset = (y * rendered.width + x) * 4
      const r = rendered.pixels[offset]!
      const g = rendered.pixels[offset + 1]!
      const b = rendered.pixels[offset + 2]!
      const a = rendered.pixels[offset + 3]!
      if (isColor(r, g, b, a)) count++
    }
  }
  return count
}

export const nonWhitePixel: PixelPredicate = (r, g, b, a) => a > 0 && (r < 245 || g < 245 || b < 245)
