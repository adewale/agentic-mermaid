import { layoutResult, scene, type BrowserSvgFamilyHooks } from '../browser-lazy/family.ts'
import { withFrontmatterTitle } from '../mermaid-source.ts'
import { resolveSequenceConfig } from '../sequence/config.ts'
import { layoutSequenceDiagram } from '../sequence/layout.ts'
import { parseSequenceDiagram } from '../sequence/parser.ts'
import { lowerSequenceScene } from '../sequence/renderer.ts'
import { withAccessibilityFields } from '../shared/accessibility-directives.ts'

/** The sequence SVG hooks: one definition for the complete renderer
 * (src/render-family-hooks.ts) and the lazy browser chunk. */
export const SEQUENCE_SVG_HOOKS = {
  // Wire-or-warn config threading (src/sequence/config.ts): the typed
  // `sequence` frontmatter/init section's wired keys reach the parser
  // (showSequenceNumbers) and layout (margins/sizes); unwired keys are named
  // by verify's INEFFECTIVE_CONFIG lint. Absent config resolves to {} and
  // keeps default geometry byte-identical.
  normalizeRequest: ctx => ({
    familyConfig: { sequence: resolveSequenceConfig(ctx.source.frontmatter) },
  }),
  layout: ctx => {
    const seqConfig = (ctx.familyConfig as {
      sequence?: ReturnType<typeof resolveSequenceConfig>
    } | undefined)?.sequence ?? {}
    const diagram = withFrontmatterTitle(withAccessibilityFields(
      parseSequenceDiagram(ctx.source.familyLines, seqConfig),
      ctx.source.accessibility,
    ), ctx.source.frontmatter)
    return layoutResult(layoutSequenceDiagram(diagram, ctx.renderOptions, seqConfig, ctx.styleFace))
  },
  lowerScene: scene(lowerSequenceScene),
} satisfies BrowserSvgFamilyHooks
