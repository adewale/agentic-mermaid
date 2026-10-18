import type { PieChart } from '../../src/pie/types.ts'
import type { QuadrantChart, QuadrantPointStyle } from '../../src/quadrant/types.ts'
import type { RadarChart } from '../../src/radar/types.ts'
import type { SankeyDiagram } from '../../src/sankey/types.ts'
import type { XYChart, XYAxis } from '../../src/xychart/types.ts'
import type { GrammarReferenceReply, NativeSemanticProjection } from './grammar-types.ts'
import type { Json } from './reference.ts'

const record = (value: unknown): Record<string, unknown> | undefined => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined
const text = (value: unknown): string => typeof value === 'string' ? value : ''
const argumentText = (value: unknown): string => typeof value === 'string' ? value : text(record(value)?.text)
const projection = (value: Record<string, Json>): NativeSemanticProjection => ({ fields: Object.keys(value), value })

function sectionsByLabel(entries: Array<[string, number]>): Json {
  return entries.sort((a, b) => a[0].localeCompare(b[0]))
}

function nativeStyle(style: QuadrantPointStyle | undefined): Json {
  return {
    ...(style?.radius !== undefined ? { radius: style.radius } : {}),
    ...(style?.color !== undefined ? { color: style.color } : {}),
    ...(style?.strokeColor !== undefined ? { strokeColor: style.strokeColor } : {}),
    ...(style?.strokeWidth !== undefined ? { strokeWidth: style.strokeWidth } : {}),
    ...(style?.extra?.length ? { extra: style.extra } : {}),
  }
}

/** These are authored style values from actual yy arguments, not positioned
 * points or inferred theme defaults. Numeric radius spellings normalize to a
 * number; class/style dictionaries have key semantics, while point order stays.
 */
function referenceStyle(value: unknown): Json {
  const style: Record<string, Json> = {}
  if (!Array.isArray(value)) return style
  for (const entry of value) {
    if (typeof entry !== 'string') continue
    const colon = entry.indexOf(':')
    if (colon < 0) continue
    const key = entry.slice(0, colon).trim()
    const item = entry.slice(colon + 1).trim()
    if (key === 'radius') style.radius = Number(item)
    else if (key === 'color') style.color = item
    else if (key === 'stroke-color') style.strokeColor = item
    else if (key === 'stroke-width') style.strokeWidth = item
    else {
      if (!Array.isArray(style.extra)) style.extra = []
      style.extra.push(entry)
    }
  }
  return style
}

function nativeXYAxis(axis: XYAxis): Json {
  return {
    title: axis.title ?? '',
    categories: axis.categories ?? null,
    // Auto ranges express our rendering policy, not an authored directive.
    range: axis.rangeAuthored && axis.range ? { min: axis.range.min, max: axis.range.max } : null,
  }
}

/** Independent native RESULT projections. Nothing here emits parser actions or
 * reconstructs a native token/yy stream. Optional absent text normalizes to the
 * reference DB's empty string, and absent max/point labels normalize to null.
 * Renderer geometry, default paint, frontmatter config, and accessibility are
 * outside this declared field scope.
 */
