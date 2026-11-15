import { layoutResult, positionedView, scene, type BrowserSvgFamilyHooks } from '../browser-lazy/family.ts'
import { projectGraphPositioned } from '../positioned-views/graph.ts'
import { lowerGraphScene } from '../renderer.ts'
import { applyFlowchartLabelWrapping, resolveFlowchartRenderOptions } from '../flowchart-config.ts'
import { flowchartStatementEnds } from '../flowchart-lexer.ts'
import { checkAllGraphAuthoredStyles } from '../shared/style-props.ts'
import { parseSwimlaneRenderSource } from '../swimlane/parser.ts'
import { layoutSwimlane } from '../swimlane/layout.ts'
import { frontmatterTitle } from '../mermaid-source.ts'

export const SWIMLANE_SVG_HOOKS = {
  statementEnds: flowchartStatementEnds,
  normalizeRequest: ctx => ({ renderOptions: resolveFlowchartRenderOptions(ctx.source.frontmatter, ctx.renderOptions) }),
  layout: ctx => {
    const graph = parseSwimlaneRenderSource(ctx.source.authoredFamilyBody ?? ctx.source.familyBody, ctx.source.familyBody)
    checkAllGraphAuthoredStyles(graph)
    applyFlowchartLabelWrapping(graph, ctx.renderOptions, ctx.styleFace)
    return layoutResult(layoutSwimlane(graph, { ...ctx.renderOptions, ...(ctx.styleFace ? { styleFace: ctx.styleFace } : {}) }, frontmatterTitle(ctx.source.frontmatter)))
  },
  projectPositioned: positionedView(projectGraphPositioned),
  lowerScene: scene(lowerGraphScene),
} satisfies BrowserSvgFamilyHooks
