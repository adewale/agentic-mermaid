import { type BrowserSvgFamilyHooks, layoutResult, positionedView, scene } from '../browser-lazy/family.ts'
import { withFrontmatterTitle } from '../mermaid-source.ts'
import { resolvePacketConfig } from '../packet/config.ts'
import { diagnosePacketConfig } from '../packet/config-diagnostics.ts'
import { layoutPacketDiagram } from '../packet/layout.ts'
import { parsePacketDiagram } from '../packet/parser.ts'
import { projectPacketPositioned } from '../packet/projection.ts'
import { lowerPacketScene } from '../packet/renderer.ts'

export const PACKET_SVG_HOOKS = {
  configDiagnostics: diagnosePacketConfig,
  normalizeRequest: ctx => ({ familyConfig: { visual: resolvePacketConfig(ctx.source.frontmatter) } }),
  layout: ctx => layoutResult(layoutPacketDiagram(withFrontmatterTitle(parsePacketDiagram(ctx.source.familyBody, ctx.source.accessibility), ctx.source.frontmatter), ctx.renderOptions, (ctx.familyConfig as { visual?: ReturnType<typeof resolvePacketConfig> } | undefined)?.visual ?? resolvePacketConfig(), ctx.styleFace)),
  projectPositioned: positionedView(projectPacketPositioned),
  lowerScene: scene(lowerPacketScene),
} satisfies BrowserSvgFamilyHooks
