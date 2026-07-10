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
// Structured-or-opaque: any other non-blank, non-comment line (accTitle,
// accDescr, multi-statement `;` lines, quoted text, weird tokens) returns null
// so the caller falls back to a lossless opaque body. We deliberately model
// ONLY bare (unquoted) text for titles, axis names, series names, and
// categories so the serializer's canonical output re-parses identically under
// the legacy parser (no quoting/escaping round-trip hazards). Render support is
// unchanged — the legacy renderer keeps parsing the canonical source we emit.
// ============================================================================

import { unknownOpMessage } from './mutation-ops.ts'
import type {
  XyChartBody, XyChartAxis, XyChartSeries, XyChartMutationOp,
  MutationError, Result, LayoutWarning, VerifyOptions,
} from './types.ts'
import { ok, err, DEFAULT_LABEL_CHAR_CAP } from './types.ts'
import { labelOverflowWarning } from './label-metrics.ts'

// ---- Number format ----------------------------------------------------------
//
// Canonical number format is `String(n)` for finite n. JS `String(number)`
// emits the shortest round-tripping decimal, and the legacy parser reads values
// with `parseFloat`, so `parseFloat(String(n)) === n` for every finite n
// (0.1 → "0.1", -5 → "-5", 2.5 → "2.5", 42 → "42"). We reject non-finite
// (NaN / Infinity) at every entry point so a structured body never serializes a
// token the legacy parser would turn into NaN.

function formatNumber(n: number): string {
  return String(n)
}

function isFiniteNumber(n: unknown): n is number {
  return typeof n === 'number' && Number.isFinite(n)
}

// ---- Parser -----------------------------------------------------------------

const NUMBER = String.raw`[+-]?(?:\d+(?:\.\d+)?|\.\d+)`
const RANGE_RE = new RegExp(`^(${NUMBER})\\s*-->\\s*(${NUMBER})$`)
const HEADER_RE = /^xychart(?:-beta)?(?:\s+(horizontal|vertical))?$/i

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

/** Strip a single layer of matching surrounding quotes. Mermaid's xychart
 *  syntax quotes text (and the family's own example does), so a model that
 *  quotes a title/axis/series name must not silently drop the whole chart to an
 *  opaque body. We accept quoted text whose inner content is otherwise bare and
 *  serialize it back canonically (unquoted); quoted text that still isn't bare
 *  after unquoting (embedded quotes/brackets/`-->`) legitimately stays opaque. */
function unquote(value: string): string {
  const v = value.trim()
  if (v.length >= 2 && ((v[0] === '"' && v.endsWith('"')) || (v[0] === "'" && v.endsWith("'")))) {
    return v.slice(1, -1).trim()
  }
  return v
}

/** Unquote then validate as bare text; returns the bare token or null. */
function bareToken(value: string): string | null {
  const t = unquote(value)
  return isBareText(t) ? t : null
}

function parseNumber(token: string): number | null {
  if (!new RegExp(`^${NUMBER}$`).test(token)) return null
  const n = Number.parseFloat(token)
  return Number.isFinite(n) ? n : null
}

/** Parse a `[a, b, c]` category list into bare tokens, or null if any token
 *  isn't bare (quoted/empty/bracketed categories fall back to opaque). */
function parseCategories(inner: string): string[] | null {
  const parts = inner.split(',').map(p => p.trim())
  const out: string[] = []
  for (const p of parts) {
    const t = bareToken(p)
    if (t === null) return null
    out.push(t)
  }
  return out.length > 0 ? out : null
}

/** Parse the value portion of an `x-axis`/`y-axis` directive. axisName === 'x'
 *  additionally accepts categorical forms. Returns the axis or null. */
function parseAxis(rawValue: string, axisName: 'x' | 'y'): XyChartAxis | null {
  const value = rawValue.trim()
  if (value.length === 0) return null

  // Categorical: `[…]` or `<name> [...]` (x-axis only).
  const catMatch = value.match(/^(.*?)\[([^\[\]]*)\]$/)
  if (catMatch && axisName === 'x') {
    const namePart = catMatch[1]!.trim()
    const categories = parseCategories(catMatch[2]!)
    if (!categories) return null
    if (namePart.length > 0) {
      const name = bareToken(namePart)
      if (name === null) return null
      return { name, categories }
    }
    return { categories }
  }
  if (catMatch) return null // y-axis cannot be categorical

  // Range only: `<min> --> <max>`.
  const rangeOnly = value.match(RANGE_RE)
  if (rangeOnly) {
    const min = parseNumber(rangeOnly[1]!)
    const max = parseNumber(rangeOnly[2]!)
    if (min === null || max === null) return null
    return { range: { min, max } }
  }

  // Named range: `<name> <min> --> <max>`.
  const arrowAt = value.indexOf('-->')
  if (arrowAt >= 0) {
    // Split the leading name from `<min> --> <max>`: the min is the last token
    // before the arrow.
    const before = value.slice(0, arrowAt).trim()
    const after = value.slice(arrowAt + 3).trim()
    const max = parseNumber(after)
    const lastSpace = before.lastIndexOf(' ')
    if (lastSpace < 0 || max === null) return null
    const name = bareToken(before.slice(0, lastSpace).trim())
    const min = parseNumber(before.slice(lastSpace + 1).trim())
    if (min === null || name === null) return null
    return { name, range: { min, max } }
  }

  // Name only (no range, no categories) — legacy accepts this for either axis
  // (y-axis name only, x-axis title only).
  const nameOnly = bareToken(value)
  if (nameOnly !== null) return { name: nameOnly }
  return null
}

