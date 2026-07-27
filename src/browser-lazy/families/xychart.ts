import descriptorData from '../generated/descriptors/xychart.ts'
import { createBrowserFamilyDescriptor, layoutResult, scene } from '../family.ts'
import { layoutXYChart } from '../../xychart/layout.ts'
import {
  applyResolvedXYChartConfig,
  parseXYChart,
  resolveXYChartConfig,
  resolveXYChartTheme,
} from '../../xychart/parser.ts'
import { lowerXYChartScene } from '../../xychart/renderer.ts'
import { withAccessibilityObject } from '../../shared/accessibility-directives.ts'

export default createBrowserFamilyDescriptor(descriptorData, {
  normalizeRequest: ctx => {
    const config = resolveXYChartConfig(ctx.source.frontmatter)
    const theme = resolveXYChartTheme(ctx.source.frontmatter)
    return {
      familyConfig: { config },
      appearance: {
        ...(ctx.renderOptions.bg === undefined && theme.backgroundColor
          ? { colors: { bg: theme.backgroundColor } }
          : {}),
        family: { theme },
      },
    }
  },
  layout: ctx => {
    const familyConfig = ctx.familyConfig as { config: ReturnType<typeof resolveXYChartConfig> } | undefined
    const familyAppearance = ctx.familyAppearance as { theme: ReturnType<typeof resolveXYChartTheme> } | undefined
    const chart = applyResolvedXYChartConfig(
      withAccessibilityObject(parseXYChart(ctx.source.familyLines), ctx.source.accessibility),
      familyConfig?.config ?? resolveXYChartConfig({}),
      familyAppearance?.theme ?? resolveXYChartTheme({}),
    )
    return layoutResult(layoutXYChart(chart, ctx.renderOptions, ctx.styleFace), { injectAccessibility: false })
  },
  lowerScene: scene(lowerXYChartScene),
})
