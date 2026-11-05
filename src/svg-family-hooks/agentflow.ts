import { layoutResult, positionedView, scene, type BrowserSvgFamilyHooks } from '../browser-lazy/family.ts'
import { projectGraphPositioned } from '../positioned-views/graph.ts'
import { lowerGraphScene } from '../renderer.ts'
import { layoutGraphSync } from '../layout-engine.ts'
import { applyFlowchartLabelWrapping, resolveFlowchartRenderOptions } from '../flowchart-config.ts'
import { flowchartStatementEnds } from '../flowchart-lexer.ts'
import { checkAllGraphAuthoredStyles } from '../shared/style-props.ts'
import { parseAgentflow } from '../agentflow/parser.ts'
import { projectAgentflowGraph } from '../agentflow/projection.ts'
import { frontmatterTitle } from '../mermaid-source.ts'

export const AGENTFLOW_SVG_HOOKS = {
  statementEnds: flowchartStatementEnds,
  normalizeRequest: ctx => ({ renderOptions: resolveFlowchartRenderOptions(ctx.source.frontmatter, ctx.renderOptions) }),
  layout: ctx => {
    const graph = projectAgentflowGraph(parseAgentflow(ctx.source.authoredFamilyBody ?? ctx.source.familyBody))
    checkAllGraphAuthoredStyles(graph)
    applyFlowchartLabelWrapping(graph, ctx.renderOptions, ctx.styleFace)
    return layoutResult(layoutGraphSync(graph, { ...ctx.renderOptions, ...(ctx.styleFace ? { styleFace: ctx.styleFace } : {}), diagramTitle: frontmatterTitle(ctx.source.frontmatter) }))
  },
  projectPositioned: positionedView(projectGraphPositioned),
  lowerScene: scene(lowerGraphScene),
} satisfies BrowserSvgFamilyHooks
