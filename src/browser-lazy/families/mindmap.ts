import descriptorData from '../generated/descriptors/mindmap.ts'
import { createBrowserFamilyDescriptor, layoutResult, scene } from '../family.ts'
import { parseMindmap } from '../../mindmap/parser.ts'
import { positionMindmap, resolveMindmapPositionConfig } from '../../mindmap/position.ts'
import { lowerMindmapScene } from '../../mindmap/renderer.ts'
import { withAccessibilityFields } from '../../shared/accessibility-directives.ts'

export default createBrowserFamilyDescriptor(descriptorData, {
  normalizeRequest: ctx => ({
    familyConfig: {
      position: resolveMindmapPositionConfig(ctx.source.config.mindmap, ctx.source.config.layout),
    },
  }),
  layout: ctx => layoutResult(positionMindmap(
    withAccessibilityFields(parseMindmap(ctx.source.familyBody), ctx.source.accessibility),
    (ctx.familyConfig as { position?: ReturnType<typeof resolveMindmapPositionConfig> } | undefined)?.position
      ?? resolveMindmapPositionConfig(undefined, undefined),
  ), { injectAccessibility: false }),
  lowerScene: scene(lowerMindmapScene),
})
