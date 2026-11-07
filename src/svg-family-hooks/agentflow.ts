import { layoutResult, positionedView, scene, type BrowserSvgFamilyHooks } from '../browser-lazy/family.ts'
import { projectGraphPositioned } from '../positioned-views/graph.ts'
import { lowerGraphScene } from '../renderer.ts'
import { nativeFamilyGraphLayout } from '../layout/native-family-policy.ts'
import { layoutGraphSync } from '../layout-engine.ts'
import { applyFlowchartLabelWrapping, resolveFlowchartRenderOptions } from '../flowchart-config.ts'
import { flowchartStatementEnds } from '../flowchart-lexer.ts'
import { checkAllGraphAuthoredStyles } from '../shared/style-props.ts'
import { parseAgentflow } from '../agentflow/parser.ts'
import { projectAgentflowGraph } from '../agentflow/projection.ts'
import { frontmatterTitle } from '../mermaid-source.ts'
import { ownedAgentflowRenderGraph } from '../agent/owned-render-model.ts'

export const AGENTFLOW_SVG_HOOKS = {
  statementEnds: flowchartStatementEnds,
  normalizeRequest: ctx => ({ renderOptions: resolveFlowchartRenderOptions(ctx.source.frontmatter, ctx.renderOptions) }),
  layout: ctx => {
    const graph = ownedAgentflowRenderGraph(ctx.source) ?? projectAgentflowGraph(parseAgentflow(ctx.source.authoredFamilyBody ?? ctx.source.familyBody))
    checkAllGraphAuthoredStyles(graph)
    applyFlowchartLabelWrapping(graph, ctx.renderOptions, ctx.styleFace)
    const positioned = layoutGraphSync(graph, { ...ctx.renderOptions, graphLayout: nativeFamilyGraphLayout(graph, ctx.renderOptions), ...(ctx.styleFace ? { styleFace: ctx.styleFace } : {}), diagramTitle: frontmatterTitle(ctx.source.frontmatter) })
    // Certified forest nodes do not overlap; geometric paint order is stable
    // across equivalent declaration spellings without changing model order.
    if (positioned.layoutDecision?.selected === 'agentic') positioned.nodes.sort((a, b) => a.y - b.y || a.x - b.x || a.id.localeCompare(b.id))
    return layoutResult(positioned)
  },
  projectPositioned: positionedView(projectGraphPositioned),
  lowerScene: scene(lowerGraphScene),
} satisfies BrowserSvgFamilyHooks
