import type { AsciiContext } from '../agent/families.ts'
import { resolveKanbanConfig } from '../kanban/config.ts'
import { kanbanItemText } from '../kanban/layout.ts'
import { parseKanbanDiagram } from '../kanban/parser.ts'
import { preservedMermaidFamilyText, withFrontmatterTitle } from '../mermaid-source.ts'
import { prepareCellText } from './prepared-text.ts'
import { serializeTerminalArtifact, type TerminalArtifact, terminalArtifact } from './terminal-artifact.ts'
import { TerminalDocument } from './terminal-document.ts'
import { paintTerminalFrame } from './terminal-geometry.ts'
import { AsciiWidthError } from './width-error.ts'

export function renderKanbanTerminal(context: AsciiContext): TerminalArtifact {
  const body = withFrontmatterTitle(parseKanbanDiagram(preservedMermaidFamilyText(context.source), context.source.accessibility, context.source), context.source.frontmatter)
  const visual = (context.familyConfig as { visual?: ReturnType<typeof resolveKanbanConfig> } | undefined)?.visual ?? resolveKanbanConfig(context.source.frontmatter)
  const maxWidth = context.options.targetWidth ?? context.options.maxWidth ?? context.config.maxWidth
  const count = body.columns.length,
    minimum = count * 8 + Math.max(0, count - 1) * 2
  if (maxWidth && maxWidth < minimum) throw new AsciiWidthError(maxWidth, minimum, 'kanban', 'MINIMUM_GEOMETRY')
  const columnWidth = count && maxWidth ? Math.max(8, Math.floor((maxWidth - (count - 1) * 2) / count)) : Math.max(18, Math.min(40, Math.round(visual.sectionWidth / 8)))
  const document = new TerminalDocument()
  if (body.title) {
    for (const line of prepareCellText(body.title, { display: 'formatted', maxWidth }).lines) document.line([{ text: line, role: 'text', owner: { id: 'title', kind: 'label' } }])
    document.line()
  }
  const top = document.height
  const columns = body.columns.map((column, index) => {
    const local = new TerminalDocument(),
      owner = { id: column.id, kind: 'band' as const, members: column.tasks.map(task => task.id) }
    const header = kanbanItemText(column).flatMap(text => [...prepareCellText(text.text, { display: 'formatted', maxWidth: columnWidth - 4 }).lines])
    let y = header.length + 2
    local.textBlock(2, 1, header, { role: 'text', owner })
    for (const task of column.tasks) {
      const lines = kanbanItemText(task).flatMap(text => [...prepareCellText(text.text, { display: 'formatted', maxWidth: columnWidth - 6 }).lines])
      const taskOwner = { id: task.id, kind: 'node' as const, parent: { id: column.id, kind: 'band' as const } }
      paintTerminalFrame(local, { x: 1, y, width: columnWidth - 2, height: lines.length + 2 }, taskOwner, context.config.useAscii)
      local.textBlock(2, y + 1, lines, { role: 'text', owner: taskOwner })
      y += lines.length + 3
    }
    return { local, owner, x: index * (columnWidth + 2), height: Math.max(header.length + 3, y + 1) }
  })
  const height = Math.max(3, ...columns.map(column => column.height))
  for (const column of columns) {
    paintTerminalFrame(column.local, { x: 0, y: 0, width: columnWidth, height }, column.owner, context.config.useAscii)
    document.overlay(column.local, column.x, top)
  }
  return terminalArtifact(document, { colorMode: context.colorMode, theme: context.theme, trimEnd: true })
}
export function renderKanbanAscii(context: AsciiContext): string {
  return serializeTerminalArtifact(renderKanbanTerminal(context))
}
