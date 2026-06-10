// ============================================================================
// ASCII renderer — Pie chart
//
// A pie chart doesn't map cleanly to a character grid, so we render it as a
// proportional horizontal bar list (the conventional terminal pie rendering):
//
//   Pets (title, if present)
//   Dogs  ████████████████████████  77.2%
//   Cats  █████                     17.0%
//   Rats  █                          5.8%
//
// Each bar's length is proportional to the slice's share of the total. With
// `showData` the raw value is shown alongside the percentage. Bars use █
// (Unicode) or # (ASCII fallback), colored per-slice with the same xychart
// palette as the SVG renderer for cross-format consistency.
// ============================================================================

import { parsePieChart } from '../pie/parser.ts'
import { formatPieValue, formatPiePercent } from '../pie/layout.ts'
import type { AsciiConfig, AsciiTheme, ColorMode } from './types.ts'
import { colorizeText } from './ansi.ts'
import { getSeriesColor, CHART_ACCENT_FALLBACK, isValidHex } from '../xychart/colors.ts'

/** Maximum bar length in characters (the largest slice fills this). */
const MAX_BAR = 30

function sliceColor(index: number, theme: AsciiTheme): string {
  const accent = theme.accent && isValidHex(theme.accent) ? theme.accent : CHART_ACCENT_FALLBACK
  return getSeriesColor(index, accent, theme.bg)
}

export function renderPieAscii(
  lines: string[],
  config: AsciiConfig,
  colorMode: ColorMode,
  theme: AsciiTheme,
): string {
  const chart = parsePieChart(lines)
  const barChar = config.useAscii ? '#' : '█'

  const total = chart.entries.reduce((sum, e) => sum + e.value, 0)
  if (total <= 0) return ''

  // Column widths.
  const labelWidth = Math.max(...chart.entries.map(e => e.label.length))
  const maxValue = Math.max(...chart.entries.map(e => e.value))

  const out: string[] = []
  if (chart.title) out.push(chart.title)

  chart.entries.forEach((entry, index) => {
    const fraction = entry.value / total
    // Bar length proportional to the largest slice, min 1 char for nonzero.
    const barLen = Math.max(1, Math.round((entry.value / maxValue) * MAX_BAR))
    const bar = barChar.repeat(barLen)
    const coloredBar = colorMode === 'none' ? bar : colorizeText(bar, sliceColor(index, theme), colorMode)

    const label = entry.label.padEnd(labelWidth)
    const barPad = ' '.repeat(MAX_BAR - barLen + 2)
    const pct = formatPiePercent(fraction).padStart(6)
    const valuePart = chart.showData ? `  [${formatPieValue(entry.value)}]` : ''

    out.push(`${label}  ${coloredBar}${barPad}${pct}${valuePart}`)
  })

  return out.join('\n')
}
