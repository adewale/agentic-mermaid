import type { ResolvedStateVisualConfig } from '../state/config.ts'
import { layoutResult, scene, type BrowserSvgFamilyHooks } from '../browser-lazy/family.ts'
import { layoutGraphSync } from '../layout-engine.ts'
import { parseMermaid } from '../parser.ts'
import { lowerGraphScene } from '../renderer.ts'
import { frontmatterTitle } from '../mermaid-source.ts'
import { resolveStateRenderOptions } from '../state/config.ts'
import { checkAllGraphAuthoredStyles } from '../shared/style-props.ts'

/** The state SVG hooks: one definition for the complete renderer
 * (src/render-family-hooks.ts) and the lazy browser chunk. */
export const STATE_SVG_HOOKS = {
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
    const diagramTitle = frontmatterTitle(ctx.source.frontmatter)
    const graph = parseMermaid(ctx.source.familyText)
    checkAllGraphAuthoredStyles(graph)
    return layoutResult(layoutGraphSync(graph, {
      ...ctx.renderOptions,
      ...(ctx.styleFace ? { styleFace: ctx.styleFace } : {}),
      ...(stateVisual ? { stateVisual } : {}),
      ...(diagramTitle ? { diagramTitle } : {}),
    }))
  },
  lowerScene: scene(lowerGraphScene),
} satisfies BrowserSvgFamilyHooks
