import type { RenderOptions } from './types.ts'
import { isTerminalOutputOptionField } from './terminal-contract.ts'

/** The RenderOptions projection of a terminal request. The terminal adapter
 * owns its cell-grid controls and its projection-diagnostic callback; every
 * other field, an unknown one included,
 * enters shared render admission, so a terminal render refuses an unknown or
 * misspelt option exactly as an SVG render does. */
export function sharedRenderOptionsOf(options: RenderOptions): RenderOptions {
  return Object.fromEntries(
    Object.entries(options).filter(([field, value]) => value !== undefined && field !== 'onProjectionDiagnostic' && !isTerminalOutputOptionField(field)),
  ) as RenderOptions
}
