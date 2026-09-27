import descriptorData from '../generated/descriptors/class.ts'
import { createBrowserFamilyDescriptor, layoutResult, scene } from '../family.ts'
import { layoutClassDiagram, resolveClassRenderOptions } from '../../class/layout.ts'
import { parseClassDiagram } from '../../class/parser.ts'
import { lowerClassScene } from '../../class/renderer.ts'
import { withAccessibilityFields } from '../../shared/accessibility-directives.ts'
import { normalizeMermaidSource } from '../../mermaid-source.ts'
import { checkAllClassLikeAuthoredStyles } from '../../shared/style-props.ts'

export default createBrowserFamilyDescriptor(descriptorData, {
  normalizeRequest: ctx => ({
    renderOptions: resolveClassRenderOptions(ctx.source.frontmatter, ctx.renderOptions),
  }),
  layout: ctx => {
    const diagram = withAccessibilityFields(parseClassDiagram(
      ctx.source.familyLines,
      normalizeMermaidSource(ctx.source.originalText).familyLines,
    ), ctx.source.accessibility)
    checkAllClassLikeAuthoredStyles(diagram.classDefs, diagram.classes)
    return layoutResult(layoutClassDiagram(diagram, ctx.renderOptions, ctx.styleFace))
  },
  lowerScene: scene(lowerClassScene),
})
