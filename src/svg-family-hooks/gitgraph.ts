import { GITGRAPH_NORMALIZE_REQUEST } from '../family-request-hooks.ts'
import { withParserSource } from '../shared/parser-source.ts'
import { diagnoseGitGraphConfig } from '../gitgraph/config-diagnostics.ts'
import { projectGitGraphPositioned } from '../positioned-views/gitgraph.ts'
import { layoutResult, positionedView, scene, type BrowserSvgFamilyHooks } from '../browser-lazy/family.ts'
import { gitGraphStatementEnds, parseGitGraph } from '../gitgraph/parser.ts'
import { positionGitGraph, resolveGitGraphPositionConfig } from '../gitgraph/position.ts'
import { lowerGitGraphScene } from '../gitgraph/renderer.ts'
import { withAccessibilityFields } from '../shared/accessibility-directives.ts'

/** The gitgraph SVG hooks: one definition for the complete renderer
 * (src/render-family-hooks.ts) and the lazy browser chunk. */
export const GITGRAPH_SVG_HOOKS = {
  configDiagnostics: diagnoseGitGraphConfig,
  statementEnds: gitGraphStatementEnds,
  normalizeRequest: GITGRAPH_NORMALIZE_REQUEST,
  layout: ctx => {
    const familyConfig = ctx.familyConfig as {
      position: ReturnType<typeof resolveGitGraphPositionConfig>
      title?: string
    } | undefined
    const config = familyConfig?.position ?? resolveGitGraphPositionConfig(undefined)
    const diagram = withAccessibilityFields(withParserSource(ctx.source, () => ctx.source.familyBody.split('\n'), () => parseGitGraph(ctx.source.familyBody, {
      mainBranchName: config.mainBranchName,
      mainBranchOrder: config.mainBranchOrder,
      title: familyConfig?.title,
    })), ctx.source.accessibility)
    return layoutResult(positionGitGraph(diagram, config, ctx.renderOptions, ctx.styleFace), { injectAccessibility: false })
  },
  projectPositioned: positionedView(projectGitGraphPositioned),
  lowerScene: scene(lowerGitGraphScene),
} satisfies BrowserSvgFamilyHooks
