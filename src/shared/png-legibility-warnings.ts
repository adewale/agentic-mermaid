import { svgIntrinsicDimensions, type ResolvedPngOutputPolicy } from '../png-contract.ts'

export interface PngLegibilityWarning {
  code: 'BELOW_READABLE_SIZE'
  naturalWidth: number
  naturalHeight: number
  effectiveScale: number
  baseMinLabelPx: number
  effectiveMinLabelPx: number
  floorPx: number
  cause: 'fitTo' | 'scale'
  message: string
}

/** Every emitter writes literal `font-size="N"` root-relative px attributes
 * (scene marks and renderer text paths), so the secured SVG itself is the
 * exact, family-agnostic inventory of configured text sizes. */
const FONT_SIZE_ATTRIBUTE = /font-size="(\d*\.?\d+)(?:px)?"/g

function smallestSvgFontSize(svg: string): number | undefined {
  let smallest: number | undefined
  for (const match of svg.matchAll(FONT_SIZE_ATTRIBUTE)) {
    const value = Number(match[1])
    if (Number.isFinite(value) && value > 0 && (smallest === undefined || value < smallest)) {
      smallest = value
    }
  }
  return smallest
}

const round2 = (value: number): number => Math.round(value * 100) / 100

/**
 * Raster legibility gate: rasterization scales every glyph by the resolved
 * fitTo/scale ratio, because `prepareSvgForPngRasterization` pins the root
 * to the budgeted dimensions and never rewrites font sizes. When the
 * smallest configured text lands below the `minLabelPx` floor, the render
 * still succeeds — but a text-only agent cannot see the shrink, so the
 * condition must surface as a structured warning. `minLabelPx: 0` disables.
 */
export function buildPngLegibilityWarnings(
  svg: string,
  policy: Pick<ResolvedPngOutputPolicy, 'scale' | 'fitTo' | 'minLabelPx'>,
): PngLegibilityWarning[] {
  if (policy.minLabelPx <= 0) return []
  const baseMinLabelPx = smallestSvgFontSize(svg)
  if (baseMinLabelPx === undefined) return []
  const bounds = svgIntrinsicDimensions(svg)
  const effectiveScale = policy.fitTo.mode === 'width'
    ? policy.fitTo.value / bounds.width
    : policy.fitTo.mode === 'height'
      ? policy.fitTo.value / bounds.height
      : policy.fitTo.value
  const effectiveMinLabelPx = baseMinLabelPx * effectiveScale
  if (effectiveMinLabelPx >= policy.minLabelPx) return []
  const cause = policy.fitTo.mode === 'zoom' ? 'scale' as const : 'fitTo' as const
  const constraint = cause === 'fitTo'
    ? `fitTo ${policy.fitTo.mode} ${policy.fitTo.value}px against a ${round2(bounds.width)}×${round2(bounds.height)} diagram`
    : `scale ${policy.fitTo.value}`
  return [{
    code: 'BELOW_READABLE_SIZE' as const,
    naturalWidth: bounds.width,
    naturalHeight: bounds.height,
    effectiveScale,
    baseMinLabelPx,
    effectiveMinLabelPx,
    floorPx: policy.minLabelPx,
    cause,
    message: `smallest configured text is ${round2(baseMinLabelPx)}px and ${constraint} rasterizes it at ${round2(effectiveMinLabelPx)}px, below the ${round2(policy.minLabelPx)}px legibility floor. Raise the fit/scale, split the diagram, or pass minLabelPx: 0 to accept the shrink.`,
  }]
}
