import { terminalArtifact, type TerminalArtifact } from './terminal-artifact.ts'
import { formatChartValue as fmt } from '../shared/chart-value-format.ts'
// ============================================================================
// ASCII renderer — Radar (spider) chart
//
// Polar geometry degrades to a grouped proportional-bar table. The scale is
// shared with SVG, labels are emitted as explicit multiline cells, and every
// final line remains subject to the global display-cell targetWidth contract.
// ============================================================================

import { parseRadarChart } from '../radar/parser.ts'
import { resolveRadarVisualConfig } from '../radar/config.ts'
import { radarValueRatio, resolveRadarScale } from '../radar/scale.ts'
import { pieSliceColors } from '../pie/palette.ts'
import { getFrontmatterScalar, type MermaidFrontmatterMap } from '../mermaid-source.ts'
import type { AsciiConfig, AsciiTheme, ColorMode } from './types.ts'
import { TerminalDocument, type TerminalRun } from './terminal-document.ts'
import { visualWidth } from './width.ts'
import { wrapText } from './wrap.ts'
import { resolveRoleStyle, type InternalStyleFace } from '../scene/style-registry.ts'

const MAX_BAR = 24

function cellLines(label: string, width?: number): string[] {
  const lines = label.split('\n').flatMap(line => wrapText(line.trim(), width)).filter(Boolean)
  return lines.length > 0 ? lines : ['']
}

function maxCellWidth(labels: string[]): number {
  let width = 0
  for (const label of labels) for (const line of cellLines(label)) width = Math.max(width, visualWidth(line))
  return width
}

/** Match graphical per-key occurrences, adding a role only when an authored
 * identifier is shared by axes and curves. Unique authored IDs stay stable. */
function occurrenceOwners(values: readonly string[], otherRole: ReadonlySet<string>, role: 'axis' | 'curve'): string[] {
  const counts = new Map<string, number>(), seen = new Map<string, number>()
  for (const id of values) counts.set(id, (counts.get(id) ?? 0) + 1)
  return values.map(id => {
    const occurrence = seen.get(id) ?? 0
    seen.set(id, occurrence + 1)
    const identity = counts.get(id)! > 1 ? `${id}#${occurrence}` : id
    return otherRole.has(id) ? `${role}:${identity}` : identity
  })
}

