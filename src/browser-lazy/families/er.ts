import descriptorData from '../generated/descriptors/er.ts'
import { createBrowserFamilyDescriptor, layoutResult, scene } from '../family.ts'
import { applyErFrontmatterDirection, layoutErDiagram, resolveErRenderOptions } from '../../er/layout.ts'
import { parseErDiagram } from '../../er/parser.ts'
import { lowerErScene } from '../../er/renderer.ts'
import { withAccessibilityFields } from '../../shared/accessibility-directives.ts'
import { checkAllClassLikeAuthoredStyles } from '../../shared/style-props.ts'

export default createBrowserFamilyDescriptor(descriptorData, {
  normalizeRequest: ctx => ({
    renderOptions: resolveErRenderOptions(ctx.source.frontmatter, ctx.renderOptions),
  }),
  layout: ctx => {
    const diagram = applyErFrontmatterDirection(
      withAccessibilityFields(parseErDiagram(ctx.source.familyLines), ctx.source.accessibility),
      ctx.source.frontmatter,
    )
    checkAllClassLikeAuthoredStyles(diagram.classDefs, diagram.entities)
    return layoutResult(layoutErDiagram(diagram, ctx.renderOptions, ctx.styleFace))
  },
  lowerScene: scene(lowerErScene),
})
