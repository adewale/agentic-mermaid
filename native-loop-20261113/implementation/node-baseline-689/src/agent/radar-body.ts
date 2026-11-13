// ============================================================================
// Radar structured body — structured mutation for `radar-beta` diagrams,
// following the journey/xychart/pie/quadrant pilots.
//
// Modeled grammar (mirrors the legacy renderer parser, src/radar/parser.ts):
//   radar-beta
//   title <text>
//   axis  id[["Label"]] [, id2 …]
//   curve id[["Label"]]{ v1, v2, … }        (positional, axis order)
//   curve id[["Label"]]{ axisId[:] v, … }   (keyed, colon optional)
//   min <n> | max <n> | ticks <n> | graticule circle|polygon | showLegend <bool>
//
// Coupling invariant: every curve carries exactly one value per axis, so
// add/remove/reorder-axis re-shape every curve's value vector and the mutator
// keeps `curve.values.length === axes.length` by construction.
//
// Structured-or-opaque: any unmodeled/malformed line returns null so the
// caller falls back to a lossless opaque body. Identities that Mermaid cannot
// spell portably stay opaque too. Accessibility rides the universal envelope. The
// serializer emits a canonical form the legacy parser re-parses identically
// (differential-tested). Empty (no axes) → opaque, so the loud "no axes" render
// error still surfaces.
// ============================================================================

import { unknownOpMessage } from './mutation-ops.ts'
import type {
  Accessibility, RadarBody, RadarMutationOp,
  MutationError, Result, LayoutWarning, VerifyOptions,
} from './types.ts'
import { ok, err } from './types.ts'
import { labelOverflowCollector, setOptionalField } from './body-utils.ts'
import { MAX_RADAR_TICKS, parseRadarChart, radarStatementEnds } from '../radar/parser.ts'
import { resolveRadarScale } from '../radar/scale.ts'
import { mermaidNumber as formatNumber } from '../shared/mermaid-number.ts'
import { normalizeBrTags } from '../multiline-utils.ts'
import { normalizeMermaidSource } from '../mermaid-source.ts'
import { statementAccessibilityConflicts } from './accessibility-envelope.ts'

// ---- Shared lexical shapes --------------------------------------------------

const ID_RE = /^[A-Za-z_](?:[\w-]*[\w])?$/
const ID_KEYWORDS = new Set(['radar-beta', 'axis', 'curve', 'showLegend', 'ticks', 'max', 'min', 'graticule'])
// NUMBER, BOOLEAN, GRATICULE and TITLE precede ID in the pinned lexer.
// Unlike keywords, these terminals also take the prefix of a longer name.
const ID_TOKEN_PREFIX_RE = /^(?:true|false|circle|polygon|title)/

function portableId(id: string): boolean {
  return ID_RE.test(id) && !ID_KEYWORDS.has(id) && !ID_TOKEN_PREFIX_RE.test(id)
}

// ---- Parser (structured-or-opaque) ------------------------------------------

/**
 * Construct the typed body only after the renderer parser has fully recognized
 * the source. Model states that cannot uphold stable identity plus axis↔value
 * coupling stay opaque. `accessibility` is what the grammar read after a
 * statement on its line, as authored, for the source envelope.
 */
export function parseRadarBody(lines: string[]): { body: RadarBody; accessibility: Accessibility } | null {
  // A line inside a quoted label is text, whatever it holds.
  const ends = radarStatementEnds(lines)
  for (let index = 0; index < lines.length; index = ends[index]! + 1) {
    if (/^\s*acc(?:Title|Descr)\b/i.test(lines[index]!)) return null
  }
  try {
    const chart = parseRadarChart(['radar-beta', ...lines])
    const body: RadarBody = {
      kind: 'radar',
      title: chart.title,
      axes: chart.axes.map(axis => ({ id: axis.id, label: axis.label })),
      curves: chart.curves.map(curve => ({ id: curve.id, label: curve.label, values: [...curve.values] })),
      min: chart.min,
      max: chart.max,
      ticks: chart.ticks,
      graticule: chart.graticule,
      showLegend: chart.showLegend,
    }
    return radarBodyProblem(body, true) === null ? { body, accessibility: chart.statementAccessibility ?? {} } : null
  } catch {
    return null
  }
}

