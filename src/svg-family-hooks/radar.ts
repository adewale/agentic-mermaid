import { RADAR_NORMALIZE_REQUEST } from '../family-request-hooks.ts'
import { diagnoseRadarConfig } from '../radar/config-diagnostics.ts'
import { projectRadarPositioned } from '../positioned-views/radar.ts'
import { layoutResult, positionedView, scene, type BrowserSvgFamilyHooks } from '../browser-lazy/family.ts'
import { resolveRadarVisualConfig } from '../radar/config.ts'
import { layoutRadarChart } from '../radar/layout.ts'
import { parseRadarChart, radarStatementEnds } from '../radar/parser.ts'
import { familyParserLines } from '../shared/parser-source.ts'
import { lowerRadarScene } from '../radar/renderer.ts'

/** The radar SVG hooks: one definition for the complete renderer
 * (src/render-family-hooks.ts) and the lazy browser chunk. */
export const RADAR_SVG_HOOKS = {
  configDiagnostics: diagnoseRadarConfig,
  statementEnds: radarStatementEnds,
  normalizeRequest: RADAR_NORMALIZE_REQUEST,
  layout: ctx => layoutResult(layoutRadarChart(
    parseRadarChart(familyParserLines({ familyBody: ctx.source.body, familyLines: ctx.source.lines }), {
      title: typeof ctx.source.frontmatter.title === 'string' ? ctx.source.frontmatter.title : undefined,
    }),
    ctx.renderOptions,
    (ctx.familyConfig as { visual?: ReturnType<typeof resolveRadarVisualConfig> } | undefined)?.visual
      ?? resolveRadarVisualConfig(ctx.source.frontmatter),
    ctx.styleFace,
  ), { injectAccessibility: false }),
  projectPositioned: positionedView(projectRadarPositioned),
  lowerScene: scene(lowerRadarScene),
} satisfies BrowserSvgFamilyHooks
