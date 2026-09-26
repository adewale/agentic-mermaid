import descriptorData from '../generated/descriptors/flowchart.ts'
import { createBrowserFamilyDescriptor, layoutResult, scene } from '../family.ts'
import { resolveFlowchartRenderOptions, applyFlowchartLabelWrapping } from '../../flowchart-config.ts'
import { layoutGraphSync } from '../../layout-engine.ts'
import { parseMermaid } from '../../parser.ts'
import { lowerGraphScene } from '../../renderer.ts'
import { frontmatterTitle } from '../../mermaid-source.ts'

export default createBrowserFamilyDescriptor(descriptorData, {
  normalizeRequest: ctx => ({
    renderOptions: resolveFlowchartRenderOptions(ctx.source.frontmatter, ctx.renderOptions),
  }),
  layout: ctx => {
    const graph = parseMermaid(ctx.source.familyText)
    applyFlowchartLabelWrapping(graph, ctx.renderOptions, ctx.styleFace)
    const diagramTitle = frontmatterTitle(ctx.source.frontmatter)
    return layoutResult(layoutGraphSync(graph, {
      ...ctx.renderOptions,
      ...(ctx.styleFace ? { styleFace: ctx.styleFace } : {}),
      ...(diagramTitle ? { diagramTitle } : {}),
    }))
  },
  lowerScene: scene(lowerGraphScene),
})
