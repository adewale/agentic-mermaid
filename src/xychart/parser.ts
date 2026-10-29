import {
  getFrontmatterList,
  getFrontmatterMap,
  getFrontmatterScalar,
  type MermaidFrontmatterMap,
} from '../mermaid-source.ts'
import type {
  XYChart,
  XYAxis,
  XYAxisRenderConfig,
  XYChartConfig,
  XYChartSeries,
  XYChartTheme,
} from './types.ts'
import { parseAccessibilityDirective, scanAccessibilityDirectives } from '../shared/accessibility-directives.ts'
import { splitCssColorList } from '../shared/css-color.ts'
import { encodeMermaidEntities } from '../shared/mermaid-entities.ts'
import { decodeMermaidEntities } from '../shared/mermaid-entity-display.ts'
import { quotedTextEnds, statementText, trailingCommentStart } from '../shared/trailing-comment.ts'
import { parserObservationActive, observeParserStatement, observeParserMutation } from '../shared/parser-observation.ts'
import { MermaidSyntaxError, syntaxError } from '../shared/syntax-error.ts'

// ============================================================================
// XY Chart parser
//
// Parses Mermaid xychart syntax into a typed XYChart structure.
//
// Supported directives:
//   xychart [horizontal]
//   title "Chart Title"
//   x-axis [label1, label2, ...]          — categorical
//   x-axis min --> max                     — numeric range
//   x-axis "Axis Title" [label1, ...]      — with title
//   x-axis "Axis Title" min --> max        — with title
//   y-axis (same patterns)
//   bar [val1, val2, ...]
//   line [val1, val2, ...]
// ============================================================================

/**
 * Parse a Mermaid xychart / xychart-beta diagram from preprocessed lines.
 * Lines should already be trimmed and comment-stripped.
 */
