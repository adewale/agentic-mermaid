import { diagnoseRequirementConfig } from '../requirement/config-diagnostics.ts'
import { layoutResult, positionedView, scene, type BrowserSvgFamilyHooks } from '../browser-lazy/family.ts'
import { parseRequirementDiagram } from '../requirement/parser.ts'
import { layoutRequirementDiagram } from '../requirement/layout.ts'
import { lowerRequirementScene, projectRequirementPositioned } from '../requirement/renderer.ts'
import { frontmatterTitle, preservedMermaidFamilyText } from '../mermaid-source.ts'
import { requirementStatementEnds } from '../requirement/lexer.ts'
export const REQUIREMENT_SVG_HOOKS = {
  configDiagnostics: diagnoseRequirementConfig,
  statementEnds: requirementStatementEnds,
  layout: ctx => {
    const body = parseRequirementDiagram(preservedMermaidFamilyText(ctx.source))
    body.title ??= frontmatterTitle(ctx.source.frontmatter)
    body.accessibilityTitle = ctx.source.accessibility.title ?? body.accessibilityTitle
    body.accessibilityDescription = ctx.source.accessibility.descr ?? body.accessibilityDescription
    return layoutResult(layoutRequirementDiagram(body, ctx.renderOptions, ctx.styleFace, ctx.source.config.requirement as Record<string, unknown> | undefined))
  },
  projectPositioned: positionedView(projectRequirementPositioned),
  lowerScene: scene(lowerRequirementScene),
} satisfies BrowserSvgFamilyHooks
