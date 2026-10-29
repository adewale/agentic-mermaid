import { layoutResult, positionedView, scene, type BrowserSvgFamilyHooks } from '../browser-lazy/family.ts'
import { parseIshikawaDiagram } from '../ishikawa/parser.ts'
import { layoutIshikawaDiagram } from '../ishikawa/layout.ts'
import { lowerIshikawaScene } from '../ishikawa/renderer.ts'
import { projectIshikawaPositioned } from '../ishikawa/projection.ts'
import { diagnoseIshikawaConfig } from '../ishikawa/config-diagnostics.ts'

export const ISHIKAWA_SVG_HOOKS = {
  configDiagnostics: diagnoseIshikawaConfig,
  layout: ctx => {
    const config = ctx.source.config.ishikawa as Record<string, unknown> | undefined
    return layoutResult(
      layoutIshikawaDiagram(
        parseIshikawaDiagram(ctx.source.authoredFamilyBody ?? ctx.source.familyBody),
        ctx.renderOptions,
        ctx.styleFace,
        typeof ctx.source.frontmatter.title === 'string' ? ctx.source.frontmatter.title : undefined,
        typeof config?.diagramPadding === 'number' && Number.isFinite(config.diagramPadding) && config.diagramPadding >= 0 ? config.diagramPadding : undefined,
      ),
    )
  },
  projectPositioned: positionedView(projectIshikawaPositioned),
  lowerScene: scene(lowerIshikawaScene),
} satisfies BrowserSvgFamilyHooks
