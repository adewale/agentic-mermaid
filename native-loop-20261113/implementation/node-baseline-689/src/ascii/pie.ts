import { terminalArtifact, type TerminalArtifact } from './terminal-artifact.ts'
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
import { pieTotal } from '../pie/semantics.ts'
import { resolvePieVisualConfig } from '../pie/config.ts'
import type { PieVisualConfig } from '../pie/config.ts'
import type { MermaidFrontmatterMap } from '../mermaid-source.ts'
import type { AsciiConfig, AsciiTheme, ColorMode } from './types.ts'
import { TerminalDocument } from './terminal-document.ts'
import { visualWidth } from './width.ts'
import { wrapText } from './wrap.ts'
import { resolveRoleStyle, type InternalStyleFace } from '../scene/style-registry.ts'
import { sanitizeTerminalText } from '../terminal-security.ts'

/** Maximum bar length in characters (the largest slice fills this). */
const MAX_BAR = 30

/** Keep authored line breaks, but never let a decoded Pie escape move the
 * terminal cursor or alter a cell after source admission has completed. */
export function safePieTerminalText(value: string): string {
  return sanitizeTerminalText(value, true).replace(/\r/g, '?')
}

export function renderPieTerminal(
  lines: string[],
  config: AsciiConfig,
  colorMode: ColorMode,
  theme: AsciiTheme,
  frontmatter: MermaidFrontmatterMap = {},
  targetWidth?: number,
  resolvedVisual?: PieVisualConfig,
  styleFace?: InternalStyleFace,
): TerminalArtifact {
  targetWidth ??= config.maxWidth
  const chart = parsePieChart(lines)
  // Frontmatter is already plain title data, not Pie body grammar. Keep it
  // literal; body titles retain the parser's separate entity display field.
  chart.title ??= config.title
  const barChar = config.useAscii ? '#' : '█'

  const total = pieTotal(chart.entries)
  const document = new TerminalDocument()

  const visual = resolvedVisual ?? resolvePieVisualConfig(frontmatter)
  const project = (feature: string, value: unknown, representation: string): void => document.report({
    code: 'TERMINAL_FAMILY_PROJECTION', feature,
    message: `${feature}=${JSON.stringify(value)} is represented by ${representation}; source configuration is retained.`,
  })
  if (chart.entries.length > 0) {
    if (visual.donutHole > 0) project('pie.donutHole', visual.donutHole, 'a proportional bar list without a circular hole')
    if (visual.legendPosition !== 'right') project('pie.legendPosition', visual.legendPosition, 'the complete slice labels beside their bars, in source order')
    if (visual.textPosition !== 0.75) project('pie.textPosition', visual.textPosition, 'percentages in a fixed value column beside the bars')
    for (const [feature, value] of [['pieStrokeColor', visual.strokeColor], ['pieStrokeWidth', visual.strokeWidth]] as const) {
      if (value !== undefined) project(`themeVariables.${feature}`, value, 'solid bar glyphs without separate slice outlines')
    }
    for (const [feature, value] of [['pieOuterStrokeColor', visual.outerStrokeColor], ['pieOuterStrokeWidth', visual.outerStrokeWidth]] as const) {
      if (value !== undefined) project(`themeVariables.${feature}`, value, 'a bar list without an outer circle')
    }
    if (visual.opacity !== undefined && visual.opacity !== 1) project('themeVariables.pieOpacity', visual.opacity, 'opaque per-slice terminal glyphs')
    for (const [feature, value] of [['pieSectionTextSize', visual.sectionTextSize], ['pieLegendTextSize', visual.legendTextSize]] as const) {
      if (value !== undefined) project(`themeVariables.${feature}`, value, 'the terminal font cell size with complete wrapped text')
    }
  }
  if (chart.title && visual.titleTextSize !== undefined) project('themeVariables.pieTitleTextSize', visual.titleTextSize, 'the terminal font cell size with the complete title')
  // `hover` is interaction-only. Terminal output has no hover state, so it
  // must neither select a literal "hover" label nor reserve marker padding.
  const staticHighlight = visual.highlightSlice === 'hover' ? undefined : visual.highlightSlice
  const colors = pieSliceColors(chart.entries.length, {
    accent: theme.accent,
    bg: theme.bg,
    overrides: visual.paletteOverrides,
  })

  const semanticRoles = chart.entries.map(entry => resolveRoleStyle(styleFace, 'pie-slice', {
    category: entry.label,
    value: entry.value,
  }, { includeFallback: false }))
  const hasSemanticCue = semanticRoles.some(role => role?.cue !== undefined && role.cue !== 'none')
  const maxValue = Math.max(...chart.entries.map(e => e.value))
  const valueWidths = chart.entries.map(entry => chart.showData ? visualWidth(`  [${formatPieValue(entry.value)}]`) : 0)
  const markerWidth = staticHighlight !== undefined || hasSemanticCue ? 2 : 0
  const fixedWidth = markerWidth + 2 + MAX_BAR + 2 + 6 + Math.max(0, ...valueWidths)
  const labelBudget = targetWidth ? Math.max(1, targetWidth - fixedWidth) : undefined
  const labelLines = chart.entries.map(entry => wrapText(safePieTerminalText(entry.displayLabel ?? entry.label), labelBudget))
  const labelWidth = Math.max(...labelLines.flat().map(visualWidth))

  if (chart.title) for (const text of wrapText(safePieTerminalText(chart.displayTitle ?? chart.title), targetWidth)) {
    document.line([{ text, role: 'text', color: visual.titleTextColor, textGroup: 'title', owner: { id: 'title', kind: 'label' } }])
  }

  chart.entries.forEach((entry, index) => {
    const fraction = total > 0 ? entry.value / total : 0
    // Bar length proportional to the largest slice, min 1 char for nonzero.
    const barLen = entry.value > 0 ? Math.max(1, Math.round((entry.value / maxValue) * MAX_BAR)) : 0
    const bar = barChar.repeat(barLen)

    const barPad = ' '.repeat(MAX_BAR - barLen + 2)
    const pct = formatPiePercent(fraction).padStart(6)
    const valuePart = chart.showData ? `  [${formatPieValue(entry.value)}]` : ''
    const linesForEntry = labelLines[index]!
    for (let lineIndex = 0; lineIndex < linesForEntry.length - 1; lineIndex++) {
      document.line([{ text: ' '.repeat(markerWidth), kind: 'surface' }, { text: linesForEntry[lineIndex]!, role: 'text', color: visual.legendTextColor, textGroup: 'label', owner: { id: `slice-${index}`, kind: 'node' } }])
    }
    const highlighted = staticHighlight === entry.label
    const cue = semanticRoles[index]?.cue ?? 'none'
    const cueMarker = cue === 'outline' ? (config.useAscii ? '* ' : '◇ ')
      : cue === 'double-line' ? '= '
      : cue === 'pattern' ? (config.useAscii ? '# ' : '░ ')
      : ''
    // The family-owned highlight selector remains authoritative. A brand cue
    // may style any category, but it cannot displace the explicit `>` target.
    const marker = highlighted ? '> ' : cueMarker || (staticHighlight !== undefined || hasSemanticCue ? '  ' : '')
    document.line([
      { text: marker, role: 'arrow', kind: 'marker', owner: { id: `slice-${index}:highlight`, kind: 'label', parent: { id: `slice-${index}`, kind: 'node' } } },
      { text: linesForEntry.at(-1) ?? '', role: 'text', color: visual.legendTextColor, textGroup: 'label', owner: { id: `slice-${index}`, kind: 'node' } },
      { text: ' '.repeat(Math.max(0, labelWidth - visualWidth(linesForEntry.at(-1) ?? '')) + 2), kind: 'surface' },
      { text: bar, role: 'arrow', kind: 'mark', color: colors[index]!, owner: { id: `slice-${index}:bar`, kind: 'plot', parent: { id: `slice-${index}`, kind: 'node' } } },
      { text: barPad, kind: 'surface' },
      { text: pct, role: 'text', color: visual.sectionTextColor, textGroup: 'value', owner: { id: `slice-${index}:value`, kind: 'label', parent: { id: `slice-${index}`, kind: 'node' } } },
      { text: valuePart, role: 'text', color: visual.legendTextColor, textGroup: 'value', owner: { id: `slice-${index}:value`, kind: 'label', parent: { id: `slice-${index}`, kind: 'node' } } },
    ])
  })

  return terminalArtifact(document, { colorMode, theme })
}

