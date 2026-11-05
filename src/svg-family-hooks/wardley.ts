import { layoutResult, positionedView, scene, type BrowserSvgFamilyHooks } from '../browser-lazy/family.ts'
import { parseWardleyBody } from '../agent/wardley-body.ts'
import { layoutWardley } from '../wardley/layout.ts'
import { projectWardleyPositioned } from '../wardley/projection.ts'
import { lowerWardleyScene } from '../wardley/renderer.ts'
export const WARDLEY_SVG_HOOKS = {
  layout: ctx => {
    const body = parseWardleyBody(ctx.source.authoredFamilyBody ?? ctx.source.familyBody)
    if (body.title === undefined && typeof ctx.source.frontmatter.title === 'string') body.title = ctx.source.frontmatter.title
    return layoutResult(layoutWardley(body, ctx.renderOptions, ctx.styleFace))
  },
  projectPositioned: positionedView(projectWardleyPositioned), lowerScene: scene(lowerWardleyScene),
} satisfies BrowserSvgFamilyHooks
