import type { RadarChart, RadarAxis, RadarCurve } from './types.ts'
import { normalizeBrTags } from '../multiline-utils.ts'
import { syntaxError } from '../shared/syntax-error.ts'

// ============================================================================
// Radar chart parser
//
// Full-recognition boundary for Mermaid `radar-beta`. The grammar is parsed in
// two phases: statements are recognized first, then curves are resolved against
// the final axis set. That construction makes Mermaid's unordered body grammar
// true by design (a keyed curve may precede its axes) instead of depending on
// statement order. Multiline `{ ... }` statements are coalesced before parsing.
// ============================================================================

export const MAX_RADAR_TICKS = 64

const HEADER_RE = /^radar-beta\s*:?\s*$/i
const TITLE_RE = /^title\s+(.+)$/i
const ACC_TITLE_RE = /^accTitle\s*:\s*(.+)$/i
const ACC_DESCR_RE = /^accDescr\s*:\s*(.+)$/i
const ACC_DESCR_BLOCK_RE = /^accDescr\s*:?\s*\{/i
const AXIS_RE = /^axis\s+(.+)$/i
const CURVE_RE = /^curve\s+([\s\S]+)$/i
const OPTION_RE = /^(showLegend|ticks|max|min|graticule)\b(.*)$/i
const NUMBER_RE = /^(?:0|[1-9]\d*|\d+\.\d+|0\.\d+)$/
const ID_TOKEN = String.raw`[\w](?:[\w-]*[\w])?`
const QUOTED_TOKEN = String.raw`(?:"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')`
const ID_LABEL_RE = new RegExp(String.raw`^(${ID_TOKEN})\s*(?:\[\s*(${QUOTED_TOKEN})\s*\])?$`)
const CURVE_ITEM_RE = new RegExp(String.raw`^(${ID_TOKEN})\s*(?:\[\s*(${QUOTED_TOKEN})\s*\])?\s*\{([\s\S]*)\}$`)
const KEYED_ENTRY_RE = new RegExp(String.raw`^(${ID_TOKEN})(?:\s*:\s*|\s+)(.+)$`)

export interface RadarParseOptions {
  /** YAML frontmatter title. An in-body `title` statement wins when present. */
  title?: string
}

/** Split a comma list outside quotes/brackets/braces and reject empty entries. */
function splitTopLevel(s: string, context: string): string[] {
  const out: string[] = []
  let squareDepth = 0
  let braceDepth = 0
  let quote: '"' | "'" | null = null
  let escaped = false
  let cur = ''
  for (const ch of s) {
    if (escaped) { cur += ch; escaped = false; continue }
    if (quote && ch === '\\') { cur += ch; escaped = true; continue }
    if (ch === '"' || ch === "'") {
      if (quote === ch) quote = null
      else if (quote === null) quote = ch
      cur += ch
      continue
    }
    if (!quote) {
      if (ch === '[') squareDepth++
      else if (ch === ']') squareDepth--
      else if (ch === '{') braceDepth++
      else if (ch === '}') braceDepth--
    }
    if (ch === ',' && !quote && squareDepth === 0 && braceDepth === 0) {
      out.push(cur.trim())
      cur = ''
    } else {
      cur += ch
    }
  }
  out.push(cur.trim())
  if (quote || squareDepth !== 0 || braceDepth !== 0) {
    throw new Error(`Radar ${context} has unbalanced quotes or delimiters.`)
  }
  if (out.some(entry => entry.length === 0)) {
    throw new Error(`Radar ${context} contains an empty comma-separated entry.`)
  }
  return out
}

function decodeQuotedString(raw: string, context: string): string {
  const quote = raw[0]
  if ((quote !== '"' && quote !== "'") || raw.at(-1) !== quote) {
    throw new Error(`Radar ${context} must use a quoted label.`)
  }
  let out = ''
  for (let i = 1; i < raw.length - 1; i++) {
    const ch = raw[i]!
    if (ch !== '\\') { out += ch; continue }
    i++
    if (i >= raw.length - 1) throw new Error(`Radar ${context} has an incomplete escape.`)
    const escaped = raw[i]!
    out += escaped === 'n' ? '\n'
      : escaped === 'r' ? '\r'
        : escaped === 't' ? '\t'
          : escaped === 'b' ? '\b'
            : escaped === 'f' ? '\f'
              : escaped
  }
  return out
}

function stripInlineComment(raw: string): string {
  let quote: '"' | "'" | null = null
  let escaped = false
  for (let i = 0; i < raw.length - 1; i++) {
    const ch = raw[i]!
    if (escaped) { escaped = false; continue }
    if (quote && ch === '\\') { escaped = true; continue }
    if (ch === '"' || ch === "'") {
      if (quote === ch) quote = null
      else if (quote === null) quote = ch
      continue
    }
    if (!quote && ch === '%' && raw[i + 1] === '%') return raw.slice(0, i).trimEnd()
  }
  return raw
}

function braceBalance(raw: string): number {
  let balance = 0
  let quote: '"' | "'" | null = null
  let escaped = false
  for (const ch of raw) {
    if (escaped) { escaped = false; continue }
    if (quote && ch === '\\') { escaped = true; continue }
    if (ch === '"' || ch === "'") {
      if (quote === ch) quote = null
      else if (quote === null) quote = ch
      continue
    }
    if (!quote) {
      if (ch === '{') balance++
      else if (ch === '}') balance--
    }
  }
  return balance
}

/** Coalesce multiline curve/accessibility blocks before statement parsing. */
function logicalStatements(lines: string[]): string[] {
  const out: string[] = []
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i]!.trim()
    if (!raw || raw.startsWith('%%')) continue
    // Mermaid's hidden %% token terminates ordinary radar statements. Keep
    // accessibility/title free text literal; comments after data/options are
    // stripped outside quoted labels.
    let statement = /^(?:title|accTitle|accDescr)\b/i.test(raw) ? raw : stripInlineComment(raw)
    if (!statement) continue
    let balance = braceBalance(statement)
    if (balance < 0) throw new Error(`Radar statement has an unexpected closing brace: "${statement}"`)
    while (balance > 0) {
      i++
      if (i >= lines.length) throw new Error(`Radar statement is missing a closing "}": "${statement}"`)
      const continuationRaw = lines[i]!.trim()
      const continuation = stripInlineComment(continuationRaw)
      statement += `\n${continuation}`
      balance = braceBalance(statement)
      if (balance < 0) throw new Error(`Radar statement has an unexpected closing brace: "${statement}"`)
    }
    out.push(statement.trim())
  }
  return out
}

