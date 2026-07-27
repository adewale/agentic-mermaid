import descriptorData from '../generated/descriptors/sequence.ts'
import { createBrowserFamilyDescriptor, layoutResult, scene } from '../family.ts'
import { resolveSequenceConfig } from '../../sequence/config.ts'
import { layoutSequenceDiagram } from '../../sequence/layout.ts'
import { parseSequenceDiagram } from '../../sequence/parser.ts'
import { lowerSequenceScene } from '../../sequence/renderer.ts'
import { withAccessibilityFields } from '../../shared/accessibility-directives.ts'

export default createBrowserFamilyDescriptor(descriptorData, {
  normalizeRequest: ctx => ({
    familyConfig: { sequence: resolveSequenceConfig(ctx.source.frontmatter) },
  }),
  layout: ctx => {
    const seqConfig = (ctx.familyConfig as {
      sequence?: ReturnType<typeof resolveSequenceConfig>
    } | undefined)?.sequence ?? {}
    const diagram = withAccessibilityFields(
      parseSequenceDiagram(ctx.source.familyLines, seqConfig),
      ctx.source.accessibility,
    )
    return layoutResult(layoutSequenceDiagram(diagram, ctx.renderOptions, seqConfig, ctx.styleFace))
  },
  lowerScene: scene(lowerSequenceScene),
})
