import { type BrowserSvgFamilyHooks, layoutResult, positionedView, scene } from '../browser-lazy/family.ts'
import { projectGraphPositioned } from '../positioned-views/graph.ts'
import { layoutUsecaseDiagram } from '../usecase/layout.ts'
import { parseUsecaseDiagram, usecaseStatementEnds } from '../usecase/parser.ts'
import { lowerUsecaseScene } from '../usecase/renderer.ts'
export const USECASE_SVG_HOOKS = {
  statementEnds: usecaseStatementEnds,
  layout: ctx => layoutResult(layoutUsecaseDiagram(parseUsecaseDiagram(ctx.source.authoredFamilyBody ?? ctx.source.familyBody), ctx.renderOptions, ctx.styleFace, typeof ctx.source.frontmatter.title === 'string' ? ctx.source.frontmatter.title : undefined)),
  projectPositioned: positionedView(projectGraphPositioned),
  lowerScene: scene(lowerUsecaseScene),
} satisfies BrowserSvgFamilyHooks
