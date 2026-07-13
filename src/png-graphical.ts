import { executeGraphicalRequest, type GraphicalSvgArtifact } from './graphical-render.ts'
import type { RenderOptions } from './types.ts'
import type { RenderExecutionResolutionOptions } from './render-contract.ts'
import {
  resolvePngOutputPolicy,
  type PngOutputPolicyInput,
  type ResolvedPngOutputPolicy,
} from './png-contract.ts'

export interface PngGraphicalProjection extends GraphicalSvgArtifact {
  outputPolicy: ResolvedPngOutputPolicy
}

/** One logical PNG request/receipt entry shared by NAPI and WASM rasterizers. */
export function renderPngGraphicalProjection(
  source: string,
  renderOptions: RenderOptions,
  outputOptions: PngOutputPolicyInput = {},
  resolutionOptions: RenderExecutionResolutionOptions = {},
): PngGraphicalProjection {
  const outputPolicy = resolvePngOutputPolicy(outputOptions)
  return {
    ...executeGraphicalRequest(source, renderOptions, 'png', outputPolicy, resolutionOptions),
    outputPolicy,
  }
}