/** One owner for every typed RadarBody invariant. */
export function radarBodyProblem(body: RadarBody, allowEmptyDraft = false): string | null {
  const emptyDraft = allowEmptyDraft && body.axes.length === 0 && body.curves.length === 0
  if (body.axes.length === 0 && !emptyDraft) return 'Radar requires at least one axis before curves can exist.'
  if (body.axes.some(axis => !portableId(axis.id))) return 'Every typed radar axis id must have a portable Mermaid identifier spelling.'
  if (body.curves.some(curve => !portableId(curve.id))) return 'Every typed radar curve id must have a portable Mermaid identifier spelling.'
  if (body.axes.some(axis => axis.label.trim().length === 0)) return 'Typed radar axis labels must be non-empty.'
  if (body.curves.some(curve => curve.label.trim().length === 0)) return 'Typed radar curve labels must be non-empty.'
  if (body.title !== undefined && body.title.trim().length === 0) return 'A typed radar title must be non-empty.'
  if (new Set(body.axes.map(axis => axis.id)).size !== body.axes.length) return 'Radar axis ids must be unique for typed mutation.'
  if (new Set(body.curves.map(curve => curve.id)).size !== body.curves.length) return 'Radar curve ids must be unique for typed mutation.'
  for (const curve of body.curves) {
    if (curve.values.length !== body.axes.length) {
      return `Radar curve "${curve.id}" needs exactly ${body.axes.length} value(s) (one per axis).`
    }
  }
  if (!Number.isInteger(body.ticks) || body.ticks < 1 || body.ticks > MAX_RADAR_TICKS) {
    return `Radar ticks must be an integer from 1 through ${MAX_RADAR_TICKS}.`
  }
  if (emptyDraft) {
    if (!Number.isFinite(body.min) || body.min < 0) return 'Radar min must be a finite non-negative number.'
    if (body.max !== undefined && (!Number.isFinite(body.max) || body.max <= body.min)) return 'Radar max must be finite and greater than min.'
    return null
  }
  try { resolveRadarScale(body) } catch (error) { return error instanceof Error ? error.message : String(error) }
  return null
}

// ---- Serializer -------------------------------------------------------------

function renderAxisLabel(id: string, label: string): string {
  if (label === id) return id
  const escaped = label
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\r/g, '\\r')
    .replace(/\n/g, '\\n')
    .replace(/\t/g, '\\t')
  return `${id}["${escaped}"]`
}

export function renderRadar(body: RadarBody): string {
  const lines: string[] = ['radar-beta']
  if (body.title !== undefined) lines.push(`  title ${body.title.replace(/\r\n?|\n/g, '<br/>')}`)
  if (body.axes.length > 0) {
    lines.push('  axis ' + body.axes.map(a => renderAxisLabel(a.id, a.label)).join(', '))
  }
  for (const c of body.curves) {
    lines.push(`  curve ${renderAxisLabel(c.id, c.label)}{${c.values.map(formatNumber).join(', ')}}`)
  }
  // Non-default options only — keeps canonical output minimal and idempotent.
  if (body.min !== 0) lines.push(`  min ${formatNumber(body.min)}`)
  if (body.max !== undefined) lines.push(`  max ${formatNumber(body.max)}`)
  if (body.ticks !== 5) lines.push(`  ticks ${formatNumber(body.ticks)}`)
  if (body.graticule !== 'circle') lines.push(`  graticule ${body.graticule}`)
  if (!body.showLegend) lines.push('  showLegend false')
  return lines.join('\n') + '\n'
}

// ---- Mutator ----------------------------------------------------------------

function cloneRadar(b: RadarBody): RadarBody {
  return {
    kind: 'radar',
    title: b.title,
    axes: b.axes.map(a => ({ id: a.id, label: a.label })),
    curves: b.curves.map(c => ({ id: c.id, label: c.label, values: [...c.values] })),
    min: b.min,
    max: b.max,
    ticks: b.ticks,
    graticule: b.graticule,
    showLegend: b.showLegend,
  }
}

function validId(value: unknown, field: string): Result<string, MutationError> {
  if (typeof value !== 'string' || !portableId(value.trim())) {
    return err({ code: 'INVALID_OP', message: `Radar ${field} must start with a letter or _, keep dashes inside, and avoid reserved words or prefixes true/false/circle/polygon/title, got ${JSON.stringify(value)}` })
  }
  return ok(value.trim())
}

function validLabel(value: unknown, field: string): Result<string, MutationError> {
  if (typeof value !== 'string') return err({ code: 'INVALID_OP', message: `Radar ${field} must be a string` })
  const text = normalizeBrTags(value).trim()
  if (!text) return err({ code: 'INVALID_OP', message: `Radar ${field} must be non-empty text` })
  return ok(text)
}

