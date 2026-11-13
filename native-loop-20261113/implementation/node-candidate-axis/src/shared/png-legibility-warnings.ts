import {
  svgIntrinsicDimensions,
  svgViewBoxDimensions,
  type PngRasterDimensions,
  type ResolvedPngOutputPolicy,
} from '../png-contract.ts'
import { decodedSvgAttributeValue, scanSvgStartTags, svgCssText } from '../svg-structure.ts'

export interface PngLegibilityWarning {
  code: 'BELOW_READABLE_SIZE'
  naturalWidth: number
  naturalHeight: number
  /** Final raster height / SVG viewBox height. Font-size follows this vertical
   * user-unit scale after PNG projection pins the root dimensions. */
  effectiveScale: number
  baseMinLabelPx: number
  effectiveMinLabelPx: number
  floorPx: number
  cause: 'fitTo' | 'scale'
  message: string
}

/** First-party built-in text emitters write literal `font-size="N"`
 * root-relative px attributes, so this scan gives their exact configured
 * minimum. Extension SVG is measurable only when its text-content elements
 * also declare literal absolute-px font-size attributes; inherited CSS and
 * transformed sizes are intentionally not inferred by this v1 gate. */
const ABSOLUTE_FONT_SIZE = /^(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?(?:px)?$/i
const TEXT_CONTENT_ELEMENTS = new Set(['text', 'tspan', 'textpath'])
const FINITE_TRANSFORM_NUMBER = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i

/** Translation and rotation preserve glyph size. Any other SVG transform, or
 * a malformed transform we cannot prove safe, makes the effective-size oracle
 * abstain rather than emit false evidence. */
function sizePreservingTransform(value: string): boolean {
  let rest = value.trim()
  while (rest.length > 0) {
    const match = /^(translate|rotate)\s*\(([^)]*)\)\s*,?\s*/i.exec(rest)
    if (!match) return false
    const values = match[2]!.trim().split(/[\s,]+/).filter(Boolean)
    if (!values.every(token => FINITE_TRANSFORM_NUMBER.test(token))) return false
    if (match[1]!.toLowerCase() === 'translate' && values.length !== 1 && values.length !== 2) return false
    if (match[1]!.toLowerCase() === 'rotate' && values.length !== 1 && values.length !== 3) return false
    rest = rest.slice(match[0].length)
  }
  return true
}

function hasUnresolvedTextScale(svg: string): boolean {
  // CSS can override presentation attributes or apply transforms through the
  // cascade. Do not guess which selector wins.
  if (/(?:^|[;{\n])\s*(?:font|font-size|transform)\s*:/i.test(svgCssText(svg))) return true
  for (const tag of scanSvgStartTags(svg)) {
    const transform = decodedSvgAttributeValue(tag, 'transform')
    if (transform !== undefined && !sizePreservingTransform(transform)) return true
  }
  return false
}

function smallestSvgFontSize(svg: string): number | undefined {
  if (hasUnresolvedTextScale(svg)) return undefined
  let smallest: number | undefined
  for (const tag of scanSvgStartTags(svg)) {
    if (!TEXT_CONTENT_ELEMENTS.has(tag.name.toLowerCase())) continue
    const token = decodedSvgAttributeValue(tag, 'font-size')?.trim()
    if (!token || !ABSOLUTE_FONT_SIZE.test(token)) continue
    const value = Number(token.replace(/px$/i, ''))
    if (Number.isFinite(value) && value >= 0 && (smallest === undefined || value < smallest)) {
      smallest = value
    }
  }
  return smallest
}

// Multiplication-based rounding overflows for otherwise valid large finite
// thresholds (for example 1e308), producing a misleading `Infinitypx` message.
const format2 = (value: number): string => Number(value.toFixed(2)).toString()

/**
 * Raster legibility gate: rasterization scales every glyph by the resolved
 * integer raster height / SVG viewBox height, because
 * `prepareSvgForPngRasterization` pins the root with `preserveAspectRatio=none`
 * and never rewrites font sizes. When the
 * smallest configured text lands below the `minLabelPx` floor, the render
 * still succeeds — but a text-only agent cannot see the shrink, so the
 * condition must surface as a structured warning. `minLabelPx: 0` disables.
 * No warning when the SVG has no measurable literal font size means that the
 * gate lacks a measurement; it is not proof that every label is readable.
 */
export function buildPngLegibilityWarnings(
  svg: string,
  policy: Pick<ResolvedPngOutputPolicy, 'fitTo' | 'minLabelPx'>,
  rasterDimensions: PngRasterDimensions,
): PngLegibilityWarning[] {
  if (policy.minLabelPx <= 0) return []
  const baseMinLabelPx = smallestSvgFontSize(svg)
  if (baseMinLabelPx === undefined) return []
  const bounds = svgIntrinsicDimensions(svg)
  const userSpace = svgViewBoxDimensions(svg)
  const effectiveScale = rasterDimensions.height / userSpace.height
  const effectiveMinLabelPx = baseMinLabelPx * effectiveScale
  if (effectiveMinLabelPx >= policy.minLabelPx) return []
  const cause = policy.fitTo.mode === 'zoom' ? 'scale' as const : 'fitTo' as const
  const constraint = cause === 'fitTo'
    ? `fitTo ${policy.fitTo.mode} ${policy.fitTo.value}px against a ${format2(bounds.width)}×${format2(bounds.height)} diagram`
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
    message: `smallest measurable configured text is ${format2(baseMinLabelPx)}px and ${constraint} projects it to ${format2(effectiveMinLabelPx)}px, below the ${format2(policy.minLabelPx)}px legibility floor. Raise the fit/scale, split the diagram, or pass minLabelPx: 0 to accept the shrink.`,
  }]
}
