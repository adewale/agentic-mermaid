import { tryParseCssColor, type RgbaColor } from '../shared/color-math.ts'
import { paintedStrokeExtent } from './bounds.ts'
import { sceneGroupOpacity } from './inspection.ts'
import type { MarkerDescriptor, MarkPaint } from './ir.ts'

/** Identical resources can inherit different paint from distinct carriers.
 * Only explicit concrete paint (or resolved paint in a flat context) can
 * justify the existing exact-pose duplicate exemption. */
export interface MarkerPaintEvidence {
  readonly identity: string
  readonly fillColor: RgbaColor | undefined
  readonly strokeColor: RgbaColor | undefined
  readonly strokeVisible: boolean
  readonly survivingFill: boolean
  readonly transparent: boolean
}

export function computeMarkerPaintEvidence(marker: MarkerDescriptor | undefined, resolveColor: (value: string) => string | undefined, work: () => boolean, resolveVariables: boolean): MarkerPaintEvidence | undefined {
  if (!work() || !marker) return undefined
  const descriptor = Object.getOwnPropertyDescriptor(marker, 'paint')
  if (!descriptor || !Object.hasOwn(descriptor, 'value') || !descriptor.value || typeof descriptor.value !== 'object') return undefined
  const source = descriptor.value as MarkPaint, paint: MarkPaint = Object.create(null)
  const pay = (count: number): boolean => { for (let i = 0; i < count; i++) if (!work()) return false; return true }
  for (const field of ['fill', 'stroke', 'opacity', 'strokeWidth', 'strokeMiterlimit', 'strokeLinecap', 'strokeLinejoin', 'strokeDasharray', 'strokeDashoffset', 'paintOrder'] as const) {
    if (!pay(4)) return undefined
    const value = Object.getOwnPropertyDescriptor(source, field)
    if (!value) { if (field in source) return undefined; continue }
    if (!Object.hasOwn(value, 'value') || value.value !== undefined && typeof value.value !== 'string') return undefined
    if (typeof value.value === 'string' && !pay(value.value.length * 4)) return undefined
    Object.defineProperty(paint, field, { value: value.value })
  }
  const strokeExtent = paintedStrokeExtent(paint, true)
  if (!paint.fill || !Number.isFinite(sceneGroupOpacity(paint.opacity)) || strokeExtent === undefined
    || paint.strokeDasharray !== undefined && paint.strokeDasharray !== 'none' || paint.strokeDashoffset !== undefined
    || paint.paintOrder !== undefined && paint.paintOrder !== 'normal') return undefined
  const concrete = (raw: string): { value: string; rgba: RgbaColor | undefined } | undefined => {
    let rgba = raw === 'none' ? undefined : tryParseCssColor(raw) ?? undefined
    const value = raw === 'none' || rgba ? raw : resolveVariables ? resolveColor(raw) : undefined
    if (!value || !pay(value.length * 2 + 5)) return undefined
    if (value !== 'none' && !rgba) rgba = tryParseCssColor(value) ?? undefined
    return value === 'none' || rgba ? { value, rgba } : undefined
  }
  // The typed omitted-stroke model is shared with marker bounds. Supported
  // emitted resources also require the existing closed root/defs/style guards;
  // absence alone would not establish this default in arbitrary SVG.
  const capturedFill = concrete(paint.fill), capturedStroke = concrete(paint.stroke ?? 'none')
  if (!capturedFill || !capturedStroke || !pay(capturedFill.value.length + capturedStroke.value.length + 17)) return undefined
  // Reuse the parsed colors from this paid own-data snapshot. Never ask a
  // live marker for more paint fields or infer absence from an opacity hint
  // that the resource writer does not emit.
  const fill = capturedFill.value, stroke = capturedStroke.value,
    fillColor = capturedFill.rgba, strokeColor = capturedStroke.rgba
  const noStroke = stroke === 'none' || strokeExtent === 0 || strokeColor?.[3] === 0
  const sameOpaque = fillColor?.[3] === 1 && strokeColor?.[3] === 1
    && fillColor.every((channel, index) => channel === strokeColor[index])
  return { identity: `${fill}\0${stroke}`, fillColor, strokeColor,
    strokeVisible: !noStroke && strokeColor?.[3] === 1 && sceneGroupOpacity(paint.opacity) === 1,
    survivingFill: fillColor?.[3] === 1 && (noStroke || sameOpaque),
    // Declared translucency keeps its existing diagnostic behavior; this new
    // surviving-foreground obligation concerns opaque semantic marker paint.
    transparent: sceneGroupOpacity(paint.opacity) < 1 || !!fillColor && fillColor[3] < 1
      || !!strokeColor && strokeColor[3] < 1 || fill === 'none' && noStroke }
}

