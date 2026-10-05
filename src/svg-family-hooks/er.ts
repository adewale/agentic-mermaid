import { layoutResult, scene, type BrowserSvgFamilyHooks } from '../browser-lazy/family.ts'
import { applyErFrontmatterDirection, layoutErDiagram, resolveErRenderOptions } from '../er/layout.ts'
import { parseErDiagram } from '../er/parser.ts'
import { lowerErScene } from '../er/renderer.ts'
import { withAccessibilityFields } from '../shared/accessibility-directives.ts'
import { withFrontmatterTitle } from '../mermaid-source.ts'
import { checkAllClassLikeAuthoredStyles } from '../shared/style-props.ts'

/** The ER SVG hooks: one definition for the complete renderer
 * (src/render-family-hooks.ts) and the lazy browser chunk. */
export const ER_SVG_HOOKS = {
  normalizeRequest: ctx => ({
    renderOptions: resolveErRenderOptions(ctx.source.frontmatter, ctx.renderOptions),
  }),
  // Wire-or-warn config threading: er.layoutDirection + nodeSpacing/
  // rankSpacing fold into the parsed diagram/options (statement + explicit
  // options win over frontmatter).
  layout: ctx => {
    const diagram = withFrontmatterTitle(applyErFrontmatterDirection(
      withAccessibilityFields(parseErDiagram(ctx.source.familyLines), ctx.source.accessibility),
      ctx.source.frontmatter,
    ), ctx.source.frontmatter)
    checkAllClassLikeAuthoredStyles(diagram.classDefs, diagram.entities)
    return layoutResult(layoutErDiagram(diagram, ctx.renderOptions, ctx.styleFace))
  },
  lowerScene: scene(lowerErScene),
} satisfies BrowserSvgFamilyHooks