export function projectNativeNumeric(family: string, model: unknown): NativeSemanticProjection | undefined {
  if (!record(model)) return undefined
  switch (family) {
    case 'pie': {
      const chart = model as PieChart
      if (!Array.isArray(chart.entries)) return undefined
      // The reference snapshot serializes its Map in sorted-key order, so this
      // field deliberately measures keyed sections rather than insertion order.
      return projection({ title: chart.title ?? '', showData: chart.showData, sectionsByLabel: sectionsByLabel(chart.entries.map(entry => [entry.label, entry.value])) })
    }
    case 'quadrant': {
      const chart = model as QuadrantChart
      if (!Array.isArray(chart.points) || !Array.isArray(chart.quadrants) || !record(chart.classDefs)) return undefined
      return projection({
        title: chart.title ?? '',
        xAxis: chart.xAxis ? { near: chart.xAxis.near, far: chart.xAxis.far ?? '' } : null,
        yAxis: chart.yAxis ? { near: chart.yAxis.near, far: chart.yAxis.far ?? '' } : null,
        quadrants: Array.from({ length: 4 }, (_, index) => chart.quadrants[index] ?? ''),
        points: chart.points.map(point => ({ label: point.label, x: point.x, y: point.y, className: point.className ?? '', style: nativeStyle(point.style) })),
        classDefs: Object.fromEntries(Object.entries(chart.classDefs).map(([name, style]) => [name, nativeStyle(style)])),
      })
    }
    case 'radar': {
      const chart = model as RadarChart
      if (!Array.isArray(chart.axes) || !Array.isArray(chart.curves)) return undefined
      return projection({
        title: chart.title ?? '',
        axes: chart.axes.map(axis => ({ id: axis.id, label: axis.label })),
        curves: chart.curves.map(curve => ({ id: curve.id, label: curve.label, values: curve.values })),
        options: { min: chart.min, max: chart.max ?? null, ticks: chart.ticks, graticule: chart.graticule, showLegend: chart.showLegend },
      })
    }
    case 'sankey': {
      const chart = model as SankeyDiagram
      if (!Array.isArray(chart.nodes) || !Array.isArray(chart.links)) return undefined
      return projection({ title: chart.title ?? '', nodes: chart.nodes, links: chart.links.map(link => ({ source: link.source, target: link.target, value: link.value })) })
    }
    case 'xychart': {
      const chart = model as XYChart
      if (!record(chart.xAxis) || !record(chart.yAxis) || !Array.isArray(chart.series)) return undefined
      return projection({
        title: chart.title ?? '',
        headerOrientation: chart.headerOrientation ?? null,
        xAxis: nativeXYAxis(chart.xAxis),
        yAxis: nativeXYAxis(chart.yAxis),
        series: chart.series.map(series => ({ type: series.type, label: series.label ?? '', values: series.data, pointLabels: series.data.map((_, index) => series.pointLabels?.[index] ?? '') })),
      })
    }
    default: return undefined
  }
}

function referenceQuadrant(reply: GrammarReferenceReply): NativeSemanticProjection | undefined {
  if (reply.actions.status !== 'available') return undefined
  let xAxis: { near: string; far: string } | null = null
  let yAxis: { near: string; far: string } | null = null
  const quadrants: string[] = ['', '', '', '']
  const points: Json[] = []
  const classDefs: Record<string, Json> = Object.create(null)
  for (const action of reply.actions.value) {
    const [operation, value] = action
    if (operation === 'setXAxisLeftText') { xAxis ??= { near: '', far: '' }; xAxis.near = argumentText(value) }
    else if (operation === 'setXAxisRightText') { xAxis ??= { near: '', far: '' }; xAxis.far = argumentText(value) }
    else if (operation === 'setYAxisBottomText') { yAxis ??= { near: '', far: '' }; yAxis.near = argumentText(value) }
    else if (operation === 'setYAxisTopText') { yAxis ??= { near: '', far: '' }; yAxis.far = argumentText(value) }
    else if (typeof operation === 'string' && /^setQuadrant[1-4]Text$/.test(operation)) quadrants[Number(operation[11]) - 1] = argumentText(value)
    else if (operation === 'addPoint') points.push({ label: argumentText(value), className: text(action[2]), x: Number(action[3]), y: Number(action[4]), style: referenceStyle(action[5]) })
    else if (operation === 'addClass' && typeof value === 'string') classDefs[value] = referenceStyle(action[2])
  }
  return projection({ title: text(reply.snapshot?.data.getDiagramTitle), xAxis, yAxis, quadrants, points, classDefs: { ...classDefs } })
}

