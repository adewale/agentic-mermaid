import { executeGraphicalRequest, type GraphicalSvgArtifact } from './graphical-render.ts'
import type { RenderOptions } from './types.ts'
import type { RenderExecutionResolutionOptions } from './render-contract.ts'
import {
  assertPngRasterBudget,
  resolvePngRasterBackground,
  resolvePortablePngOutputPolicy,
  resolvePngOutputPolicy,
  type PortablePngOutputOptions,
  type PngOutputPolicyInput,
  type PngRasterDimensions,
  type ResolvedPngOutputPolicy,
} from './png-contract.ts'

export interface PngGraphicalProjection extends GraphicalSvgArtifact {
  outputPolicy: ResolvedPngOutputPolicy
  /** One concrete artifact/explicit/fallback background shared by every
   * raster substrate. This is derived from the secured graphical artifact. */
  rasterBackground: string
  /** Exact integer allocation approved before any rasterizer is invoked. */
  rasterDimensions: PngRasterDimensions
}

function renderResolvedPngGraphicalProjection(
  source: string,
  renderOptions: RenderOptions,
  outputPolicy: ResolvedPngOutputPolicy,
  resolutionOptions: RenderExecutionResolutionOptions = {},
): PngGraphicalProjection {
  const graphical = executeGraphicalRequest(source, renderOptions, 'png', outputPolicy, resolutionOptions)
  const rasterBackground = resolvePngRasterBackground(graphical.svg, outputPolicy)
  const rasterDimensions = assertPngRasterBudget(graphical.svg, outputPolicy)
  return {
    ...graphical,
    outputPolicy,
    rasterBackground,
    rasterDimensions,
  }
}

/** Native PNG request/receipt entry, including trusted host font inputs. */
export function renderPngGraphicalProjection(
  source: string,
  renderOptions: RenderOptions,
  outputOptions: PngOutputPolicyInput = {},
  resolutionOptions: RenderExecutionResolutionOptions = {},
): PngGraphicalProjection {
  return renderResolvedPngGraphicalProjection(
    source,
    renderOptions,
    resolvePngOutputPolicy(outputOptions),
    resolutionOptions,
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
