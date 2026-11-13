import type { InternalStyleFace } from '../scene/style-registry.ts'
import { assertDiagramWorkLimit } from '../shared/diagram-limits.ts'
import { preparePixelText } from '../shared/prepared-text.ts'
import { diagramTitleBand, positionDiagramTitle, resolveRenderStyle } from '../styles.ts'
import type { RenderOptions } from '../types.ts'
import { resolvePacketConfig } from './config.ts'
import type { PacketBody, PacketVisualConfig, PositionedPacketDiagram, PositionedPacketField } from './types.ts'

/** Geometry encodes inclusive bit counts. Text changes row height, never widths. */
export function layoutPacketDiagram(body: PacketBody, options: Readonly<RenderOptions> = {}, visual: PacketVisualConfig = resolvePacketConfig(), styleFace?: Readonly<InternalStyleFace>): PositionedPacketDiagram {
  const rowCount = body.fields.length ? Math.floor(body.fields.at(-1)!.end / visual.bitsPerRow) + 1 : 0
  assertDiagramWorkLimit('nodes', rowCount + body.fields.length)
  const style = resolveRenderStyle(options, undefined, styleFace)
  const pad = options.padding ?? 24
  const titleBand = diagramTitleBand(body.title, style)
  const textPaddingX = styleFace?.node?.paddingX, textPaddingY = styleFace?.node?.paddingY ?? 8
  const bitSize = Math.max(8, Math.min(11, style.edgeLabelFontSize))
  const bitGutter = visual.showBits ? bitSize * 1.5 + 4 : 0
  const fields: PositionedPacketField[] = []
  const rowHeights = Array.from({ length: rowCount }, () => visual.rowHeight)
  const textOptions = { display: 'formatted' as const, transform: style.nodeTextTransform, fontSize: style.nodeLabelFontSize, fontWeight: style.nodeLabelFontWeight, letterSpacing: style.nodeLetterSpacing, fontFamily: options.font }
  for (const field of body.fields) {
    let measured: ReturnType<typeof preparePixelText> | undefined
    for (let start = field.start; start <= field.end; ) {
      const row = Math.floor(start / visual.bitsPerRow),
        rowStart = row * visual.bitsPerRow
      const end = Math.min(field.end, rowStart + visual.bitsPerRow - 1)
      const slotWidth = (end - start + 1) * visual.bitWidth
      const gap = Math.min(visual.paddingX, slotWidth - 1),
        width = slotWidth - gap
      // A one-bit flag commonly carries an acronym (URG, ACK, SYN). Fit that
      // short label as a unit before wrapping; never widen its encoded bit.
      if (start === end) measured ??= preparePixelText(field.label, textOptions)
      const compactFlag = start === end && measured!.lines.length === 1 && measured!.text.length <= 4
      const availableWidth = Math.max(1, width - (textPaddingX === undefined ? compactFlag ? 2 : 8 : textPaddingX * 2))
      const fontSize = compactFlag ? Math.max(9, Math.min(textOptions.fontSize, Math.floor((textOptions.fontSize * availableWidth) / Math.max(1, measured!.width)))) : textOptions.fontSize
      const labelBlock = preparePixelText(field.label, { ...textOptions, fontSize, maxWidth: availableWidth })
      const x = pad + (visual.bitOrder === 'descending' ? visual.bitsPerRow - (end - rowStart + 1) : start - rowStart) * visual.bitWidth + gap / 2
      fields.push({ ...field, id: `${field.id}:row-${row}`, fieldId: field.id, start, end, row, x, y: 0, width, slotWidth, height: 0, labelBlock, bitLabels: [] })
      rowHeights[row] = Math.max(rowHeights[row]!, labelBlock.height + textPaddingY * 2)
      assertDiagramWorkLimit('nodes', fields.length)
      start = end + 1
    }
  }
  let top = pad + (titleBand?.height ?? 0)
  let fieldIndex = 0
  for (let row = 0; row < rowCount; row++) {
    // Contiguous authored ranges emit segments in monotonically increasing rows.
    while (fieldIndex < fields.length && fields[fieldIndex]!.row === row) {
      const field = fields[fieldIndex++]!
      field.y = top + bitGutter
      field.height = rowHeights[row]!
      if (visual.showBits) {
        const singleton = field.start === field.end
        const left = visual.bitOrder === 'descending' ? field.end : field.start
        const right = visual.bitOrder === 'descending' ? field.start : field.end
        const values = singleton
          ? [{ bit: field.start, x: field.x + field.width / 2, anchor: 'middle' as const }]
          : [
              { bit: left, x: field.x + 2, anchor: 'start' as const },
              { bit: right, x: field.x + field.width - 2, anchor: 'end' as const },
            ]
        field.bitLabels = values.map(value => ({ text: String(value.bit), x: value.x, y: top + bitGutter / 2, anchor: value.anchor, block: preparePixelText(String(value.bit), { display: 'literal', fontSize: bitSize, fontWeight: 400 }) }))
      }
    }
    top += bitGutter + rowHeights[row]! + visual.paddingY
  }
  const width = Math.max(pad * 2 + visual.bitsPerRow * visual.bitWidth, (titleBand?.width ?? 0) + 2 * pad)
  return { width, height: Math.max(pad * 2 + (titleBand?.height ?? 0), top + pad), rows: rowCount, fields, visual, ...(titleBand ? { title: positionDiagramTitle(titleBand, width, pad) } : {}), accessibility: { title: body.accessibilityTitle, descr: body.accessibilityDescription } }
}
