// Canonical browser PNG adapter. The browser owns rasterization (Canvas,
// OffscreenCanvas, or another host implementation), while the library owns
// request resolution, secured SVG production, receipt identity, and the PNG
// color-profile contract.

import { renderPortablePngGraphicalProjection } from './png-graphical.ts'
import { applyPngColorProfile, inspectPngColorProfile, inspectPngDimensions } from './output-color-profile.ts'
import {
  MAX_PNG_PIXELS,
  PNG_DEFAULT_SCALE,
  prepareSvgForPngRasterization,
  type PngFontSource,
  type PngRasterDimensions,
  type PortablePngOutputOptions,
  type ResolvedPngOutputPolicy,
} from './png-contract.ts'
import type { RenderRequestReceipt } from './render-contract.ts'
import type { RenderExecutionResolutionOptions } from './render-contract.ts'
import type { RenderOptions } from './types.ts'
import { snapshotHostBackendPolicy, type HostBackendPolicy } from './scene/backend.ts'
import type { ParsedDiagram } from './agent/types.ts'
import { prepareRenderInput } from './agent/render-input.ts'
import { inlineFontVarForRaster } from './theme.ts'

export interface BrowserPngDiagnostic {
  readonly code: string
  readonly message: string
  readonly resource?: string
}

export interface BrowserPngRasterContext {
  readonly outputPolicy: ResolvedPngOutputPolicy
  /** Exact integer canvas dimensions approved by the shared raster budget. */
  readonly rasterDimensions: PngRasterDimensions
  /** Canonical portable color after explicit/artifact/fallback precedence. */
  readonly rasterBackground: string
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

/** Trusted browser host inputs; neither callback nor policy is serializable. */
export interface MermaidBrowserPNGRendererHostOptions {
  readonly rasterize: BrowserPngRasterizer
  readonly backendPolicy?: HostBackendPolicy
}

export interface MermaidBrowserPNGRenderer {
  renderMermaidPNG(source: ParsedDiagram | string, options?: RenderOptions, output?: number | PortablePngOutputOptions): Promise<Uint8Array>
  renderMermaidPNGWithReceipt(source: ParsedDiagram | string, options?: RenderOptions, output?: number | PortablePngOutputOptions): Promise<RenderedBrowserPng>
}

function portablePngOptions(output: number | PortablePngOutputOptions | undefined): PortablePngOutputOptions {
  if (output === undefined) return { scale: PNG_DEFAULT_SCALE }
  return typeof output === 'number' ? { scale: output } : output
}

/** Bind an injected browser rasterizer to one trusted graphical backend policy. */
export function createMermaidBrowserPNGRenderer(
  hostOptions: MermaidBrowserPNGRendererHostOptions,
): MermaidBrowserPNGRenderer {
  if (!hostOptions || typeof hostOptions !== 'object') throw new TypeError('browser PNG renderer host options are required')
  const rasterize = hostOptions.rasterize
  if (typeof rasterize !== 'function') throw new TypeError('browser PNG rasterizer must be a function')
  const backendPolicy = snapshotHostBackendPolicy(hostOptions.backendPolicy)
  const host = Object.freeze({ rasterize, ...(backendPolicy ? { backendPolicy } : {}) })
  return Object.freeze({
    async renderMermaidPNG(
      source: ParsedDiagram | string,
      options: RenderOptions = {},
      output: number | PortablePngOutputOptions = PNG_DEFAULT_SCALE,
    ): Promise<Uint8Array> {
      const input = prepareRenderInput(source)
      return (await renderMermaidPNGInBrowserWithReceiptForHost(
        input.source,
        options,
        portablePngOptions(output),
        { ...host, expectedFamilyId: input.expectedFamilyId },
      )).png
    },
    renderMermaidPNGWithReceipt(
      source: ParsedDiagram | string,
      options: RenderOptions = {},
      output: number | PortablePngOutputOptions = PNG_DEFAULT_SCALE,
    ): Promise<RenderedBrowserPng> {
      const input = prepareRenderInput(source)
      return renderMermaidPNGInBrowserWithReceiptForHost(
        input.source,
        options,
        portablePngOptions(output),
        { ...host, expectedFamilyId: input.expectedFamilyId },
      )
    },
  })
}

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

function intrinsicTypedArrayByteLength(value: Uint8Array): number {
  if (TYPED_ARRAY_BYTE_LENGTH_GETTER === undefined) {
    throw new Error('TypedArray byteLength intrinsic is unavailable')
  }
  return Reflect.apply(TYPED_ARRAY_BYTE_LENGTH_GETTER, value, []) as number
}

function assertBrowserPngByteBudget(png: Uint8Array, dimensions: PngRasterDimensions): void {
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
  source: ParsedDiagram | string,
  options: RenderOptions,
  output: number | PortablePngOutputOptions,
  rasterize: BrowserPngRasterizer,
): Promise<RenderedBrowserPng> {
  const input = prepareRenderInput(source)
  return renderMermaidPNGInBrowserWithReceiptForHost(
    input.source,
    options,
    portablePngOptions(output),
    { rasterize, expectedFamilyId: input.expectedFamilyId },
  )
}

async function renderMermaidPNGInBrowserWithReceiptForHost(
  source: string,
  options: RenderOptions,
  output: PortablePngOutputOptions,
  hostOptions: MermaidBrowserPNGRendererHostOptions & Pick<RenderExecutionResolutionOptions, 'expectedFamilyId'>,
): Promise<RenderedBrowserPng> {
  if (typeof hostOptions.rasterize !== 'function') throw new TypeError('browser PNG rasterizer must be a function')
  const graphical = renderPortablePngGraphicalProjection(
    source,
    options,
    output,
    { backendPolicy: hostOptions.backendPolicy, expectedFamilyId: hostOptions.expectedFamilyId },
  )
  if (graphical.receipt.output !== 'png') throw new Error('browser PNG adapter received a non-PNG receipt')
  const rasterSvg = prepareSvgForPngRasterization(
    inlineFontVarForRaster(graphical.svg),
    graphical.rasterDimensions,
  )
  const raster = await hostOptions.rasterize(rasterSvg, {
    outputPolicy: graphical.outputPolicy,
    rasterDimensions: graphical.rasterDimensions,
    rasterBackground: graphical.rasterBackground,
    receipt: graphical.receipt,
  })
  // The injected callback may return an accessor-backed object. Capture its
  // complete public result surface once: type/budget checks and PNG parsing
  // must inspect the same bytes, rather than allowing a later getter read to
  // swap in an over-budget buffer after the pre-parser gate.
  const rasterPng = raster?.png
  const rasterDiagnostics = raster?.diagnostics
  const rasterFontSources = raster?.fontSources
  if (!(rasterPng instanceof Uint8Array)) throw new TypeError('browser PNG rasterizer must return Uint8Array bytes')
  assertBrowserPngByteBudget(rasterPng, graphical.rasterDimensions)
  const runtime = browserRuntimeProvenance(rasterFontSources)
  const png = applyPngColorProfile(rasterPng)
  assertBrowserPngByteBudget(png, graphical.rasterDimensions)
  const actualDimensions = inspectPngDimensions(png)
  if (actualDimensions.width !== graphical.rasterDimensions.width
    || actualDimensions.height !== graphical.rasterDimensions.height) {
    throw new Error(
      `browser PNG rasterizer returned ${actualDimensions.width}×${actualDimensions.height}; `
      + `expected ${graphical.rasterDimensions.width}×${graphical.rasterDimensions.height}`,
    )
  }
  const colorProfile = inspectPngColorProfile(png)
  if (colorProfile.profile !== 'srgb' || colorProfile.hasICC || colorProfile.cICP === undefined) {
    throw new Error('browser PNG color-profile gate failed')
  }
  return Object.freeze({
    png,
    receipt: graphical.receipt,
    diagnostics: Object.freeze([...(rasterDiagnostics ?? [])]),
    colorProfile: Object.freeze(colorProfile),
    runtime,
  })
}
