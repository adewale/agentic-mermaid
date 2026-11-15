import { type BrowserSvgFamilyHooks, layoutResult, positionedView, scene } from '../browser-lazy/family.ts'
import { resolveKanbanConfig } from '../kanban/config.ts'
import { diagnoseKanbanConfig } from '../kanban/config-diagnostics.ts'
import { layoutKanbanDiagram } from '../kanban/layout.ts'
import { kanbanStatementEnds, parseKanbanDiagram } from '../kanban/parser.ts'
import { projectKanbanPositioned } from '../kanban/projection.ts'
import { lowerKanbanScene } from '../kanban/renderer.ts'
import { preservedMermaidFamilyText, withFrontmatterTitle } from '../mermaid-source.ts'

export const KANBAN_SVG_HOOKS = {
  statementEnds: kanbanStatementEnds,
  configDiagnostics: diagnoseKanbanConfig,
  normalizeRequest: ctx => ({ familyConfig: { visual: resolveKanbanConfig(ctx.source.frontmatter) } }),
  layout: ctx => layoutResult(layoutKanbanDiagram(withFrontmatterTitle(parseKanbanDiagram(preservedMermaidFamilyText(ctx.source), ctx.source.accessibility, ctx.source), ctx.source.frontmatter), ctx.renderOptions, (ctx.familyConfig as { visual?: ReturnType<typeof resolveKanbanConfig> } | undefined)?.visual ?? resolveKanbanConfig(), ctx.styleFace)),
  projectPositioned: positionedView(projectKanbanPositioned),
  lowerScene: scene(lowerKanbanScene),
} satisfies BrowserSvgFamilyHooks
