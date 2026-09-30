import { layoutResult, scene, type BrowserSvgFamilyHooks } from '../browser-lazy/family.ts'
import { layoutClassDiagram, resolveClassRenderOptions } from '../class/layout.ts'
import { parseClassDiagram } from '../class/parser.ts'
import { lowerClassScene } from '../class/renderer.ts'
import { withAccessibilityFields } from '../shared/accessibility-directives.ts'
import { normalizeMermaidSource, withFrontmatterTitle } from '../mermaid-source.ts'
import { checkAllClassLikeAuthoredStyles } from '../shared/style-props.ts'

/** The class SVG hooks: one definition for the complete renderer
 * (src/render-family-hooks.ts) and the lazy browser chunk. */
export const CLASS_SVG_HOOKS = {
  normalizeRequest: ctx => ({
    renderOptions: resolveClassRenderOptions(ctx.source.frontmatter, ctx.renderOptions),
  }),
  layout: ctx => {
    const diagram = withFrontmatterTitle(withAccessibilityFields(parseClassDiagram(
      ctx.source.familyLines,
      normalizeMermaidSource(ctx.source.originalText).familyLines,
    ), ctx.source.accessibility), ctx.source.frontmatter)
    checkAllClassLikeAuthoredStyles(diagram.classDefs, diagram.classes)
    return layoutResult(layoutClassDiagram(diagram, ctx.renderOptions, ctx.styleFace))
  },
  lowerScene: scene(lowerClassScene),
} satisfies BrowserSvgFamilyHooks
