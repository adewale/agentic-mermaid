import type { ResolvedStateVisualConfig } from '../../state/config.ts'
import descriptorData from '../generated/descriptors/state.ts'
import { createBrowserFamilyDescriptor, layoutResult, scene } from '../family.ts'
import { layoutGraphSync } from '../../layout-engine.ts'
import { parseMermaid } from '../../parser.ts'
import { lowerGraphScene } from '../../renderer.ts'
import { resolveStateRenderOptions } from '../../state/config.ts'

export default createBrowserFamilyDescriptor(descriptorData, {
  normalizeRequest: ctx => {
    const resolved = resolveStateRenderOptions(ctx.source.frontmatter, ctx.renderOptions)
    const { stateVisual, ...renderOptions } = resolved
    return {
      renderOptions,
      ...(stateVisual ? { appearance: { family: { visual: stateVisual } } } : {}),
    }
  },
  layout: ctx => {
    const stateVisual = (ctx.familyAppearance as { visual?: ResolvedStateVisualConfig } | undefined)?.visual
    return layoutResult(layoutGraphSync(parseMermaid(ctx.source.familyText), {
      ...ctx.renderOptions,
      ...(ctx.styleFace ? { styleFace: ctx.styleFace } : {}),
      ...(stateVisual ? { stateVisual } : {}),
    }))
  },
  lowerScene: scene(lowerGraphScene),
})
