// Canonical browser PNG adapter. The browser owns rasterization (Canvas,
// OffscreenCanvas, or another host implementation), while the library owns
// request resolution, secured SVG production, receipt identity, and the PNG
// color-profile contract.

import { renderPngGraphicalProjection } from './png-graphical.ts'
import { applyPngColorProfile, inspectPngColorProfile } from './output-color-profile.ts'
import type { PngFontSource } from './png-contract.ts'
import type { RenderRequestReceipt } from './render-contract.ts'
import type { RenderOptions } from './types.ts'

export interface BrowserPngDiagnostic {
  readonly code: string
  readonly message: string
  readonly resource?: string
}

export interface BrowserPngRasterContext {
  readonly scale: number
  readonly receipt: RenderRequestReceipt
}

export interface BrowserPngRasterResult {
  readonly png: Uint8Array
  readonly diagnostics?: readonly BrowserPngDiagnostic[]
  /** Host-reported font inputs. Omission is recorded as unavailable evidence. */
  readonly fontSources?: readonly BrowserPngFontSource[]
}

export type BrowserPngRasterizer = (
  securedSvg: string,
  context: BrowserPngRasterContext,
) => Promise<BrowserPngRasterResult>

export interface RenderedBrowserPng {
  readonly png: Uint8Array
  readonly receipt: RenderRequestReceipt
  readonly diagnostics: readonly BrowserPngDiagnostic[]
  readonly colorProfile: ReturnType<typeof inspectPngColorProfile>
  /** Host provenance is artifact metadata and never changes the logical receipt. */
  readonly runtime: BrowserPngRuntimeProvenance
}

export type BrowserPngFontSource = Extract<PngFontSource, 'verified-buffers' | 'embedded-data-uri' | 'unavailable'>

export interface BrowserPngRuntimeProvenance {
  readonly engine: 'canvas'
  readonly binding: 'browser'
  readonly fontSources: readonly BrowserPngFontSource[]
  /** Browser callbacks do not expose content identities for every byte-affecting resource. */
  readonly reproducibility: 'host-dependent'
}

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

function browserRuntimeProvenance(sources: readonly BrowserPngFontSource[] | undefined): BrowserPngRuntimeProvenance {
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

export async function renderMermaidPNGInBrowserWithReceipt(
  source: string,
  options: RenderOptions,
  scale: number,
  rasterize: BrowserPngRasterizer,
): Promise<RenderedBrowserPng> {
  if (!Number.isFinite(scale) || scale <= 0) throw new TypeError('browser PNG scale must be a positive finite number')
  if (typeof rasterize !== 'function') throw new TypeError('browser PNG rasterizer must be a function')
  const graphical = renderPngGraphicalProjection(source, options, { scale })
  if (graphical.receipt.output !== 'png') throw new Error('browser PNG adapter received a non-PNG receipt')
  const raster = await rasterize(graphical.svg, { scale, receipt: graphical.receipt })
  if (!(raster?.png instanceof Uint8Array)) throw new TypeError('browser PNG rasterizer must return Uint8Array bytes')
  const runtime = browserRuntimeProvenance(raster.fontSources)
  const png = applyPngColorProfile(raster.png)
  const colorProfile = inspectPngColorProfile(png)
  if (colorProfile.profile !== 'srgb' || colorProfile.hasICC || colorProfile.cICP === undefined) {
    throw new Error('browser PNG color-profile gate failed')
  }
  return Object.freeze({
    png,
    receipt: graphical.receipt,
    diagnostics: Object.freeze([...(raster.diagnostics ?? [])]),
    colorProfile: Object.freeze(colorProfile),
    runtime,
  })
}