export function parseXYChart(lines: string[], options: { strict?: boolean } = {}): XYChart {
  // Expand family-level statement separators before the universal scan so a
  // directive has the same meaning whether it is line- or semicolon-delimited.
  // Strict agent projection rejects an unclosed block to preserve the source
  // opaquely; direct rendering retains XYChart's established tolerant policy.
  const expandedStatements = expandXYChartStatements(lines, options.strict === true)
  const accessibilityScan = scanAccessibilityDirectives(expandedStatements)
  const accessibility = accessibilityScan.accessibility
  let familyLines = accessibilityScan.familyLines
  if (accessibilityScan.unclosedIndex !== undefined) {
    if (options.strict) throw new Error('XYChart accDescr block is missing a closing "}"')
    const unclosed = accessibilityScan.unclosedIndex
    familyLines = accessibilityScan.familyLines.slice(0, unclosed - expandedStatements.length)
    accessibility.descr = expandedStatements
      .slice(unclosed)
      .join('\n')
      .replace(/^[^{]*\{/, '')
      .trim() || undefined
  }
  const xAxis: XYAxis = {}
  const yAxis: XYAxis = {}
  const series: XYChartSeries[] = []
  const statements = expandXYChartStatements(familyLines, options.strict === true)
  let title: string | undefined
  let horizontal = false
  let headerOrientation: 'vertical' | 'horizontal' | undefined

  const header = statements[0]
  const headerMatch = header?.match(/^xychart(?:-beta)?(?:\s+(horizontal|vertical))?$/i)
  if (!headerMatch && options.strict) {
    throw new Error(`Invalid XYChart header: "${header ?? ''}"`)
  }
  if (headerMatch && parserObservationActive('xychart')) observeParserStatement('xychart', 'header', header!, { line: 1, unit: 'normalized' })
  if (headerMatch?.[1]) {
    headerOrientation = headerMatch[1].toLowerCase() as 'vertical' | 'horizontal'
    if (parserObservationActive('xychart')) observeParserMutation('xychart', 'setHeaderOrientation', headerOrientation, { line: 1, unit: 'normalized' })
    horizontal = headerOrientation === 'horizontal'
    if (parserObservationActive('xychart')) observeParserMutation('xychart', 'setHorizontal', horizontal, { line: 1, unit: 'normalized' })
  }

  for (let index = headerMatch ? 1 : 0; index < statements.length; index++) {
    const line = statements[index]!

    // Title (quoted text may hold a line break)
    const titleMatch = line.match(/^title\s+([\s\S]+)$/i)
    if (titleMatch) {
      if (parserObservationActive('xychart')) observeParserStatement('xychart', 'title', line, { line: index + 1, unit: 'normalized' })
      const parsed = parseDirectiveText(titleMatch[1]!)
      if (parsed === null) {
        if (options.strict) throw new Error(`Invalid XYChart title directive: "${line}"`)
      } else {
        title = parsed
        if (parserObservationActive('xychart')) observeParserMutation('xychart', 'setTitle', title, { line: index + 1, unit: 'normalized' })
      }
      continue
    }

    // x-axis: optional title with either categories or numeric range
    const xAxisMatch = line.match(/^x-axis\s+([\s\S]+)$/i)
    if (xAxisMatch) {
      if (parserObservationActive('xychart')) observeParserStatement('xychart', 'x-axis', line, { line: index + 1, unit: 'normalized' })
      if (!applyAxisDirective(xAxis, xAxisMatch[1]!, 'x', index + 1) && options.strict) {
        throw new Error(`Invalid XYChart x-axis directive: "${line}"`)
      }
      continue
    }

    // y-axis: numeric range only, optionally with a title
    const yAxisMatch = line.match(/^y-axis\s+([\s\S]+)$/i)
    if (yAxisMatch) {
      if (parserObservationActive('xychart')) observeParserStatement('xychart', 'y-axis', line, { line: index + 1, unit: 'normalized' })
      if (!applyAxisDirective(yAxis, yAxisMatch[1]!, 'y', index + 1) && options.strict) {
        throw new Error(`Invalid XYChart y-axis directive: "${line}"`)
      }
      continue
    }

    const seriesDirective = parseSeriesDirective(line)
    if (seriesDirective?.type === 'bar') {
      if (parserObservationActive('xychart')) observeParserStatement('xychart', 'bar', line, { line: index + 1, unit: 'normalized' })
      const points = parseNumericPoints(seriesDirective.points, options.strict === true, index + 1)
      series.push({
        type: 'bar',
        label: seriesDirective.label,
        data: points.values,
        ...(points.labels.some(pointLabel => pointLabel !== undefined) ? { pointLabels: points.labels } : {}),
      })
      if (parserObservationActive('xychart')) observeParserMutation('xychart', 'appendSeries', series[series.length - 1], { line: index + 1, unit: 'normalized' })
      continue
    }

    if (seriesDirective?.type === 'line') {
      if (parserObservationActive('xychart')) observeParserStatement('xychart', 'line', line, { line: index + 1, unit: 'normalized' })
      const points = parseNumericPoints(seriesDirective.points, options.strict === true, index + 1)
      series.push({
        type: 'line',
        label: seriesDirective.label,
        data: points.values,
        ...(points.labels.some(label => label !== undefined) ? { pointLabels: points.labels } : {}),
      })
      if (parserObservationActive('xychart')) observeParserMutation('xychart', 'appendSeries', series[series.length - 1], { line: index + 1, unit: 'normalized' })
      continue
    }

    // A closed grammar must not produce a plausible partial chart after
    // silently dropping an authored statement. Agent mode still preserves the
    // full source opaquely when this error reaches its strict projection.
    if (parserObservationActive('xychart')) observeParserStatement('xychart', 'unrecognized', line, { line: index + 1, unit: 'normalized' })
    throw new Error(`Unrecognized XYChart line: "${line}"`)
  }

  // Auto-derive y-axis range from data if not specified
  if (!yAxis.range && series.length > 0) {
    const allValues = series.flatMap(s => s.data)
    // A bar's length is its value, so a chart with bars always spans zero and
    // is padded only on the side away from the zero baseline.
    const hasBars = series.some(s => s.type === 'bar')
    let min = hasBars ? Math.min(0, ...allValues) : Math.min(...allValues)
    let max = hasBars ? Math.max(0, ...allValues) : Math.max(...allValues)
    const span = max - min || 1
    // Add 10% padding
    const minAtZeroBaseline = hasBars && min === 0
    const maxAtZeroBaseline = hasBars && max === 0 && min < 0
    if (!minAtZeroBaseline) min = min - span * 0.1
    if (!maxAtZeroBaseline) max = max + span * 0.1
    // Floor to 0 if all values are positive and min is close to 0
    if (min > 0 && min < span * 0.5) min = 0
    yAxis.range = { min, max }
    if (parserObservationActive('xychart')) observeParserMutation('xychart', 'deriveYAxisRange', yAxis.range)
  }

  // Fallback y-axis range
  if (!yAxis.range) {
    yAxis.range = { min: 0, max: 100 }
    if (parserObservationActive('xychart')) observeParserMutation('xychart', 'setFallbackYAxisRange', yAxis.range)
  }

  return {
    title,
    accessibility: accessibility.title || accessibility.descr ? {
      ...(accessibility.title !== undefined ? { title: accessibility.title } : {}),
      ...(accessibility.descr !== undefined ? { description: accessibility.descr } : {}),
    } : undefined,
    horizontal,
    headerOrientation,
    xAxis,
    yAxis,
    series,
    config: resolveXYChartConfig({}),
    theme: resolveXYChartTheme({}),
  }
}

export function applyXYChartFrontmatterConfig(
  chart: XYChart,
  frontmatter: MermaidFrontmatterMap = {},
): XYChart {
  const config = resolveXYChartConfig(frontmatter)
  return applyResolvedXYChartConfig(chart, config, resolveXYChartTheme(frontmatter))
}

/** Apply request-boundary projections without re-reading raw frontmatter. */
export function applyResolvedXYChartConfig(
  chart: XYChart,
  config: XYChartConfig,
  theme: XYChartTheme,
): XYChart {
  const resolved = {
    ...chart,
    horizontal: chart.headerOrientation
      ? chart.horizontal
      : config.chartOrientation === 'horizontal',
    config,
    theme,
  }
  if (parserObservationActive('xychart')) observeParserMutation('xychart', 'applyConfig', { horizontal: resolved.horizontal, config, theme })
  return resolved
}

// splitCommaList removes the quote delimiters while preserving their content.
const LABELED_POINT_RE = /^([+-]?(?:\d+(?:\.\d+)?|\.\d+))(?:\s+([\s\S]+))?$/

/** Full recognition prevents `parseFloat('25 typo')` from silently accepting a prefix. */
function parseNumericPoints(str: string, strict = false, statementLine?: number): { values: number[]; labels: Array<string | undefined> } {
  const values: number[] = []
  const labels: Array<string | undefined> = []
  for (const token of splitCommaTokens(str)) {
    const match = token.trim().match(LABELED_POINT_RE)
    if (!match) throw new Error(`Invalid XYChart point: "${token.trim()}"`)
    const value = Number(match[1])
    if (!Number.isFinite(value)) throw new Error(`XYChart point must be finite: "${token.trim()}"`)
    const rawLabel = match[2]?.trim()
    if (strict && rawLabel !== undefined && !rawLabel.startsWith('"')) {
      throw new Error(`XYChart point labels must be double-quoted: "${token.trim()}"`)
    }
    const label = rawLabel === undefined ? undefined : parseDirectiveText(rawLabel)
    if (label === null) throw new Error(`Invalid XYChart point label: "${token.trim()}"`)
    values.push(value)
    if (parserObservationActive('xychart')) observeParserMutation('xychart', 'appendSeriesValue', { index: values.length - 1, value }, { line: statementLine, unit: 'normalized' })
    labels.push(label)
    if (parserObservationActive('xychart')) observeParserMutation('xychart', 'appendSeriesPointLabel', { index: labels.length - 1, label }, { line: statementLine, unit: 'normalized' })
  }
  if (values.length === 0) throw new Error('XYChart series must contain at least one point')
  return { values, labels }
}

const NUMBER_PATTERN = String.raw`[+-]?(?:\d+(?:\.\d+)?|\.\d+)`
const RANGE_REGEX = new RegExp(`^(${NUMBER_PATTERN})\\s*-->\\s*(${NUMBER_PATTERN})$`)

type XYChartTextSyntax = 'xychart_unquoted_axis_title' | 'xychart_unquoted_text'
/** Where Mermaid's xychart lexer reads unquoted text otherwise: the syntax it
 * concerns, and what it does there. */
type XYChartTextReport = (syntax: XYChartTextSyntax, what: string) => void

// Mermaid's xychart lexer reads unquoted text (a title, an axis title, a
// series label or a category) as a run of ASCII letters, digits and
// &+=*.#_-, running the words together; in an axis title a digit starts a
// range number instead. Any other character, a single quote included, is a
// lexical or parse error upstream. A keyword where a word can start is a
// token of its own, so the text ends there. Ours reads the text as written;
// verify reports it, and the serializer writes it quoted, as Mermaid reads it.
const NOT_TEXT_RE = /[^A-Za-z0-9&+=*.#_\s-]/
const NOT_AXIS_TEXT_RE = /[^A-Za-z&+=*.#_\s-]/
const TEXT_KEYWORD_RE = /(?<![A-Za-z])(?:xychart-beta|xychart|vertical|horizontal|[xy]-axis|title|line|bar)(?![A-Za-z0-9_])/i

/** Report `text`, read from `raw`, unless `raw` is a double-quoted string. */
function reportUnquotedText(raw: string, text: string, subject: string, syntax: XYChartTextSyntax, report: XYChartTextReport | undefined): void {
  if (!report || raw.startsWith('"')) return
  const error = raw.startsWith("'") ? "'" : (syntax === 'xychart_unquoted_axis_title' ? NOT_AXIS_TEXT_RE : NOT_TEXT_RE).exec(text)?.[0]
  if (error !== undefined) return report(syntax, `${subject} ${JSON.stringify(text)} has ${JSON.stringify(error)} outside a double-quoted string, which pinned Mermaid rejects`)
  const keyword = TEXT_KEYWORD_RE.exec(text)?.[0]
  if (keyword !== undefined) report(syntax, `${subject} ${JSON.stringify(text)} has the keyword ${JSON.stringify(keyword)} outside a double-quoted string, where pinned Mermaid ends the text: it rejects the line or reads another statement there`)
}

function applyAxisDirective(axis: XYAxis, rawValue: string, axisName: 'x' | 'y', statementLine: number, report?: XYChartTextReport): boolean {
  const value = rawValue.trim()
  if (value.length === 0) return false

  const categoriesMatch = splitTrailingBracketList(value)
  if (categoriesMatch && axisName === 'x') {
    const prefix = categoriesMatch.prefix
    const title = prefix.length > 0 ? parseDirectiveText(prefix) : undefined
    if (title === null) return false
    const categories = splitCommaList(categoriesMatch.contents)
    if (categories.length === 0) return false
    if (report) for (const raw of splitCommaTokens(categoriesMatch.contents)) reportUnquotedText(raw, raw, 'XY chart category', 'xychart_unquoted_text', report)
    if (title !== undefined) {
      reportUnquotedText(prefix, title, `XY chart ${axisName}-axis title`, 'xychart_unquoted_axis_title', report)
      axis.title = title
      if (parserObservationActive('xychart')) observeParserMutation('xychart', 'setAxisTitle', { axis: axisName, title }, { line: statementLine, unit: 'normalized' })
    }
    axis.categories = categories
    if (parserObservationActive('xychart')) observeParserMutation('xychart', 'setAxisCategories', { axis: axisName, categories }, { line: statementLine, unit: 'normalized' })
    delete axis.range
    if (parserObservationActive('xychart')) observeParserMutation('xychart', 'deleteAxisRange', axisName, { line: statementLine, unit: 'normalized' })
    delete axis.rangeAuthored
    if (parserObservationActive('xychart')) observeParserMutation('xychart', 'deleteAxisRangeAuthored', axisName, { line: statementLine, unit: 'normalized' })
    axis.authored = true
    if (parserObservationActive('xychart')) observeParserMutation('xychart', 'setAxisAuthored', { axis: axisName, authored: true }, { line: statementLine, unit: 'normalized' })
    return true
  }

  const parsed = readAxisTitleRange(value)
  if (!parsed) return false
  if (parsed.title !== undefined) {
    reportUnquotedText(value, parsed.title, `XY chart ${axisName}-axis title`, 'xychart_unquoted_axis_title', report)
    axis.title = parsed.title
    if (parserObservationActive('xychart')) observeParserMutation('xychart', 'setAxisTitle', { axis: axisName, title: axis.title }, { line: statementLine, unit: 'normalized' })
  }
  if (parsed.range) {
    axis.range = parsed.range
    if (parserObservationActive('xychart')) observeParserMutation('xychart', 'setAxisRange', { axis: axisName, range: axis.range }, { line: statementLine, unit: 'normalized' })
    axis.rangeAuthored = true
    if (parserObservationActive('xychart')) observeParserMutation('xychart', 'setAxisRangeAuthored', { axis: axisName, authored: true }, { line: statementLine, unit: 'normalized' })
    delete axis.categories
    if (parserObservationActive('xychart')) observeParserMutation('xychart', 'deleteAxisCategories', axisName, { line: statementLine, unit: 'normalized' })
  }
  axis.authored = true
  if (parserObservationActive('xychart')) observeParserMutation('xychart', 'setAxisAuthored', { axis: axisName, authored: true }, { line: statementLine, unit: 'normalized' })
  return true
}

/**
 * An axis's range, its title, or a title and then a range. The title is one
 * quoted string or unquoted text, which may be several words (Mermaid runs
 * those together: `Monthly totals` reads as `Monthlytotals` there). Words
 * holding a double quote, a bracket or `-->` are not a title.
 */
function readAxisTitleRange(value: string): { title?: string; range?: { min: number; max: number }; words: boolean } | null {
  const range = (match: RegExpMatchArray) => ({ min: parseFloat(match[1]!), max: parseFloat(match[2]!) })
  const rangeOnly = value.match(RANGE_REGEX)
  if (rangeOnly) return { range: range(rangeOnly), words: false }
  const leading = parseLeadingTextToken(value)
  if (!leading) return null
  const rangeMatch = leading.rest.match(RANGE_REGEX)
  if (rangeMatch) return { title: leading.value, range: range(rangeMatch), words: false }
  if (leading.rest.length === 0) return { title: leading.value, words: false }
  if (/^["']/.test(value)) return null
  // Several words, perhaps followed by `min --> max`.
  let words = value
  let wordsRange: { min: number; max: number } | undefined
  const arrow = value.lastIndexOf('-->')
  if (arrow >= 0) {
    const before = value.slice(0, arrow).trimEnd()
    let start = before.length
    while (start > 0 && !/\s/.test(before[start - 1]!)) start--
    const tail = `${before.slice(start)} --> ${value.slice(arrow + 3).trim()}`.match(RANGE_REGEX)
    if (!tail) return null
    words = before.slice(0, start).trim()
    wordsRange = range(tail)
  }
  return /^[^"[\]]+$/.test(words) && !words.includes('-->') ? { title: words, ...(wordsRange ? { range: wordsRange } : {}), words: true } : null
}

// Mermaid reads entity codes before its grammar, so a string written
// `"#quot;"` shows `"`. Its strings have no escapes; ours also read `\"` and
// `\\`, and the writer below spells `"` and `\` as entity codes instead.
const ENTITY_REFUSAL = { subject: 'XYChart text entity', example: 'title "Say #quot;hi#quot;"' }

function parseLeadingTextToken(text: string): { value: string; rest: string } | undefined {
  const trimmed = text.trim()
  if (trimmed.length === 0) return undefined

  if (trimmed.startsWith('"') || trimmed.startsWith("'")) {
    const quoted = readQuotedText(trimmed)
    if (!quoted) return undefined
    return {
      value: decodeMermaidEntities(quoted.value, ENTITY_REFUSAL),
      rest: trimmed.slice(quoted.endIndex + 1).trim(),
    }
  }

  const match = trimmed.match(/^([^\s]+)(?:\s+(.*))?$/)
  if (!match) return undefined
  return {
    value: match[1]!,
    rest: (match[2] ?? '').trim(),
  }
}

function parseDirectiveText(text: string): string | null {
  const trimmed = text.trim()
  if (!trimmed) return null
  if (!trimmed.startsWith('"') && !trimmed.startsWith("'")) return trimmed
  const token = parseLeadingTextToken(trimmed)
  return token && token.rest.length === 0 ? token.value : null
}

function parseOptionalSeriesLabel(value: string | undefined): string | null | undefined {
  if (!value) return undefined
  const trimmed = value.trim()
  return trimmed ? parseDirectiveText(trimmed) : undefined
}

function parseSeriesDirective(line: string): { type: 'bar' | 'line'; label?: string; points: string } | null {
  const keyword = line.match(/^(bar|line)\b/i)
  if (!keyword) return null
  const remainder = line.slice(keyword[0].length).trim()
  const list = splitTrailingBracketList(remainder)
  if (!list) return null
  const label = list.prefix.length > 0 ? parseOptionalSeriesLabel(list.prefix) : undefined
  if (label === null) return null
  return { type: keyword[1]!.toLowerCase() as 'bar' | 'line', label, points: list.contents }
}

/** Find the syntactic list at the end without confusing quoted brackets for delimiters. */
function splitTrailingBracketList(text: string): { prefix: string; contents: string } | null {
  let quote: '"' | "'" | null = null
  let escaped = false
  let open = -1
  let depth = 0
  let close = -1
  for (let index = 0; index < text.length; index++) {
    const char = text[index]!
    if (quote) {
      if (escaped) { escaped = false; continue }
      if (char === '\\') { escaped = true; continue }
      if (char === quote) quote = null
      continue
    }
    if (char === '"' || char === "'") { quote = char; continue }
    if (char === '[') {
      if (depth === 0) open = index
      depth++
      continue
    }
    if (char === ']') {
      if (depth === 0) return null
      depth--
      if (depth === 0) close = index
    }
  }
  if (quote || depth !== 0 || open < 0 || close < open || text.slice(close + 1).trim()) return null
  return { prefix: text.slice(0, open).trim(), contents: text.slice(open + 1, close) }
}

function splitCommaList(text: string): string[] {
  const rawValues = splitCommaTokens(text)
  const values: string[] = []
  for (const raw of rawValues) {
    const value = parseDirectiveText(raw)
    if (value === null || value.length === 0) throw syntaxError({ what: `Invalid XYChart category ${JSON.stringify(raw)}`, expectedForm: 'nonempty categories separated by commas', example: 'x-axis ["A", "B"]' })
    values.push(value)
  }
  return values
}

function splitCommaTokens(text: string): string[] {
  const values: string[] = []
  let current = ''
  let quote: '"' | "'" | null = null
  let escaped = false

  for (let i = 0; i < text.length; i++) {
    const char = text[i]!
    if (quote) {
      current += char
      if (escaped) { escaped = false; continue }
      if (char === '\\') { escaped = true; continue }
      if (char === quote) quote = null
      continue
    }

    if (char === '"' || char === "'") {
      quote = char
      current += char
      continue
    }

    if (char === ',') {
      pushValue(values, current)
      current = ''
      continue
    }

    current += char
  }

  if (quote) throw new Error('Unclosed quoted XYChart value')

  pushValue(values, current)
  return values
}

function readQuotedText(text: string): { value: string; endIndex: number } | null {
  const quote = text[0]
  if (quote !== '"' && quote !== "'") return null
  let value = ''
  let escaped = false
  for (let index = 1; index < text.length; index++) {
    const char = text[index]!
    if (escaped) {
      if (char === quote || char === '\\') value += char
      else value += `\\${char}`
      escaped = false
      continue
    }
    if (char === '\\') { escaped = true; continue }
    if (char === quote) return { value, endIndex: index }
    value += char
  }
  return null
}

/** Serialize text through the same lexical contract consumed above. Quoted,
 * `"` and `\` are entity codes, which Mermaid and this reader both read as
 * the character; a backslash escape is ours alone. */
export function renderXYChartText(value: string, mode: 'free' | 'token' | 'list' | 'quoted'): string {
  if (!value.length) throw new Error('Empty XYChart text has no portable quoted spelling')
  const quoted = `"${encodeMermaidEntities(value, value.includes('%%') ? '"\\%' : '"\\')}"`
  if (mode === 'quoted') return quoted
  // Mermaid discards whitespace between bare tokens and reserves chart
  // keywords. Quoting preserves labels rather than merely accepting them in
  // our more generous reader (e.g. "Revenue (USD)" and the category "bar").
  const bare = /^[A-Za-z_][A-Za-z0-9_]*$/.test(value)
    // Axis-title mode tokenizes digits as range numbers, unlike category text.
    && (mode !== 'token' || !/\d/.test(value))
    && !/^(?:title|bar|line|xychart|horizontal|vertical|accTitle|accDescr)/i.test(value)
  return bare && value.length > 0 ? value : quoted
}

function pushValue(values: string[], rawValue: string): void {
  values.push(rawValue.trim())
}

export function resolveXYChartConfig(frontmatter: MermaidFrontmatterMap): XYChartConfig {
  const configRoot = getFrontmatterMap(frontmatter, ['config']) ?? frontmatter
  const root = getFrontmatterMap(frontmatter, ['config', 'xyChart']) ?? getFrontmatterMap(frontmatter, ['xyChart']) ?? {}
  const chartOrientation = getString(root, ['chartOrientation'])
  const config: XYChartConfig = {
    width: getPositiveNumber(root, ['width']),
    height: getPositiveNumber(root, ['height']),
    useMaxWidth: getBoolean(root, ['useMaxWidth']) ?? getBoolean(configRoot, ['useMaxWidth']),
    useWidth: getPositiveNumber(root, ['useWidth']) ?? getPositiveNumber(configRoot, ['useWidth']),
    titleFontSize: getPositiveNumber(root, ['titleFontSize']),
    titlePadding: getNonNegativeNumber(root, ['titlePadding']),
    chartOrientation: chartOrientation === 'horizontal' || chartOrientation === 'vertical'
      ? chartOrientation
      : undefined,
    plotReservedSpacePercent: getPositiveNumber(root, ['plotReservedSpacePercent']),
    showDataLabel: getBoolean(root, ['showDataLabel']),
    showDataLabelOutsideBar: getBoolean(root, ['showDataLabelOutsideBar']),
    showTitle: getBoolean(root, ['showTitle']),
    showLegend: getBoolean(root, ['showLegend']),
    legendFontSize: getPositiveNumber(root, ['legendFontSize']),
    legendPadding: getNonNegativeNumber(root, ['legendPadding']),
    xAxis: resolveAxisConfig(root, 'xAxis'),
    yAxis: resolveAxisConfig(root, 'yAxis'),
  }
  if (parserObservationActive('xychart')) observeParserMutation('xychart', 'resolveConfig', config)
  return config
}

export function resolveXYChartTheme(frontmatter: MermaidFrontmatterMap): XYChartTheme {
  const configRoot = getFrontmatterMap(frontmatter, ['config']) ?? frontmatter
  const root = getFrontmatterMap(frontmatter, ['config', 'themeVariables', 'xyChart'])
    ?? getFrontmatterMap(frontmatter, ['themeVariables', 'xyChart'])
    ?? {}
  const theme: XYChartTheme = {
    backgroundColor: getString(root, ['backgroundColor']),
    themeCss: getString(configRoot, ['themeCSS']),
    titleColor: getString(root, ['titleColor']),
    xAxisLabelColor: getString(root, ['xAxisLabelColor']),
    xAxisTickColor: getString(root, ['xAxisTickColor']),
    xAxisLineColor: getString(root, ['xAxisLineColor']),
    xAxisTitleColor: getString(root, ['xAxisTitleColor']),
    yAxisLabelColor: getString(root, ['yAxisLabelColor']),
    yAxisTickColor: getString(root, ['yAxisTickColor']),
    yAxisLineColor: getString(root, ['yAxisLineColor']),
    yAxisTitleColor: getString(root, ['yAxisTitleColor']),
    legendTextColor: getString(root, ['legendTextColor']),
    dataLabelColor: getString(root, ['dataLabelColor']),
    plotColorPalette: getPalette(root, ['plotColorPalette']),
  }
  if (parserObservationActive('xychart')) observeParserMutation('xychart', 'resolveTheme', theme)
  return theme
}

function resolveAxisConfig(root: MermaidFrontmatterMap, key: 'xAxis' | 'yAxis'): XYAxisRenderConfig | undefined {
  const axisRoot = getFrontmatterMap(root, [key])
  if (!axisRoot) return undefined
  const showLabel = getBoolean(axisRoot, ['showLabel'])
  const labelFontSize = getPositiveNumber(axisRoot, ['labelFontSize'])
  const labelPadding = getNonNegativeNumber(axisRoot, ['labelPadding'])
  const showTitle = getBoolean(axisRoot, ['showTitle'])
  const titleFontSize = getPositiveNumber(axisRoot, ['titleFontSize'])
  const titlePadding = getNonNegativeNumber(axisRoot, ['titlePadding'])
  const showTick = getBoolean(axisRoot, ['showTick'])
  const tickLength = getNonNegativeNumber(axisRoot, ['tickLength'])
  const tickWidth = getPositiveNumber(axisRoot, ['tickWidth'])
  const showAxisLine = getBoolean(axisRoot, ['showAxisLine'])
  const axisLineWidth = getPositiveNumber(axisRoot, ['axisLineWidth'])

  if (
    showLabel === undefined &&
    labelFontSize === undefined &&
    labelPadding === undefined &&
    showTitle === undefined &&
    titleFontSize === undefined &&
    titlePadding === undefined &&
    showTick === undefined &&
    tickLength === undefined &&
    tickWidth === undefined &&
    showAxisLine === undefined &&
    axisLineWidth === undefined
  ) {
    return undefined
  }

  return {
    showLabel,
    labelFontSize,
    labelPadding,
    showTitle,
    titleFontSize,
    titlePadding,
    showTick,
    tickLength,
    tickWidth,
    showAxisLine,
    axisLineWidth,
  }
}

function parsePalette(value: string | undefined): string[] | undefined {
  if (!value) return undefined
  const items = splitCssColorList(value).map(item => item.trim()).filter(Boolean)
  return items.length > 0 ? items : undefined
}

function getPalette(root: MermaidFrontmatterMap, path: readonly string[]): string[] | undefined {
  const fromList = getFrontmatterList<string | number | boolean | null>(root, path)
  if (fromList && fromList.length > 0) {
    const items = fromList
      .filter((value): value is string => typeof value === 'string')
      .map(value => value.trim())
      .filter(Boolean)
    if (items.length > 0) return items
  }

  return parsePalette(getString(root, path))
}

function getBoolean(root: MermaidFrontmatterMap, path: readonly string[]): boolean | undefined {
  const value = getFrontmatterScalar<boolean>(root, path)
  return typeof value === 'boolean' ? value : undefined
}

function getPositiveNumber(root: MermaidFrontmatterMap, path: readonly string[]): number | undefined {
  const value = getFrontmatterScalar<number>(root, path)
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined
}

function getNonNegativeNumber(root: MermaidFrontmatterMap, path: readonly string[]): number | undefined {
  const value = getFrontmatterScalar<number>(root, path)
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined
}

function getString(root: MermaidFrontmatterMap, path: readonly string[]): string | undefined {
  const value = getFrontmatterScalar<string>(root, path)
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined
}

/**
 * What Mermaid's xychart lexer rejects in the unquoted text of a chart's
 * statements, read by the parser's own statement grammar, with the index in
 * `lines` (header first) of the line each statement starts on.
 */
export function xychartTextRejections(lines: readonly string[]): Array<{ index: number; syntax: XYChartTextSyntax; what: string }> {
  const rejections: Array<{ index: number; syntax: XYChartTextSyntax; what: string }> = []
  const read = (statement: string, index: number): void => {
    const report: XYChartTextReport = (syntax, what) => rejections.push({ index, syntax, what })
    const title = statement.match(/^title\s+([\s\S]+)$/i)
    if (title) return reportUnquotedText(title[1]!.trim(), title[1]!.trim(), 'XY chart title', 'xychart_unquoted_text', report)
    const series = statement.match(/^(bar|line)\s+([\s\S]+)$/i)
    if (series) {
      const label = splitTrailingBracketList(series[2]!.trim())?.prefix
      if (label) reportUnquotedText(label, label, `XY chart ${series[1]!.toLowerCase()} label`, 'xychart_unquoted_text', report)
      return
    }
    const axis = statement.match(/^([xy])-axis\s+([\s\S]+)$/i)
    if (!axis) return
    const axisName = axis[1]!.toLowerCase() as 'x' | 'y'
    try {
      applyAxisDirective({}, axis[2]!, axisName, index + 1, report)
    } catch (error) {
      // This scan names portable text; malformed lists stay rejected by the
      // renderer and become source findings through the normal verify path.
      if (!(error instanceof MermaidSyntaxError)) throw error
    }
  }
  const starts: number[] = []
  const statements = expandXYChartStatements([...lines], false, starts)
  for (let at = 1; at < statements.length; at++) {
    const directive = parseAccessibilityDirective(statements, at)
    if (directive === undefined) break
    if (directive === null) {
      read(statements[at]!, starts[at]!)
      continue
    }
    at = directive.endIndex
    if (directive.suffixLine) {
      for (const statement of expandXYChartStatements([directive.suffixLine], false)) read(statement, starts[at]!)
    }
  }
  return rejections
}

/** For each line, the last line of the statement that starts there. Mermaid's
 * xychart strings have no escapes: `"C:\"` closes at its second quote. An
 * `accTitle:` or `accDescr:` value is the rest of its line wherever it starts,
 * and an `accDescr {` block runs to its `}`, so a quote in either opens no
 * string. */
export function xychartStatementEnds(lines: readonly string[]): number[] {
  return quotedTextEnds(lines, { escapes: false, restOfLine: /(?<!\w)acc(?:Title|Descr)\s*:/iy, block: ACCESSIBILITY_BLOCK })
}

/** Each statement on `lines`, with the index of the line it starts on pushed to `starts`. */
function expandXYChartStatements(lines: string[], strict: boolean, starts?: number[]): string[] {
  const statements: string[] = []
  let inAccDescrBlock = false
  const ends = xychartStatementEnds(lines)

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
    const start = lineIndex
    let line = lines[lineIndex]!.trim()
    if (!line) continue
    if (line.startsWith('%%')) continue

    if (inAccDescrBlock) {
      statements.push(line)
      starts?.push(start)
      if (line.includes('}')) inAccDescrBlock = false
      continue
    }

    // Mermaid's XYChart grammar ends a statement at a `%%` comment; only
    // accessibility text reads it as text.
    const accessibility = /^acc(?:Title|Descr)\b/i.test(line)
    if (!accessibility) {
      // A double-quoted string runs to its closing quote across line breaks,
      // which it keeps.
      const end = ends[lineIndex]!
      if (end > lineIndex) {
        line = statementText(lines, lineIndex, end).trim()
        lineIndex = end
      }
    }
    const parts = accessibility ? splitSemicolonStatements(line, strict) : splitStatementsBeforeComment(line, strict)
    for (const part of parts) {
      statements.push(part)
      starts?.push(start)
      const block = part.match(/^accDescr\s*:?\s*\{(.*)$/i)
      if (block && !block[1]!.includes('}')) inAccDescrBlock = true
    }
  }

  return statements
}

/** The statements on `line` before a trailing `%%` comment. An `accTitle:` or
 * `accDescr:` after another statement takes the rest of the line, a `%%`
 * included, and an `accDescr {` block the text to its `}`, as in Mermaid's
 * lexer. */
function splitStatementsBeforeComment(line: string, strict: boolean): string[] {
  const comment = trailingCommentStart(line, ACCESSIBILITY_BLOCK)
  if (comment < 0) return splitSemicolonStatements(line, strict)
  const before = line.slice(0, comment).trimEnd()
  const parts = splitSemicolonStatements(before, strict)
  const last = parts.length - 1
  if (last >= 0 && INLINE_ACCESSIBILITY.test(parts[last]!)) parts[last] = line.slice(before.length - parts[last]!.length).trim()
  return parts
}

const INLINE_ACCESSIBILITY = /^acc(?:Title|Descr)\s*:/i
const ACCESSIBILITY_BLOCK = /(?<!\w)accDescr\s*\{/iy

// Mermaid's lexer reads these as keywords wherever they occur outside a
// string, so statements may share a line without `;`. An accessibility
// directive ends the search: `accTitle:` and `accDescr:` run to the end of
// the line, `;` included, and an `accDescr {` block to its `}`. The source
// envelope reads one that starts a line.
const STATEMENT_KEYWORD = /(?:title|[xy]-axis|bar|line)(?!\w)|acc(?:Title\s*:|Descr\s*[:{])/iy

/**
 * Split one statement's text at the keyword offsets found in it where the
 * text on both sides reads as a statement. A keyword in a series label before
 * its data, or between words of an unquoted title, therefore stays text.
 */
function pushKeywordStatements(statements: string[], text: string, offsets: readonly number[]): void {
  let start = 0
  if (offsets.length > 0) {
    let before = statementShape(text.slice(0, offsets[0]).trim())
    for (let index = 0; index < offsets.length; index++) {
      const after = statementShape(text.slice(offsets[index], offsets[index + 1]).trim())
      if (before && after && (before !== 'title' || after === 'data')) {
        const statement = text.slice(start, offsets[index]).trim()
        if (statement) statements.push(statement)
        start = offsets[index]!
        before = after
      } else if (before !== 'title') {
        before = after
      }
    }
  }
  const statement = text.slice(start).trim()
  if (statement) statements.push(statement)
}

/**
 * How text reads as one statement, without recording it: `title` when it is
 * only unquoted title words, or axis-title words where a keyword may be text,
 * `text` when it is one unquoted axis-title word, `data` for any other
 * statement, and undefined when it is no complete statement.
 */
function statementShape(text: string): 'title' | 'text' | 'data' | undefined {
  const directive = text.match(/^(title|x-axis|y-axis)\s+([\s\S]+)$/i)
  if (!directive) {
    const series = parseSeriesDirective(text)
    return series && splitCommaTokens(series.points).every(point => LABELED_POINT_RE.test(point.trim())) ? 'data' : undefined
  }
  const value = directive[2]!.trim()
  const quoted = value.startsWith('"') || value.startsWith("'")
  if (/^title$/i.test(directive[1]!)) return parseDirectiveText(value) === null ? undefined : quoted ? 'data' : 'title'
  const list = /^x/i.test(directive[1]!) ? splitTrailingBracketList(value) : null
  if (list) return list.prefix && parseDirectiveText(list.prefix) === null ? undefined : 'data'
  const axis = readAxisTitleRange(value)
  return !axis ? undefined : axis.range || quoted ? 'data' : axis.words ? 'title' : 'text'
}

function splitSemicolonStatements(text: string, strict: boolean): string[] {
  const statements: string[] = []
  let current = ''
  let quote: '"' | "'" | null = null
  let bracketDepth = 0
  let braceDepth = 0
  let escaped = false
  // Offsets in `current` where a keyword may start another statement.
  let keywords: number[] = []
  let started = false
  let collecting = true

  for (let i = 0; i < text.length; i++) {
    const char = text[i]!
    if (quote) {
      current += char
      if (escaped) { escaped = false; continue }
      if (char === '\\') { escaped = true; continue }
      if (char === quote) quote = null
      continue
    }

    if (char === '"' || char === "'") {
      quote = char
      current += char
      continue
    }
    if (char === '[') {
      bracketDepth++
      current += char
      continue
    }
    if (char === ']') {
      bracketDepth--
      current += char
      continue
    }
    if (char === '{') {
      braceDepth++
      current += char
      continue
    }
    if (char === '}') {
      braceDepth--
      current += char
      continue
    }
    if (char === ';' && bracketDepth === 0 && braceDepth === 0) {
      pushKeywordStatements(statements, current, keywords)
      current = ''
      keywords = []
      started = false
      collecting = true
      continue
    }
    if (collecting && bracketDepth === 0 && braceDepth === 0 && /[abltxy]/i.test(char) && !/\w/.test(text[i - 1] ?? ' ')) {
      STATEMENT_KEYWORD.lastIndex = i
      const keyword = STATEMENT_KEYWORD.exec(text)
      if (keyword && /^acc/i.test(keyword[0])) {
        // The directive starts here when the text before it is a statement
        // or there is none.
        const before: string[] = []
        pushKeywordStatements(before, current, keywords)
        if (before.length === 0 || statementShape(before[before.length - 1]!) !== undefined) {
          statements.push(...before)
          current = ''
          keywords = []
          if (!keyword[0].endsWith('{')) {
            statements.push(text.slice(i).trim())
            return statements
          }
          // A block's text runs to its `}`, a quote in it included.
          const close = text.indexOf('}', i + keyword[0].length)
          if (close >= 0) {
            current += text.slice(i, close + 1)
            i = close
            started = true
            collecting = false
            continue
          }
        }
        collecting = false
      } else if (keyword && started) keywords.push(current.length)
    }
    if (!started && !/\s/.test(char)) started = true

    current += char
  }

  if (strict && (quote || bracketDepth !== 0 || braceDepth !== 0)) {
    throw new Error(`Unclosed XYChart delimiter in line: "${text}"`)
  }

  pushKeywordStatements(statements, current, keywords)
  return statements
}
