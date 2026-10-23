import { assertBrowserPngByteBudget, browserRuntimeProvenance } from './browser-png-runtime.ts'
export { BROWSER_CANVAS_RUNTIME } from './browser-png-runtime.ts'
// Canonical browser PNG adapter. The browser owns rasterization (Canvas,
// OffscreenCanvas, or another host implementation), while the library owns
// request resolution, secured SVG production, receipt identity, and the PNG
// color-profile contract.

import { finalizePngRasterSvg, renderPortablePngGraphicalProjection } from './png-graphical.ts'
import { applyPngColorProfile, inspectPngColorProfile, inspectPngDimensions } from './output-color-profile.ts'
import {
  PNG_DEFAULT_SCALE,
  type PngFontSource,
  type PngRasterDimensions,
  type PortablePngOutputOptions,
  type ResolvedPngOutputPolicy,
} from './png-contract.ts'
import type { RenderRequestReceipt } from './render-contract.ts'
import type { RenderExecutionResolutionOptions } from './render-contract.ts'
import type { RenderOptions } from './types.ts'
import { snapshotHostBackendPolicy, type HostBackendPolicy } from './scene/backend.ts'
import { snapshotTextMeasurementProfile, type TextMeasurementProfile } from './text-measurement-profile.ts'
import type { ParsedDiagram } from './agent/types.ts'
import { prepareRenderInput } from './agent/render-input.ts'
import { inlineFontVarForRaster } from './theme.ts'
import type { PngLegibilityWarning } from './shared/png-legibility-warnings.ts'

export interface BrowserPngHostDiagnostic {
  readonly code: string
  readonly message: string
  readonly resource?: string
}

/** Shared projection warnings retain their structured evidence; injected
 * rasterizers may append host-specific diagnostics. */
export type BrowserPngDiagnostic = PngLegibilityWarning | BrowserPngHostDiagnostic

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

/** Trusted browser host inputs; neither callback nor policy is serializable. */
export interface MermaidBrowserPNGRendererHostOptions {
  readonly rasterize: BrowserPngRasterizer
  readonly backendPolicy?: HostBackendPolicy
  readonly textMeasurement?: TextMeasurementProfile
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
  const textMeasurement = snapshotTextMeasurementProfile(hostOptions.textMeasurement)
  const host = Object.freeze({ rasterize, ...(backendPolicy ? { backendPolicy } : {}), ...(textMeasurement ? { textMeasurement } : {}) })
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
    { backendPolicy: hostOptions.backendPolicy, textMeasurement: hostOptions.textMeasurement, expectedFamilyId: hostOptions.expectedFamilyId },
  )
  if (graphical.receipt.output !== 'png') throw new Error('browser PNG adapter received a non-PNG receipt')
  const rasterSvg = finalizePngRasterSvg(
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
    diagnostics: Object.freeze([
      ...graphical.legibilityWarnings,
      ...(rasterDiagnostics ?? []),
    ]),
    colorProfile: Object.freeze(colorProfile),
    runtime,
  })
}
