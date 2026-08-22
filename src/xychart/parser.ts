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
import { scanAccessibilityDirectives } from '../shared/accessibility-directives.ts'

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
  if (headerMatch?.[1]) {
    headerOrientation = headerMatch[1].toLowerCase() as 'vertical' | 'horizontal'
    horizontal = headerOrientation === 'horizontal'
  }

  for (let index = headerMatch ? 1 : 0; index < statements.length; index++) {
    const line = statements[index]!

    // Title
    const titleMatch = line.match(/^title\s+(.+)$/i)
    if (titleMatch) {
      const parsed = parseDirectiveText(titleMatch[1]!)
      if (parsed === null) {
        if (options.strict) throw new Error(`Invalid XYChart title directive: "${line}"`)
      } else title = parsed
      continue
    }

    // x-axis: optional title with either categories or numeric range
    const xAxisMatch = line.match(/^x-axis\s+(.+)$/i)
    if (xAxisMatch) {
      if (!applyAxisDirective(xAxis, xAxisMatch[1]!, 'x') && options.strict) {
        throw new Error(`Invalid XYChart x-axis directive: "${line}"`)
      }
      continue
    }

    // y-axis: numeric range only, optionally with a title
    const yAxisMatch = line.match(/^y-axis\s+(.+)$/i)
    if (yAxisMatch) {
      if (!applyAxisDirective(yAxis, yAxisMatch[1]!, 'y') && options.strict) {
        throw new Error(`Invalid XYChart y-axis directive: "${line}"`)
      }
      continue
    }

    const seriesDirective = parseSeriesDirective(line)
    if (seriesDirective?.type === 'bar') {
      const points = parseNumericPoints(seriesDirective.points, options.strict === true)
      series.push({
        type: 'bar',
        label: seriesDirective.label,
        data: points.values,
        ...(points.labels.some(pointLabel => pointLabel !== undefined) ? { pointLabels: points.labels } : {}),
      })
      continue
    }

    if (seriesDirective?.type === 'line') {
      const points = parseNumericPoints(seriesDirective.points, options.strict === true)
      series.push({
        type: 'line',
        label: seriesDirective.label,
        data: points.values,
        ...(points.labels.some(label => label !== undefined) ? { pointLabels: points.labels } : {}),
      })
      continue
    }

    if (options.strict) throw new Error(`Unrecognized XYChart line: "${line}"`)
  }

  // Auto-derive y-axis range from data if not specified
  if (!yAxis.range && series.length > 0) {
    const allValues = series.flatMap(s => s.data)
    let min = Math.min(...allValues)
    let max = Math.max(...allValues)
    const span = max - min || 1
    // Add 10% padding
    min = min - span * 0.1
    max = max + span * 0.1
    // Floor to 0 if all values are positive and min is close to 0
    if (min > 0 && min < span * 0.5) min = 0
    yAxis.range = { min, max }
  }

  // Fallback y-axis range
  if (!yAxis.range) {
    yAxis.range = { min: 0, max: 100 }
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
  return {
    ...chart,
    horizontal: chart.headerOrientation
      ? chart.horizontal
      : config.chartOrientation === 'horizontal',
    config,
    theme,
  }
}

// splitCommaList removes the quote delimiters while preserving their content.
const LABELED_POINT_RE = /^([+-]?(?:\d+(?:\.\d+)?|\.\d+))(?:\s+(.+))?$/

/** Full recognition prevents `parseFloat('25 typo')` from silently accepting a prefix. */
function parseNumericPoints(str: string, strict = false): { values: number[]; labels: Array<string | undefined> } {
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
    labels.push(label)
  }
  if (values.length === 0) throw new Error('XYChart series must contain at least one point')
  return { values, labels }
}

function parseNumericArray(str: string): number[] {
  return parseNumericPoints(str).values
}

const NUMBER_PATTERN = String.raw`[+-]?(?:\d+(?:\.\d+)?|\.\d+)`
const RANGE_REGEX = new RegExp(`^(${NUMBER_PATTERN})\\s*-->\\s*(${NUMBER_PATTERN})$`)

