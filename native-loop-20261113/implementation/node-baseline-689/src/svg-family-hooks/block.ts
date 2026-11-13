import { diagnoseBlockConfig } from '../block/config-diagnostics.ts'
import { layoutResult, positionedView, scene, type BrowserSvgFamilyHooks } from '../browser-lazy/family.ts'
import { parseBlockDiagram } from '../block/parser.ts'
import { layoutBlockDiagram } from '../block/layout.ts'
import { lowerBlockScene, projectBlockPositioned } from '../block/renderer.ts'
import { frontmatterTitle } from '../mermaid-source.ts'
export const BLOCK_SVG_HOOKS = {
  configDiagnostics: diagnoseBlockConfig,
  layout: ctx => {
    const body = parseBlockDiagram(ctx.source.familyLines)
    body.title ??= frontmatterTitle(ctx.source.frontmatter)
    body.accessibilityTitle = ctx.source.accessibility.title
    body.accessibilityDescription = ctx.source.accessibility.descr
    return layoutResult(layoutBlockDiagram(body, ctx.renderOptions, ctx.styleFace, ctx.source.config.block as Record<string, unknown> | undefined))
  },
  projectPositioned: positionedView(projectBlockPositioned),
  lowerScene: scene(lowerBlockScene),
} satisfies BrowserSvgFamilyHooks
