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
// (Unicode) or # (ASCII fallback), colored per-slice with the SAME shared pie
// palette as the SVG renderer (src/pie/palette.ts) — including pie1..pie12
// theme-variable overrides — for cross-format consistency.
// ============================================================================

import { parsePieChart } from '../pie/parser.ts'
import { formatPieValue, formatPiePercent } from '../pie/layout.ts'
import { pieSliceColors } from '../pie/palette.ts'
import { resolvePieVisualConfig } from '../pie/config.ts'
import type { PieVisualConfig } from '../pie/config.ts'
import type { MermaidFrontmatterMap } from '../mermaid-source.ts'
import type { AsciiConfig, AsciiTheme, ColorMode } from './types.ts'
import { colorizeText } from './ansi.ts'
import { padEndToVisualWidth, visualWidth } from './width.ts'
import { wrapText } from './wrap.ts'

/** Maximum bar length in characters (the largest slice fills this). */
const MAX_BAR = 30

export function renderPieAscii(
  lines: string[],
  config: AsciiConfig,
  colorMode: ColorMode,
  theme: AsciiTheme,
  frontmatter: MermaidFrontmatterMap = {},
  targetWidth?: number,
  resolvedVisual?: PieVisualConfig,
): string {
  const chart = parsePieChart(lines)
  const barChar = config.useAscii ? '#' : '█'

  const total = chart.entries.reduce((sum, e) => sum + e.value, 0)
  if (total <= 0) return ''

  const visual = resolvedVisual ?? resolvePieVisualConfig(frontmatter)
  // `hover` is interaction-only. Terminal output has no hover state, so it
  // must neither select a literal "hover" label nor reserve marker padding.
  const staticHighlight = visual.highlightSlice === 'hover' ? undefined : visual.highlightSlice
  const colors = pieSliceColors(chart.entries.length, {
    accent: theme.accent,
    bg: theme.bg,
    overrides: visual.paletteOverrides,
  })

  const maxValue = Math.max(...chart.entries.map(e => e.value))
  const valueWidths = chart.entries.map(entry => chart.showData ? visualWidth(`  [${formatPieValue(entry.value)}]`) : 0)
  const fixedWidth = 2 + MAX_BAR + 2 + 6 + Math.max(0, ...valueWidths)
  const labelBudget = targetWidth ? Math.max(1, targetWidth - fixedWidth) : undefined
  const labelLines = chart.entries.map(entry => wrapText(entry.label, labelBudget))
  const labelWidth = Math.max(...labelLines.flat().map(visualWidth))

  const out: string[] = []
  if (chart.title) out.push(...wrapText(chart.title, targetWidth))

  chart.entries.forEach((entry, index) => {
    const fraction = entry.value / total
    // Bar length proportional to the largest slice, min 1 char for nonzero.
    const barLen = Math.max(1, Math.round((entry.value / maxValue) * MAX_BAR))
    const bar = barChar.repeat(barLen)
    const coloredBar = colorMode === 'none' ? bar : colorizeText(bar, colors[index]!, colorMode)

    const barPad = ' '.repeat(MAX_BAR - barLen + 2)
    const pct = formatPiePercent(fraction).padStart(6)
    const valuePart = chart.showData ? `  [${formatPieValue(entry.value)}]` : ''
    const linesForEntry = labelLines[index]!
    for (let lineIndex = 0; lineIndex < linesForEntry.length - 1; lineIndex++) {
      out.push(padEndToVisualWidth(linesForEntry[lineIndex]!, labelWidth))
    }
    const highlighted = staticHighlight === entry.label
    const marker = highlighted ? '> ' : staticHighlight !== undefined ? '  ' : ''
    const label = padEndToVisualWidth(linesForEntry.at(-1) ?? '', labelWidth)
    out.push(`${marker}${label}  ${coloredBar}${barPad}${pct}${valuePart}`)
  })

  return out.join('\n')
}
