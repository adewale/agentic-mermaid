import type { DrawingFactory } from '../scene/drawing.ts'
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

import { TEXT_BASELINE_SHIFT } from '../styles.ts'
import { escapeXml } from '../multiline-utils.ts'
import { layoutTooltip, TIP, type TooltipLayout } from './tooltip-layout.ts'
export { TIP } from './tooltip-layout.ts'
import type { GroupMark, SceneOwner } from '../scene/ir.ts'
import * as marks from '../scene/marks.ts'

function r(value: number): string {
  return (Math.round(value * 100) / 100).toString()
}

/** Direct string consumers own their own text/layout preparation. */
export function tooltipMarkup(prefix: string, cx: number, topY: number, text: string): string {
  const { bgW, bgX, bgY, textX, textY, ptrPath } = layoutTooltip(cx, topY, text)
  return (
    `<g class="${prefix}-tip">` +
    `<rect x="${r(bgX)}" y="${r(bgY)}" width="${r(bgW)}" height="${TIP.height}" rx="${TIP.rx}" class="${prefix}-tip ${prefix}-tip-bg"/>` +
    `<path d="${ptrPath}" class="${prefix}-tip ${prefix}-tip-ptr"/>` +
    `<text x="${r(textX)}" y="${r(textY)}" text-anchor="middle" dy="${TEXT_BASELINE_SHIFT}" class="${prefix}-tip ${prefix}-tip-text">${escapeXml(text)}</text>` +
    `</g>`
  )
}

/** The same owned tooltip geometry, retained as paint rather than opaque SVG. */
export function tooltipArtwork(prefix: string, plan: TooltipLayout | undefined, id: string, owner: SceneOwner): GroupMark {
  return drawTooltipArtwork(marks, prefix, plan, id, owner) as GroupMark
}

export function drawTooltipArtwork<T>(marks: DrawingFactory<T>, prefix: string, plan: TooltipLayout | undefined, id: string, owner: SceneOwner): T {
  if (!plan) throw new TypeError(`Missing retained tooltip layout for ${id}`)
  const { block, bgW, bgX, bgY, textX, textY, ptrPath } = plan
  const n = (value: number) => Number(r(value))
  return marks.group({ id, role: 'chrome', owner, visibility: 'conditional',
    open: `<g class="${prefix}-tip">`, close: '</g>', join: '',
    children: [
      { indent: 0, node: marks.shape({ id: `${id}:background`, role: 'chrome', owner,
        geometry: { kind: 'rect', x: n(bgX), y: n(bgY), width: n(bgW), height: TIP.height, rx: TIP.rx }, paint: { fill: 'var(--_text)' },
        attributes: { className: `${prefix}-tip ${prefix}-tip-bg` },
      }) },
      { indent: 0, node: marks.shape({ id: `${id}:pointer`, role: 'chrome', owner,
        geometry: { kind: 'path', d: ptrPath }, paint: { fill: 'var(--_text)' },
        attributes: { className: `${prefix}-tip ${prefix}-tip-ptr` },
      }) },
      { indent: 0, node: marks.text({ id: `${id}:text`, role: 'label', owner,
        text: block.text, block, x: n(textX), y: n(textY), fontSize: TIP.fontSize, fontWeight: TIP.fontWeight, anchor: 'middle', paint: { fill: 'var(--bg)' },
        attributes: { className: `${prefix}-tip ${prefix}-tip-text` },
      }) },
    ],
  })
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
