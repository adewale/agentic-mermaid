import { sceneLowering, type DrawingFactory, type DrawingDocument } from '../scene/drawing.ts'
import { inkOnNodeFill } from '../color-resolver.ts'
import { escapeAttr } from '../multiline-utils.ts'
import { DefaultBackend } from '../scene/backend.ts'
import type { SceneNode } from '../scene/ir.ts'
import { preparedDisplayTextValue } from '../shared/display-text.ts'
import { drawingDocument } from '../shared/scene-document.ts'
import { diagramTitleFields, resolveRenderStyle } from '../styles.ts'
import type { RenderContext } from '../types.ts'
import type { PositionedPacketDiagram } from './types.ts'

export function lowerPacketDrawing<T>(marks: DrawingFactory<T>, { positioned: diagram, colors, resolved }: RenderContext<PositionedPacketDiagram>): DrawingDocument<T> {
  const style = resolveRenderStyle(resolved.renderOptions, undefined, resolved.styleFace)
  const transparent = resolved.renderOptions.transparent ?? false
  const parts: T[] = []
  if (diagram.title) parts.push(marks.text(diagramTitleFields(diagram.title, style)))
  const fill = style.nodeFillColor ?? 'var(--_node-fill)'
  const ink = style.nodeTextColor ?? inkOnNodeFill(undefined, colors, fill)('var(--_text)')
  for (const field of diagram.fields) {
    const children: T[] = [
      marks.shape({
        id: `${field.id}:box`,
        role: 'node',
        identity: false,
        owner: { id: field.id, role: 'node' },
        geometry: { kind: 'rect', x: field.x, y: field.y, width: field.width, height: field.height, rx: style.cornerRadius },
        paint: { fill, stroke: style.nodeBorderColor ?? 'var(--_node-stroke)', strokeWidth: String(style.nodeLineWidth) },
      }),
      marks.text({
        id: `${field.id}:label`,
        role: 'label',
        owner: { id: field.id, role: 'node' },
        text: field.labelBlock.text,
        block: field.labelBlock,
        x: field.x + field.width / 2,
        y: field.y + field.height / 2,
        fontSize: field.labelBlock.fontSize,
        fontWeight: field.labelBlock.fontWeight,
        letterSpacing: field.labelBlock.letterSpacing,
        anchor: 'middle',
        paint: { fill: ink },
      }),
    ]
    for (const [index, bit] of field.bitLabels.entries())
      children.push(marks.text({ id: `${field.id}:bit-${index}`, role: 'label', text: bit.text, block: bit.block, x: bit.x, y: bit.y, fontSize: bit.block.fontSize, fontWeight: bit.block.fontWeight, anchor: bit.anchor, paint: { fill: style.edgeTextColor ?? 'var(--_text-muted)' } }))
    parts.push(
      marks.group({
        id: field.id,
        role: 'node',
        open: `<g data-id="${escapeAttr(field.id)}" data-field-id="${escapeAttr(field.fieldId)}" data-start="${field.start}" data-end="${field.end}" data-field-label="${escapeAttr(preparedDisplayTextValue(field.labelBlock.prepared))}">`,
        close: '</g>',
        children: children.map(node => ({ node, indent: 2 })),
      }),
    )
  }
  return drawingDocument(marks, 'packet', diagram, colors, transparent, parts)
}
export function renderPacketSvg(context: RenderContext<PositionedPacketDiagram>): string {
  return DefaultBackend.render(lowerPacketScene(context), { seed: 0 })
}

export const lowerPacketScene = sceneLowering<PositionedPacketDiagram>(lowerPacketDrawing)
