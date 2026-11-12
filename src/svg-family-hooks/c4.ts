import { C4_NORMALIZE_REQUEST } from '../c4/parser.ts'
import { diagnoseC4Config } from '../c4/config-diagnostics.ts'
import { layoutResult, positionedView, scene, type BrowserSvgFamilyHooks } from '../browser-lazy/family.ts'
import { projectC4Positioned } from '../positioned-views/c4.ts'
import { layoutC4Diagram } from '../c4/layout.ts'

import { lowerC4Scene } from '../c4/renderer.ts'
import type { C4Body } from '../c4/types.ts'

/** Parse authored identities once at the request boundary, before any output
 * display admission. Pixel and cell adapters consume this same semantic plan. */
export const C4_SVG_HOOKS = {
  configDiagnostics: diagnoseC4Config,
  normalizeRequest: C4_NORMALIZE_REQUEST,
  layout: ctx => {
    const config = ctx.familyConfig as {
      model: C4Body
      c4: Record<string, unknown>
      themeVariables: Record<string, unknown>
    }
    return layoutResult(layoutC4Diagram(config.model, ctx.renderOptions, ctx.styleFace, config.c4, config.themeVariables))
  },
  projectPositioned: positionedView(projectC4Positioned),
  lowerScene: scene(lowerC4Scene),
} satisfies BrowserSvgFamilyHooks