export function renderRadarTerminal(
  lines: string[],
  config: AsciiConfig,
  colorMode: ColorMode,
  theme: AsciiTheme,
  frontmatter: MermaidFrontmatterMap = {},
  targetWidth?: number,
  styleFace?: Readonly<InternalStyleFace>,
): TerminalArtifact {
  targetWidth ??= config.maxWidth
  const chart = parseRadarChart(lines, { title: getFrontmatterScalar<string>(frontmatter, ['title']) })
  const axisOwners = occurrenceOwners(chart.axes.map(axis => axis.id), new Set(chart.curves.map(curve => curve.id)), 'axis')
  const curveIds = occurrenceOwners(chart.curves.map(curve => curve.id), new Set(chart.axes.map(axis => axis.id)), 'curve')
  const curveOwners = new Map(chart.curves.map((curve, index) => [curve, curveIds[index]!]))
  const sep = config.useAscii ? '|' : '│'
  const cueGlyphs = (label: string): { marker: string; bar: string } => {
    const cue = resolveRoleStyle(styleFace, 'pie-slice', { category: label }, { includeFallback: false })?.cue
    if (cue === 'outline') return config.useAscii ? { marker: '+', bar: '+' } : { marker: '◇', bar: '□' }
    if (cue === 'double-line') return config.useAscii ? { marker: '=', bar: '=' } : { marker: '◈', bar: '═' }
    if (cue === 'pattern') return config.useAscii ? { marker: '%', bar: '%' } : { marker: '░', bar: '░' }
    return config.useAscii ? { marker: '*', bar: '#' } : { marker: '●', bar: '█' }
  }

  const visual = resolveRadarVisualConfig(frontmatter)
  const colors = pieSliceColors(chart.curves.length, {
    accent: theme.accent,
    bg: theme.bg,
    overrides: visual.paletteOverrides,
  })
  const scale = resolveRadarScale(chart)
  const drawable = chart.curves.filter(curve => curve.values.length === chart.axes.length)

  const naturalAxisWidth = maxCellWidth(chart.axes.map(axis => axis.label))
  let valWidth = 1
  for (const curve of drawable) for (const value of curve.values) valWidth = Math.max(valWidth, visualWidth(fmt(value)))

  // These labels are literal text. Wrap the displayed characters directly,
  // before color encoding; never send literal tags through formatted markup.
  const labelBudget = targetWidth === undefined ? undefined : Math.max(2, targetWidth - 8 - valWidth)
  const axisBudget = labelBudget === undefined ? undefined : Math.max(1, Math.min(naturalAxisWidth, Math.floor(labelBudget / 2)))
  const curveBudget = labelBudget === undefined ? undefined : Math.max(1, labelBudget - axisBudget!)
  const axisWidth = Math.max(0, ...chart.axes.flatMap(axis => cellLines(axis.label, axisBudget)).map(visualWidth))
  const curveWidth = Math.max(0, ...drawable.flatMap(curve => cellLines(curve.label, curveBudget)).map(visualWidth))
  let barMax = MAX_BAR
  if (targetWidth) {
    const fixed = axisWidth + 2 + curveWidth + 1 + visualWidth(sep) + 1 + 1 + valWidth
    barMax = Math.max(3, Math.min(MAX_BAR, targetWidth - fixed))
  }

  const document = new TerminalDocument()
  const project = (feature: string, value: unknown, representation: string): void => document.report({
    code: 'TERMINAL_FAMILY_PROJECTION', feature,
    message: `${feature}=${JSON.stringify(value)} is represented by ${representation}; source configuration is retained.`,
  })
  if (chart.axes.length > 0) {
    for (const field of ['width', 'height', 'marginTop', 'marginRight', 'marginBottom', 'marginLeft', 'axisScaleFactor', 'axisLabelFactor'] as const) {
      if (visual[field] !== undefined) project(`radar.${field}`, visual[field], 'measured terminal label columns and a proportional bar scale, rather than pixel polar positions')
    }
    if (visual.axisLabelFontSize !== undefined) project('themeVariables.radar.axisLabelFontSize', visual.axisLabelFontSize, 'the terminal font cell size with complete wrapped axis labels')
    if (visual.axisStrokeWidth !== undefined) project('themeVariables.radar.axisStrokeWidth', visual.axisStrokeWidth, 'single-cell column separator glyphs')
  }
  if (drawable.length > 0) {
    project('radar.graticule', { shape: chart.graticule, ticks: chart.ticks }, 'owned threshold marks on the numeric bar ruler rather than concentric polar rings')
    if (chart.graticule === 'circle' && visual.curveTension !== undefined) project('radar.curveTension', visual.curveTension, 'independent per-axis bars without interpolated closed curves')
    if (visual.tickLabels === true) project('radar.tickLabels', true, 'the scale minimum/maximum and owned threshold marks; individual ring-value labels are not emitted')
    for (const field of ['curveStrokeWidth', 'graticuleStrokeWidth'] as const) {
      if (visual[field] !== undefined) project(`themeVariables.radar.${field}`, visual[field], 'single-cell bar/ruler glyphs without pixel stroke widths')
    }
    for (const field of ['curveOpacity', 'graticuleOpacity'] as const) {
      if (visual[field] !== undefined && visual[field] !== 1) project(`themeVariables.radar.${field}`, visual[field], 'opaque terminal bar/ruler glyphs')
    }
  }
  if (chart.showLegend && chart.curves.length > 0) {
    for (const field of ['legendBoxSize', 'legendFontSize'] as const) {
      if (visual[field] !== undefined) project(`themeVariables.radar.${field}`, visual[field], 'single-cell legend markers and the terminal font cell size with complete wrapped series labels')
    }
  }
  if (chart.title && visual.titleFontSize !== undefined) project('themeVariables.fontSize', visual.titleFontSize, 'the terminal font cell size with the complete Radar title')
  if (visual.useMaxWidth === true) document.report({
    code: 'TERMINAL_RENDER_OPTION_NOT_APPLICABLE', feature: 'radar.useMaxWidth',
    message: 'radar.useMaxWidth=true controls responsive SVG sizing; terminal output uses its measured cell width and the terminal width policy.',
  })
  if (chart.title) for (const text of wrapText(chart.title, targetWidth)) {
    document.line([{ text, role: 'text', color: visual.titleColor, textGroup: 'title', owner: { id: 'title', kind: 'label' } }])
  }

  if (chart.showLegend && chart.curves.length > 0) {
    let legend: TerminalRun[] = []
    let width = 0
    chart.curves.forEach((curve, index) => {
      const id = curveOwners.get(curve)!
      const glyph = cueGlyphs(curve.label).marker
      const lines = wrapText(cellLines(curve.label).join(' '), targetWidth === undefined ? undefined : Math.max(1, targetWidth - 2))
      lines.forEach((text, lineIndex) => {
        const itemWidth = 2 + visualWidth(text)
        if (legend.length > 0 && (lineIndex > 0 || (targetWidth !== undefined && width + 3 + itemWidth > targetWidth))) {
          document.line(legend); legend = []; width = 0
        }
        if (legend.length > 0) { legend.push({ text: '   ', kind: 'surface' }); width += 3 }
        legend.push(
          { text: glyph, role: 'arrow', kind: 'marker', color: colors[index]!, owner: { id: `${id}:legend`, kind: 'label', parent: { id, kind: 'node' } } },
          { text: ' ', kind: 'surface' },
          { text, role: 'text', textGroup: 'legend', owner: { id, kind: 'node' } },
        )
        width += itemWidth
      })
    })
    if (legend.length > 0) document.line(legend)
    document.line()
  }

  const mismatched = chart.curves.filter(curve => curve.values.length !== chart.axes.length)
  if (mismatched.length > 0) {
    for (const curve of mismatched) {
      const warning = `! ${cellLines(curve.label).join(' ')}: expected ${chart.axes.length} values, got ${curve.values.length}; not plotted`
      for (const text of wrapText(warning, targetWidth)) document.line([{ text, role: 'text', textGroup: 'warning', owner: { id: curveOwners.get(curve)!, kind: 'node' } }])
    }
    document.line()
  }

  // Polar rings project to their actual numeric thresholds on the table's
  // bar scale. These owned ruler cells retain ring identity without claiming
  // that the terminal table contains circular geometry.
  if (drawable.length > 0) {
    for (const text of wrapText(`scale: ${scale.min} .. ${scale.max}`, targetWidth)) {
      document.line([{ text, role: 'text', owner: { id: 'radar-scale', kind: 'label' } }])
    }
    const rulerRow = document.height
    const barStart = axisWidth + curveWidth + 5
    for (let index = 0; index < chart.ticks; index++) {
      const column = barStart + Math.max(0, Math.round((index + 1) / chart.ticks * barMax) - 1)
      document.stroke(column, rulerRow, 14, { ascii: config.useAscii, role: 'border', color: visual.graticuleColor, owner: { id: `ring:${index}`, kind: 'ring' } })
    }
    document.line()
  }

  // Axes are meaningful chart structure even when there is no drawable
  // series (axis-only source or every curve has an arity mismatch).
  if (drawable.length === 0) {
    for (const [index, axis] of chart.axes.entries()) {
      for (const text of cellLines(axis.label, axisBudget)) {
        document.line([{ text, role: 'text', textGroup: 'axis', owner: { id: axisOwners[index]!, kind: 'node' } }, { text: ' '.repeat(Math.max(0, axisWidth - visualWidth(text)) + 2) + sep, role: 'border', kind: 'stroke', color: visual.axisColor, owner: { id: axisOwners[index]!, kind: 'node' } }])
      }
    }
  }

  chart.axes.forEach((axis, axisIndex) => {
    drawable.forEach((curve, curveIndex) => {
      const axisId = axisOwners[axisIndex]!, curveId = curveOwners.get(curve)!
      const value = curve.values[axisIndex]!
      const ratio = radarValueRatio(value, scale)
      const barLength = ratio > 0 ? Math.max(1, Math.round(ratio * barMax)) : 0
      const bar = cueGlyphs(curve.label).bar.repeat(barLength)
      const paletteIndex = chart.curves.indexOf(curve)
      const axisLines = curveIndex === 0 ? cellLines(axis.label, axisBudget) : ['']
      const curveLines = cellLines(curve.label, curveBudget)
      const rowCount = Math.max(axisLines.length, curveLines.length)
      for (let row = 0; row < rowCount; row++) {
        const valueCol = row === 0 ? ` ${fmt(value).padStart(valWidth)}` : ''
        document.line([
          { text: axisLines[row] ?? '', role: 'text', textGroup: 'axis', ...(curveIndex === 0 ? { owner: { id: axisId, kind: 'node' as const } } : {}) },
          { text: ' '.repeat(Math.max(0, axisWidth - visualWidth(axisLines[row] ?? '')) + 2), kind: 'surface' },
          { text: curveLines[row] ?? '', role: 'text', textGroup: `table:${axisId}`, owner: { id: curveId, kind: 'node' } },
          { text: ' '.repeat(Math.max(0, curveWidth - visualWidth(curveLines[row] ?? '')) + 1) + sep + ' ', role: 'border', kind: 'stroke', color: visual.axisColor, owner: { id: axisId, kind: 'node' } },
          { text: row === 0 ? bar : '', role: 'arrow', kind: 'mark', color: colors[paletteIndex]!, owner: { id: `${curveId}:${axisId}`, kind: 'plot', parent: { id: curveId, kind: 'node' } } },
          { text: valueCol, role: 'text', owner: { id: `${curveId}:${axisId}:value`, kind: 'label', parent: { id: curveId, kind: 'node' } } },
        ])
      }
    })
  })

  return terminalArtifact(document, { colorMode, theme, trimEnd: true })
}

