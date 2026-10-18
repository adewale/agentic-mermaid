import { preparePixelText, type PixelTextBlock } from './prepared-text.ts'

export const TIP = {
  fontSize: 15,
  fontWeight: 500,
  height: 32,
  padX: 14,
  offsetY: 12,
  rx: 8,
  minY: 4,
  pointerSize: 6,
} as const

export interface TooltipLayout {
  readonly text: string
  readonly block: PixelTextBlock
  readonly bgW: number
  readonly bgX: number
  readonly bgY: number
  readonly textX: number
  readonly textY: number
  readonly ptrPath: string
}

const r = (value: number) => (Math.round(value * 100) / 100).toString()

/** Prepare the literal displayed text and callout geometry before Scene lowering. */
export function layoutTooltip(cx: number, topY: number, text: string): TooltipLayout {
  const block = preparePixelText(text.replace(/[\t\n\r ]+/g, ' ').trim(), { display: 'literal', fontSize: TIP.fontSize, fontWeight: TIP.fontWeight })
  const bgW = block.width + TIP.padX * 2
  const bgX = cx - bgW / 2
  const bgY = Math.max(TIP.minY, topY - TIP.offsetY - TIP.height)
  const ptrY = bgY + TIP.height
  const p = TIP.pointerSize
  const ptrPath = `M${r(cx - p)},${r(ptrY)} L${r(cx + p)},${r(ptrY)} L${r(cx)},${r(ptrY + p)} Z`
  return { text, block, bgW, bgX, bgY, textX: cx, textY: bgY + TIP.height / 2, ptrPath }
}
