import { parseRegisteredMermaid, serializeMermaid, verifyMermaid } from '../../../agent/index.ts'
import { renderMermaidSVG } from '../../../index.ts'
import { UPSTREAM_MERMAID_MANIFEST } from '../../../upstream-mermaid-manifest.ts'
import { facts, officialFences, record, same, textTags } from '../case-helpers.ts'
import type { FidelityCaseDefinition, FidelityJson, ObservedFidelitySurfaceEvidence } from '../contract.ts'

// This is the complete set of distinct Mermaid fences in the pinned XY Chart
// syntax page. A fence is not called native merely because it produces SVG:
// each expectation below fixes its authored model, paint, labels, or geometry.
const { sources, examples: manifestExamples } = officialFences('xyChart.md')

type Series = { kind: 'bar' | 'line'; name: string | null; values: readonly number[]; pointLabels: readonly (string | null)[] | null }
type Model = {
  title: string
  xCategories: readonly string[]
  xName: string | null
  yName: string
  yRange: readonly [number, number]
  series: readonly Series[]
  frontmatter: FidelityJson
}
type Spec = {
  featureId: string
  model: Model
  diagnostics?: readonly string[]
  legend?: readonly string[]
  palette?: readonly string[]
  pointLabels?: readonly string[]
  dataLabels?: readonly string[]
  viewBox?: string
  titleColor?: string
  yTickValues: readonly number[]
  outsideBarNoOp?: boolean
  // The page says unnamed series are omitted; the local renderer adds fallback
  // entries. The named-legend fence follows the page, but the pinned 11.16.0
  // executable bundle has no XY Chart legend path at all. Neither is parity.
  legendDivergence?: 'unnamed-fallback' | 'pinned-package-no-legend'
}

const months = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']
const tickRange = (start: number, end: number, step: number): number[] =>
  Array.from({ length: Math.round((end - start) / step) + 1 }, (_, index) => start + index * step)
