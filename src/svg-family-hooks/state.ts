import { STATE_NORMALIZE_REQUEST } from '../family-request-hooks.ts'
import { diagnoseStateConfig } from '../state/config-diagnostics.ts'
import { projectGraphPositioned } from '../positioned-views/graph.ts'
import type { ResolvedStateVisualConfig } from '../state/config.ts'
import { layoutResult, positionedView, scene, type BrowserSvgFamilyHooks } from '../browser-lazy/family.ts'
import { layoutGraphSync } from '../layout-engine.ts'
import { parseMermaid } from '../parser.ts'
import { lowerGraphScene } from '../renderer.ts'
import { frontmatterTitle } from '../mermaid-source.ts'

import { stateStatementEnds } from '../state/parse-core.ts'
import { checkAllGraphAuthoredStyles } from '../shared/style-props.ts'

/** The state SVG hooks: one definition for the complete renderer
 * (src/render-family-hooks.ts) and the lazy browser chunk. */
export const STATE_SVG_HOOKS = {
  configDiagnostics: diagnoseStateConfig,
  statementEnds: stateStatementEnds,
  normalizeRequest: STATE_NORMALIZE_REQUEST,
  layout: ctx => {
    const stateVisual = (ctx.familyAppearance as { visual?: ResolvedStateVisualConfig } | undefined)?.visual
    const diagramTitle = frontmatterTitle(ctx.source.frontmatter)
    const graph = parseMermaid(ctx.source.familyText)
    checkAllGraphAuthoredStyles(graph)
    return layoutResult(layoutGraphSync(graph, {
      ...ctx.renderOptions,
      ...(ctx.styleFace ? { styleFace: ctx.styleFace } : {}),
      ...(stateVisual ? { stateVisual } : {}),
      ...(diagramTitle ? { diagramTitle } : {}),
    }))
  },
  projectPositioned: positionedView(projectGraphPositioned),
  lowerScene: scene(lowerGraphScene),
} satisfies BrowserSvgFamilyHooks
