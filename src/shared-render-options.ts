import type { RenderOptions } from './types.ts'
import { NON_SERIALIZABLE_RENDER_OPTION_FIELDS, SHARED_RENDER_OPTION_FIELDS } from './render-contract.ts'

/** Output adapters own their format-specific controls; only this projection
 * enters shared render admission and appearance capture. */
export function sharedRenderOptionsOf(options: RenderOptions): RenderOptions {
  return Object.fromEntries(
    [...SHARED_RENDER_OPTION_FIELDS, ...NON_SERIALIZABLE_RENDER_OPTION_FIELDS]
      .filter(field => options[field] !== undefined)
      .map(field => [field, options[field]]),
  ) as RenderOptions
}