const salesValues = [5000, 6000, 7500, 8200, 9500, 10500, 11000, 10200, 9200, 8500, 7000, 6000]
const bookCategories = ['comedy', 'romance', 'mystery', 'crime', 'non fiction', 'other']
const bookValues = [12, 2, 20, 25, 17, 24]
const bookModel = (outside: boolean): Model => ({
  title: 'Genres in top 100 book survey of 2025', xCategories: bookCategories, xName: null,
  yName: 'Number of Books', yRange: [0, 30],
  series: [{ kind: 'bar', name: null, values: bookValues, pointLabels: null }],
  frontmatter: { xyChart: outside ? { showDataLabel: true, showDataLabelOutsideBar: true } : { showDataLabel: true } },
})
const salesModel = (configured: boolean): Model => ({
  title: 'Sales Revenue', xCategories: months, xName: null, yName: 'Revenue (in $)', yRange: [4000, 11000],
  series: [
    { kind: 'bar', name: null, values: salesValues, pointLabels: null },
    { kind: 'line', name: null, values: salesValues, pointLabels: null },
  ],
  frontmatter: configured ? { xyChart: { width: 900, height: 600, showDataLabel: true }, themeVariables: { xyChart: { titleColor: '#ff0000' } } } : null,
})
const specs: readonly Spec[] = [
  { featureId: 'official-doc:xychart:section:example', model: salesModel(false), legend: ['Bar 1', 'Line 1'],
    yTickValues: tickRange(4000, 11000, 500),
    legendDivergence: 'unnamed-fallback' },
  { featureId: 'official-doc:xychart:section:legend-v', model: {
    title: 'An Example Chart', xCategories: ['90d', '60d', '30d', '7d', '1d', 'Current'], xName: null,
    yName: 'Seconds', yRange: [0, 198.2], frontmatter: null,
    series: [
      { kind: 'line', name: 'avg', values: [48.1, 41.5, 45.7, 72.8, 67.7, 59.9], pointLabels: null },
      { kind: 'line', name: 'p50', values: [38.2, 36.8, 39.7, 54.5, 49, 38.4], pointLabels: null },
      { kind: 'line', name: 'p95', values: [112.2, 75.3, 103, 177, 180.2, 109.4], pointLabels: null },
    ],
  }, legend: ['avg', 'p50', 'p95'], yTickValues: tickRange(0, 180, 20),
  legendDivergence: 'pinned-package-no-legend' },
  { featureId: 'official-doc:xychart:section:setting-colors-for-lines-and-bars', model: {
    title: 'Different Colors in xyChart', xCategories: ['Category 1', 'Category 2', 'Category 3', 'Category 4'],
    xName: 'categoriesX', yName: 'valuesY', yRange: [0, 50],
    frontmatter: { themeVariables: { xyChart: { plotColorPalette: '#000000, #0000FF, #00FF00, #FF0000' } } },
    series: [
      { kind: 'line', name: null, values: [10, 20, 30, 40], pointLabels: null },
      { kind: 'bar', name: null, values: [20, 30, 25, 35], pointLabels: null },
      { kind: 'bar', name: null, values: [15, 25, 20, 30], pointLabels: null },
      { kind: 'line', name: null, values: [5, 15, 25, 35], pointLabels: null },
    ],
  }, diagnostics: ['COMMENT_DROPPED'], legend: ['Line 1', 'Bar 1', 'Bar 2', 'Line 2'],
  palette: ['#000000', '#0000FF', '#00FF00', '#FF0000'], yTickValues: tickRange(0, 50, 5),
  legendDivergence: 'unnamed-fallback' },
  { featureId: 'official-doc:xychart:section:displaying-individual-values-on-a-bar-chart-v11-14-0', model: bookModel(false),
    dataLabels: bookValues.map(String), yTickValues: tickRange(0, 30, 2) },
  { featureId: 'official-doc:xychart:section:displaying-individual-values-on-a-bar-chart-v11-14-0', model: bookModel(true),
    diagnostics: ['INEFFECTIVE_CONFIG'], dataLabels: bookValues.map(String), yTickValues: tickRange(0, 30, 2), outsideBarNoOp: true },
  { featureId: 'official-doc:xychart:section:per-point-text-labels-for-line-charts-v11-16-0', model: {
    title: 'Smallest AI models scoring above 60% on MMLU',
    xCategories: ['Apr 2022', 'Feb 2023', 'Jul 2023', 'Sep 2023', 'Apr 2024'], xName: 'Date',
    yName: 'Parameters (B)', yRange: [0, 600], frontmatter: null,
    series: [{ kind: 'line', name: null, values: [540, 65, 34, 7, 3.8],
      pointLabels: ['PaLM', 'LLaMA-65B', 'Llama 2 34B', 'Mistral 7B', 'Phi-3-mini'] }],
  }, diagnostics: ['LABEL_OVERFLOW'], pointLabels: ['PaLM', 'LLaMA-65B', 'Llama 2 34B', 'Mistral 7B', 'Phi-3-mini'],
  yTickValues: tickRange(0, 600, 50) },
  { featureId: 'official-doc:xychart:section:per-point-text-labels-for-line-charts-v11-16-0', model: {
    title: 'Quarterly Performance', xCategories: ['Q1', 'Q2', 'Q3', 'Q4'], xName: null,
    yName: 'Revenue ($M)', yRange: [0, 100], frontmatter: null,
    series: [{ kind: 'line', name: null, values: [25, 45, 72, 90], pointLabels: ['Launch', null, null, 'Target Hit'] }],
  }, pointLabels: ['Launch', 'Target Hit'], yTickValues: tickRange(0, 100, 10) },
  { featureId: 'official-doc:xychart:section:example-on-config-and-theme', model: salesModel(true),
    legend: ['Bar 1', 'Line 1'], dataLabels: salesValues.map(String), viewBox: '0 0 900 600', titleColor: '#ff0000',
    yTickValues: tickRange(4000, 11000, 500),
    legendDivergence: 'unnamed-fallback' },
]

