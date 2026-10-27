import { layoutResult, positionedView, scene, type BrowserSvgFamilyHooks } from '../browser-lazy/family.ts'
import { parseZenUml } from '../zenuml/parser.ts'
import { projectZenUmlSequence } from '../zenuml/projection.ts'
import { layoutSequenceDiagram } from '../sequence/layout.ts'
import { lowerZenUmlScene } from '../zenuml/renderer.ts'
import { projectSequencePositioned } from '../positioned-views/sequence.ts'
import { resolveSequenceConfig } from '../sequence/config.ts'
export const ZENUML_SVG_HOOKS = {
  normalizeRequest: ctx => ({ familyConfig: { sequence: resolveSequenceConfig(ctx.source.frontmatter) } }),
  layout: ctx => {
    const body = parseZenUml(ctx.source.authoredFamilyBody ?? ctx.source.familyBody)
    body.title ??= typeof ctx.source.frontmatter.title === 'string' ? ctx.source.frontmatter.title : undefined
    const config = ctx.familyConfig?.sequence as ReturnType<typeof resolveSequenceConfig> | undefined
    return layoutResult(layoutSequenceDiagram(projectZenUmlSequence(body), ctx.renderOptions, config, ctx.styleFace))
  },
  projectPositioned: positionedView(projectSequencePositioned),
  lowerScene: scene(lowerZenUmlScene),
} satisfies BrowserSvgFamilyHooks
