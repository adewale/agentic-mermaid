import type { XYChartSeries } from './types.ts'

// ============================================================================
// XY Chart legend entries — the single source of truth for legend naming and
// order, consumed by BOTH the SVG layout (src/xychart/layout.ts) and the ASCII
// renderer (src/ascii/xychart.ts) so the two surfaces cannot drift
// (xychart-legend.test.ts pins the agreement).
//
// Contract (upstream Mermaid shipped xychart legends 2026-06, PR #7724):
//   - a chart is legend-worthy when it has multiple series OR any named series
//     (naming a single series opts it into the legend, as upstream does);
//   - every series of a legend-worthy chart gets an entry in source order;
//   - unnamed series get deterministic "Bar N" / "Line N" defaults, numbered
//     within their type — the naming the ASCII legend already established.
//     (Upstream omits unnamed series instead; we keep entries for all series
//     so multi-series colors are never ambiguous. Documented divergence, see
//     docs/design/families/xychart.md.)
// ============================================================================

export interface LegendEntry {
  /** Display label: the series name, or "Bar N" / "Line N" for unnamed series. */
  label: string
  /** Series type (drives the swatch shape). */
  type: 'bar' | 'line'
  /** Index within the series' own type (0-based; label numbering is 1-based). */
  seriesIndex: number
  /** Global series index — the color index shared with the plot marks. */
  colorIndex: number
}

/** True when the chart should carry a legend: multiple series, or any series
 *  the author explicitly named. */
export function isLegendWorthy(series: XYChartSeries[]): boolean {
  return series.length > 1 || series.some(s => s.label !== undefined && s.label.length > 0)
}

/** One legend entry per series, in source order. Empty when not legend-worthy. */
export function legendEntries(series: XYChartSeries[]): LegendEntry[] {
  if (!isLegendWorthy(series)) return []
  const entries: LegendEntry[] = []
  let barIndex = 0
  let lineIndex = 0
  for (let index = 0; index < series.length; index++) {
    const s = series[index]!
    const typeIndex = s.type === 'bar' ? barIndex++ : lineIndex++
    const fallback = s.type === 'bar' ? `Bar ${typeIndex + 1}` : `Line ${typeIndex + 1}`
    entries.push({
      label: s.label !== undefined && s.label.length > 0 ? s.label : fallback,
      type: s.type,
      seriesIndex: typeIndex,
      colorIndex: index,
    })
  }
  return entries
}
