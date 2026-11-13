// Engine-free browser raster boundary, shared by direct and worker adapters.
import { MAX_PNG_PIXELS, type PngRasterDimensions } from './png-contract.ts'
import type { BrowserPngFontSource, BrowserPngRuntimeProvenance } from './browser-png.ts'

export const BROWSER_CANVAS_RUNTIME: BrowserPngRuntimeProvenance = Object.freeze({
  engine: 'canvas',
  binding: 'browser',
  fontSources: Object.freeze<BrowserPngFontSource[]>(['unavailable']),
  reproducibility: 'host-dependent',
})

const BROWSER_FONT_SOURCES = new Set<BrowserPngFontSource>([
  'verified-buffers',
  'embedded-data-uri',
  'unavailable',
])

/** Canvas produces 8-bit RGBA pixels. Allow bounded PNG framing/metadata on
 * top of that raw allocation, but never feed an attacker-sized callback
 * result into chunk parsing or color-profile rewriting. */
const MAX_BROWSER_PNG_CONTAINER_OVERHEAD_BYTES = 1_048_576
const MAX_BROWSER_PNG_BYTES = MAX_PNG_PIXELS * 4 + MAX_BROWSER_PNG_CONTAINER_OVERHEAD_BYTES
const TYPED_ARRAY_BYTE_LENGTH_GETTER = Object.getOwnPropertyDescriptor(
  Object.getPrototypeOf(Uint8Array.prototype),
  'byteLength',
)?.get

export function intrinsicTypedArrayByteLength(value: Uint8Array): number {
  if (TYPED_ARRAY_BYTE_LENGTH_GETTER === undefined) {
    throw new Error('TypedArray byteLength intrinsic is unavailable')
  }
  return Reflect.apply(TYPED_ARRAY_BYTE_LENGTH_GETTER, value, []) as number
}

export function assertBrowserPngByteBudget(png: Uint8Array, dimensions: PngRasterDimensions): void {
  const dimensionBound = dimensions.pixels * 4
    + dimensions.height
    + MAX_BROWSER_PNG_CONTAINER_OVERHEAD_BYTES
  const limit = Math.min(MAX_BROWSER_PNG_BYTES, dimensionBound)
  // Browser rasterizers are injected host code. A Uint8Array subclass can
  // shadow `byteLength`; call the realm's trusted TypedArray intrinsic so an
  // oversized backing view is rejected before any PNG parser observes it.
  if (intrinsicTypedArrayByteLength(png) > limit) {
    throw new RangeError(`browser PNG rasterizer output exceeds the ${limit}-byte allocation-derived limit`)
  }
}

export function browserRuntimeProvenance(sources: readonly BrowserPngFontSource[] | undefined): BrowserPngRuntimeProvenance {
  if (sources === undefined) return BROWSER_CANVAS_RUNTIME
  if (!Array.isArray(sources) || sources.length === 0) {
    throw new TypeError('browser PNG rasterizer fontSources must be a non-empty array when supplied')
  }
  const normalized: BrowserPngFontSource[] = []
  for (const source of sources) {
    if (!BROWSER_FONT_SOURCES.has(source)) throw new TypeError(`browser PNG rasterizer reported an invalid font source: ${String(source)}`)
    if (!normalized.includes(source)) normalized.push(source)
  }
  if (normalized.length === 1 && normalized[0] === 'unavailable') return BROWSER_CANVAS_RUNTIME
  return Object.freeze({
    engine: 'canvas',
    binding: 'browser',
    fontSources: Object.freeze(normalized),
    reproducibility: 'host-dependent',
  })
}

