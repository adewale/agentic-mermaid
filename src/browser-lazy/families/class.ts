import descriptorData from '../generated/descriptors/class.ts'
import { createBrowserFamilyDescriptor, layoutResult, scene } from '../family.ts'
import { layoutClassDiagram, resolveClassRenderOptions } from '../../class/layout.ts'
import { parseClassDiagram } from '../../class/parser.ts'
import { lowerClassScene } from '../../class/renderer.ts'
import { withAccessibilityFields } from '../../shared/accessibility-directives.ts'

export default createBrowserFamilyDescriptor(descriptorData, {
  normalizeRequest: ctx => ({
    renderOptions: resolveClassRenderOptions(ctx.source.frontmatter, ctx.renderOptions),
  }),
  layout: ctx => layoutResult(layoutClassDiagram(
    withAccessibilityFields(parseClassDiagram(ctx.source.familyLines), ctx.source.accessibility),
    ctx.renderOptions,
    ctx.styleFace,
  )),
  lowerScene: scene(lowerClassScene),
})
