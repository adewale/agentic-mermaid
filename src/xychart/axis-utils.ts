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
    return Array.from({ length: count }, (_, index) => min + step * index)
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

export function linearTicks(min: number, max: number, count = 10): number[] {
  if (!(count > 0)) return []
  if (min === max) return [min]

  const reverse = max < min
  const start = reverse ? max : min
  const stop = reverse ? min : max
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

  return ticks.map(roundTick)
}

export function formatTickValue(value: number): string {
  if (!Number.isFinite(value)) return String(value)
  if (Number.isInteger(value)) return String(value)

  const abs = Math.abs(value)
  if (abs >= 1000 || abs === 0) return roundTick(value).toString()

  const precision = abs < 1 ? 2 : abs < 10 ? 1 : 0
  return stripTrailingZeros(value.toFixed(precision))
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

function roundTick(value: number): number {
  return Math.round(value * 1e12) / 1e12
}

function stripTrailingZeros(value: string): string {
  return value.replace(/\.0+$|(\.\d*?[1-9])0+$/, '$1')
}
