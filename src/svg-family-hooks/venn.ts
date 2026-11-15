import { layoutResult, positionedView, scene, type BrowserSvgFamilyHooks } from '../browser-lazy/family.ts'
import { parseVennDiagram, vennStatementEnds } from '../venn/parser.ts'
import { layoutVennDiagram } from '../venn/layout.ts'
import { lowerVennScene } from '../venn/renderer.ts'
import { projectVennPositioned } from '../venn/projection.ts'
export const VENN_SVG_HOOKS = {
  statementEnds: vennStatementEnds,
  layout: ctx => layoutResult(layoutVennDiagram(parseVennDiagram(ctx.source.authoredFamilyBody ?? ctx.source.familyBody), ctx.renderOptions, ctx.styleFace, typeof ctx.source.frontmatter.title === 'string' ? ctx.source.frontmatter.title : undefined)),
  projectPositioned: positionedView(projectVennPositioned),
  lowerScene: scene(lowerVennScene),
} satisfies BrowserSvgFamilyHooks
