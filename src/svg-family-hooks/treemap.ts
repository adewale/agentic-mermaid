import { layoutResult, positionedView, scene, type BrowserSvgFamilyHooks } from '../browser-lazy/family.ts'
import { parseTreemapDiagram } from '../treemap/parser.ts'
import { layoutTreemapDiagram, resolveTreemapConfig } from '../treemap/layout.ts'
import { lowerTreemapScene } from '../treemap/renderer.ts'
import { projectTreemapPositioned } from '../treemap/projection.ts'
import { diagnoseTreemapConfig } from '../treemap/config-diagnostics.ts'

export const TREEMAP_SVG_HOOKS = {
  configDiagnostics: diagnoseTreemapConfig,
  normalizeRequest: ctx => ({ familyConfig: { treemap: resolveTreemapConfig(ctx.source.config.treemap as Record<string, unknown> | undefined) } }),
  layout: ctx => {
    const body = parseTreemapDiagram(ctx.source.authoredFamilyBody ?? ctx.source.familyBody)
    body.title ??= typeof ctx.source.frontmatter.title === 'string' ? ctx.source.frontmatter.title : undefined
    return layoutResult(layoutTreemapDiagram(body, ctx.renderOptions, (ctx.familyConfig as { treemap: ReturnType<typeof resolveTreemapConfig> }).treemap, ctx.styleFace))
  },
  projectPositioned: positionedView(projectTreemapPositioned),
  lowerScene: scene(lowerTreemapScene),
} satisfies BrowserSvgFamilyHooks
