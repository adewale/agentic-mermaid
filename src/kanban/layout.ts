import type { InternalStyleFace } from '../scene/style-registry.ts'
import { assertDiagramWorkLimit } from '../shared/diagram-limits.ts'
import { preparePixelText } from '../shared/prepared-text.ts'
import { layoutTextRows } from '../shared/text-rows.ts'
import { diagramTitleBand, positionDiagramTitle, resolveRenderStyle } from '../styles.ts'
import type { RenderOptions } from '../types.ts'
import { kanbanTicketUrl, resolveKanbanConfig } from './config.ts'
import type { KanbanBody, KanbanItem, KanbanText, KanbanVisualConfig, PositionedKanbanColumn, PositionedKanbanDiagram } from './types.ts'

export function kanbanItemText(item: KanbanItem): Array<{ text: string; kind: KanbanText['kind'] }> {
  const result: Array<{ text: string; kind: KanbanText['kind'] }> = [{ text: item.label, kind: 'label' }]
  if (item.metadata.ticket) result.push({ text: String(item.metadata.ticket), kind: 'ticket' })
  if (item.metadata.assigned) result.push({ text: `Assigned: ${item.metadata.assigned}`, kind: 'assigned' })
  if (item.metadata.priority) result.push({ text: `Priority: ${item.metadata.priority}`, kind: 'priority' })
  const icon = item.icon ?? item.metadata.icon
  if (icon) result.push({ text: `Icon: ${icon}`, kind: 'icon' })
  return result
}
/** Column widths are shared; wrapping determines each card's actual height. */
export function layoutKanbanDiagram(body: KanbanBody, options: Readonly<RenderOptions> = {}, visual: KanbanVisualConfig = resolveKanbanConfig(), styleFace?: Readonly<InternalStyleFace>): PositionedKanbanDiagram {
  assertDiagramWorkLimit(
    'nodes',
    body.columns.reduce((sum, column) => sum + column.tasks.length + 1, 0),
  )
  const style = resolveRenderStyle(options, undefined, styleFace)
  const pad = options.padding ?? 24,
    inset = Math.max(4, visual.padding),
    cardPadX = Math.max(8, style.nodePaddingX),
    cardPadY = Math.max(8, style.nodePaddingY),
    groupPadX = styleFace?.group?.paddingX ?? inset,
    groupPadY = styleFace?.group?.paddingY ?? inset,
    headerPadX = styleFace?.group?.paddingX ?? inset + cardPadX,
    headerPadY = styleFace?.group?.paddingY ?? cardPadY
  const minWidth = Math.max(160, groupPadX * 2 + cardPadX * 2 + 24, headerPadX * 2 + 24),
    maxWidth = options.kanban?.maxWidth,
    width = Math.max(maxWidth === undefined ? 0 : minWidth, Math.min(Math.max(visual.sectionWidth, groupPadX * 2 + cardPadX * 2 + 24, headerPadX * 2 + 24), maxWidth === undefined ? Infinity : maxWidth - 2 * pad)),
    gap = Math.max(16, inset * 2)
  const band = diagramTitleBand(body.title, style)
  const textBlocks = (item: KanbanItem, header: boolean): KanbanText[] =>
    kanbanItemText(item).map(({ text, kind }) => {
      const primary = kind === 'label'
      const block = preparePixelText(text, {
        display: 'formatted',
        transform: header ? style.groupTextTransform : style.nodeTextTransform,
        fontSize: header ? style.groupHeaderFontSize : primary ? style.nodeLabelFontSize : style.edgeLabelFontSize,
        fontWeight: header ? style.groupHeaderFontWeight : primary ? style.nodeLabelFontWeight : style.edgeLabelFontWeight,
        letterSpacing: header ? style.groupLetterSpacing : style.nodeLetterSpacing,
        fontFamily: header ? (style.groupFont ?? options.font) : options.font,
        maxWidth: width - 2 * (header ? headerPadX : groupPadX + cardPadX),
      })
      return { text, kind, block, x: 0, y: 0 }
    })
  const headers = body.columns.map(column => layoutTextRows(textBlocks(column, true), { top: pad + (band?.height ?? 0) + headerPadY, gap: 6, trailingGap: true }))
  const headerHeight = Math.max(32, ...headers.map(stack => stack.height + 2 * headerPadY))
  const columns: PositionedKanbanColumn[] = []
  body.columns.forEach((column, index) => {
    const x = pad + index * (width + gap),
      y = pad + (band?.height ?? 0)
    const texts = headers[index]!.rows.map(({ item: text, textY }) => {
      text.x = x + headerPadX
      text.y = textY
      return text
    })
    let cardY = y + headerHeight + groupPadY
    const tasks = column.tasks.map(task => {
      const stack = layoutTextRows(textBlocks(task, false), { top: cardY + cardPadY, gap: 6 }),
        height = Math.max(40, stack.height + 2 * cardPadY)
      const texts = stack.rows.map(({ item: text, textY }) => {
        text.x = x + groupPadX + cardPadX
        text.y = textY
        return text
      })
      const positioned = { ...task, parentId: column.id, x: x + groupPadX, y: cardY, width: width - groupPadX * 2, height, texts, ...(task.metadata.ticket ? { ticketUrl: kanbanTicketUrl(visual.ticketBaseUrl, String(task.metadata.ticket)) } : {}) }
      cardY += height + inset
      return positioned
    })
    columns.push({ ...column, x, y, width, height: cardY - y + groupPadY, headerHeight, texts, tasks })
  })
  const maxHeight = Math.max(headerHeight + groupPadY * 2, ...columns.map(column => column.height))
  for (const column of columns) column.height = maxHeight
  const perRow = maxWidth === undefined ? Math.max(1, columns.length) : Math.max(1, Math.floor((maxWidth - 2 * pad + gap) / (width + gap)))
  let contentHeight = maxHeight
  if (perRow < columns.length) {
    let rowY = pad + (band?.height ?? 0)
    for (let start = 0; start < columns.length; start += perRow) {
      const row = columns.slice(start, start + perRow)
      // Keep equal-height columns within each row; typography stays at the
      // authored size and cards retain their original column membership.
      for (const [index, column] of row.entries()) {
        const dx = pad + index * (width + gap) - column.x,
          dy = rowY - column.y
        column.x += dx
        column.y += dy
        for (const text of column.texts) {
          text.x += dx
          text.y += dy
        }
        for (const task of column.tasks) {
          task.x += dx
          task.y += dy
          for (const text of task.texts) {
            text.x += dx
            text.y += dy
          }
        }
      }
      rowY += maxHeight + gap
    }
    contentHeight = rowY - gap - pad - (band?.height ?? 0)
  }
  const rowColumns = Math.min(columns.length, perRow)
  const canvasWidth = Math.max(pad * 2 + Math.max(0, rowColumns * width + Math.max(0, rowColumns - 1) * gap), (band?.width ?? 0) + 2 * pad)
  return { columns, visual, width: canvasWidth, height: pad * 2 + (band?.height ?? 0) + contentHeight, ...(band ? { title: positionDiagramTitle(band, canvasWidth, pad) } : {}) }
}
