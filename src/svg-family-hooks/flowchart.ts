import { withParserSource } from '../shared/parser-source.ts'
import { diagnoseFlowchartConfig } from '../flowchart/config-diagnostics.ts'
import { projectGraphPositioned } from '../positioned-views/graph.ts'
import { layoutResult, positionedView, scene, type BrowserSvgFamilyHooks } from '../browser-lazy/family.ts'
import { resolveFlowchartRenderOptions, applyFlowchartLabelWrapping } from '../flowchart-config.ts'
import { flowchartStatementEnds } from '../flowchart-lexer.ts'
import { layoutFlowchartViewport } from '../layout/flowchart-viewport.ts'
import { layoutGraphSync } from '../layout-engine.ts'
import { parseFlowchartRenderSource } from '../flowchart-parser-entry.ts'
import { lowerGraphScene } from '../renderer.ts'
import { frontmatterTitle } from '../mermaid-source.ts'
import { checkAllGraphAuthoredStyles } from '../shared/style-props.ts'

/** The flowchart SVG hooks: one definition for the complete renderer
 * (src/render-family-hooks.ts) and the lazy browser chunk. */
// Flowchart proper (not state) additionally wires the typed `flowchart`
// frontmatter config section (nodeSpacing/rankSpacing/wrappingWidth —
// explicit RenderOptions win; unwired keys are named by verify's
// INEFFECTIVE_CONFIG lint) and applies measured-width label wrapping before
// ELK sizing so layout, renderer, and SVG see the same lines.
export const FLOWCHART_SVG_HOOKS = {
  configDiagnostics: diagnoseFlowchartConfig,
  statementEnds: flowchartStatementEnds,
  normalizeRequest: ctx => ({
    renderOptions: resolveFlowchartRenderOptions(ctx.source.frontmatter, ctx.renderOptions),
  }),
  layout: ctx => {
    const graph = withParserSource(ctx.source, () => ctx.source.familyBody.split('\n'), () => parseFlowchartRenderSource(ctx.source.authoredFamilyBody ?? ctx.source.familyBody, ctx.source.familyBody))
    checkAllGraphAuthoredStyles(graph)
    applyFlowchartLabelWrapping(graph, ctx.renderOptions, ctx.styleFace)
    const diagramTitle = frontmatterTitle(ctx.source.frontmatter)
    return layoutResult(ctx.renderOptions.graphLayout?.viewport
      ? layoutFlowchartViewport(graph, ctx.renderOptions, ctx.styleFace, diagramTitle)
      : layoutGraphSync(graph, { ...ctx.renderOptions, styleFace: ctx.styleFace, ...(diagramTitle ? { diagramTitle } : {}) }))
  },
  projectPositioned: positionedView(projectGraphPositioned),
  lowerScene: scene(lowerGraphScene),
} satisfies BrowserSvgFamilyHooks
