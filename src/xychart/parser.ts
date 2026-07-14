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
export function parseXYChart(lines: string[]): XYChart {
  const xAxis: XYAxis = {}
  const yAxis: XYAxis = {}
  const series: XYChartSeries[] = []
  const statements = expandXYChartStatements(lines)
  let title: string | undefined
  let accTitle: string | undefined
  let accDescription: string | undefined
  let horizontal = false
  let headerOrientation: 'vertical' | 'horizontal' | undefined

  for (let index = 0; index < statements.length; index++) {
    const line = statements[index]!

    // Header line — detect horizontal
    if (/^xychart(-beta)?\b/i.test(line)) {
      if (/\bhorizontal\b/i.test(line)) {
        horizontal = true
        headerOrientation = 'horizontal'
      } else if (/\bvertical\b/i.test(line)) {
        horizontal = false
        headerOrientation = 'vertical'
      }
      continue
    }

    const accTitleMatch = line.match(/^accTitle\s*:?\s*(.+)$/i)
    if (accTitleMatch) {
      accTitle = parseDirectiveText(accTitleMatch[1]!)
      continue
    }

    const accDescrBlockMatch = line.match(/^accDescr\s*:?\s*\{\s*$/i)
    if (accDescrBlockMatch) {
      const block: string[] = []
      for (index += 1; index < statements.length; index++) {
        const blockLine = statements[index]!
        if (blockLine === '}') break
        block.push(blockLine)
      }
      accDescription = block.join('\n').trim() || undefined
      continue
    }

    const accDescrMatch = line.match(/^accDescr\s*:?\s*(.+)$/i)
    if (accDescrMatch) {
      accDescription = parseDirectiveText(accDescrMatch[1]!)
      continue
    }

    // Title
    const titleMatch = line.match(/^title\s+(.+)$/)
    if (titleMatch) {
      title = parseDirectiveText(titleMatch[1]!)
      continue
    }

    // x-axis: optional title with either categories or numeric range
    const xAxisMatch = line.match(/^x-axis\s+(.+)$/)
    if (xAxisMatch) {
      applyAxisDirective(xAxis, xAxisMatch[1]!, 'x')
      continue
    }

    // y-axis: numeric range only, optionally with a title
    const yAxisMatch = line.match(/^y-axis\s+(.+)$/)
    if (yAxisMatch) {
      applyAxisDirective(yAxis, yAxisMatch[1]!, 'y')
      continue
    }

    const barMatch = line.match(/^bar(?:\s+(.+?))?\s+\[([^\]]+)\]\s*$/)
    if (barMatch) {
      const points = parseNumericPoints(barMatch[2]!)
      series.push({
        type: 'bar',
        label: parseOptionalSeriesLabel(barMatch[1]),
        data: points.values,
        // Upstream accepts labels on bars but intentionally does not render them.
      })
      continue
    }

    const lineMatch = line.match(/^line(?:\s+(.+?))?\s+\[([^\]]+)\]\s*$/)
    if (lineMatch) {
      const points = parseNumericPoints(lineMatch[2]!)
      series.push({
        type: 'line',
        label: parseOptionalSeriesLabel(lineMatch[1]),
        data: points.values,
        ...(points.labels.some(label => label !== undefined) ? { pointLabels: points.labels } : {}),
      })
      continue
    }
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
    accessibility: accTitle || accDescription ? { title: accTitle, description: accDescription } : undefined,
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
function parseNumericPoints(str: string): { values: number[]; labels: Array<string | undefined> } {
  const values: number[] = []
  const labels: Array<string | undefined> = []
  for (const token of splitCommaList(str)) {
    const match = token.trim().match(LABELED_POINT_RE)
    if (!match) throw new Error(`Invalid XYChart point: "${token.trim()}"`)
    const value = Number(match[1])
    if (!Number.isFinite(value)) throw new Error(`XYChart point must be finite: "${token.trim()}"`)
    values.push(value)
    labels.push(match[2]?.trim().replace(/\\(["\\])/g, '$1'))
  }
  return { values, labels }
}

function parseNumericArray(str: string): number[] {
  return parseNumericPoints(str).values
}

const NUMBER_PATTERN = String.raw`[+-]?(?:\d+(?:\.\d+)?|\.\d+)`
const RANGE_REGEX = new RegExp(`^(${NUMBER_PATTERN})\\s*-->\\s*(${NUMBER_PATTERN})$`)

function applyAxisDirective(axis: XYAxis, rawValue: string, axisName: 'x' | 'y'): void {
  const value = rawValue.trim()
  if (value.length === 0) return

  const categoriesMatch = value.match(/\[(.*)\]\s*$/)
  if (categoriesMatch && axisName === 'x') {
    const prefix = value.slice(0, categoriesMatch.index).trim()
    if (prefix.length > 0) axis.title = parseDirectiveText(prefix)
    axis.categories = splitCommaList(categoriesMatch[1]!)
    return
  }

  const rangeOnly = value.match(RANGE_REGEX)
  if (rangeOnly) {
    axis.range = { min: parseFloat(rangeOnly[1]!), max: parseFloat(rangeOnly[2]!) }
    return
  }

  const titledRange = parseLeadingTextToken(value)
  if (titledRange) {
    const rangeMatch = titledRange.rest.match(RANGE_REGEX)
    if (rangeMatch) {
      axis.title = parseDirectiveText(titledRange.value)
      axis.range = { min: parseFloat(rangeMatch[1]!), max: parseFloat(rangeMatch[2]!) }
      return
    }

    if (axisName === 'x' && titledRange.rest.length === 0) {
      axis.title = parseDirectiveText(titledRange.value)
    }
  }
}

function parseLeadingTextToken(text: string): { value: string; rest: string } | undefined {
  const trimmed = text.trim()
  if (trimmed.length === 0) return undefined

  if (trimmed.startsWith('"') || trimmed.startsWith("'")) {
    const quote = trimmed[0]!
    let end = 1
    while (end < trimmed.length) {
      if (trimmed[end] === quote && trimmed[end - 1] !== '\\') break
      end++
    }
    if (end >= trimmed.length) return undefined
    return {
      value: trimmed.slice(1, end),
      rest: trimmed.slice(end + 1).trim(),
    }
  }

  const match = trimmed.match(/^([^\s]+)(?:\s+(.*))?$/)
  if (!match) return undefined
  return {
    value: match[1]!,
    rest: (match[2] ?? '').trim(),
  }
}

function parseTextLiteral(text: string): string {
  const token = parseLeadingTextToken(text)
  return token ? token.value : text.trim()
}

function parseDirectiveText(text: string): string {
  const trimmed = text.trim()
  if (trimmed.startsWith('"') || trimmed.startsWith("'")) return parseTextLiteral(trimmed)
  return trimmed
}

function parseOptionalSeriesLabel(value: string | undefined): string | undefined {
  if (!value) return undefined
  const trimmed = value.trim()
  return trimmed ? parseDirectiveText(trimmed) : undefined
}

function splitCommaList(text: string): string[] {
  const values: string[] = []
  let current = ''
  let quote: '"' | "'" | null = null

  for (let i = 0; i < text.length; i++) {
    const char = text[i]!
    if (quote) {
      if (char === quote && text[i - 1] !== '\\') {
        quote = null
      } else {
        current += char
      }
      continue
    }

    if (char === '"' || char === "'") {
      quote = char
      continue
    }

    if (char === ',') {
      pushValue(values, current)
      current = ''
      continue
    }

    current += char
  }

  pushValue(values, current)
  return values
}

function pushValue(values: string[], rawValue: string): void {
  const value = rawValue.trim()
  if (value.length > 0) values.push(value)
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

function expandXYChartStatements(lines: string[]): string[] {
  const statements: string[] = []
  let inAccDescrBlock = false

  for (const rawLine of lines) {
    const line = rawLine.trim()
    if (!line) continue

    if (inAccDescrBlock) {
      statements.push(line)
      if (line === '}') inAccDescrBlock = false
      continue
    }

    const parts = splitSemicolonStatements(line)
    for (const part of parts) {
      statements.push(part)
      if (/^accDescr\s*:?\s*\{\s*$/i.test(part)) inAccDescrBlock = true
    }
  }

  return statements
}

function splitSemicolonStatements(text: string): string[] {
  const statements: string[] = []
  let current = ''
  let quote: '"' | "'" | null = null
  let bracketDepth = 0
  let braceDepth = 0

  for (let i = 0; i < text.length; i++) {
    const char = text[i]!
    if (quote) {
      current += char
      if (char === quote && text[i - 1] !== '\\') quote = null
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

  const trailing = current.trim()
  if (trailing) statements.push(trailing)
  return statements
}