function modelFacts(source: string): FidelityJson {
  const parsed = parseRegisteredMermaid(source)
  if (!parsed.ok || parsed.value.body.kind !== 'xychart') return { kind: parsed.ok ? parsed.value.body.kind : 'parse-failure' }
  const { body, meta } = parsed.value
  return {
    title: body.title ?? null,
    xCategories: body.xAxis?.categories ?? [], xName: body.xAxis?.name ?? null,
    yName: body.yAxis?.name ?? null,
    yRange: body.yAxis?.range ? [body.yAxis.range.min, body.yAxis.range.max] : null,
    series: body.series.map(series => ({ kind: series.kind, name: series.name ?? null, values: series.values,
      pointLabels: series.pointLabels?.map(label => label ?? null) ?? null })),
    frontmatter: (meta.frontmatter as unknown as FidelityJson | undefined) ?? null,
  }
}
function linePoints(path: string): [number, number][] {
  return [...path.matchAll(/[ML](-?(?:\d+(?:\.\d*)?|\.\d+)),(-?(?:\d+(?:\.\d*)?|\.\d+))/g)]
    .map(match => [Number(match[1]), Number(match[2])])
}
function renderFacts(svg: string): FidelityJson {
  const bars = textTags(svg, 'rect', 'xychart-bar').map(item => ({
    value: item.attributes['data-value'] ?? null, label: item.attributes['data-label'] ?? null,
    colorIndex: Number(item.attributes.class?.match(/xychart-color-(\d+)/)?.[1] ?? -1),
    x: Number(item.attributes.x), y: Number(item.attributes.y), width: Number(item.attributes.width), height: Number(item.attributes.height),
  }))
  const lines = textTags(svg, 'path', 'xychart-line').map(item => ({
    colorIndex: Number(item.attributes.class?.match(/xychart-color-(\d+)/)?.[1] ?? -1),
    points: linePoints(item.attributes.d ?? ''),
  }))
  const dots = textTags(svg, 'circle', 'xychart-dot').map(item => ({ x: Number(item.attributes.cx), y: Number(item.attributes.cy) }))
  const labels = textTags(svg, 'text', 'xychart-point-label').map(item => ({
    text: item.text, x: Number(item.attributes.x), y: Number(item.attributes.y),
    position: item.attributes['data-label-position'] ?? null,
    colorIndex: Number(item.attributes.class?.match(/xychart-color-(\d+)/)?.[1] ?? -1),
    fill: item.attributes.fill ?? null,
    fontSize: item.attributes['font-size'] ?? null,
  }))
  return {
    viewBox: svg.match(/<svg\b[^>]*\bviewBox="([^"]+)"/)?.[1] ?? null,
    title: textTags(svg, 'text', 'xychart-title').map(item => item.text),
    xLabels: textTags(svg, 'text', 'xychart-x-label').map(item => item.text),
    xTicks: textTags(svg, 'text', 'xychart-x-label').map(item => ({ text: item.text, x: Number(item.attributes.x), y: Number(item.attributes.y) })),
    yTicks: textTags(svg, 'text', 'xychart-y-label').map(item => ({ value: Number(item.text), x: Number(item.attributes.x), y: Number(item.attributes.y) })),
    xTitles: textTags(svg, 'text', 'xychart-x-axis-title').map(item => item.text),
    yTitles: textTags(svg, 'text', 'xychart-y-axis-title').map(item => item.text),
    titleAnchors: ['xychart-title', 'xychart-x-axis-title', 'xychart-y-axis-title', 'xychart-legend-label']
      .flatMap(className => textTags(svg, 'text', className).map(item => ({ x: Number(item.attributes.x), y: Number(item.attributes.y) }))),
    bars, lines, dots, labels,
    dataLabels: textTags(svg, 'text', 'xychart-data-label').map(item => ({
      text: item.text, x: Number(item.attributes.x), y: Number(item.attributes.y),
      fontSize: item.attributes['font-size'] ?? null,
    })),
    dataLabelPaint: svg.match(/\.xychart-data-label \{ fill: ([^;]+);/)?.[1] ?? null,
    lineStrokeWidth: svg.match(/\.xychart-line \{[^}]*stroke-width: ([^;]+);/)?.[1] ?? null,
    legend: textTags(svg, 'text', 'xychart-legend-label').map(item => item.text),
    palette: [...svg.matchAll(/--xychart-color-\d+:\s*([^;]+);/g)].map(match => match[1]!),
    barPaint: [...svg.matchAll(/\.xychart-bar\.xychart-color-(\d+) \{ fill: ([^;]+); \}/g)]
      .map(match => ({ index: Number(match[1]), color: match[2]! })),
    linePaint: [...svg.matchAll(/path\.xychart-color-(\d+), line\.xychart-color-\d+ \{ stroke: ([^;]+); \}/g)]
      .map(match => ({ index: Number(match[1]), color: match[2]! })),
    dotPaint: [...svg.matchAll(/circle\.xychart-color-(\d+) \{ fill: ([^;]+); \}/g)]
      .map(match => ({ index: Number(match[1]), color: match[2]! })),
    titleColor: svg.match(/\.xychart-title \{ fill: ([^;]+); \}/)?.[1] ?? null,
  }
}
function affineLinesMatch(actual: Readonly<Record<string, FidelityJson>>, spec: Spec): boolean {
  const lines = actual.lines
  if (!Array.isArray(lines)) return false
  const expectedLines = spec.model.series.flatMap((series, index) => series.kind === 'line' ? [{ index, values: series.values }] : [])
  if (lines.length !== expectedLines.length) return false
  if (expectedLines.length === 0) return true
  const pairs: { value: number; x: number; y: number; pointIndex: number }[] = []
  for (const [lineIndex, expected] of expectedLines.entries()) {
    const line = record(lines[lineIndex]!)
    if (line.colorIndex !== expected.index || !Array.isArray(line.points) || line.points.length !== expected.values.length) return false
    let previousX = -Infinity
    for (const [pointIndex, value] of expected.values.entries()) {
      const point = line.points[pointIndex]
      if (!Array.isArray(point) || point.length !== 2 || typeof point[0] !== 'number' || typeof point[1] !== 'number'
        || !Number.isFinite(point[0]) || point[0] <= previousX) return false
      pairs.push({ value, x: point[0], y: point[1], pointIndex })
      previousX = point[0]
    }
  }
  const first = pairs[0]
  const second = pairs.find(pair => pair.value !== first?.value)
  if (!first || !second) return false
  const slope = (second.y - first.y) / (second.value - first.value)
  const intercept = first.y - slope * first.value
  if (!Number.isFinite(slope) || slope >= 0) return false
  return pairs.every(pair => Math.abs(pair.y - (intercept + slope * pair.value)) <= 0.12
    && pairs.every(other => pair.pointIndex !== other.pointIndex || Math.abs(pair.x - other.x) <= 0.12))
}
function renderMatches(evidence: ObservedFidelitySurfaceEvidence, spec: Spec): boolean {
  const actual = facts(evidence)
  if (!same(actual.title, [spec.model.title]) || !same(actual.xLabels, spec.model.xCategories)
    || !same(actual.xTitles, spec.model.xName ? [spec.model.xName] : [])
    || !same(actual.yTitles, [spec.model.yName])
    || !same(actual.legend, spec.legend ?? [])
    || actual.viewBox !== (spec.viewBox ?? '0 0 700 500')
    || !affineLinesMatch(actual, spec)) return false
  const viewBox = typeof actual.viewBox === 'string' ? actual.viewBox.split(' ').map(Number) : []
  if (viewBox.length !== 4 || viewBox.some(value => !Number.isFinite(value))) return false
  const [, , chartWidth, chartHeight] = viewBox
  if (chartWidth! <= 0 || chartHeight! <= 0) return false
  const withinX = (value: unknown): value is number => typeof value === 'number'
    && Number.isFinite(value) && value >= 0 && value <= chartWidth!
  const withinY = (value: unknown): value is number => typeof value === 'number'
    && Number.isFinite(value) && value >= 0 && value <= chartHeight!
  const titleAnchors = actual.titleAnchors
  if (!Array.isArray(titleAnchors) || titleAnchors.some(anchor => {
    const item = record(anchor)
    return !withinX(item.x) || !withinY(item.y)
  })) return false
  const xTicks = actual.xTicks
  const yTicks = actual.yTicks
  if (!Array.isArray(xTicks) || xTicks.length !== spec.model.xCategories.length
    || !Array.isArray(yTicks) || yTicks.length !== spec.yTickValues.length) return false
  let previousX = -Infinity
  for (const [index, tick] of xTicks.entries()) {
    const item = record(tick)
    if (item.text !== spec.model.xCategories[index] || !withinX(item.x) || !withinY(item.y)
      || item.x <= previousX) return false
    previousX = item.x
  }
  const firstYTick = record(yTicks[0]!)
  const secondYTick = record(yTicks[1]!)
  if (typeof firstYTick.y !== 'number' || typeof secondYTick.y !== 'number'
    || firstYTick.value !== spec.yTickValues[0] || secondYTick.value !== spec.yTickValues[1]) return false
  const ySlope = (secondYTick.y - firstYTick.y) / (spec.yTickValues[1]! - spec.yTickValues[0]!)
  const yIntercept = firstYTick.y - ySlope * spec.yTickValues[0]!
  if (!Number.isFinite(ySlope) || ySlope >= 0 || yTicks.some((tick, index) => {
    const item = record(tick)
    return item.value !== spec.yTickValues[index] || !withinX(item.x) || !withinY(item.y)
      || Math.abs(item.y - (yIntercept + ySlope * spec.yTickValues[index]!)) > 0.15
  })) return false
  const linesForScale = actual.lines
  if (!Array.isArray(linesForScale) || linesForScale.some((line, lineIndex) => {
    const points = record(line).points
    const expected = spec.model.series.filter(series => series.kind === 'line')[lineIndex]
    return !expected || !Array.isArray(points) || points.some((point, pointIndex) => {
      if (!Array.isArray(point) || typeof point[0] !== 'number' || typeof point[1] !== 'number') return true
      const tick = record(xTicks[pointIndex]!)
      return point[0] < 0 || point[0] > chartWidth! || point[1] < 0 || point[1] > chartHeight!
        || typeof tick.x !== 'number' || Math.abs(point[0] - tick.x) > 0.15
        || Math.abs(point[1] - (yIntercept + ySlope * expected.values[pointIndex]!)) > 0.15
    })
  }) || (linesForScale.length > 0 && actual.lineStrokeWidth !== '3')) return false
  if (spec.palette && !same(actual.palette, spec.palette)) return false
  if (spec.titleColor && actual.titleColor !== spec.titleColor) return false
  const palette = actual.palette
  const barPaint = actual.barPaint
  const linePaint = actual.linePaint
  const dotPaint = actual.dotPaint
  if (!Array.isArray(palette) || !Array.isArray(barPaint) || !Array.isArray(linePaint) || !Array.isArray(dotPaint)) return false
  for (const [index, series] of spec.model.series.entries()) {
    const color = palette[index]
    const rules = series.kind === 'bar' ? barPaint : linePaint
    if (typeof color !== 'string' || !rules.some(rule => {
      const paint = record(rule)
      return paint.index === index && paint.color === color
    })) return false
    if (series.pointLabels?.some(Boolean) && !dotPaint.some(rule => {
      const paint = record(rule)
      return paint.index === index && paint.color === color
    })) return false
  }
  const bars = actual.bars
  const minimumTickSpacing = Math.min(...xTicks.slice(1).map((tick, index) => {
    const current = record(tick).x
    const previous = record(xTicks[index]!).x
    return typeof current === 'number' && typeof previous === 'number' ? current - previous : NaN
  }))
  if (!Number.isFinite(minimumTickSpacing) || minimumTickSpacing <= 0) return false
  const expectedBars = spec.model.series.flatMap((series, index) => series.kind === 'bar'
    ? series.values.map((value, pointIndex) => ({ value: String(value), label: spec.model.xCategories[pointIndex], colorIndex: index })) : [])
  if (!Array.isArray(bars) || bars.length !== expectedBars.length) return false
  for (const [index, expected] of expectedBars.entries()) {
    const bar = record(bars[index]!)
    if (bar.value !== expected.value || bar.label !== expected.label || bar.colorIndex !== expected.colorIndex
      || typeof bar.x !== 'number' || typeof bar.y !== 'number' || typeof bar.width !== 'number' || typeof bar.height !== 'number'
      || bar.width < minimumTickSpacing * 0.1 || bar.height <= 0 || bar.x < 0 || bar.x + bar.width > chartWidth!
      || bar.y < 0 || bar.y + bar.height > chartHeight!
      || Math.abs(bar.y - (yIntercept + ySlope * Number(expected.value))) > 0.15) return false
  }
  let barOffset = 0
  for (const series of spec.model.series.filter(item => item.kind === 'bar')) {
    let previousX = -Infinity
    for (let index = 0; index < series.values.length; index += 1) {
      const bar = record(bars[barOffset + index]!)
      if (typeof bar.x !== 'number' || !Number.isFinite(bar.x) || bar.x <= previousX) return false
      previousX = bar.x
    }
    barOffset += series.values.length
  }
  const barSeries = spec.model.series.filter(item => item.kind === 'bar')
  if (barSeries.length > 0) {
    for (let pointIndex = 0; pointIndex < spec.model.xCategories.length; pointIndex += 1) {
      const categoryBars = barSeries.map((_, seriesIndex) => {
        const bar = record(bars[seriesIndex * spec.model.xCategories.length + pointIndex]!)
        return { left: bar.x as number, right: (bar.x as number) + (bar.width as number) }
      })
      if (categoryBars.some((bar, index) => index > 0 && categoryBars[index - 1]!.right > bar.left + 0.15)) return false
      const centers = categoryBars.map(bar => (bar.left + bar.right) / 2)
      const tick = record(xTicks[pointIndex]!)
      if (typeof tick.x !== 'number' || Math.abs(centers.reduce((sum, center) => sum + center, 0) / centers.length - tick.x) > 0.15) return false
    }
  }
  if (bars.length > 1) {
    const first = record(bars[0]!)
    const secondIndex = expectedBars.findIndex(bar => bar.value !== expectedBars[0]!.value)
    if (secondIndex < 0) return false
    const second = record(bars[secondIndex]!)
    const slope = ((second.y as number) - (first.y as number))
      / (Number(expectedBars[secondIndex]!.value) - Number(expectedBars[0]!.value))
    const intercept = (first.y as number) - slope * Number(expectedBars[0]!.value)
    const baseline = (first.y as number) + (first.height as number)
    if (!Number.isFinite(slope) || slope >= 0 || bars.some((bar, index) => {
      const item = record(bar)
      return typeof item.y !== 'number' || typeof item.height !== 'number'
        || Math.abs(item.y - (intercept + slope * Number(expectedBars[index]!.value))) > 0.12
        || Math.abs(item.y + item.height - baseline) > 0.12
    })) return false
    const lines = actual.lines
    const expectedLines = spec.model.series.filter(series => series.kind === 'line')
    if (!Array.isArray(lines) || lines.some((line, lineIndex) => {
      const points = record(line).points
      return !Array.isArray(points) || points.some((point, pointIndex) => {
        if (!Array.isArray(point) || typeof point[1] !== 'number') return true
        return Math.abs(point[1] - (intercept + slope * expectedLines[lineIndex]!.values[pointIndex]!)) > 0.12
      })
    })) return false
  }
  const labels = actual.labels
  if (!Array.isArray(labels) || !same(labels.map(label => record(label).text), spec.pointLabels ?? [])) return false
  const expectedLabeledPoints = spec.model.series.flatMap((series, seriesIndex) => {
    if (series.kind !== 'line' || !series.pointLabels) return []
    const lineIndex = spec.model.series.slice(0, seriesIndex).filter(item => item.kind === 'line').length
    return series.pointLabels.flatMap((text, pointIndex) => text ? [{ text, seriesIndex, lineIndex, pointIndex }] : [])
  })
  const dots = actual.dots
  const lines = actual.lines
  if (!Array.isArray(dots) || !Array.isArray(lines) || dots.length !== expectedLabeledPoints.length
    || labels.length !== expectedLabeledPoints.length) return false
  for (const [index, expected] of expectedLabeledPoints.entries()) {
    const label = record(labels[index]!)
    const dot = record(dots[index]!)
    const points = record(lines[expected.lineIndex]!).points
    if (!Array.isArray(points) || !Array.isArray(points[expected.pointIndex])) return false
    const point = points[expected.pointIndex] as FidelityJson[]
    if (label.text !== expected.text || label.position !== 'above'
      || label.colorIndex !== expected.seriesIndex || label.fill !== palette[expected.seriesIndex]
      || label.fontSize !== '12'
      || typeof point[0] !== 'number' || typeof point[1] !== 'number'
      || label.x !== point[0] || dot.x !== point[0] || dot.y !== point[1]
      || !withinY(label.y) || Math.abs(label.y - (point[1] - 8)) > 0.12) return false
  }
  const dataLabels = actual.dataLabels
  if (!Array.isArray(dataLabels) || !same(dataLabels.map(label => record(label).text), spec.dataLabels ?? [])) return false
  if (dataLabels.length > 0 && actual.dataLabelPaint !== '#27272A') return false
  if (dataLabels.length > 0 && dataLabels.some((label, index) => {
    const text = record(label)
    const bar = record(bars[index]!)
    return !withinX(text.x) || text.fontSize !== '16' || typeof text.y !== 'number' || typeof bar.x !== 'number'
      || typeof bar.width !== 'number' || typeof bar.y !== 'number' || typeof bar.height !== 'number'
      || Math.abs(text.x - (bar.x + bar.width / 2)) > 0.15
      || text.y < bar.y || text.y > bar.y + bar.height
  })) return false
  return true
}

