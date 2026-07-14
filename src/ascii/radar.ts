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
import { colorizeText } from './ansi.ts'
import { padEndToVisualWidth, visualWidth } from './width.ts'
import { wrapText } from './wrap.ts'

const MAX_BAR = 24

function fmt(n: number): string {
  return Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100)
}

function cellLines(label: string): string[] {
  const lines = label.split('\n').map(line => line.trim()).filter(Boolean)
  return lines.length > 0 ? lines : ['']
}

function maxCellWidth(labels: string[]): number {
  let width = 0
  for (const label of labels) for (const line of cellLines(label)) width = Math.max(width, visualWidth(line))
  return width
}

export function renderRadarAscii(
  lines: string[],
  config: AsciiConfig,
  colorMode: ColorMode,
  theme: AsciiTheme,
  frontmatter: MermaidFrontmatterMap = {},
  targetWidth?: number,
): string {
  const chart = parseRadarChart(lines, { title: getFrontmatterScalar<string>(frontmatter, ['title']) })
  const barChar = config.useAscii ? '#' : '█'
  const sep = config.useAscii ? '|' : '│'
  const glyph = config.useAscii ? '*' : '●'

  const visual = resolveRadarVisualConfig(frontmatter)
  const colors = pieSliceColors(chart.curves.length, {
    accent: theme.accent,
    bg: theme.bg,
    overrides: visual.paletteOverrides,
  })
  const scale = resolveRadarScale(chart)
  const drawable = chart.curves.filter(curve => curve.values.length === chart.axes.length)

  const axisWidth = maxCellWidth(chart.axes.map(axis => axis.label))
  const curveWidth = maxCellWidth(drawable.map(curve => curve.label))
  let valWidth = 1
  for (const curve of drawable) for (const value of curve.values) valWidth = Math.max(valWidth, visualWidth(fmt(value)))

  let barMax = MAX_BAR
  if (targetWidth) {
    const fixed = axisWidth + 2 + curveWidth + 1 + visualWidth(sep) + 1 + 1 + valWidth
    barMax = Math.max(3, Math.min(MAX_BAR, targetWidth - fixed))
  }

  const out: string[] = []
  if (chart.title) out.push(...wrapText(chart.title, targetWidth))

  if (chart.showLegend && chart.curves.length > 0) {
    const legend = chart.curves.map((curve, index) => {
      const marker = colorMode === 'none' ? glyph : colorizeText(glyph, colors[index]!, colorMode)
      return `${marker} ${cellLines(curve.label).join(' ')}`
    }).join('   ')
    out.push(...(targetWidth ? wrapText(legend, targetWidth) : [legend]))
    out.push('')
  }

  const mismatched = chart.curves.filter(curve => curve.values.length !== chart.axes.length)
  if (mismatched.length > 0) {
    for (const curve of mismatched) {
      const warning = `! ${cellLines(curve.label).join(' ')}: expected ${chart.axes.length} values, got ${curve.values.length}; not plotted`
      out.push(...(targetWidth ? wrapText(warning, targetWidth) : [warning]))
    }
    out.push('')
  }

  chart.axes.forEach((axis, axisIndex) => {
    drawable.forEach((curve, curveIndex) => {
      const value = curve.values[axisIndex]!
      const ratio = radarValueRatio(value, scale)
      const barLength = ratio > 0 ? Math.max(1, Math.round(ratio * barMax)) : 0
      const bar = barChar.repeat(barLength)
      const paletteIndex = chart.curves.indexOf(curve)
      const coloredBar = colorMode === 'none' ? bar : colorizeText(bar, colors[paletteIndex]!, colorMode)
      const axisLines = curveIndex === 0 ? cellLines(axis.label) : ['']
      const curveLines = cellLines(curve.label)
      const rowCount = Math.max(axisLines.length, curveLines.length)
      for (let row = 0; row < rowCount; row++) {
        const axisCol = padEndToVisualWidth(axisLines[row] ?? '', axisWidth)
        const curveCol = padEndToVisualWidth(curveLines[row] ?? '', curveWidth)
        const valueCol = row === 0 ? fmt(value).padStart(valWidth) : ' '.repeat(valWidth)
        const rowBar = row === 0 ? coloredBar : ''
        out.push(`${axisCol}  ${curveCol} ${sep} ${rowBar} ${valueCol}`.trimEnd())
      }
    })
  })

  return out.join('\n')
}
