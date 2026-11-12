import { XYCHART_NORMALIZE_REQUEST } from '../xychart/parser.ts'
import { diagnoseXyChartConfig } from '../xychart/config-diagnostics.ts'
import { projectXyChartPositioned } from '../positioned-views/xychart.ts'
import { withFrontmatterTitle } from '../mermaid-source.ts'
import { layoutResult, positionedView, scene, type BrowserSvgFamilyHooks } from '../browser-lazy/family.ts'
import { layoutXYChart } from '../xychart/layout.ts'
import {
  applyResolvedXYChartConfig,
  parseXYChart,
  resolveXYChartConfig,
  resolveXYChartTheme,
  xychartStatementEnds,
} from '../xychart/parser.ts'
import { lowerXYChartScene } from '../xychart/renderer.ts'
import { withAccessibilityObject } from '../shared/accessibility-directives.ts'
import { familyParserLines } from '../shared/parser-source.ts'

/** The xychart SVG hooks: one definition for the complete renderer
 * (src/render-family-hooks.ts) and the lazy browser chunk. */
export const XYCHART_SVG_HOOKS = {
  configDiagnostics: diagnoseXyChartConfig,
  statementEnds: xychartStatementEnds,
  normalizeRequest: XYCHART_NORMALIZE_REQUEST,
  layout: ctx => {
    const familyConfig = ctx.familyConfig as { config: ReturnType<typeof resolveXYChartConfig> } | undefined
    const familyAppearance = ctx.familyAppearance as { theme: ReturnType<typeof resolveXYChartTheme> } | undefined
    const chart = applyResolvedXYChartConfig(
      withFrontmatterTitle(withAccessibilityObject(parseXYChart(familyParserLines(ctx.source)), ctx.source.accessibility), ctx.source.frontmatter),
      familyConfig?.config ?? resolveXYChartConfig({}),
      familyAppearance?.theme ?? resolveXYChartTheme({}),
    )
    return layoutResult(layoutXYChart(chart, ctx.renderOptions, ctx.styleFace), { injectAccessibility: false })
  },
  projectPositioned: positionedView(projectXyChartPositioned),
  lowerScene: scene(lowerXYChartScene),
} satisfies BrowserSvgFamilyHooks
