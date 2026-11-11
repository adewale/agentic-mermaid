import type { XYChart } from './types.ts'

export function getDataCount(chart: Pick<XYChart, 'xAxis' | 'series'>): number {
  const seriesCount = Math.max(0, ...chart.series.map(series => series.data.length))
  if (chart.xAxis.categories) return Math.max(1, chart.xAxis.categories.length, seriesCount)
  return Math.max(1, seriesCount)
}

export function getDataXValues(chart: Pick<XYChart, 'xAxis' | 'series'>, count = getDataCount(chart)): number[] {
  if (chart.xAxis.range) {
    const { min, max } = chart.xAxis.range
    const step = count > 1 ? (max - min) / (count - 1) : 0
    return Array.from({ length: count }, (_, index) => {
      if (index === 0) return min
      if (index === count - 1) return max
      return Number.isFinite(step) ? min + step * index : min * (1 - index / (count - 1)) + max * (index / (count - 1))
    })
  }
  return Array.from({ length: count }, (_, index) => index)
}

export function getCategoryLabels(chart: Pick<XYChart, 'xAxis' | 'series'>, count = getDataCount(chart)): string[] {
  if (chart.xAxis.categories) return Array.from({ length: count }, (_, index) => chart.xAxis.categories![index] ?? String(index + 1))
  if (chart.xAxis.range) return getDataXValues(chart, count).map(value => formatTickValue(value))
  return Array.from({ length: count }, (_, index) => String(index + 1))
}

export function getPointSpacing(values: number[], scale: (value: number) => number, fallback: number): number {
  if (values.length < 2) return fallback
  let minSpacing = Number.POSITIVE_INFINITY
  for (let i = 1; i < values.length; i++) {
    minSpacing = Math.min(minSpacing, Math.abs(scale(values[i]!) - scale(values[i - 1]!)))
  }
  return Number.isFinite(minSpacing) && minSpacing > 0 ? minSpacing : fallback
}

/** A value clamped into an axis range authored in either direction. */
export function clampToAxisRange(range: { min: number; max: number }, value: number): number {
  const lo = Math.min(range.min, range.max)
  const hi = Math.max(range.min, range.max)
  return Math.min(hi, Math.max(lo, value))
}

/** Bars measure from zero. When an axis range excludes zero, the nearest range
 * edge is the reference that remains, so zero is clamped into the range. Both
 * the SVG layout and the terminal renderer use this one rule. */
export function barBaselineValue(range: { min: number; max: number }): number {
  return clampToAxisRange(range, 0)
}

/** Display text for a bar's value, shared by data labels and tooltips. */
export function formatBarValue(value: number): string {
  if (Number.isInteger(value)) return String(value)
  const rounded = value.toFixed(Math.abs(value) < 10 ? 1 : 0)
  return Number(rounded) === 0 && value !== 0 ? String(value) : rounded
}

export function linearTicks(min: number, max: number, count = 10): number[] {
  if (!(count > 0) || !Number.isFinite(count)) return []
  if (min === max) return [min]

  const reverse = max < min
  const start = reverse ? max : min
  const stop = reverse ? min : max
  const step = (stop - start) / count
  // Normalize only when subtraction or the reciprocal tick increment cannot
  // be represented. Ordinary domains keep their existing arithmetic.
  if (!Number.isFinite(step) || step === 0 || !Number.isFinite(Math.pow(10, -Math.floor(Math.log10(step))))) {
    const magnitude = Math.max(Math.abs(start), Math.abs(stop))
    const scaledStart = start / magnitude, scaledStop = stop / magnitude
    if (scaledStart === start && scaledStop === stop) return []
    const ticks = linearTicks(scaledStart, scaledStop, count)
      .map(value => value * magnitude)
      .filter(value => Number.isFinite(value) && value >= start && value <= stop)
    const distinct = [...new Set(ticks)]
    return reverse ? distinct.reverse() : distinct
  }
  const [indexStart, indexStop, increment] = tickSpec(start, stop, count)
  if (!(indexStop >= indexStart)) return []

  const tickCount = indexStop - indexStart + 1
  const ticks = new Array<number>(tickCount)
  if (reverse) {
    if (increment < 0) {
      for (let i = 0; i < tickCount; i++) ticks[i] = (indexStop - i) / -increment
    } else {
      for (let i = 0; i < tickCount; i++) ticks[i] = (indexStop - i) * increment
    }
  } else if (increment < 0) {
    for (let i = 0; i < tickCount; i++) ticks[i] = (indexStart + i) / -increment
  } else {
    for (let i = 0; i < tickCount; i++) ticks[i] = (indexStart + i) * increment
  }

  return [...new Set(ticks.map(value => Math.max(start, Math.min(stop, value))))]
}

export function formatTickValue(value: number): string {
  // The shortest round-trip spelling preserves ticks even when their spacing
  // is smaller than a fixed decimal or significant-digit budget.
  return String(value)
}

function tickSpec(start: number, stop: number, count: number): [number, number, number] {
  const step = (stop - start) / Math.max(0, count)
  const power = Math.floor(Math.log10(step))
  const error = step / Math.pow(10, power)
  const factor = error >= Math.sqrt(50) ? 10 : error >= Math.sqrt(10) ? 5 : error >= Math.sqrt(2) ? 2 : 1

  let indexStart: number
  let indexStop: number
  let increment: number

  if (power < 0) {
    increment = Math.pow(10, -power) / factor
    indexStart = Math.round(start * increment)
    indexStop = Math.round(stop * increment)
    if (indexStart / increment < start) indexStart++
    if (indexStop / increment > stop) indexStop--
    increment = -increment
  } else {
    increment = Math.pow(10, power) * factor
    indexStart = Math.round(start / increment)
    indexStop = Math.round(stop / increment)
    if (indexStart * increment < start) indexStart++
    if (indexStop * increment > stop) indexStop--
  }

  if (indexStop < indexStart && 0.5 <= count && count < 2) {
    return tickSpec(start, stop, count * 2)
  }

  return [indexStart, indexStop, increment]
}

