import { withFrontmatterTitle } from '../mermaid-source.ts'
import { layoutResult, scene, type BrowserSvgFamilyHooks } from '../browser-lazy/family.ts'
import { resolveArchitectureVisualConfig } from '../architecture/config.ts'
import { layoutArchitectureDiagram } from '../architecture/layout.ts'
import { parseArchitectureDiagram } from '../architecture/parser.ts'
import { lowerArchitectureScene } from '../architecture/renderer.ts'
import { withAccessibilityFields } from '../shared/accessibility-directives.ts'

/** The architecture SVG hooks: one definition for the complete renderer
 * (src/render-family-hooks.ts) and the lazy browser chunk. */
export const ARCHITECTURE_SVG_HOOKS = {
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
    const diagram = withFrontmatterTitle(withAccessibilityFields(
      parseArchitectureDiagram(ctx.source.familyLines),
      ctx.source.accessibility,
    ), ctx.source.frontmatter)
    return layoutResult(layoutArchitectureDiagram(diagram, ctx.renderOptions, familyConfig?.layout), {
      injectAccessibility: false,
    })
  },
  lowerScene: scene(lowerArchitectureScene),
} satisfies BrowserSvgFamilyHooks
