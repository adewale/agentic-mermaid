import { CLASS_NORMALIZE_REQUEST } from '../family-request-hooks.ts'
import { withParserSource } from '../shared/parser-source.ts'
import { diagnoseClassConfig } from '../class/config-diagnostics.ts'
import { projectClassPositioned } from '../positioned-views/class.ts'
import { layoutResult, positionedView, scene, type BrowserSvgFamilyHooks } from '../browser-lazy/family.ts'
import { layoutClassDiagram } from '../class/layout.ts'
import { classStatementEnds, expandInlineNamespaceStatement, parseClassDiagram } from '../class/parser.ts'
import { lowerClassScene } from '../class/renderer.ts'
import { withAccessibilityFields } from '../shared/accessibility-directives.ts'
import { withFrontmatterTitle } from '../mermaid-source.ts'
import { checkAllClassLikeAuthoredStyles } from '../shared/style-props.ts'

/** The class SVG hooks: one definition for the complete renderer
 * (src/render-family-hooks.ts) and the lazy browser chunk. */
export const CLASS_SVG_HOOKS = {
  configDiagnostics: diagnoseClassConfig,
  statementEnds: classStatementEnds,
  normalizeRequest: CLASS_NORMALIZE_REQUEST,
  layout: ctx => {
    const diagram = withFrontmatterTitle(withAccessibilityFields(withParserSource(ctx.source, () => ctx.source.familyLines.flatMap(expandInlineNamespaceStatement), () => parseClassDiagram(
      ctx.source.familyLines,
      ctx.source.authoredFamilyLines ?? ctx.source.familyLines,
    )), ctx.source.accessibility), ctx.source.frontmatter)
    checkAllClassLikeAuthoredStyles(diagram.classDefs, diagram.classes)
    return layoutResult(layoutClassDiagram(diagram, ctx.renderOptions, ctx.styleFace, ctx.paintBackendId))
  },
  projectPositioned: positionedView(projectClassPositioned),
  lowerScene: scene(lowerClassScene),
} satisfies BrowserSvgFamilyHooks
