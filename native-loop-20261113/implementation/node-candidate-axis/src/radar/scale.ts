import type { RadarChart } from './types.ts'

/** Resolved finite scale shared by SVG layout and terminal rendering. */
export interface RadarScale {
  min: number
  max: number
}

/**
 * Resolve auto-max once at the family boundary and reject a degenerate domain.
 * Every backend consumes this value object, so SVG and terminal output cannot
 * silently disagree about clamping or zero-width ranges.
 */
export function resolveRadarScale(chart: Pick<RadarChart, 'curves' | 'min' | 'max'>): RadarScale {
  if (!Number.isFinite(chart.min) || chart.min < 0) throw new Error(`Radar min must be a finite non-negative number, got ${chart.min}.`)
  if (chart.max !== undefined && (!Number.isFinite(chart.max) || chart.max < 0)) {
    throw new Error(`Radar max must be a finite non-negative number, got ${chart.max}.`)
  }
  let sawValue = false
  let autoMax = 1
  for (const curve of chart.curves) {
    for (const value of curve.values) {
      if (!Number.isFinite(value) || value < 0) throw new Error(`Radar curve "${curve.id}" contains a non-finite or negative value.`)
      if (!sawValue || value > autoMax) autoMax = value
      sawValue = true
    }
  }
  const max = chart.max ?? (sawValue ? autoMax : 1)
  if (!(max > chart.min)) {
    throw new Error(
      `Radar scale is degenerate: max (${max}) must be greater than min (${chart.min}). ` +
        'Set an explicit `max`, or ensure curve values span a range.',
    )
  }
  return { min: chart.min, max }
}

/** Clamp a value into the chart domain and return its normalized radius ratio. */
export function radarValueRatio(value: number, scale: RadarScale): number {
  const clamped = Math.min(Math.max(value, scale.min), scale.max)
  return (clamped - scale.min) / (scale.max - scale.min)
}
