import descriptorData from '../generated/descriptors/journey.ts'
import { createBrowserFamilyDescriptor, layoutResult, scene } from '../family.ts'
import { layoutJourneyDiagram, resolveJourneyRequestAppearance } from '../../journey/layout.ts'
import { parseJourneyDiagram } from '../../journey/parser.ts'
import { lowerJourneyScene } from '../../journey/renderer.ts'

export default createBrowserFamilyDescriptor(descriptorData, {
  normalizeRequest: ctx => ({
    appearance: { family: resolveJourneyRequestAppearance(ctx.renderOptions) as unknown as Record<string, unknown> },
  }),
  layout: ctx => layoutResult(layoutJourneyDiagram(
    parseJourneyDiagram(ctx.source.familyLines, ctx.source.accessibility),
    (ctx.familyAppearance as ReturnType<typeof resolveJourneyRequestAppearance> | undefined)
      ?? resolveJourneyRequestAppearance(ctx.renderOptions),
    ctx.renderOptions,
    ctx.styleFace,
  )),
  lowerScene: scene(lowerJourneyScene),
})
