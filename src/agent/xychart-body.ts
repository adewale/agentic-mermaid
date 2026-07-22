// ============================================================================
// XY chart structured body (BUILD-16: promotes xychart from opaque-only
// fallback semantics to structured mutation, following the BUILD-15 journey and
// BUILD-17 architecture pilots).
//
// Modeled grammar (mirrors the legacy renderer parser, src/xychart/parser.ts):
//   xychart-beta | xychart   [horizontal | vertical]
//   title <text>
//   x-axis [<cat>, <cat>, …]              — categorical
//   x-axis <name> [<cat>, …]              — named categorical
//   x-axis <min> --> <max>                — numeric range
//   x-axis <name> <min> --> <max>         — named range
//   y-axis <name>                         — name only
//   y-axis <min> --> <max>                — range only
//   y-axis <name> <min> --> <max>         — named range
//   bar  [<n>, …]   /  bar  <name>  [<n>, …]
//   line [<n>, …]   /  line <name> [<n>, …]
//
// Structured-or-opaque: any unsupported or malformed family statement returns
// null. Quoted text and quote-aware semicolon-separated statements are part of
// the shared renderer grammar and therefore remain structured.
// Universal accTitle/accDescr directives are removed and preserved by the
// source envelope before this family grammar runs.
// Other unmodeled syntax falls back to a lossless opaque body. Mutations retain
// a deliberately narrower bare-text input contract, but already-authored
// quoted values are parsed and serialized by the shared lossless authority.
// ============================================================================

import { unknownOpMessage } from './mutation-ops.ts'
import type {
  XyChartBody, XyChartAxis, XyChartSeries, XyChartMutationOp,
  MutationError, Result, LayoutWarning, VerifyOptions,
} from './types.ts'
import { ok, err } from './types.ts'
import { indexedIdAllocator, labelOverflowCollector } from './body-utils.ts'
import { appendAccessibilityLines } from './accessibility-envelope.ts'
import { parseXYChart, renderXYChartText } from '../xychart/parser.ts'

// ---- Number format ----------------------------------------------------------
//
// Mermaid 11.16 accepts decimal notation but not exponent notation. JavaScript
// switches `String(number)` to exponents for large and small finite values, so
// expand that shortest round-tripping representation back into a plain decimal.
// This makes every finite value admitted by mutation serializable by the same
// grammar that must reparse it.

function formatNumber(n: number): string {
  if (!Number.isFinite(n)) throw new Error(`Cannot serialize non-finite XYChart number: ${String(n)}`)
  if (Object.is(n, -0)) return '-0'
  const source = String(n)
  const match = source.match(/^(-?)(\d)(?:\.(\d+))?e([+-]?\d+)$/i)
  if (!match) return source

  const sign = match[1]!
  const digits = match[2]! + (match[3] ?? '')
  const decimalIndex = 1 + Number(match[4])
  if (decimalIndex <= 0) return `${sign}0.${'0'.repeat(-decimalIndex)}${digits}`
  if (decimalIndex >= digits.length) return `${sign}${digits}${'0'.repeat(decimalIndex - digits.length)}`
  return `${sign}${digits.slice(0, decimalIndex)}.${digits.slice(decimalIndex)}`
}

function isFiniteNumber(n: unknown): n is number {
  return typeof n === 'number' && Number.isFinite(n)
}

// ---- Parser -----------------------------------------------------------------

