import { sceneLowering, type DrawingFactory, type DrawingDocument } from '../scene/drawing.ts'
import { createFillInkResolver } from '../color-resolver.ts'
import { escapeAttr } from '../multiline-utils.ts'
import { DefaultBackend } from '../scene/backend.ts'
import type { SceneOwner } from '../scene/ir.ts'
import { drawingDocument } from '../shared/scene-document.ts'
import { diagramTitleFields, resolveRenderStyle } from '../styles.ts'
import type { RenderContext } from '../types.ts'
import type { KanbanText, PositionedKanbanDiagram } from './types.ts'

export function lowerKanbanDrawing<T>(marks: DrawingFactory<T>, { positioned: diagram, colors, resolved }: RenderContext<PositionedKanbanDiagram>): DrawingDocument<T> {
  const style = resolveRenderStyle(resolved.renderOptions, undefined, resolved.styleFace)
  const inkOnFill = createFillInkResolver(colors)
  const transparent = resolved.renderOptions.transparent ?? false
  const parts: T[] = []
  if (diagram.title) parts.push(marks.text(diagramTitleFields(diagram.title, style)))
  const textMark = (id: string, text: KanbanText, fill: string, owner: SceneOwner): T =>
    marks.text({ id, role: 'label', owner, text: text.block.text, block: text.block, x: text.x, y: text.y, fontSize: text.block.fontSize, fontWeight: text.block.fontWeight, letterSpacing: text.block.letterSpacing, anchor: 'start', paint: { fill } })
  for (const column of diagram.columns) {
    const columnFill = style.groupFillColor ?? 'var(--_group-fill)',
      headerFill = style.groupHeaderFillColor ?? 'var(--_group-hdr)'
    const children: T[] = [
      marks.shape({
        id: `${column.id}:surface`,
        role: 'group',
        identity: false,
        owner: { id: column.id, role: 'group' },
        geometry: { kind: 'rect', x: column.x, y: column.y, width: column.width, height: column.height, rx: style.groupCornerRadius },
        paint: { fill: columnFill, stroke: style.groupBorderColor ?? 'var(--_node-stroke)', strokeWidth: String(style.groupLineWidth) },
      }),
      marks.shape({ id: `${column.id}:header`, role: 'group-header', owner: { id: column.id, role: 'group' }, geometry: { kind: 'rect', x: column.x, y: column.y, width: column.width, height: column.headerHeight, rx: style.groupCornerRadius }, paint: { fill: headerFill, stroke: 'none' } }),
    ]
    const headerInk = style.groupTextColor ?? inkOnFill('var(--_text)', headerFill)
    column.texts.forEach((text, index) => children.push(textMark(`${column.id}:text-${index}`, text, headerInk, { id: column.id, role: 'group' })))
    for (const task of column.tasks) {
      const fill = style.nodeFillColor ?? 'var(--_node-fill)',
        ink = style.nodeTextColor ?? inkOnFill('var(--_text)', fill)
      const nodes: T[] = [
        marks.shape({
          id: `${task.id}:surface`,
          role: 'node',
          identity: false,
          owner: { id: task.id, role: 'node' },
          geometry: { kind: 'rect', x: task.x, y: task.y, width: task.width, height: task.height, rx: style.cornerRadius ?? 5 },
          paint: { fill, stroke: style.nodeBorderColor ?? 'var(--_node-stroke)', strokeWidth: String(style.nodeLineWidth) },
        }),
      ]
      task.texts.forEach((text, index) => nodes.push(textMark(`${task.id}:text-${index}`, text, ink, { id: task.id, role: 'node' })))
      const classes = task.className
        ?.split(/\s+/)
        .filter(token => /^[\w-]+$/.test(token))
        .join(' ')
      const link = task.ticketUrl && resolved.renderOptions.security !== 'strict' ? ` data-href="${escapeAttr(task.ticketUrl)}" role="link" tabindex="0"` : ''
      children.push(marks.group({ id: task.id, role: 'node', open: `<g data-id="${escapeAttr(task.id)}" data-parent="${escapeAttr(column.id)}"${classes ? ` class="${escapeAttr(classes)}"` : ''}${link}>`, close: '</g>', children: nodes.map(node => ({ node, indent: 2 })) }))
    }
    const classes = column.className
      ?.split(/\s+/)
      .filter(token => /^[\w-]+$/.test(token))
      .join(' ')
    parts.push(marks.group({ id: column.id, role: 'group', open: `<g data-id="${escapeAttr(column.id)}"${classes ? ` class="${escapeAttr(classes)}"` : ''}>`, close: '</g>', children: children.map(node => ({ node, indent: 2 })) }))
  }
  return drawingDocument(marks, 'kanban', diagram, colors, transparent, parts)
}
export function renderKanbanSvg(context: RenderContext<PositionedKanbanDiagram>): string {
  return DefaultBackend.render(lowerKanbanScene(context), { seed: 0 })
}

export const lowerKanbanScene = sceneLowering<PositionedKanbanDiagram>(lowerKanbanDrawing)
