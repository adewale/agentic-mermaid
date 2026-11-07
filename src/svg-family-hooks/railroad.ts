import { layoutResult, positionedView, scene, type BrowserSvgFamilyHooks } from '../browser-lazy/family.ts'
import { parseRailroad } from '../railroad/parser.ts'
import { layoutRailroad } from '../railroad/layout.ts'
import { lowerRailroadScene } from '../railroad/renderer.ts'
import { projectRailroadPositioned } from '../railroad/projection.ts'
import { frontmatterTitle } from '../mermaid-source.ts'

export const RAILROAD_SVG_HOOKS = {
  layout: ctx => layoutResult(layoutRailroad(parseRailroad(ctx.source.authoredFamilyBody ?? ctx.source.familyBody), ctx.renderOptions, ctx.styleFace, frontmatterTitle(ctx.source.frontmatter))),
  projectPositioned: positionedView(projectRailroadPositioned),
  lowerScene: scene(lowerRailroadScene),
} satisfies BrowserSvgFamilyHooks