// A bare text token must not introduce quoting, brackets, the range operator,
// or statement separators — anything that wouldn't round-trip through the
// legacy parser when re-emitted unquoted.
const BARE_TEXT_RE = /^[^"'\[\];]+$/

function normalizeText(value: string): string {
  return value.split(/\r?\n/).map(part => part.trim()).filter(Boolean).join(' ')
}

/** A bare text token is non-empty, has no quote/bracket/semicolon, and doesn't
 *  contain the `-->` range operator (which would re-parse as a range). */
function isBareText(value: string): boolean {
  return value.length > 0 && BARE_TEXT_RE.test(value) && !value.includes('-->')
}

/**
 * Project the renderer's grammar AST into the agent AST. This is deliberately
 * a projection rather than a second parser: syntax recognition, escaping,
 * statement splitting, and last-writer rules have one authority.
 */
export function parseXyChartBody(lines: readonly string[]): XyChartBody | null {
  try {
    const chart = parseXYChart([...lines], { strict: true })
    if (chart.series.length === 0) return null
    const projectAxis = (axis: typeof chart.xAxis): XyChartAxis => ({
      ...(axis.title !== undefined ? { name: axis.title } : {}),
      ...(axis.categories !== undefined ? { categories: [...axis.categories] } : {}),
      ...(axis.rangeAuthored && axis.range !== undefined ? { range: { ...axis.range } } : {}),
    })
    return {
      kind: 'xychart',
      ...(chart.title !== undefined ? { title: chart.title } : {}),
      ...(chart.accessibility?.title !== undefined ? { accessibilityTitle: chart.accessibility.title } : {}),
      ...(chart.accessibility?.description !== undefined ? { accessibilityDescription: chart.accessibility.description } : {}),
      ...(chart.headerOrientation !== undefined ? { horizontal: chart.horizontal } : {}),
      ...(chart.xAxis.authored ? { xAxis: projectAxis(chart.xAxis) } : {}),
      ...(chart.yAxis.authored ? { yAxis: projectAxis(chart.yAxis) } : {}),
      series: chart.series.map((series, index) => ({
        id: `series-${index}`,
        kind: series.type,
        ...(series.label !== undefined ? { name: series.label } : {}),
        values: [...series.data],
        ...(series.pointLabels !== undefined ? { pointLabels: [...series.pointLabels] } : {}),
      })),
    }
  } catch {
    return null
  }
}

// ---- Serializer -------------------------------------------------------------

function renderAxis(keyword: 'x-axis' | 'y-axis', axis: XyChartAxis): string {
  const parts: string[] = []
  if (axis.name !== undefined) parts.push(renderXYChartText(axis.name, 'token'))
  if (axis.range) parts.push(`${formatNumber(axis.range.min)} --> ${formatNumber(axis.range.max)}`)
  if (axis.categories) parts.push(`[${axis.categories.map(value => renderXYChartText(value, 'list')).join(', ')}]`)
  return `  ${keyword} ${parts.join(' ')}`
}

export function renderXyChart(body: XyChartBody): string {
  const header = body.horizontal === true
    ? 'xychart-beta horizontal'
    : body.horizontal === false
      ? 'xychart-beta vertical'
      : 'xychart-beta'
  const lines: string[] = [header]
  appendAccessibilityLines(lines, body)
  if (body.title !== undefined) lines.push(`  title ${renderXYChartText(body.title, 'free')}`)
  if (body.xAxis) lines.push(renderAxis('x-axis', body.xAxis))
  if (body.yAxis) lines.push(renderAxis('y-axis', body.yAxis))
  for (const s of body.series) {
    const namePart = s.name !== undefined ? `${renderXYChartText(s.name, 'free')} ` : ''
    const values = s.values.map((value, index) => {
      const label = s.pointLabels?.[index]
      return `${formatNumber(value)}${label !== undefined ? ` ${renderXYChartText(label, 'quoted')}` : ''}`
    })
    lines.push(`  ${s.kind} ${namePart}[${values.join(', ')}]`)
  }
  return lines.join('\n') + '\n'
}

// ---- Mutator ----------------------------------------------------------------

function cloneAxis(a: XyChartAxis): XyChartAxis {
  return {
    name: a.name,
    categories: a.categories ? [...a.categories] : undefined,
    range: a.range ? { ...a.range } : undefined,
  }
}

function cloneXyChart(b: XyChartBody): XyChartBody {
  return {
    kind: 'xychart',
    accessibilityTitle: b.accessibilityTitle,
    accessibilityDescription: b.accessibilityDescription,
    title: b.title,
    horizontal: b.horizontal,
    xAxis: b.xAxis ? cloneAxis(b.xAxis) : undefined,
    yAxis: b.yAxis ? cloneAxis(b.yAxis) : undefined,
    series: b.series.map(s => ({ id: s.id, kind: s.kind, name: s.name, values: [...s.values], ...(s.pointLabels ? { pointLabels: [...s.pointLabels] } : {}) })),
  }
}

function validBareText(value: unknown, field: string): Result<string, MutationError> {
  if (typeof value !== 'string') return err({ code: 'INVALID_OP', message: `XY chart ${field} must be a string` })
  const normalized = normalizeText(value)
  if (!isBareText(normalized)) {
    return err({ code: 'INVALID_OP', message: `XY chart ${field} must be non-empty bare text (no quotes, brackets, ; or -->)` })
  }
  return ok(normalized)
}

function validValues(values: unknown, field: string): Result<number[], MutationError> {
  if (!Array.isArray(values) || values.length === 0) {
    return err({ code: 'INVALID_OP', message: `XY chart ${field} must be a non-empty array of numbers` })
  }
  for (const v of values) {
    if (!isFiniteNumber(v)) return err({ code: 'INVALID_OP', message: `XY chart ${field} must contain only finite numbers, got ${JSON.stringify(v)}` })
  }
  return ok([...values as number[]])
}

/** Build an axis from a structured op payload (categories XOR range, both
 *  optional name). Validates bare text + finite numbers. */
function buildAxis(
  spec: { name?: string | null; categories?: string[]; range?: { min: number; max: number } },
  axisName: 'x' | 'y',
): Result<XyChartAxis, MutationError> {
  const axis: XyChartAxis = {}
  if (spec.name !== undefined && spec.name !== null) {
    const n = validBareText(spec.name, `${axisName}-axis name`)
    if (!n.ok) return n
    axis.name = n.value
  }
  const hasCategories = spec.categories !== undefined
  const hasRange = spec.range !== undefined
  if (hasCategories && hasRange) {
    return err({ code: 'INVALID_OP', message: `XY chart ${axisName}-axis cannot have both categories and a range` })
  }
  if (hasCategories) {
    if (axisName === 'y') return err({ code: 'INVALID_OP', message: 'XY chart y-axis cannot be categorical' })
    if (!Array.isArray(spec.categories) || spec.categories.length === 0) {
      return err({ code: 'INVALID_OP', message: 'XY chart x-axis categories must be a non-empty array' })
    }
    const cats: string[] = []
    for (const c of spec.categories) {
      const r = validBareText(c, 'x-axis category')
      if (!r.ok) return r
      cats.push(r.value)
    }
    axis.categories = cats
  }
  if (hasRange) {
    const { min, max } = spec.range!
    if (!isFiniteNumber(min) || !isFiniteNumber(max)) {
      return err({ code: 'INVALID_OP', message: `XY chart ${axisName}-axis range min/max must be finite numbers` })
    }
    axis.range = { min, max }
  }
  if (axis.name === undefined && !hasCategories && !hasRange) {
    return err({ code: 'INVALID_OP', message: `XY chart ${axisName}-axis needs a name, categories, or a range` })
  }
  return ok(axis)
}

export function mutateXyChart(body: XyChartBody, op: XyChartMutationOp): Result<XyChartBody, MutationError> {
  const next = cloneXyChart(body)
  const nextId = indexedIdAllocator(next.series.map(series => series.id), 'series')

  switch (op.kind) {
    case 'set_title': {
      if (op.title === null) { delete next.title; break }
      const t = validBareText(op.title, 'title')
      if (!t.ok) return t
      next.title = t.value
      break
    }
    case 'set_x_axis': {
      if (op.axis === null) { delete next.xAxis; break }
      const axis = buildAxis(op.axis, 'x')
      if (!axis.ok) return axis
      next.xAxis = axis.value
      break
    }
    case 'set_y_axis': {
      if (op.axis === null) { delete next.yAxis; break }
      const axis = buildAxis(op.axis, 'y')
      if (!axis.ok) return axis
      next.yAxis = axis.value
      break
    }
    case 'add_series': {
      if (op.kind2 !== 'bar' && op.kind2 !== 'line') {
        return err({ code: 'INVALID_OP', message: `XY chart series kind must be 'bar' or 'line', got ${JSON.stringify(op.kind2)}` })
      }
      let name: string | undefined
      if (op.name !== undefined && op.name !== null) {
        const n = validBareText(op.name, 'series name')
        if (!n.ok) return n
        name = n.value
      }
      const values = validValues(op.values, 'series values')
      if (!values.ok) return values
      next.series.push({ id: nextId(), kind: op.kind2, name, values: values.value })
      break
    }
    case 'remove_series': {
      if (!next.series[op.index]) return err({ code: 'SERIES_NOT_FOUND', message: `No series at index ${op.index}` })
      next.series.splice(op.index, 1)
      break
    }
    case 'set_series_values': {
      const s = next.series[op.index]
      if (!s) return err({ code: 'SERIES_NOT_FOUND', message: `No series at index ${op.index}` })
      const values = validValues(op.values, 'series values')
      if (!values.ok) return values
      s.values = values.value
      if (s.pointLabels) {
        s.pointLabels = values.value.map((_, pointIndex) => s.pointLabels?.[pointIndex])
        if (!s.pointLabels.some(label => label !== undefined)) delete s.pointLabels
      }
      break
    }
    case 'set_series_name': {
      const s = next.series[op.index]
      if (!s) return err({ code: 'SERIES_NOT_FOUND', message: `No series at index ${op.index}` })
      if (op.name === null) { delete s.name; break }
      const n = validBareText(op.name, 'series name')
      if (!n.ok) return n
      s.name = n.value
      break
    }
    case 'reorder_series': {
      const { from, to } = op
      if (!Number.isInteger(from) || !Number.isInteger(to) || !next.series[from] || to < 0 || to >= next.series.length) {
        return err({ code: 'SERIES_NOT_FOUND', message: `reorder_series indices out of range (from=${from}, to=${to})` })
      }
      const [moved] = next.series.splice(from, 1)
      next.series.splice(to, 0, moved!)
      break
    }
    case 'set_orientation': {
      if (typeof op.horizontal !== 'boolean') {
        return err({ code: 'INVALID_OP', message: `XY chart set_orientation horizontal must be a boolean (true = horizontal, false = vertical), got ${JSON.stringify(op.horizontal)}` })
      }
      // Preserve both explicit orientations. Absence remains the only state
      // that defers to runtime frontmatter configuration.
      next.horizontal = op.horizontal
      break
    }
    case 'set_data_point': {
      const s = Number.isInteger(op.seriesIndex) ? next.series[op.seriesIndex] : undefined
      if (!s) {
        const range = next.series.length > 0 ? ` (valid indices 0..${next.series.length - 1})` : ' (the chart has no series)'
        return err({ code: 'SERIES_NOT_FOUND', message: `No series at index ${JSON.stringify(op.seriesIndex)}${range}` })
      }
      if (!Number.isInteger(op.index) || op.index < 0 || op.index >= s.values.length) {
        return err({ code: 'POINT_NOT_FOUND', message: `No data point at index ${JSON.stringify(op.index)} in series ${op.seriesIndex} (${s.values.length} values, valid indices 0..${s.values.length - 1})` })
      }
      if (!isFiniteNumber(op.value)) {
        return err({ code: 'INVALID_OP', message: `XY chart data point value must be a finite number, got ${JSON.stringify(op.value)}` })
      }
      s.values[op.index] = op.value
      break
    }
    default: {
      const _x: never = op
      return err({ code: 'INVALID_OP', message: unknownOpMessage('xychart', _x) })
    }
  }

  // Preserve the structured floor: an xychart must keep at least one series so
  // it always renders. Only mutations that EMPTY a non-empty chart are refused;
  // a body that starts empty (createMermaid/buildMermaid) may stay empty while
  // ops build it up — title/axes first, series after.
  if (body.series.length > 0 && next.series.length === 0) {
    return err({ code: 'INVALID_OP', message: 'XY chart must keep at least one series' })
  }

  return ok(next)
}

// ---- Verifier (FamilyDescriptor.verify hook) --------------------------------

export function verifyXyChart(body: XyChartBody, opts: VerifyOptions): LayoutWarning[] {
  const warnings: LayoutWarning[] = []
  const overflow = labelOverflowCollector(warnings, opts)
  if (body.series.length === 0) warnings.push({ code: 'EMPTY_DIAGRAM' })
  if (body.title !== undefined) overflow('title', body.title)
  if (body.xAxis?.name !== undefined) overflow('x-axis', body.xAxis.name)
  for (const c of body.xAxis?.categories ?? []) overflow('x-axis', c)
  if (body.yAxis?.name !== undefined) overflow('y-axis', body.yAxis.name)
  for (const s of body.series) {
    if (s.name !== undefined) overflow(s.id, s.name)
    const categoryCount = body.xAxis?.categories?.length
    if (categoryCount !== undefined && s.values.length !== categoryCount) {
      warnings.push({
        code: 'UNSUPPORTED_SYNTAX',
        syntax: 'xychart_axis_series_length_mismatch',
        message: `XY chart series ${s.id} has ${s.values.length} values for ${categoryCount} x-axis categories; Mermaid tolerates the mismatch by dropping or synthesizing positions. Make the lengths equal.`,
      })
    }
  }
  return warnings
}
