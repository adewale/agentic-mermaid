import { type BrowserSvgFamilyHooks, layoutResult, positionedView, scene } from '../browser-lazy/family.ts'
import { resolveKanbanConfig } from '../kanban/config.ts'
import { diagnoseKanbanConfig } from '../kanban/config-diagnostics.ts'
import { layoutKanbanDiagram } from '../kanban/layout.ts'
import { parseKanbanDiagram } from '../kanban/parser.ts'
import { projectKanbanPositioned } from '../kanban/projection.ts'
import { lowerKanbanScene } from '../kanban/renderer.ts'
import { withFrontmatterTitle } from '../mermaid-source.ts'

export const KANBAN_SVG_HOOKS = {
  configDiagnostics: diagnoseKanbanConfig,
  normalizeRequest: ctx => ({ familyConfig: { visual: resolveKanbanConfig(ctx.source.frontmatter) } }),
  layout: ctx => layoutResult(layoutKanbanDiagram(withFrontmatterTitle(parseKanbanDiagram(ctx.source.familyBody, ctx.source.accessibility), ctx.source.frontmatter), ctx.renderOptions, (ctx.familyConfig as { visual?: ReturnType<typeof resolveKanbanConfig> } | undefined)?.visual ?? resolveKanbanConfig(), ctx.styleFace)),
  projectPositioned: positionedView(projectKanbanPositioned),
  lowerScene: scene(lowerKanbanScene),
} satisfies BrowserSvgFamilyHooks