const SERIES_RE = /^(bar|line)(?:\s+(.+?))?\s+\[([^\[\]]*)\]$/

function parseSeries(line: string, idx: number): XyChartSeries | null {
  const m = line.match(SERIES_RE)
  if (!m) return null
  const kind = m[1] as 'bar' | 'line'
  const namePart = m[2]?.trim()
  let name: string | undefined
  if (namePart !== undefined && namePart.length > 0) {
    const t = bareToken(namePart)
    if (t === null) return null
    name = t
  }
  const values: number[] = []
  for (const tok of m[3]!.split(',').map(t => t.trim())) {
    if (tok.length === 0) return null
    const n = parseNumber(tok)
    if (n === null) return null
    values.push(n)
  }
  if (values.length === 0) return null
  return { id: `series-${idx}`, kind, name, values }
}

/**
 * Parse xychart body lines (header excluded). Returns a structured body only if
 * EVERY non-blank, non-comment line is a modeled title / x-axis / y-axis /
 * series directive using bare text and finite numbers. Otherwise returns null
 * (opaque fallback). A structured body must contain at least one series (the
 * legacy renderer needs data to render).
 */
export function parseXyChartBody(lines: string[]): XyChartBody | null {
  const body: XyChartBody = { kind: 'xychart', series: [] }
  let sIdx = 0

  for (const raw of lines) {
    const line = raw.trim()
    if (!line) continue
    if (line.startsWith('%%')) continue

    const titleMatch = line.match(/^title\s+(.+)$/)
    if (titleMatch) {
      const title = bareToken(normalizeText(titleMatch[1]!))
      if (title === null) return null
      body.title = title
      continue
    }

    const xMatch = line.match(/^x-axis\s+(.+)$/)
    if (xMatch) {
      const axis = parseAxis(xMatch[1]!, 'x')
      if (!axis) return null
      body.xAxis = axis
      continue
    }

    const yMatch = line.match(/^y-axis\s+(.+)$/)
    if (yMatch) {
      const axis = parseAxis(yMatch[1]!, 'y')
      if (!axis) return null
      body.yAxis = axis
      continue
    }

    if (/^(bar|line)\b/.test(line)) {
      const series = parseSeries(line, sIdx)
      if (!series) return null
      body.series.push(series)
      sIdx++
      continue
    }

    // Unmodeled line (accTitle/accDescr/quoted/`;`-joined/anything else) → opaque.
    return null
  }

  // The legacy renderer needs at least one data series to render; model the
  // same floor so a structured body always renders.
  if (body.series.length === 0) return null

  return body
}

// ---- Serializer -------------------------------------------------------------

function renderAxis(keyword: 'x-axis' | 'y-axis', axis: XyChartAxis): string {
  const parts: string[] = []
  if (axis.name !== undefined) parts.push(axis.name)
  if (axis.range) parts.push(`${formatNumber(axis.range.min)} --> ${formatNumber(axis.range.max)}`)
  if (axis.categories) parts.push(`[${axis.categories.join(', ')}]`)
  return `  ${keyword} ${parts.join(' ')}`
}

export function renderXyChart(body: XyChartBody): string {
  const header = body.horizontal === true
    ? 'xychart-beta horizontal'
    : body.horizontal === false
      ? 'xychart-beta vertical'
      : 'xychart-beta'
  const lines: string[] = [header]
  if (body.title !== undefined) lines.push(`  title ${body.title}`)
  if (body.xAxis) lines.push(renderAxis('x-axis', body.xAxis))
  if (body.yAxis) lines.push(renderAxis('y-axis', body.yAxis))
  for (const s of body.series) {
    const namePart = s.name !== undefined ? `${s.name} ` : ''
    lines.push(`  ${s.kind} ${namePart}[${s.values.map(formatNumber).join(', ')}]`)
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
    title: b.title,
    horizontal: b.horizontal,
    xAxis: b.xAxis ? cloneAxis(b.xAxis) : undefined,
    yAxis: b.yAxis ? cloneAxis(b.yAxis) : undefined,
    series: b.series.map(s => ({ id: s.id, kind: s.kind, name: s.name, values: [...s.values] })),
  }
}

function makeSeriesIdAllocator(body: XyChartBody): () => string {
  const seen = new Set(body.series.map(s => s.id))
  return () => {
    let n = 0
    while (seen.has(`series-${n}`)) n++
    const id = `series-${n}`
    seen.add(id)
    return id
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
  const nextId = makeSeriesIdAllocator(next)

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

// ---- Verifier (FamilyPlugin.verify hook) ------------------------------------

export function verifyXyChart(body: XyChartBody, opts: VerifyOptions): LayoutWarning[] {
  const cap = opts.labelCharCap ?? DEFAULT_LABEL_CHAR_CAP
  const warnings: LayoutWarning[] = []
  const overflow = (target: string, text: string) => {
    const w = labelOverflowWarning(target, text, cap)
    if (w) warnings.push(w)
  }
  if (body.series.length === 0) warnings.push({ code: 'EMPTY_DIAGRAM' })
  if (body.title !== undefined) overflow('title', body.title)
  if (body.xAxis?.name !== undefined) overflow('x-axis', body.xAxis.name)
  for (const c of body.xAxis?.categories ?? []) overflow('x-axis', c)
  if (body.yAxis?.name !== undefined) overflow('y-axis', body.yAxis.name)
  for (const s of body.series) {
    if (s.name !== undefined) overflow(s.id, s.name)
  }
  return warnings
}