/** Parse a single non-negative radar number; throws loudly otherwise. */
function parseRadarNumber(raw: string, context: string): number {
  const t = raw.trim()
  if (t.startsWith('-') || t.startsWith('+')) {
    throw new Error(`Radar ${context} "${t}" has a sign — radar numbers must be non-negative (the grammar has no sign token).`)
  }
  if (!NUMBER_RE.test(t)) throw new Error(`Radar ${context} "${t}" is not a valid number.`)
  const value = Number.parseFloat(t)
  if (!Number.isFinite(value)) throw new Error(`Radar ${context} "${t}" is not finite.`)
  return value
}

function parseRadarTicks(raw: string): number {
  const ticks = parseRadarNumber(raw, 'ticks')
  if (!Number.isInteger(ticks) || ticks < 1 || ticks > MAX_RADAR_TICKS) {
    throw new Error(`Radar ticks must be an integer from 1 through ${MAX_RADAR_TICKS}, got "${raw.trim()}".`)
  }
  return ticks
}

function parseAxisItem(item: string): RadarAxis {
  const match = item.match(ID_LABEL_RE)
  if (!match) {
    throw syntaxError({
      what: `Invalid radar axis: "${item}"`,
      expectedForm: 'an id (not ending in "-") with an optional quoted label',
      example: 'axis speed["Top Speed"], range',
    })
  }
  const id = match[1]!
  const label = match[2] !== undefined
    ? normalizeBrTags(decodeQuotedString(match[2]!, `axis "${id}" label`))
    : id
  return { id, label }
}

function parseCurveItem(item: string, axes: RadarAxis[]): RadarCurve {
  const match = item.match(CURVE_ITEM_RE)
  if (!match) {
    throw syntaxError({
      what: `Invalid radar curve: "${item}"`,
      expectedForm: 'an id (not ending in "-") with an optional quoted label and a `{…}` value block',
      example: 'curve a["Alice"]{85, 90, 80}',
    })
  }
  const id = match[1]!
  const label = match[2] !== undefined
    ? normalizeBrTags(decodeQuotedString(match[2]!, `curve "${id}" label`))
    : id
  const entries = splitTopLevel(match[3]!, `curve "${id}" value block`)

  // A leading number/sign denotes the positional form. Everything else must
  // be a keyed axis reference. The two forms cannot mix.
  const keyedFlags = entries.map(entry => !/^[+-]?(?:\d|\.)/.test(entry))
  const anyKeyed = keyedFlags.some(Boolean)
  const allKeyed = keyedFlags.every(Boolean)
  if (anyKeyed && !allKeyed) {
    throw new Error(`Radar curve "${id}" mixes positional and keyed entries — use one form.`)
  }
  if (!anyKeyed) return { id, label, values: entries.map(entry => parseRadarNumber(entry, `curve "${id}" value`)) }

  if (axes.length === 0) {
    throw new Error(`Radar curve "${id}" uses keyed entries (axis: value) but no axes are declared.`)
  }
  const byAxis = new Map<string, number>()
  for (const entry of entries) {
    const keyed = entry.match(KEYED_ENTRY_RE)
    if (!keyed) throw new Error(`Radar curve "${id}" has an invalid keyed entry: "${entry}".`)
    const axisId = keyed[1]!
    const value = parseRadarNumber(keyed[2]!, `curve "${id}" entry for "${axisId}"`)
    // Mermaid resolves duplicate keyed entries with Array.find: first wins.
    if (!byAxis.has(axisId)) byAxis.set(axisId, value)
  }
  const values = axes.map(axis => {
    const value = byAxis.get(axis.id)
    if (value === undefined) throw new Error(`Radar curve "${id}" is missing an entry for axis "${axis.id}".`)
    return value
  })
  return { id, label, values }
}

