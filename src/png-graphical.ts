// PNG is a complete graphical adapter, including sketch looks. Enroll its
// backends here so direct native/browser/hosted imports do not depend on the
// complete library entry having run first. SVG-only entries stay independent.
import './scene/builtin-backends.ts'
import { executeGraphicalRequest, type GraphicalSvgArtifact, type GraphicalLayoutConsumer } from './graphical-render.ts'
import type { RenderOptions } from './types.ts'
import type { RenderExecutionResolutionOptions } from './render-contract.ts'
import {
  assertPngRasterBudget,
  resolvePngRasterBackground,
  resolvePortablePngOutputPolicy,
  resolvePngOutputPolicy,
  prepareSvgForPngRasterization,
  type PortablePngOutputOptions,
  type PngOutputPolicyInput,
  type PngRasterDimensions,
  type ResolvedPngOutputPolicy,
} from './png-contract.ts'
import { buildPngLegibilityWarnings, type PngLegibilityWarning } from './shared/png-legibility-warnings.ts'
import { assertFinalSvgByteBudget } from './scene/scene-validation-core.ts'
import { applyOutputSecurityPolicy } from './output-security.ts'

export interface PngGraphicalProjection extends GraphicalSvgArtifact {
  outputPolicy: ResolvedPngOutputPolicy
  /** One concrete artifact/explicit/fallback background shared by every
   * raster substrate. This is derived from the secured graphical artifact. */
  rasterBackground: string
  /** Exact integer allocation approved before any rasterizer is invoked. */
  rasterDimensions: PngRasterDimensions
  /** BELOW_READABLE_SIZE gate computed once here so every raster substrate
   * (native, browser, WASM, hosted) reports the identical verdict. */
  legibilityWarnings: readonly PngLegibilityWarning[]
}

/** Last library-owned SVG bytes before rasterization or trusted host handoff.
 * Receipts continue to identify the logical graphical projection, not these
 * substrate-specific font/marker/canvas rewrites. */
export function finalizePngRasterSvg(
  projectedSvg: string,
  dimensions: PngRasterDimensions,
): string {
  const svg = prepareSvgForPngRasterization(projectedSvg, dimensions)
  assertFinalSvgByteBudget(svg, 'PNG raster SVG')
  return applyOutputSecurityPolicy(svg, 'strict').svg
}

function renderResolvedPngGraphicalProjection(
  source: string,
  renderOptions: RenderOptions,
  outputPolicy: ResolvedPngOutputPolicy,
  resolutionOptions: RenderExecutionResolutionOptions = {},
  consumeLayout?: GraphicalLayoutConsumer,
): PngGraphicalProjection {
  const graphical = executeGraphicalRequest(source, renderOptions, 'png', outputPolicy, resolutionOptions, consumeLayout)
  const rasterBackground = resolvePngRasterBackground(graphical.svg, outputPolicy)
  const rasterDimensions = assertPngRasterBudget(graphical.svg, outputPolicy)
  return {
    ...graphical,
    outputPolicy,
    rasterBackground,
    rasterDimensions,
    legibilityWarnings: Object.freeze(buildPngLegibilityWarnings(graphical.svg, outputPolicy, rasterDimensions)),
  }
}

/** Native PNG request/receipt entry, including trusted host font inputs. */
export function renderPngGraphicalProjection(
  source: string,
  renderOptions: RenderOptions,
  outputOptions: PngOutputPolicyInput = {},
  resolutionOptions: RenderExecutionResolutionOptions = {},
  consumeLayout?: GraphicalLayoutConsumer,
): PngGraphicalProjection {
  return renderResolvedPngGraphicalProjection(
    source,
    renderOptions,
    resolvePngOutputPolicy(outputOptions),
    resolutionOptions,
    consumeLayout,
  )
}

/** Portable PNG entry for browser, WASM, and hosted raster substrates. */
export function renderPortablePngGraphicalProjection(
  source: string,
  renderOptions: RenderOptions,
  outputOptions: PortablePngOutputOptions = {},
  resolutionOptions: RenderExecutionResolutionOptions = {},
): PngGraphicalProjection {
  return renderResolvedPngGraphicalProjection(
    source,
    renderOptions,
    resolvePortablePngOutputPolicy(outputOptions),
    resolutionOptions,
  )
}
