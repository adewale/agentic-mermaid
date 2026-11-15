import type { PixelTextBlock } from './shared/prepared-text.ts'
import type { ResolvedRenderStyle } from './styles.ts'
import { resolveLabelContent } from './shared/display-text.ts'
import { graphTextBlock } from './graph-text.ts'
import type { PositionedGroup } from './types.ts'

type HeaderRect = { readonly x: number; readonly y: number; readonly width: number; readonly height: number }

/** Painted header geometry of a graph group: the band the renderer fills
 * across the top of the frame and the start-anchored, vertically centred
 * title ink inside it. Renderer, certification and family routers read these
 * rects, so the reserved header is the header that is drawn. */
export function graphGroupHeader(group: Pick<PositionedGroup, 'x' | 'y' | 'width' | 'headerHeight' | 'labelBlock' | 'label' | 'labelContent'>, style: ResolvedRenderStyle): { block: PixelTextBlock; band: HeaderRect; title: HeaderRect } {
  const block = group.labelBlock ?? graphTextBlock(resolveLabelContent(group.label, group.labelContent), style, 'group')
  const height = group.headerHeight ?? style.groupHeaderFontSize + 16 + block.height - block.lineHeight
  return {
    block,
    band: { x: group.x, y: group.y, width: group.width, height },
    title: { x: group.x + style.groupLabelPaddingX, y: group.y + height / 2 - block.height / 2, width: block.width, height: block.height },
  }
}
