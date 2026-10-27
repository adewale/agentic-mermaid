import { layoutResult, positionedView, scene, type BrowserSvgFamilyHooks } from '../browser-lazy/family.ts'
import { frontmatterTitle, preservedMermaidFamilyText } from '../mermaid-source.ts'
import { parseZenUML, zenUMLStatementEnds } from '../zenuml/native-parser.ts'
import { layoutZenUML, lowerZenUMLScene } from '../zenuml/native-render.ts'
import { projectZenUMLPositioned } from '../positioned-views/zenuml.ts'

export const ZENUML_SVG_HOOKS = {
  statementEnds: zenUMLStatementEnds,
  layout: ctx => {
    const body = parseZenUML(preservedMermaidFamilyText(ctx.source))
    body.title ??= frontmatterTitle(ctx.source.frontmatter)
    body.accessibilityTitle = ctx.source.accessibility.title ?? body.accessibilityTitle
    body.accessibilityDescription = ctx.source.accessibility.descr ?? body.accessibilityDescription
    return layoutResult(layoutZenUML(body, ctx.renderOptions, ctx.styleFace))
  },
  projectPositioned: positionedView(projectZenUMLPositioned),
  lowerScene: scene(lowerZenUMLScene),
} satisfies BrowserSvgFamilyHooks
