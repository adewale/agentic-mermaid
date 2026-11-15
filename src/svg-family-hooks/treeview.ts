import { type BrowserSvgFamilyHooks, layoutResult, positionedView, scene } from '../browser-lazy/family.ts'
import { layoutTreeviewDiagram } from '../treeview/layout.ts'
import { parseTreeviewDiagram } from '../treeview/parser.ts'
import { projectTreeviewPositioned } from '../treeview/projection.ts'
import { lowerTreeviewScene } from '../treeview/renderer.ts'

export const TREEVIEW_SVG_HOOKS = {
  layout: ctx =>
    layoutResult(layoutTreeviewDiagram(parseTreeviewDiagram(ctx.source.authoredFamilyBody ?? ctx.source.familyBody), ctx.renderOptions, ctx.styleFace, typeof ctx.source.frontmatter.title === 'string' ? ctx.source.frontmatter.title : undefined, ctx.source.config.treeView as Record<string, unknown> | undefined)),
  projectPositioned: positionedView(projectTreeviewPositioned),
  lowerScene: scene(lowerTreeviewScene),
} satisfies BrowserSvgFamilyHooks
