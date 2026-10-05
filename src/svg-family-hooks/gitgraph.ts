import { layoutResult, scene, type BrowserSvgFamilyHooks } from '../browser-lazy/family.ts'
import { parseGitGraph } from '../gitgraph/parser.ts'
import { positionGitGraph, resolveGitGraphPositionConfig } from '../gitgraph/position.ts'
import { lowerGitGraphScene, resolveGitGraphThemeProjection } from '../gitgraph/renderer.ts'
import { withAccessibilityFields } from '../shared/accessibility-directives.ts'

/** The gitgraph SVG hooks: one definition for the complete renderer
 * (src/render-family-hooks.ts) and the lazy browser chunk. */
export const GITGRAPH_SVG_HOOKS = {
  normalizeRequest: ctx => ({
    familyConfig: {
      position: resolveGitGraphPositionConfig(ctx.source.config.gitGraph, ctx.source.config.themeVariables),
      ...(typeof ctx.source.frontmatter.title === 'string' ? { title: ctx.source.frontmatter.title } : {}),
    },
    appearance: {
      family: {
        themeVariables: resolveGitGraphThemeProjection(ctx.source.config.themeVariables),
      },
    },
  }),
  layout: ctx => {
    const familyConfig = ctx.familyConfig as {
      position: ReturnType<typeof resolveGitGraphPositionConfig>
      title?: string
    } | undefined
    const config = familyConfig?.position ?? resolveGitGraphPositionConfig(undefined)
    const diagram = withAccessibilityFields(parseGitGraph(ctx.source.familyBody, {
      mainBranchName: config.mainBranchName,
      mainBranchOrder: config.mainBranchOrder,
      title: familyConfig?.title,
    }), ctx.source.accessibility)
    return layoutResult(positionGitGraph(diagram, config), { injectAccessibility: false })
  },
  lowerScene: scene(lowerGitGraphScene),
} satisfies BrowserSvgFamilyHooks
