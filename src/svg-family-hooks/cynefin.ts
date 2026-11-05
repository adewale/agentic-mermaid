import { layoutResult, positionedView, scene, type BrowserSvgFamilyHooks } from '../browser-lazy/family.ts'
import { parseCynefinBody } from '../agent/cynefin-body.ts'
import { layoutCynefin } from '../cynefin/layout.ts'
import { projectCynefinPositioned } from '../cynefin/projection.ts'
import { lowerCynefinScene } from '../cynefin/renderer.ts'
export const CYNEFIN_SVG_HOOKS = {
  layout: ctx => {
    const body = parseCynefinBody(ctx.source.authoredFamilyBody ?? ctx.source.familyBody)
    if (body.title === undefined && typeof ctx.source.frontmatter.title === 'string') body.title = ctx.source.frontmatter.title
    return layoutResult(layoutCynefin(body, ctx.renderOptions, ctx.styleFace))
  },
  projectPositioned: positionedView(projectCynefinPositioned), lowerScene: scene(lowerCynefinScene),
} satisfies BrowserSvgFamilyHooks