function validValue(value: unknown, field: string): Result<number, MutationError> {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    return err({ code: 'INVALID_OP', message: `Radar ${field} must be a non-negative number, got ${JSON.stringify(value)}` })
  }
  return ok(value)
}

function findAxis(b: RadarBody, id: string): number { return b.axes.findIndex(a => a.id === id) }
function findCurve(b: RadarBody, id: string): number { return b.curves.findIndex(c => c.id === id) }

function insertionIndex(index: number | undefined, len: number, what: string): Result<number, MutationError> {
  if (index === undefined) return ok(len)
  if (!Number.isInteger(index) || index < 0 || index > len) {
    return err({ code: 'INVALID_OP', message: `Radar ${what} index must be an integer from 0 through ${len}, got ${JSON.stringify(index)}` })
  }
  return ok(index)
}

export function mutateRadar(body: RadarBody, op: RadarMutationOp): Result<RadarBody, MutationError> {
  const next = cloneRadar(body)

  switch (op.kind) {
    case 'set_title': {
      const title = setOptionalField(next, 'title', op.title, value => validLabel(value, 'title'))
      if (!title.ok) return title
      break
    }
    case 'add_axis': {
      const id = validId(op.id, 'axis id')
      if (!id.ok) return id
      if (findAxis(next, id.value) >= 0) return err({ code: 'INVALID_OP', message: `Radar axis "${id.value}" already exists` })
      let label = id.value
      if (op.label !== undefined && op.label !== null) {
        const l = validLabel(op.label, 'axis label')
        if (!l.ok) return l
        label = l.value
      }
      let fill = next.min
      if (op.fill !== undefined) {
        const f = validValue(op.fill, 'axis fill value')
        if (!f.ok) return f
        fill = f.value
      }
      const at = insertionIndex(op.index, next.axes.length, 'axis insertion')
      if (!at.ok) return at
      next.axes.splice(at.value, 0, { id: id.value, label })
      for (const c of next.curves) c.values.splice(at.value, 0, fill)
      break
    }
    case 'remove_axis': {
      const idx = findAxis(next, typeof op.id === 'string' ? op.id : '')
      if (idx < 0) return err({ code: 'AXIS_NOT_FOUND', message: `Radar axis "${String(op.id)}" not found` })
      next.axes.splice(idx, 1)
      for (const c of next.curves) c.values.splice(idx, 1)
      break
    }
    case 'rename_axis': {
      const from = validId(op.from, 'axis id')
      if (!from.ok) return from
      const to = validId(op.to, 'axis id')
      if (!to.ok) return to
      const idx = findAxis(next, from.value)
      if (idx < 0) return err({ code: 'AXIS_NOT_FOUND', message: `Radar axis "${from.value}" not found` })
      if (from.value !== to.value && findAxis(next, to.value) >= 0) return err({ code: 'INVALID_OP', message: `Radar axis "${to.value}" already exists` })
      const axis = next.axes[idx]!
      const hadDefaultLabel = axis.label === axis.id
      axis.id = to.value
      if (hadDefaultLabel) axis.label = to.value
      break
    }
    case 'set_axis_label': {
      const idx = findAxis(next, typeof op.id === 'string' ? op.id : '')
      if (idx < 0) return err({ code: 'AXIS_NOT_FOUND', message: `Radar axis "${String(op.id)}" not found` })
      if (op.label === null) { next.axes[idx]!.label = next.axes[idx]!.id; break }
      const l = validLabel(op.label, 'axis label')
      if (!l.ok) return l
      next.axes[idx]!.label = l.value
      break
    }
    case 'reorder_axis': {
      const move = reorder(next.axes.length, op.from, op.to, 'axis')
      if (!move.ok) return move
      const [f, t] = [move.value.from, move.value.to]
      const [axis] = next.axes.splice(f, 1)
      next.axes.splice(t, 0, axis!)
      for (const c of next.curves) { const [v] = c.values.splice(f, 1); c.values.splice(t, 0, v!) }
      break
    }
    case 'add_curve': {
      const id = validId(op.id, 'curve id')
      if (!id.ok) return id
      if (findCurve(next, id.value) >= 0) return err({ code: 'INVALID_OP', message: `Radar curve "${id.value}" already exists` })
      if (!Array.isArray(op.values) || op.values.length !== next.axes.length) {
        return err({ code: 'INVALID_OP', message: `Radar curve "${id.value}" needs exactly ${next.axes.length} value(s) (one per axis)` })
      }
      const values: number[] = []
      for (const v of op.values) { const vr = validValue(v, 'curve value'); if (!vr.ok) return vr; values.push(vr.value) }
      let label = id.value
      if (op.label !== undefined && op.label !== null) {
        const l = validLabel(op.label, 'curve label')
        if (!l.ok) return l
        label = l.value
      }
      const at = insertionIndex(op.index, next.curves.length, 'curve insertion')
      if (!at.ok) return at
      next.curves.splice(at.value, 0, { id: id.value, label, values })
      break
    }
    case 'remove_curve': {
      const idx = findCurve(next, typeof op.id === 'string' ? op.id : '')
      if (idx < 0) return err({ code: 'CURVE_NOT_FOUND', message: `Radar curve "${String(op.id)}" not found` })
      next.curves.splice(idx, 1)
      break
    }
    case 'set_curve_values': {
      const idx = findCurve(next, typeof op.id === 'string' ? op.id : '')
      if (idx < 0) return err({ code: 'CURVE_NOT_FOUND', message: `Radar curve "${String(op.id)}" not found` })
      if (!Array.isArray(op.values) || op.values.length !== next.axes.length) {
        return err({ code: 'INVALID_OP', message: `Radar curve values must have exactly ${next.axes.length} entr(y/ies) (one per axis)` })
      }
      const values: number[] = []
      for (const v of op.values) { const vr = validValue(v, 'curve value'); if (!vr.ok) return vr; values.push(vr.value) }
      next.curves[idx]!.values = values
      break
    }
    case 'set_curve_value': {
      const cIdx = findCurve(next, typeof op.curve === 'string' ? op.curve : '')
      if (cIdx < 0) return err({ code: 'CURVE_NOT_FOUND', message: `Radar curve "${String(op.curve)}" not found` })
      const aIdx = findAxis(next, typeof op.axis === 'string' ? op.axis : '')
      if (aIdx < 0) return err({ code: 'AXIS_NOT_FOUND', message: `Radar axis "${String(op.axis)}" not found` })
      const v = validValue(op.value, 'curve value')
      if (!v.ok) return v
      next.curves[cIdx]!.values[aIdx] = v.value
      break
    }
    case 'set_curve_label': {
      const idx = findCurve(next, typeof op.id === 'string' ? op.id : '')
      if (idx < 0) return err({ code: 'CURVE_NOT_FOUND', message: `Radar curve "${String(op.id)}" not found` })
      if (op.label === null) { next.curves[idx]!.label = next.curves[idx]!.id; break }
      const l = validLabel(op.label, 'curve label')
      if (!l.ok) return l
      next.curves[idx]!.label = l.value
      break
    }
    case 'rename_curve': {
      const from = validId(op.from, 'curve id')
      if (!from.ok) return from
      const to = validId(op.to, 'curve id')
      if (!to.ok) return to
      const idx = findCurve(next, from.value)
      if (idx < 0) return err({ code: 'CURVE_NOT_FOUND', message: `Radar curve "${from.value}" not found` })
      if (from.value !== to.value && findCurve(next, to.value) >= 0) return err({ code: 'INVALID_OP', message: `Radar curve "${to.value}" already exists` })
      const curve = next.curves[idx]!
      const hadDefaultLabel = curve.label === curve.id
      curve.id = to.value
      if (hadDefaultLabel) curve.label = to.value
      break
    }
    case 'reorder_curve': {
      const move = reorder(next.curves.length, op.from, op.to, 'curve')
      if (!move.ok) return move
      const [curve] = next.curves.splice(move.value.from, 1)
      next.curves.splice(move.value.to, 0, curve!)
      break
    }
    case 'set_config': {
      const draft = { min: next.min, max: next.max, ticks: next.ticks, graticule: next.graticule, showLegend: next.showLegend }
      if (op.min !== undefined) { if (op.min === null) draft.min = 0; else { const r = validValue(op.min, 'min'); if (!r.ok) return r; draft.min = r.value } }
      if (op.max !== undefined) { if (op.max === null) draft.max = undefined; else { const r = validValue(op.max, 'max'); if (!r.ok) return r; draft.max = r.value } }
      if (op.ticks !== undefined) { if (op.ticks === null) draft.ticks = 5; else { if (!Number.isInteger(op.ticks) || op.ticks < 1 || op.ticks > MAX_RADAR_TICKS) return err({ code: 'INVALID_OP', message: `Radar ticks must be an integer from 1 through ${MAX_RADAR_TICKS}, got ${JSON.stringify(op.ticks)}` }); draft.ticks = op.ticks } }
      if (op.graticule !== undefined) { if (op.graticule === null) draft.graticule = 'circle'; else if (op.graticule !== 'circle' && op.graticule !== 'polygon') return err({ code: 'INVALID_OP', message: `Radar graticule must be 'circle' or 'polygon'` }); else draft.graticule = op.graticule }
      if (op.showLegend !== undefined) { if (op.showLegend === null) draft.showLegend = true; else if (typeof op.showLegend !== 'boolean') return err({ code: 'INVALID_OP', message: 'Radar showLegend must be a boolean' }); else draft.showLegend = op.showLegend }
      if (draft.max !== undefined && draft.max <= draft.min) return err({ code: 'INVALID_OP', message: `Radar max (${draft.max}) must be greater than min (${draft.min})` })
      next.min = draft.min
      next.max = draft.max
      next.ticks = draft.ticks
      next.graticule = draft.graticule
      next.showLegend = draft.showLegend
      break
    }
    default: {
      const _x: never = op
      return err({ code: 'INVALID_OP', message: unknownOpMessage('radar', _x) })
    }
  }

  const invariantProblem = radarBodyProblem(next, true)
  if (invariantProblem) return err({ code: 'INVALID_OP', message: invariantProblem })
  return ok(next)
}

