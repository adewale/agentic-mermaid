import { formatSvgNumber } from '../shared/svg-number.ts'
import type { SceneDoc } from './ir.ts'
import type { StyleBackendContext } from './backend.ts'

/** Same actual page underlay for Native drawing and Scene backends. */
export function pageRectFor(doc: Pick<SceneDoc, 'width' | 'height' | 'transparent'>, ctx: StyleBackendContext): string {
  if (!ctx.style || doc.transparent) return ''
  return `<rect width="${formatSvgNumber(doc.width)}" height="${formatSvgNumber(doc.height)}" fill="var(--bg)" data-backdrop="page" />`
}