function applyAxisDirective(axis: XYAxis, rawValue: string, axisName: 'x' | 'y'): boolean {
  const value = rawValue.trim()
  if (value.length === 0) return false

  const categoriesMatch = splitTrailingBracketList(value)
  if (categoriesMatch && axisName === 'x') {
    const prefix = categoriesMatch.prefix
    const title = prefix.length > 0 ? parseDirectiveText(prefix) : undefined
    if (title === null) return false
    const categories = splitCommaList(categoriesMatch.contents)
    if (categories.length === 0) return false
    if (title !== undefined) axis.title = title
    axis.categories = categories
    delete axis.range
    delete axis.rangeAuthored
    axis.authored = true
    return true
  }

  const rangeOnly = value.match(RANGE_REGEX)
  if (rangeOnly) {
    axis.range = { min: parseFloat(rangeOnly[1]!), max: parseFloat(rangeOnly[2]!) }
    axis.rangeAuthored = true
    delete axis.categories
    axis.authored = true
    return true
  }

  const titledRange = parseLeadingTextToken(value)
  if (titledRange) {
    const rangeMatch = titledRange.rest.match(RANGE_REGEX)
    if (rangeMatch) {
      axis.title = titledRange.value
      axis.range = { min: parseFloat(rangeMatch[1]!), max: parseFloat(rangeMatch[2]!) }
      axis.rangeAuthored = true
      delete axis.categories
      axis.authored = true
      return true
    }

    if (titledRange.rest.length === 0) {
      axis.title = titledRange.value
      axis.authored = true
      return true
    }
  }
  return false
}

function parseLeadingTextToken(text: string): { value: string; rest: string } | undefined {
  const trimmed = text.trim()
  if (trimmed.length === 0) return undefined

  if (trimmed.startsWith('"') || trimmed.startsWith("'")) {
    const quoted = readQuotedText(trimmed)
    if (!quoted) return undefined
    return {
      value: quoted.value,
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
    if (value === null || value.length === 0) throw new Error(`Invalid XYChart list value: "${raw}"`)
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

/** Serialize text through the same lexical contract consumed above. */
export function renderXYChartText(value: string, mode: 'free' | 'token' | 'list' | 'quoted'): string {
  if (mode === 'quoted') return `"${value.replace(/(["\\])/g, '\\$1')}"`
  const bare = mode === 'token'
    ? /^[^\s"'\\;\[\]{},]+$/.test(value)
    : mode === 'list'
      ? /^[^"'\\;,\[\]{}]+$/.test(value) && value.trim() === value
      : /^[^"'\\;\[\]{}]+$/.test(value) && value.trim() === value
  return bare && value.length > 0 ? value : `"${value.replace(/(["\\])/g, '\\$1')}"`
}

function pushValue(values: string[], rawValue: string): void {
  values.push(rawValue.trim())
}

export function resolveXYChartConfig(frontmatter: MermaidFrontmatterMap): XYChartConfig {
  const configRoot = getFrontmatterMap(frontmatter, ['config']) ?? frontmatter
  const root = getFrontmatterMap(frontmatter, ['config', 'xyChart']) ?? getFrontmatterMap(frontmatter, ['xyChart']) ?? {}
  const chartOrientation = getString(root, ['chartOrientation'])
  return {
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
    showTitle: getBoolean(root, ['showTitle']),
    showLegend: getBoolean(root, ['showLegend']),
    legendFontSize: getPositiveNumber(root, ['legendFontSize']),
    legendPadding: getNonNegativeNumber(root, ['legendPadding']),
    xAxis: resolveAxisConfig(root, 'xAxis'),
    yAxis: resolveAxisConfig(root, 'yAxis'),
  }
}

export function resolveXYChartTheme(frontmatter: MermaidFrontmatterMap): XYChartTheme {
  const configRoot = getFrontmatterMap(frontmatter, ['config']) ?? frontmatter
  const root = getFrontmatterMap(frontmatter, ['config', 'themeVariables', 'xyChart'])
    ?? getFrontmatterMap(frontmatter, ['themeVariables', 'xyChart'])
    ?? {}
  return {
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
    plotColorPalette: getPalette(root, ['plotColorPalette']),
  }
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
  const items = value.split(',').map(item => item.trim()).filter(Boolean)
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

function expandXYChartStatements(lines: string[], strict: boolean): string[] {
  const statements: string[] = []
  let inAccDescrBlock = false

  for (const rawLine of lines) {
    const line = rawLine.trim()
    if (!line) continue
    if (line.startsWith('%%')) continue

    if (inAccDescrBlock) {
      statements.push(line)
      if (line.includes('}')) inAccDescrBlock = false
      continue
    }

    const parts = splitSemicolonStatements(line, strict)
    for (const part of parts) {
      statements.push(part)
      const block = part.match(/^accDescr\s*:?\s*\{(.*)$/i)
      if (block && !block[1]!.includes('}')) inAccDescrBlock = true
    }
  }

  return statements
}

function splitSemicolonStatements(text: string, strict: boolean): string[] {
  const statements: string[] = []
  let current = ''
  let quote: '"' | "'" | null = null
  let bracketDepth = 0
  let braceDepth = 0
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
      const statement = current.trim()
      if (statement) statements.push(statement)
      current = ''
      continue
    }

    current += char
  }

  if (strict && (quote || bracketDepth !== 0 || braceDepth !== 0)) {
    throw new Error(`Unclosed XYChart delimiter in line: "${text}"`)
  }

  const trailing = current.trim()
  if (trailing) statements.push(trailing)
  return statements
}
