import { renderGraphicalSvgWithReceipt, type RenderedSvg } from './index.ts'
import type { RenderOptions } from './types.ts'
import {
  resolvePngOutputPolicy,
  type PngOutputPolicyInput,
  type ResolvedPngOutputPolicy,
} from './png-contract.ts'

export interface PngGraphicalProjection extends RenderedSvg {
  outputPolicy: ResolvedPngOutputPolicy
}

/** One logical PNG request/receipt entry shared by NAPI and WASM rasterizers. */
export function renderPngGraphicalProjection(
  source: string,
  renderOptions: RenderOptions,
  outputOptions: PngOutputPolicyInput = {},
): PngGraphicalProjection {
  const outputPolicy = resolvePngOutputPolicy(outputOptions)
  return {
    ...renderGraphicalSvgWithReceipt(source, renderOptions, 'png', outputPolicy),
    outputPolicy,
  }
}
