import { diagnoseFlowchartConfig } from '../flowchart/config-diagnostics.ts'
import { projectGraphPositioned } from '../positioned-views/graph.ts'
import { layoutResult, positionedView, scene, type BrowserSvgFamilyHooks } from '../browser-lazy/family.ts'
import { resolveFlowchartRenderOptions, applyFlowchartLabelWrapping } from '../flowchart-config.ts'
import { flowchartStatementEnds } from '../flowchart-lexer.ts'
import { layoutGraphSync } from '../layout-engine.ts'
import { parseFlowchartRenderSource } from '../parser.ts'
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
    const graph = parseFlowchartRenderSource(ctx.source.authoredFamilyBody ?? ctx.source.familyBody, ctx.source.familyBody)
    checkAllGraphAuthoredStyles(graph)
    applyFlowchartLabelWrapping(graph, ctx.renderOptions, ctx.styleFace)
    const diagramTitle = frontmatterTitle(ctx.source.frontmatter)
    return layoutResult(layoutGraphSync(graph, {
      ...ctx.renderOptions,
      ...(ctx.styleFace ? { styleFace: ctx.styleFace } : {}),
      ...(diagramTitle ? { diagramTitle } : {}),
    }))
  },
  projectPositioned: positionedView(projectGraphPositioned),
  lowerScene: scene(lowerGraphScene),
} satisfies BrowserSvgFamilyHooks
