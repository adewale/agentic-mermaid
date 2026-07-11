// ============================================================================
// Shared SVG hover-tooltip primitive.
//
// Extracted from the xychart renderer (which introduced the `interactive`
// RenderOptions affordance) so other families reuse the machinery instead of
// copying it. The markup and CSS are parameterized ONLY by a class-name
// prefix and the hover-group class list; with prefix "xychart" the output is
// byte-identical to the strings the xychart renderer historically emitted
// (pinned by quadrant-interactive.test.ts and xychart-renderer.test.ts).
//
// A tooltip is pure interaction chrome: an initially-invisible <g> that the
// stylesheet reveals on :hover of an enclosing hover group. Pointer-shaped
// callout above the anchor; clamps to the canvas top.
// ============================================================================

import { TEXT_BASELINE_SHIFT, estimateTextWidth } from '../styles.ts'
import { escapeXml } from '../multiline-utils.ts'

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

function r(value: number): string {
  return (Math.round(value * 100) / 100).toString()
}

/**
 * Tooltip markup centered above (cx, topY): background pill + pointer + text,
 * classed `{prefix}-tip` so the matching CSS (tooltipCss) can reveal it.
 */
export function tooltipMarkup(prefix: string, cx: number, topY: number, text: string): string {
  const textW = estimateTextWidth(text, TIP.fontSize, TIP.fontWeight)
  const bgW = textW + TIP.padX * 2
  const bgX = cx - bgW / 2
  let bgY = topY - TIP.offsetY - TIP.height
  let ptrY = bgY + TIP.height

  if (bgY < TIP.minY) {
    bgY = TIP.minY
    ptrY = bgY + TIP.height
  }

  const textX = cx
  const textY = bgY + TIP.height / 2
  const p = TIP.pointerSize
  const ptrPath = `M${r(cx - p)},${r(ptrY)} L${r(cx + p)},${r(ptrY)} L${r(cx)},${r(ptrY + p)} Z`

  return (
    `<g class="${prefix}-tip">` +
    `<rect x="${r(bgX)}" y="${r(bgY)}" width="${r(bgW)}" height="${TIP.height}" rx="${TIP.rx}" class="${prefix}-tip ${prefix}-tip-bg"/>` +
    `<path d="${ptrPath}" class="${prefix}-tip ${prefix}-tip-ptr"/>` +
    `<text x="${r(textX)}" y="${r(textY)}" text-anchor="middle" dy="${TEXT_BASELINE_SHIFT}" class="${prefix}-tip ${prefix}-tip-text">${escapeXml(text)}</text>` +
    `</g>`
  )
}

/**
 * The CSS block that hides tooltips until an enclosing hover group is
 * hovered. `hoverGroups` are the class names of the hover targets (e.g.
 * xychart-bar-group / quadrant-point-group).
 */
export function tooltipCss(prefix: string, hoverGroups: string[]): string {
  const selectors = hoverGroups.map(g => `.${g}:hover .${prefix}-tip`).join(',\n  ')
  return `
  .${prefix}-tip { opacity: 0; pointer-events: none; }
  .${prefix}-tip-bg { fill: var(--_text); }
  .${prefix}-tip-text { fill: var(--bg); font-size: ${TIP.fontSize}px; font-weight: ${TIP.fontWeight}; }
  .${prefix}-tip-ptr { fill: var(--_text); }
  ${selectors} { opacity: 1; }`
}