export const fidelityCases: readonly FidelityCaseDefinition[] = specs.map((spec, index) => ({
  id: `xychart.official.fence-${index}`,
  family: 'xychart',
  featureId: spec.featureId,
  source: sources[index]!,
  upstreamReference: `${manifestExamples[index]!.officialDocs}#${spec.featureId.split(':section:')[1]}`,
  upstreamRevision: UPSTREAM_MERMAID_MANIFEST.provenance.commit,
  expected: {
    agent: { applicability: 'applicable', disposition: spec.outsideBarNoOp ? 'diagnosed' : 'native',
      diagnosticCodes: spec.diagnostics ?? [],
      evaluate: evidence => same(facts(evidence).model, spec.model)
        && (spec.outsideBarNoOp ? facts(evidence).outsideBarWarning === true : true)
        ? spec.outsideBarNoOp ? 'diagnosed' : 'native' : 'absent' },
    render: { applicability: 'applicable', disposition: spec.outsideBarNoOp || spec.legendDivergence ? 'absent' : 'native',
      evaluate: evidence => renderMatches(evidence, spec)
        ? (spec.outsideBarNoOp && facts(evidence).identicalToInsideLabels === true) || Boolean(spec.legendDivergence)
          ? 'absent' : 'native'
        : 'source-preserved' },
    serialize: { applicability: 'applicable', disposition: 'native',
      evaluate: evidence => same(facts(evidence).model, spec.model) && facts(evidence).stable === true ? 'native' : 'absent' },
    mutate: { applicability: 'not-applicable', rationale: 'Official syntax-fence classification does not advertise a mutation; XY Chart set_data_point has its own semantic receipt.' },
  },
  observe: () => {
    const source = sources[index]!
    const parsed = parseRegisteredMermaid(source)
    if (!parsed.ok) throw new Error(`Pinned official XY Chart fence ${index} no longer parses`)
    const verification = verifyMermaid(parsed.value)
    const svg = renderMermaidSVG(source)
    const serialized = serializeMermaid(parsed.value)
    const reparsed = parseRegisteredMermaid(serialized)
    if (!reparsed.ok) throw new Error(`Pinned official XY Chart fence ${index} no longer reparses`)
    return {
      agent: { status: 'observed', diagnosticCodes: [...new Set(verification.warnings.map(warning => warning.code))],
        semantics: { model: modelFacts(source), outsideBarWarning: verification.warnings.some(warning => warning.code === 'INEFFECTIVE_CONFIG' && warning.message.includes('showDataLabelOutsideBar')) } },
      render: { status: 'observed', diagnosticCodes: [], semantics: {
        ...record(renderFacts(svg)), identicalToInsideLabels: index === 4 ? svg === renderMermaidSVG(sources[3]!) : false,
      } },
      serialize: { status: 'observed', diagnosticCodes: [], semantics: {
        model: modelFacts(serialized), stable: serializeMermaid(reparsed.value) === serialized,
      } },
    }
  },
}))
