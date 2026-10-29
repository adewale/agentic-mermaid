import { diagnoseMindmapConfig } from '../mindmap/config-diagnostics.ts'
import { projectMindmapPositioned } from '../positioned-views/mindmap.ts'
import { layoutResult, positionedView, scene, type BrowserSvgFamilyHooks } from '../browser-lazy/family.ts'
import { mindmapStatementEnds, parseMindmap } from '../mindmap/parser.ts'
import { positionMindmap, resolveMindmapPositionConfig } from '../mindmap/position.ts'
import { lowerMindmapScene } from '../mindmap/renderer.ts'
import { withAccessibilityFields } from '../shared/accessibility-directives.ts'
import { withFrontmatterTitle } from '../mermaid-source.ts'
import { resolveRenderStyle } from '../styles.ts'

/** The mindmap SVG hooks: one definition for the complete renderer
 * (src/render-family-hooks.ts) and the lazy browser chunk. */
export const MINDMAP_SVG_HOOKS = {
  configDiagnostics: diagnoseMindmapConfig,
  statementEnds: mindmapStatementEnds,
  normalizeRequest: ctx => ({
    familyConfig: {
      position: resolveMindmapPositionConfig(ctx.source.config.mindmap, ctx.source.config.layout),
    },
  }),
  layout: ctx => layoutResult(positionMindmap(
    withFrontmatterTitle(withAccessibilityFields(parseMindmap(ctx.source.authoredFamilyBody ?? ctx.source.familyBody), ctx.source.accessibility), ctx.source.frontmatter),
    (ctx.familyConfig as { position?: ReturnType<typeof resolveMindmapPositionConfig> } | undefined)?.position
      ?? resolveMindmapPositionConfig(undefined, undefined),
    resolveRenderStyle(ctx.renderOptions, undefined, ctx.styleFace),
  ), { injectAccessibility: false }),
  projectPositioned: positionedView(projectMindmapPositioned),
  lowerScene: scene(lowerMindmapScene),
} satisfies BrowserSvgFamilyHooks
