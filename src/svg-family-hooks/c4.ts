import { diagnoseC4Config } from '../c4/config-diagnostics.ts'
import { layoutResult, positionedView, scene, type BrowserSvgFamilyHooks } from '../browser-lazy/family.ts'
import { projectC4Positioned } from '../positioned-views/c4.ts'
import { layoutC4Diagram } from '../c4/layout.ts'
import { parseC4Diagram } from '../c4/parser.ts'
import { lowerC4Scene } from '../c4/renderer.ts'
import type { C4Body } from '../c4/types.ts'
import { frontmatterTitle } from '../mermaid-source.ts'

/** Parse authored identities once at the request boundary, before any output
 * display admission. Pixel and cell adapters consume this same semantic plan. */
export const C4_SVG_HOOKS = {
  configDiagnostics: diagnoseC4Config,
  normalizeRequest: ctx => {
    const wrapperLength = ctx.source.authoredWrapperLength ?? ctx.source.wrapperSource?.length ?? 0
    const wrapper = ctx.source.originalText.slice(0, wrapperLength)
    const body = parseC4Diagram(ctx.source.originalText.slice(wrapperLength))
    const lineOffset = wrapper.split(/\r\n?|\n/).length - 1
    for (const statement of body.statements) {
      statement.span.start += wrapper.length
      statement.span.end += wrapper.length
      statement.span.line += lineOffset
    }
    const title = frontmatterTitle(ctx.source.frontmatter)
    if (body.title === undefined && title !== undefined) body.title = title
    if (ctx.source.accessibility.title !== undefined) body.accessibilityTitle = ctx.source.accessibility.title
    if (ctx.source.accessibility.descr !== undefined) body.accessibilityDescription = ctx.source.accessibility.descr
    return {
      familyConfig: {
        model: body,
        c4: ctx.source.config.c4 ?? {},
        themeVariables: ctx.source.config.themeVariables ?? {},
      },
    }
  },
  layout: ctx => {
    const config = ctx.familyConfig as {
      model: C4Body
      c4: Record<string, unknown>
      themeVariables: Record<string, unknown>
    }
    return layoutResult(layoutC4Diagram(config.model, ctx.renderOptions, ctx.styleFace, config.c4, config.themeVariables))
  },
  projectPositioned: positionedView(projectC4Positioned),
  lowerScene: scene(lowerC4Scene),
} satisfies BrowserSvgFamilyHooks