function referenceXY(reply: GrammarReferenceReply): NativeSemanticProjection | undefined {
  const data = record(reply.snapshot?.data.getXYChartData)
  if (!data || reply.actions.status !== 'available') return undefined
  let orientation: Json = null
  const xAxis: Record<string, Json> = { title: text(record(data.xAxis)?.title), categories: null, range: null }
  const yAxis: Record<string, Json> = { title: text(record(data.yAxis)?.title), categories: null, range: null }
  const series: Json[] = []
  for (const action of reply.actions.value) {
    const [operation, value] = action
    if (operation === 'setOrientation') orientation = text(value)
    else if (operation === 'setXAxisBand') {
      const categories = record(data.xAxis)?.categories
      xAxis.categories = Array.isArray(categories) ? categories as Json[] : []
      xAxis.range = null
    } else if (operation === 'setXAxisRangeData' || operation === 'setYAxisRangeData') {
      const axis = operation === 'setXAxisRangeData' ? xAxis : yAxis
      axis.range = { min: Number(value), max: Number(action[2]) }
      axis.categories = null
    } else if ((operation === 'setBarData' || operation === 'setLineData') && Array.isArray(action[2])) {
      // The getter has already transformed/truncated plots for rendering and
      // discarded point labels. Actual builder arguments retain the authored
      // series; none of these values are screen coordinates.
      const points = action[2].map(point => record(point))
      series.push({ type: operation === 'setBarData' ? 'bar' : 'line', label: argumentText(value), values: points.map(point => Number(point?.value)), pointLabels: points.map(point => text(point?.label)) })
    }
  }
  return projection({ title: text(reply.snapshot?.data.getDiagramTitle), headerOrientation: orientation, xAxis, yAxis, series })
}

/** Reference fields come from real DB getters or actual grammar action
 * arguments. Quadrant's getter contains layout, so logical labels, normalized
 * data coordinates and authored class/style fields use its real yy calls.
 */
export function projectReferenceNumeric(family: string, reply: GrammarReferenceReply): NativeSemanticProjection | undefined {
  if (!reply.accepted) return undefined
  const data = reply.snapshot?.data
  switch (family) {
    case 'pie': {
      if (!Array.isArray(data?.getSections) || typeof data?.getShowData !== 'boolean') return undefined
      const entries = data.getSections.map(entry => Array.isArray(entry) ? [text(entry[0]), Number(entry[1])] as [string, number] : undefined)
      if (entries.some(entry => entry === undefined)) return undefined
      return projection({ title: text(data.getDiagramTitle), showData: data.getShowData, sectionsByLabel: sectionsByLabel(entries as Array<[string, number]>) })
    }
    case 'quadrant': return referenceQuadrant(reply)
    case 'radar': {
      if (!Array.isArray(data?.getAxes) || !Array.isArray(data?.getCurves) || !record(data?.getOptions)) return undefined
      const options = record(data.getOptions)!
      return projection({
        title: text(data.getDiagramTitle),
        axes: data.getAxes.map(axis => ({ id: text(record(axis)?.name), label: text(record(axis)?.label) })),
        curves: data.getCurves.map(curve => ({ id: text(record(curve)?.name), label: text(record(curve)?.label), values: (record(curve)?.entries ?? []) as Json })),
        options: { min: Number(options.min), max: options.max === null || options.max === undefined ? null : Number(options.max), ticks: Number(options.ticks), graticule: text(options.graticule), showLegend: options.showLegend === true },
      })
    }
    case 'sankey': {
      const graph = record(data?.getGraph)
      if (!graph || !Array.isArray(graph.nodes) || !Array.isArray(graph.links)) return undefined
      return projection({ title: text(data?.getDiagramTitle), nodes: graph.nodes.map(node => text(record(node)?.id)), links: graph.links.map(link => ({ source: text(record(link)?.source), target: text(record(link)?.target), value: Number(record(link)?.value) })) })
    }
    case 'xychart': return referenceXY(reply)
    default: return undefined
  }
}