function reorder(len: number, from: unknown, to: unknown, what: string): Result<{ from: number; to: number }, MutationError> {
  if (!Number.isInteger(from) || (from as number) < 0 || (from as number) >= len) {
    return err({ code: 'INVALID_OP', message: `Radar reorder ${what} 'from' must be 0..${len - 1}, got ${JSON.stringify(from)}` })
  }
  if (!Number.isInteger(to) || (to as number) < 0 || (to as number) >= len) {
    return err({ code: 'INVALID_OP', message: `Radar reorder ${what} 'to' must be 0..${len - 1}, got ${JSON.stringify(to)}` })
  }
  return ok({ from: from as number, to: to as number })
}

// ---- Verifier (FamilyPlugin.verify hook) ------------------------------------

/** Nonportable identities and conflicting accessibility statements keep their
 * native reading and source-preserved body, with a portability diagnostic. */
export function radarUnsupportedSyntaxWarnings(canonicalSource: string): LayoutWarning[] {
  const source = normalizeMermaidSource(canonicalSource)
  let chart: ReturnType<typeof parseRadarChart>
  try { chart = parseRadarChart(source.familyLines) } catch { return [] }
  const warnings: LayoutWarning[] = []
  for (const [role, items] of [['axis', chart.axes], ['curve', chart.curves]] as const) {
    for (const { id } of items) {
      if (portableId(id)) continue
      warnings.push({
        code: 'UNSUPPORTED_SYNTAX', syntax: 'radar_id', node: id,
        message: `Radar ${role} id "${id}" is read as written, but pinned Mermaid reads it as another token. The source is preserved; use an id starting with a letter or _, avoiding reserved words and prefixes true/false/circle/polygon/title, before typed editing.`,
      })
    }
  }
  return warnings.concat(statementAccessibilityConflicts(chart.statementAccessibility ?? {}, source.accessibility).map(directive => ({
    code: 'UNSUPPORTED_SYNTAX',
    syntax: 'radar_accessibility_order',
    message: `Radar chart has an ${directive} after a statement on its line and another on a line of its own. Mermaid keeps the one written last; this reader cannot tell which that is, so the source is kept as written and the one on its own line is drawn. Keep one ${directive}, on a line of its own.`,
  })))
}

export function verifyRadar(body: RadarBody, opts: VerifyOptions): LayoutWarning[] {
  const warnings: LayoutWarning[] = []
  // Labels are drawn as written (upstream sets them as text), so they are
  // measured literally.
  const overflow = labelOverflowCollector(warnings, opts, undefined, 'literal')
  const range = resolveRadarScale(body)
  if (body.min > 0) warnings.push({ code: 'SCALE_RANGE_EXCLUDES_ZERO', range, baseline: body.min, message: 'Radar radii use value minus min; a non-zero baseline exaggerates relative differences.' })
  for (const curve of body.curves) {
    const values = curve.values.filter(value => value < range.min || value > range.max)
    if (values.length) warnings.push({ code: 'VALUES_OUTSIDE_RANGE', series: curve.id, values, range, message: 'Radar values outside the authored range are clipped to its boundary.' })
  }

  if (body.axes.length === 0 && body.curves.length === 0) warnings.push({ code: 'EMPTY_DIAGRAM' })
  if (body.title !== undefined) overflow('title', body.title)
  for (const a of body.axes) overflow(a.id, a.label)
  for (const c of body.curves) overflow(c.id, c.label)
  return warnings
}