/** Parse Mermaid radar source after wrapper normalization/comment extraction. */
export function parseRadarChart(lines: string[], options: RadarParseOptions = {}): RadarChart {
  const statements = logicalStatements(lines)
  if (statements.length === 0) throw new Error('Radar chart is empty')
  const header = statements[0]!
  if (!HEADER_RE.test(header)) throw new Error(`Radar chart must start with "radar-beta", got: "${header}"`)

  let title = options.title
  const accessibility: NonNullable<RadarChart['accessibility']> = {}
  const axes: RadarAxis[] = []
  const pendingCurves: string[] = []
  let min = 0
  let max: number | undefined
  let ticks = 5
  let graticule: 'circle' | 'polygon' = 'circle'
  let showLegend = true

  for (let i = 1; i < statements.length; i++) {
    const line = statements[i]!
    let match: RegExpMatchArray | null

    if ((match = line.match(ACC_TITLE_RE))) { accessibility.title = normalizeBrTags(match[1]!.trim()); continue }
    if (ACC_DESCR_BLOCK_RE.test(line)) {
      const open = line.indexOf('{')
      const close = line.lastIndexOf('}')
      if (open < 0 || close <= open) throw new Error('Radar accDescr block is missing a closing "}"')
      if (line.slice(close + 1).trim()) throw new Error(`Unrecognized text after radar accDescr block: "${line.slice(close + 1).trim()}"`)
      accessibility.description = normalizeBrTags(line.slice(open + 1, close).trim().split('\n').map(part => part.trim()).filter(Boolean).join('\n'))
      continue
    }
    if ((match = line.match(ACC_DESCR_RE))) { accessibility.description = normalizeBrTags(match[1]!.trim()); continue }
    if ((match = line.match(TITLE_RE))) { title = normalizeBrTags(match[1]!.trim()); continue }
    if ((match = line.match(AXIS_RE))) {
      for (const item of splitTopLevel(match[1]!, 'axis list')) axes.push(parseAxisItem(item))
      continue
    }
    if ((match = line.match(CURVE_RE))) {
      for (const item of splitTopLevel(match[1]!, 'curve list')) pendingCurves.push(item)
      continue
    }
    if (OPTION_RE.test(line)) {
      for (const option of splitTopLevel(line, 'option list')) {
        const optionMatch = option.match(OPTION_RE)
        if (!optionMatch) throw new Error(`Invalid radar option: "${option}"`)
        const name = optionMatch[1]!.toLowerCase()
        const value = optionMatch[2]!.trim()
        switch (name) {
          case 'showlegend':
            if (!/^(true|false)$/i.test(value)) throw new Error(`Radar showLegend must be true or false, got "${value}".`)
            showLegend = value.toLowerCase() === 'true'
            break
          case 'ticks': ticks = parseRadarTicks(value); break
          case 'max': max = parseRadarNumber(value, 'max'); break
          case 'min': min = parseRadarNumber(value, 'min'); break
          case 'graticule':
            if (value !== 'circle' && value !== 'polygon') throw new Error(`Radar graticule must be circle or polygon, got "${value}".`)
            graticule = value
            break
        }
      }
      continue
    }
    throw syntaxError({
      what: `Unrecognized radar chart line: "${line}"`,
      expectedForm: 'a title, accessibility directive, axis, curve, or option (min/max/ticks/graticule/showLegend)',
      example: 'axis a, b, c',
    })
  }

  if (axes.length === 0) throw new Error('Radar chart has no axes — declare at least one `axis`.')
  const curves = pendingCurves.map(item => parseCurveItem(item, axes))
  if (max !== undefined && max <= min) throw new Error(`Radar max (${max}) must be greater than min (${min}).`)

  return {
    title,
    ...(accessibility.title || accessibility.description ? { accessibility } : {}),
    axes,
    curves,
    min,
    max,
    ticks,
    graticule,
    showLegend,
  }
}
