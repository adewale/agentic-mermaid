import type { InternalStyleFace } from '../scene/style-registry.ts'
import { assertDiagramWorkLimit } from '../shared/diagram-limits.ts'
import { preparePixelText } from '../shared/prepared-text.ts'
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
    cardPadY = Math.max(8, style.nodePaddingY)
  const width = Math.max(visual.sectionWidth, inset * 2 + cardPadX * 2 + 24)
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
        maxWidth: width - 2 * inset - 2 * cardPadX,
      })
      return { text, kind, block, x: 0, y: 0 }
    })
  const headers = body.columns.map(column => textBlocks(column, true))
  const headerHeight = Math.max(32, ...headers.map(texts => texts.reduce((height, text) => height + text.block.height + 6, 2 * cardPadY)))
  const columns: PositionedKanbanColumn[] = []
  body.columns.forEach((column, index) => {
    const x = pad + index * (width + Math.max(16, inset * 2)),
      y = pad + (band?.height ?? 0)
    const texts = headers[index]!
    let textY = y + cardPadY
    for (const text of texts) {
      text.x = x + inset + cardPadX
      text.y = textY + text.block.height / 2
      textY += text.block.height + 6
    }
    let cardY = y + headerHeight + inset
    const tasks = column.tasks.map(task => {
      const texts = textBlocks(task, false),
        height = Math.max(
          40,
          texts.reduce((sum, text) => sum + text.block.height + 6, 2 * cardPadY - 6),
        )
      let top = cardY + cardPadY
      for (const text of texts) {
        text.x = x + inset + cardPadX
        text.y = top + text.block.height / 2
        top += text.block.height + 6
      }
      const positioned = { ...task, parentId: column.id, x: x + inset, y: cardY, width: width - inset * 2, height, texts, ...(task.metadata.ticket ? { ticketUrl: kanbanTicketUrl(visual.ticketBaseUrl, String(task.metadata.ticket)) } : {}) }
      cardY += height + inset
      return positioned
    })
    columns.push({ ...column, x, y, width, height: cardY - y + inset, headerHeight, texts, tasks })
  })
  const maxHeight = Math.max(headerHeight + inset * 2, ...columns.map(column => column.height))
  for (const column of columns) column.height = maxHeight
  const canvasWidth = Math.max(pad * 2 + Math.max(0, columns.length * width + Math.max(0, columns.length - 1) * Math.max(16, inset * 2)), (band?.width ?? 0) + 2 * pad)
  return { columns, visual, width: canvasWidth, height: pad * 2 + (band?.height ?? 0) + maxHeight, ...(band ? { title: positionDiagramTitle(band, canvasWidth, pad) } : {}) }
}
