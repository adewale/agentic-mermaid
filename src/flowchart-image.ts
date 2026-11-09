import type { MermaidNode } from './types.ts'
import type { ResolvedRenderStyle } from './styles.ts'
import { isInlinePng } from './shared/inline-png.ts'

type ImageNode = Pick<MermaidNode, 'image' | 'icon' | 'shape' | 'imageWidth' | 'imageHeight' | 'imageConstraint'>

export function imageDimension(value: unknown): number | undefined {
  if (typeof value !== 'number' && typeof value !== 'string') return undefined
  const size = Number(value)
  return Number.isFinite(size) && size > 0 ? size : undefined
}

/** Only rectangular, explicitly sized, self-contained PNGs have owned media layout. */
export function flowchartImageViewport(node: ImageNode): { width: number; height: number; fit: 'contain' | 'stretch' } | undefined {
  if (!Object.hasOwn(node, 'imageWidth') || !Object.hasOwn(node, 'imageHeight')) return undefined
  const width = node.imageWidth, height = node.imageHeight
  if (node.icon || node.shape !== 'rectangle' || !isInlinePng(node.image) || typeof width !== 'number' || typeof height !== 'number'
    || !Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return undefined
  return { width, height, fit: Object.hasOwn(node, 'imageConstraint') && node.imageConstraint === 'off' ? 'stretch' : 'contain' }
}

/** Picture and caption share one vertical content box in measurement and emission. */
export function flowchartImageContent(viewport: { width: number; height: number }, label: { width: number; height: number }, style: ResolvedRenderStyle) {
  const gap = label.height > 0 ? style.nodePaddingY : 0
  return {
    width: Math.max(viewport.width, label.width) + style.nodePaddingX * 2,
    height: viewport.height + gap + label.height + style.nodePaddingY * 2,
    contentHeight: viewport.height + gap + label.height,
    labelOffset: viewport.height + gap + label.height / 2,
    captionOffset: (viewport.height + gap) / 2,
  }
}
