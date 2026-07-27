import descriptorData from '../generated/descriptors/architecture.ts'
import { createBrowserFamilyDescriptor, layoutResult, scene } from '../family.ts'
import { resolveArchitectureVisualConfig } from '../../architecture/config.ts'
import { layoutArchitectureDiagram } from '../../architecture/layout.ts'
import { parseArchitectureDiagram } from '../../architecture/parser.ts'
import { lowerArchitectureScene } from '../../architecture/renderer.ts'
import { withAccessibilityFields } from '../../shared/accessibility-directives.ts'

export default createBrowserFamilyDescriptor(descriptorData, {
  normalizeRequest: ctx => {
    const resolved = resolveArchitectureVisualConfig(ctx.source.frontmatter, ctx.colors, ctx.renderOptions, ctx.styleFace)
    const renderOptions = {
      ...ctx.renderOptions,
      padding: ctx.renderOptions.padding ?? resolved.padding,
      nodeSpacing: ctx.renderOptions.nodeSpacing ?? resolved.nodeSpacing,
      layerSpacing: ctx.renderOptions.layerSpacing ?? resolved.layerSpacing,
    }
    return {
      renderOptions,
      familyConfig: { layout: resolved.layout },
      appearance: { family: { visual: resolved.visual } },
    }
  },
  layout: ctx => {
    const familyConfig = ctx.familyConfig as {
      layout: ReturnType<typeof resolveArchitectureVisualConfig>['layout']
    } | undefined
    const diagram = withAccessibilityFields(
      parseArchitectureDiagram(ctx.source.familyLines),
      ctx.source.accessibility,
    )
    return layoutResult(layoutArchitectureDiagram(diagram, ctx.renderOptions, familyConfig?.layout), {
      injectAccessibility: false,
    })
  },
  lowerScene: scene(lowerArchitectureScene),
})
