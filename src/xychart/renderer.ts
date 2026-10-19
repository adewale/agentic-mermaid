import type { PositionedBar, PositionedXYChart } from './types.ts'
import type { RenderContext, RenderOptions } from '../types.ts'
import { applyTextTransform, resolveRenderStyle } from '../styles.ts'
import { LEGEND_SWATCH_GAP, LEGEND_SWATCH_SIZE, XY_DOT_RADIUS, XY_STYLE_DEFAULTS } from './layout.ts'
import { CHART_ACCENT_FALLBACK } from './colors.ts'
import { categoricalPalette } from '../shared/categorical-palette.ts'
import { contrastTextColor } from '../color-resolver.ts'
import { toHex, tryParseCssColor } from '../shared/color-math.ts'
import { formatBarValue } from './axis-utils.ts'
import type { MarkPaint, SceneDoc, SceneNode } from '../scene/ir.ts'
import * as marks from '../scene/marks.ts'
import { DefaultBackend } from '../scene/backend.ts'
import { tooltipArtwork, tooltipCss } from '../shared/svg-tooltip.ts'
import { resolveRoleStyle, type InternalStyleFace } from '../scene/style-registry.ts'
import { snapshotSvgEmissionRecipe, svgValue as v, type SvgAttribute, type SvgEmissionRecipe, type SvgGeometryField } from '../scene/svg-emission.ts'

// ============================================================================
// XY Chart SVG renderer
//
// Rendered output now tracks Mermaid's own xychart structure more closely:
// fixed chart dimensions, explicit axis lines/ticks, simple grid lines,
// straight line segments, and in-bar data labels for bar plots.
//
// The chart is lowered to the SceneGraph IR (SPEC §3.1): every visual mark
// becomes a scene node carrying semantic fields (role, geometry, paint,
// channels, stable id). renderXYChartSvg() uses DefaultBackend serialization of that scene. Interaction-only
// chrome (hover targets, tooltip groups) uses the same typed emission boundary.
// ============================================================================

/** Halo behind bar value labels, in the surface they sit on. */
const DATA_LABEL_HALO_WIDTH = 3

const CHART_FONT = {
  titleWeight: 500,
  axisTitleWeight: 400,
  labelWeight: 400,
  dotRadius: XY_DOT_RADIUS,
  lineWidth: 3,
} as const

const RECT_FIELDS = ['x', 'y', 'width', 'height'] as const
const LINE_FIELDS = ['x1', 'y1', 'x2', 'y2'] as const
const CIRCLE_FIELDS = ['cx', 'cy', 'r'] as const
function primitive(geometry: readonly SvgGeometryField[], attributes: readonly SvgAttribute[]): SvgEmissionRecipe {
  return snapshotSvgEmissionRecipe({ kind: 'primitive', close: '/>', attributes: [
    ...geometry.map(name => ({ name, value: v.geometry(name) })), ...attributes,
  ] })
}
const GRID_EMISSION = primitive(LINE_FIELDS, [{ name: 'class', value: v.meta('xychart-grid') }])
const RECT_HIT_EMISSION = primitive(RECT_FIELDS, [{ name: 'fill', value: v.paint('fill') }])
const CIRCLE_HIT_EMISSION = primitive(CIRCLE_FIELDS, [{ name: 'fill', value: v.paint('fill') }, { name: 'class', value: v.meta('xychart-hit') }])
const LEGEND_RECT_EMISSION = primitive([...RECT_FIELDS, 'rx', 'ry'], [{ name: 'class', value: v.meta('xychart-legend-swatch') }, { name: 'fill', value: v.paint('fill') }])
const LEGEND_LINE_EMISSION = primitive(LINE_FIELDS, [
  { name: 'class', value: v.meta('xychart-legend-swatch') }, { name: 'stroke', value: v.paint('stroke') },
  { name: 'stroke-width', value: v.paint('strokeWidth') }, { name: 'stroke-linecap', value: v.meta('round') },
])
const LEGEND_DOT_EMISSION = primitive(CIRCLE_FIELDS, [
  { name: 'class', value: v.meta('xychart-legend-dot') }, { name: 'fill', value: v.paint('fill') },
  { name: 'stroke', value: v.paint('stroke') }, { name: 'stroke-width', value: v.paint('strokeWidth') },
])
const BAR_GROUP_EMISSION = snapshotSvgEmissionRecipe({ kind: 'group', attributes: [{ name: 'class', value: v.meta('xychart-bar-group') }] })
const DOT_GROUP_EMISSION = snapshotSvgEmissionRecipe({ kind: 'group', attributes: [{ name: 'class', value: v.meta('xychart-dot-group') }] })
const LEGEND_GROUP_EMISSION = snapshotSvgEmissionRecipe({ kind: 'group', attributes: [{ name: 'class', value: v.meta('xychart-legend') }] })
const AXIS_EMISSIONS = ['x', 'y'].map(axis => ({
  line: primitive(LINE_FIELDS, [{ name: 'class', value: v.meta(`xychart-axis-line xychart-${axis}-axis-line`) }, { name: 'stroke-width', value: v.paint('strokeWidth') }]),
  tick: primitive(LINE_FIELDS, [{ name: 'class', value: v.meta(`xychart-tick xychart-${axis}-tick`) }, { name: 'stroke-width', value: v.paint('strokeWidth') }]),
}))
function fontAttributes(): SvgAttribute[] {
  return [
    { name: 'font-size', value: v.text('fontSize') }, { name: 'font-weight', value: v.text('fontWeight') },
    { name: 'letter-spacing', value: v.text('letterSpacing'), omit: 'zero' },
  ]
}
const AXIS_TITLE_EMISSIONS = ['x', 'y'].map(axis => snapshotSvgEmissionRecipe({ kind: 'text', layout: 'multiline', attributes: [
  { name: 'text-anchor', value: v.text('anchor') }, { name: 'transform', value: { source: 'transform', separator: 'comma' } },
  ...fontAttributes(), { name: 'class', value: v.meta(`xychart-axis-title xychart-${axis}-axis-title`) },
] }))
const TITLE_EMISSION = snapshotSvgEmissionRecipe({ kind: 'text', layout: 'multiline', attributes: [
  { name: 'text-anchor', value: v.text('anchor') }, ...fontAttributes(), { name: 'class', value: v.meta('xychart-title') },
] })
const LEGEND_TEXT_EMISSION = snapshotSvgEmissionRecipe({ kind: 'text', layout: 'multiline', baselineShift: 0, attributes: [
  { name: 'text-anchor', value: v.text('anchor') }, { name: 'dominant-baseline', value: v.meta('middle') },
  ...fontAttributes(), { name: 'class', value: v.meta('xychart-legend-label') },
] })
const AXIS_LABEL_EMISSIONS = ['x', 'y'].map(axis => [false, true].map(middle => snapshotSvgEmissionRecipe({ kind: 'text', layout: 'multiline', baselineShift: middle ? 0 : 0.35, attributes: [
  { name: 'text-anchor', value: v.text('anchor') }, ...(middle ? [{ name: 'dominant-baseline' as const, value: v.meta('middle') }] : []),
  ...fontAttributes(), { name: 'class', value: v.meta(`xychart-label xychart-${axis}-label`) },
] })))

function dataAttributes(value: number, label?: string): SvgAttribute[] {
  return [{ name: 'data-value', value: v.meta(value) }, ...(label ? [{ name: 'data-label' as const, value: v.meta(label), escape: 'xml' as const }] : [])]
}

// Tooltip metrics/markup/CSS live in the shared primitive (also consumed by
// the quadrant renderer); prefix "xychart" reproduces the historical strings
// byte-for-byte.

export function renderXYChartSvg(
  ctx: RenderContext<PositionedXYChart>,
): string {
  return DefaultBackend.render(lowerXYChartScene(ctx), { seed: 0 })
}

/**
 * Lower a positioned XY chart to the SceneGraph IR in canonical mark order.
 */
export function lowerXYChartScene(
  ctx: RenderContext<PositionedXYChart>,
): SceneDoc {
  const { positioned: chart, colors, resolved } = ctx
  const options = resolved.renderOptions
  const font = colors.font ?? 'Inter'
  const transparent = options.transparent ?? false
  const interactive = options.interactive ?? false
  const parts: SceneNode[] = []
  const style = resolveRenderStyle(options, XY_STYLE_DEFAULTS, resolved.styleFace)
  const chartColors = resolveChartColors(chart, style)
  const hasAuthoredSeriesPalette = Boolean(chart.theme.plotColorPalette?.length)

  const maxColorIdx = Math.max(0, ...chart.bars.map(bar => bar.colorIndex), ...chart.lines.map(line => line.colorIndex))
  const svgMeta = buildSvgMetadata(chart)
  const chartStyle = chartStyles(chart, interactive, colors.accent, colors.bg, options, resolved.styleFace)
  parts.push(marks.documentOpen(
    { id: 'prelude', width: chart.width, height: chart.height, colors, transparent, font, hasMonoFont: false, extraCss: chartStyle },
    { kind: 'prelude', width: chart.width, height: chart.height, colors, transparent, font, hasMonoFont: false,
      widthAttribute: svgMeta.width, heightAttribute: svgMeta.height, extraStyle: svgMeta.style,
      attributes: [{ name: 'data-xychart-colors', value: v.meta(maxColorIdx) }, ...svgMeta.attributes],
      children: [{ kind: 'sharedStyle' }, { kind: 'stylesheet', css: chartStyle }],
    },
  ))
  if (colors.shadow) parts.push(marks.definitions({ id: 'shadow-defs' }, { kind: 'resources', layout: 'inline', resources: [{ kind: 'shadow', colors }] }))
  if (svgMeta.title) parts.push(marks.documentContent({ id: 'acc-title', role: 'chrome', nonPaint: 'accessibility' }, { kind: 'documentText', element: 'title', ...svgMeta.title }))
  if (svgMeta.description) parts.push(marks.documentContent({ id: 'acc-desc', role: 'chrome', nonPaint: 'accessibility' }, { kind: 'documentText', element: 'desc', ...svgMeta.description }))

  // Grid lines are always derived from the value (y) axis tick values, in
  // both orientations; the tick value itself is not carried through layout,
  // so the stable id falls back to the tick index.
  const gridPaint: MarkPaint = {
    stroke: chartColors.gridStroke,
    strokeWidth: '1',
    ...(style.edgeStrokeColor ? { opacity: '0.25' } : {}),
  }
  chart.gridLines.forEach((gridLine, index) => {
    parts.push(marks.shape({
      id: `grid:y:${index}`,
      role: 'grid',
      geometry: { kind: 'line', x1: rn(gridLine.x1), y1: rn(gridLine.y1), x2: rn(gridLine.x2), y2: rn(gridLine.y2) },
      paint: gridPaint,
    },
      GRID_EMISSION,
    ))
  })

  lowerAxis(parts, chart.xAxis, 'x', chartColors.xAxisLineColor, chartColors.xAxisTickColor)
  lowerAxis(parts, chart.yAxis, 'y', chartColors.yAxisLineColor, chartColors.yAxisTickColor)

  // Normalization basis for the `value` channel: the largest absolute data
  // value across every series (cheap, deterministic).
  const maxAbsValue = Math.max(
    0,
    ...chart.bars.map(bar => Math.abs(bar.value)),
    ...chart.lines.flatMap(line => line.points.map(point => Math.abs(point.value))),
  )
  const normalized = (value: number): number | undefined =>
    maxAbsValue > 0 ? value / maxAbsValue : undefined

  const barOverlay: SceneNode[] = []
  const barSeriesCount = new Map<number, number>()
  const seriesPalette = resolveSeriesPalette(chart, colors.accent, colors.bg)
  const barFills = new Map<PositionedBar, string>()
  for (const bar of chart.bars) {
    const catIndex = barSeriesCount.get(bar.seriesIndex) ?? 0
    barSeriesCount.set(bar.seriesIndex, catIndex + 1)
    const barId = `bar:${bar.seriesIndex}:${bar.label ?? catIndex}`
    const channels = { category: `bar-${bar.seriesIndex}`, value: normalized(bar.value) }
    const roleStyle = resolveRoleStyle(resolved.styleFace, 'bar', channels, { includeFallback: false })
    const paletteFill = `var(--xychart-color-${bar.colorIndex})`
    const fill = hasAuthoredSeriesPalette ? paletteFill : roleStyle?.fillColor ?? paletteFill
    barFills.set(bar, hasAuthoredSeriesPalette ? seriesPalette.concrete(bar.colorIndex) : roleStyle?.fillColor ?? seriesPalette.concrete(bar.colorIndex))
    const stroke = roleStyle?.strokeColor ?? roleStyle?.borderColor
    const strokeWidth = roleStyle?.lineWidth
    const inlineStyle = roleStyleAttributes(!hasAuthoredSeriesPalette && roleStyle?.fillColor !== undefined, stroke !== undefined, strokeWidth !== undefined)
    parts.push(marks.shape({
      id: barId,
      role: 'bar',
      geometry: { kind: 'rect', x: rn(bar.x), y: rn(bar.y), width: rn(bar.width), height: rn(bar.height) },
      paint: {
        fill,
        ...(stroke ? { stroke } : {}),
        ...(strokeWidth !== undefined ? { strokeWidth: String(strokeWidth) } : {}),
      },
      channels,
    },
      primitive(RECT_FIELDS, [{ name: 'class', value: v.meta(`xychart-bar xychart-color-${bar.colorIndex}`) }, ...inlineStyle, ...dataAttributes(bar.value, bar.label)]),
    ))

    if (interactive) {
      const tipText = formatBarValue(bar.value)
      const tipTitle = bar.label ? `${bar.label}: ${tipText}` : tipText
      const owner = { id: barId, role: 'bar' as const }
      barOverlay.push(marks.group({ id: `tooltip:${barId}`, role: 'chrome', owner,
        emission: BAR_GROUP_EMISSION, join: '', children: [
          { indent: 0, node: marks.shape({ id: `${barId}:hit`, role: 'chrome', owner,
            geometry: { kind: 'rect', x: rn(bar.x), y: rn(bar.y), width: rn(bar.width), height: rn(bar.height) }, paint: { fill: 'transparent' },
          }, RECT_HIT_EMISSION) },
          { indent: 0, node: marks.documentContent({ id: `${barId}:title`, role: 'chrome', nonPaint: 'interaction-metadata' }, { kind: 'documentText', element: 'title', text: tipTitle }) },
          { indent: 0, node: tooltipArtwork('xychart', bar.tooltip, `${barId}:tooltip`, owner) },
        ],
      }))
    }
  }

  for (const line of chart.lines) {
    // A single sample has no relationship to route.  The graphical SVG has
    // historically treated its one-command path as invisible, while the
    // terminal renderer still draws the sample directly from the semantic
    // series.  Do not manufacture an invalid one-point Scene connector.
    if (line.points.length < 2) continue
    const d = polylinePath(line.points)
    const channels = { category: `line-${line.seriesIndex}` }
    const roleStyle = resolveRoleStyle(resolved.styleFace, 'series', channels, { includeFallback: false })
    const paletteStroke = `var(--xychart-color-${line.colorIndex})`
    const stroke = hasAuthoredSeriesPalette ? paletteStroke : roleStyle?.strokeColor ?? roleStyle?.borderColor ?? paletteStroke
    const strokeWidth = roleStyle?.lineWidth ?? style.lineWidth
    const inlineStyle = roleStyleAttributes(false, !hasAuthoredSeriesPalette && (roleStyle?.strokeColor ?? roleStyle?.borderColor) !== undefined, roleStyle?.lineWidth !== undefined)
    parts.push(marks.connector({
      id: `series:line-${line.seriesIndex}`,
      role: 'series',
      geometry: { kind: 'path', d, points: line.points },
      lineStyle: 'solid',
      paint: { stroke, strokeWidth: String(strokeWidth) },
      channels,
    },
      primitive(['d'], [{ name: 'class', value: v.meta(`xychart-line xychart-color-${line.colorIndex}`) }, ...inlineStyle]),
    ))
  }

  // Mermaid 11.16 line-point labels are semantic chart content, not hover
  // chrome. A label therefore forces a visible point mark even when the
  // interactive tooltip layer is disabled.
  for (const line of chart.lines) {
    line.points.forEach((point, pointIndex) => {
      if (point.textLabel === undefined) return
      const at = point.textPosition
      const position = at?.placement ?? (chart.horizontal ? 'right' : 'above')
      const x = at?.x ?? point.x + (chart.horizontal ? 8 : 0)
      const y = at?.y ?? point.y + (chart.horizontal ? 4 : -8)
      const anchor = at?.anchor ?? (chart.horizontal ? 'start' : 'middle')
      parts.push(marks.shape({
        id: `point-label-dot:${line.seriesIndex}:${pointIndex}`, role: 'point',
        geometry: { kind: 'circle', cx: rn(point.x), cy: rn(point.y), r: CHART_FONT.dotRadius },
        paint: { fill: `var(--xychart-color-${line.colorIndex})`, stroke: 'var(--bg)', strokeWidth: '1' },
        channels: { category: `line-${line.seriesIndex}`, value: normalized(point.value) },
      }, primitive(CIRCLE_FIELDS, [{ name: 'class', value: v.meta(`xychart-dot xychart-color-${line.colorIndex}`) }, ...dataAttributes(point.value)])))
      parts.push(marks.text({
        id: `point-label:${line.seriesIndex}:${pointIndex}`, role: 'label', text: point.textBlock?.text ?? point.textLabel, block: point.textBlock,
        x, y, fontSize: 12, fontWeight: style.nodeLabelFontWeight, letterSpacing: style.nodeLetterSpacing, display: 'literal', anchor,
        paint: { fill: `var(--xychart-color-${line.colorIndex})` },
        channels: { category: `line-${line.seriesIndex}`, value: normalized(point.value) },
      }, { kind: 'text', layout: 'multiline', positionFormat: 'round2', baselineShift: at ? 0.35 : 0, attributes: [
        { name: 'class', value: v.meta(`xychart-point-label xychart-color-${line.colorIndex}`) },
        { name: 'data-label-position', value: v.meta(position) }, { name: 'text-anchor', value: v.text('anchor') },
        ...fontAttributes(), { name: 'fill', value: v.paint('fill') },
      ] }))
    })
  }

  const dotOverlay: SceneNode[] = []
  if (interactive) {
    for (const line of chart.lines) {
      line.points.forEach((point, pointIndex) => {
        const pointId = `point:line-${line.seriesIndex}:${point.label ?? pointIndex}`
        const tipText = formatBarValue(point.value)
        const tipTitle = point.label ? `${point.label}: ${tipText}` : tipText
        // The visible dot is a semantic point mark; the enlarged hit circle
        // and the tooltip block remain typed interaction chrome.
        dotOverlay.push(marks.group({
          id: `point-group:line-${line.seriesIndex}:${point.label ?? pointIndex}`,
          role: 'chrome',
          emission: DOT_GROUP_EMISSION,
          join: '',
          children: [
            {
              node: marks.shape({ id: `hit:${pointId}`, role: 'chrome', owner: { id: pointId, role: 'point' },
                geometry: { kind: 'circle', cx: rn(point.x), cy: rn(point.y), r: CHART_FONT.dotRadius * 3 }, paint: { fill: 'transparent' },
              },
                CIRCLE_HIT_EMISSION),
              indent: 0,
            },
            {
              node: marks.shape({
                id: pointId,
                role: 'point',
                geometry: { kind: 'circle', cx: rn(point.x), cy: rn(point.y), r: CHART_FONT.dotRadius },
                paint: { fill: `var(--xychart-color-${line.colorIndex})`, stroke: 'var(--bg)', strokeWidth: '2' },
                channels: { category: `line-${line.seriesIndex}`, value: normalized(point.value) },
              },
                primitive(CIRCLE_FIELDS, [{ name: 'class', value: v.meta(`xychart-dot xychart-color-${line.colorIndex}`) }, ...dataAttributes(point.value, point.label)])),
              indent: 0,
            },
            {
              node: marks.documentContent({ id: `title:${pointId}`, role: 'chrome', nonPaint: 'interaction-metadata' }, { kind: 'documentText', element: 'title', text: tipTitle }),
              indent: 0,
            },
            {
              node: tooltipArtwork('xychart', point.tooltip, `tooltip:${pointId}`, { id: pointId, role: 'point' }),
              indent: 0,
            },
          ],
        }))
      })
    }
  }

  const labelSeriesCount = new Map<number, number>()
  for (const label of chart.dataLabels) {
    const text = label.block?.text ?? applyTextTransform(label.text, style.nodeTextTransform)
    const catIndex = labelSeriesCount.get(label.bar.seriesIndex) ?? 0
    labelSeriesCount.set(label.bar.seriesIndex, catIndex + 1)
    // Outside labels sit on the page, whose text contrast the palette contract
    // certifies. Inside labels sit on the bar, so their ink is chosen against
    // that bar's own fill.
    const onBar = chart.theme.dataLabelColor === undefined && label.placement === 'inside'
      ? inkOnFill(barFills.get(label.bar))
      : undefined
    const fill = chart.theme.dataLabelColor ?? onBar ?? chartColors.labelColor
    // A line series can cross a value label; a halo in the label's own surface
    // (its bar inside, the page outside) knocks the line out behind the glyphs.
    const halo = label.placement === 'inside' ? barFills.get(label.bar) ?? 'var(--bg)' : 'var(--bg)'
    parts.push(marks.text({
      id: `label:bar:${label.bar.seriesIndex}:${label.bar.label ?? catIndex}`,
      role: 'label',
      text,
      block: label.block,
      x: label.x,
      y: label.y,
      fontSize: label.fontSize, fontWeight: style.nodeLabelFontWeight, letterSpacing: style.nodeLetterSpacing, display: 'literal',
      anchor: label.anchor,
      paint: { fill, stroke: halo, strokeWidth: String(DATA_LABEL_HALO_WIDTH), strokeLinejoin: 'round', paintOrder: 'stroke' },
      // Sketch looks halo text with the page color over hatched or washed
      // bars, so an ink chosen against the bar would sit on the page instead.
      ...(onBar ? { pageFill: chartColors.labelColor } : {}),
      channels: { category: `bar-${label.bar.seriesIndex}`, value: normalized(label.bar.value) },
    },
      { kind: 'text', layout: 'direct', attributes: [
        { name: 'x', value: v.text('x'), format: 'round2' }, { name: 'y', value: v.text('y'), format: 'round2' },
        { name: 'text-anchor', value: v.text('anchor') },
        ...(label.dominantBaseline ? [{ name: 'dominant-baseline' as const, value: v.meta(label.dominantBaseline) }] : []),
        ...fontAttributes(), { name: 'fill', value: v.paint('fill'), escape: 'xml' },
        { name: 'stroke', value: v.paint('stroke'), escape: 'xml' }, { name: 'stroke-width', value: v.paint('strokeWidth') },
        { name: 'stroke-linejoin', value: v.paint('strokeLinejoin') }, { name: 'paint-order', value: v.paint('paintOrder') },
        { name: 'class', value: v.meta('xychart-data-label') }, { name: 'data-literal-text', value: v.meta(true) },
      ] },
    ))
  }

  lowerAxisLabels(parts, chart.xAxis.ticks, chart.xAxis.config.labelFontSize, 'x', style, chartColors.xAxisLabelColor)
  lowerAxisLabels(parts, chart.yAxis.ticks, chart.yAxis.config.labelFontSize, 'y', style, chartColors.yAxisLabelColor)

  if (chart.xAxis.title) {
    const title = chart.xAxis.title
    const text = title.block?.text ?? applyTextTransform(title.text, style.edgeTextTransform)
    const rotation = title.rotate ? { kind: 'rotate' as const, angle: title.rotate, cx: title.x, cy: title.y } : undefined
    parts.push(marks.text({
      id: 'axis:x:title',
      role: 'axis',
      text,
      block: title.block,
      x: title.x,
      y: title.y,
      fontSize: chart.xAxis.config.titleFontSize, fontWeight: style.edgeLabelFontWeight, letterSpacing: style.edgeLetterSpacing, display: 'literal',
      anchor: 'middle',
      paint: { fill: chartColors.xAxisTitleColor },
      transform: rotation,
    },
      AXIS_TITLE_EMISSIONS[0]!,
    ))
  }

  if (chart.yAxis.title) {
    const title = chart.yAxis.title
    const text = title.block?.text ?? applyTextTransform(title.text, style.edgeTextTransform)
    const rotation = title.rotate ? { kind: 'rotate' as const, angle: title.rotate, cx: title.x, cy: title.y } : undefined
    parts.push(marks.text({
      id: 'axis:y:title',
      role: 'axis',
      text,
      block: title.block,
      x: title.x,
      y: title.y,
      fontSize: chart.yAxis.config.titleFontSize, fontWeight: style.edgeLabelFontWeight, letterSpacing: style.edgeLetterSpacing, display: 'literal',
      anchor: 'middle',
      paint: { fill: chartColors.yAxisTitleColor },
      transform: rotation,
    },
      AXIS_TITLE_EMISSIONS[1]!,
    ))
  }

  if (chart.title) {
    const title = chart.title.text
    parts.push(marks.text({
      id: 'title',
      role: 'title',
      text: title,
      block: chart.title.block,
      x: chart.title.x,
      y: chart.title.y,
      fontSize: chart.config.titleFontSize, fontWeight: style.groupHeaderFontWeight, letterSpacing: style.groupLetterSpacing, display: 'literal',
      anchor: 'middle',
      paint: { fill: chartColors.titleColor },
    },
      TITLE_EMISSION,
    ))
  }

  // Right-side legend (layout has already reserved its space inside the
  // canvas; an empty legend array means the chart is not legend-worthy, the
  // config hides it, or the column was dropped rather than clipped).
  if (chart.legend.length > 0) {
    const legendChildren: Array<{ node: SceneNode; indent: number }> = []
    for (const item of chart.legend) {
      const cy = item.y + Math.max(LEGEND_SWATCH_SIZE, item.block?.height ?? 0) / 2
      if (item.type === 'bar') {
        legendChildren.push({
          node: marks.shape({
            id: `legend:swatch:${item.colorIndex}`,
            role: 'legend',
            geometry: { kind: 'rect', x: rn(item.x), y: rn(item.y), width: LEGEND_SWATCH_SIZE, height: LEGEND_SWATCH_SIZE, rx: 2, ry: 2 },
            paint: { fill: `var(--xychart-color-${item.colorIndex})` },
            channels: { category: `bar-${item.seriesIndex}` },
          },
            LEGEND_RECT_EMISSION),
          indent: 2,
        })
      } else {
        // Line swatch: a stroke sample plus its center dot (the LegendItem
        // contract: rect for bar, line+dot for line).
        legendChildren.push({
          node: marks.shape({
            id: `legend:swatch:${item.colorIndex}`,
            role: 'legend',
            geometry: { kind: 'line', x1: rn(item.x), y1: rn(cy), x2: rn(item.x + LEGEND_SWATCH_SIZE), y2: rn(cy) },
            paint: { stroke: `var(--xychart-color-${item.colorIndex})`, strokeWidth: String(CHART_FONT.lineWidth) },
            channels: { category: `line-${item.seriesIndex}` },
          },
            LEGEND_LINE_EMISSION),
          indent: 2,
        })
        legendChildren.push({
          node: marks.shape({
            id: `legend:dot:${item.colorIndex}`,
            role: 'legend',
            geometry: { kind: 'circle', cx: rn(item.x + LEGEND_SWATCH_SIZE / 2), cy: rn(cy), r: 2.5 },
            paint: { fill: `var(--xychart-color-${item.colorIndex})`, stroke: 'var(--bg)', strokeWidth: '1' },
            channels: { category: `line-${item.seriesIndex}` },
          },
            LEGEND_DOT_EMISSION),
          indent: 2,
        })
      }
      const label = item.block?.text ?? applyTextTransform(item.label, style.nodeTextTransform)
      const labelX = item.x + LEGEND_SWATCH_SIZE + LEGEND_SWATCH_GAP
      legendChildren.push({
        node: marks.text({
          id: `legend:label:${item.colorIndex}`,
          role: 'legend',
          text: label,
          block: item.block,
          x: rn(labelX),
          y: rn(cy),
          fontSize: chart.config.legendFontSize, fontWeight: style.nodeLabelFontWeight, letterSpacing: style.nodeLetterSpacing, display: 'literal',
          anchor: 'start',
          paint: { fill: chartColors.legendTextColor },
        },
          LEGEND_TEXT_EMISSION),
        indent: 2,
      })
    }
    parts.push(marks.group({
      id: 'legend',
      role: 'legend',
      emission: LEGEND_GROUP_EMISSION,
      children: legendChildren,
    }))
  }

  for (const group of barOverlay) parts.push(group)
  for (const group of dotOverlay) parts.push(group)

  parts.push(marks.documentClose())

  return { family: 'xychart', width: chart.width, height: chart.height, colors, transparent, parts }
}

function lowerAxis(
  parts: SceneNode[],
  axis: PositionedXYChart['xAxis'],
  axisName: 'x' | 'y',
  lineColor: string,
  tickColor: string,
): void {
  if (axis.config.showAxisLine) {
    parts.push(marks.shape({
      id: `axis:${axisName}:line`,
      role: 'axis',
      geometry: { kind: 'line', x1: rn(axis.line.x1), y1: rn(axis.line.y1), x2: rn(axis.line.x2), y2: rn(axis.line.y2) },
      paint: { stroke: lineColor, strokeWidth: String(axis.config.axisLineWidth) },
    },
      AXIS_EMISSIONS[axisName === 'x' ? 0 : 1]!.line,
    ))
  }

  if (!axis.config.showTick) return
  for (const tick of axis.ticks) {
    parts.push(marks.shape({
      id: `axis:${axisName}:tick:${tick.label}`,
      role: 'axis',
      geometry: { kind: 'line', x1: rn(tick.x), y1: rn(tick.y), x2: rn(tick.tx), y2: rn(tick.ty) },
      paint: { stroke: tickColor, strokeWidth: String(axis.config.tickWidth) },
    },
      AXIS_EMISSIONS[axisName === 'x' ? 0 : 1]!.tick,
    ))
  }
}

function lowerAxisLabels(
  parts: SceneNode[],
  ticks: PositionedXYChart['xAxis']['ticks'],
  fontSize: number,
  axisName: 'x' | 'y',
  style: ReturnType<typeof resolveRenderStyle>,
  fill: string,
): void {
  for (const tick of ticks) {
    const label = tick.block?.text ?? applyTextTransform(tick.label, style.edgeTextTransform)
    parts.push(marks.text({
      id: `axis:${axisName}:label:${tick.label}`,
      role: 'axis',
      text: label,
      block: tick.block,
      x: tick.labelX,
      y: tick.labelY,
      fontSize, fontWeight: style.nodeLabelFontWeight, letterSpacing: style.nodeLetterSpacing, display: 'literal',
      anchor: tick.textAnchor,
      paint: { fill },
    },
      AXIS_LABEL_EMISSIONS[axisName === 'x' ? 0 : 1]![tick.textAnchor === 'end' ? 1 : 0]!,
    ))
  }
}

/** Theme/renderStyle color cascade shared by the style block and mark paints. */
interface ResolvedChartColors {
  gridStroke: string
  titleColor: string
  labelColor: string
  axisTitleColor: string
  xAxisLabelColor: string
  yAxisLabelColor: string
  xAxisTickColor: string
  yAxisTickColor: string
  xAxisLineColor: string
  yAxisLineColor: string
  xAxisTitleColor: string
  yAxisTitleColor: string
  legendTextColor: string
}

function resolveChartColors(
  chart: PositionedXYChart,
  renderStyle: ReturnType<typeof resolveRenderStyle>,
): ResolvedChartColors {
  const themeOverrides = chart.theme
  return {
    gridStroke: renderStyle.edgeStrokeColor ?? 'color-mix(in srgb, var(--fg) 14%, transparent)',
    titleColor: themeOverrides.titleColor ?? renderStyle.groupTextColor ?? renderStyle.nodeTextColor ?? 'var(--_text)',
    labelColor: renderStyle.nodeTextColor ?? 'var(--_text)',
    axisTitleColor: renderStyle.edgeTextColor ?? renderStyle.nodeTextColor ?? 'var(--_text)',
    xAxisLabelColor: themeOverrides.xAxisLabelColor ?? renderStyle.nodeTextColor ?? 'var(--_text)',
    yAxisLabelColor: themeOverrides.yAxisLabelColor ?? renderStyle.nodeTextColor ?? 'var(--_text)',
    xAxisTickColor: themeOverrides.xAxisTickColor ?? renderStyle.groupTextColor ?? 'var(--_text-sec)',
    yAxisTickColor: themeOverrides.yAxisTickColor ?? renderStyle.groupTextColor ?? 'var(--_text-sec)',
    xAxisLineColor: themeOverrides.xAxisLineColor ?? renderStyle.edgeStrokeColor ?? 'var(--_text-sec)',
    yAxisLineColor: themeOverrides.yAxisLineColor ?? renderStyle.edgeStrokeColor ?? 'var(--_text-sec)',
    xAxisTitleColor: themeOverrides.xAxisTitleColor ?? renderStyle.edgeTextColor ?? renderStyle.nodeTextColor ?? 'var(--_text)',
    yAxisTitleColor: themeOverrides.yAxisTitleColor ?? renderStyle.edgeTextColor ?? renderStyle.nodeTextColor ?? 'var(--_text)',
    legendTextColor: themeOverrides.legendTextColor ?? renderStyle.nodeTextColor ?? 'var(--_text)',
  }
}

/** Series colors by color index: the CSS value each `--xychart-color-N`
 * carries, and the concrete color it resolves to. A small palette keeps
 * `var(--accent)` in slot zero so consumers can retint it, unless the palette
 * contract had to repair the accent (for example, an accent that vanishes
 * against the background). */
function resolveSeriesPalette(
  chart: PositionedXYChart,
  themeAccent: string | undefined,
  bgColor: string | undefined,
): { css: (index: number) => string; concrete: (index: number) => string } {
  const accentHex = themeAccent ?? CHART_ACCENT_FALLBACK
  const explicitPalette = chart.theme.plotColorPalette
  const maxIndex = Math.max(0, ...chart.bars.map(bar => bar.colorIndex), ...chart.lines.map(line => line.colorIndex))
  const derivedPalette = categoricalPalette(maxIndex + 1, { accent: accentHex, bg: bgColor })
  const concrete = (index: number): string => explicitPalette && explicitPalette.length > 0
    ? explicitPalette[index % explicitPalette.length]!
    : derivedPalette[index]!
  return {
    concrete,
    css: index => !(explicitPalette && explicitPalette.length > 0) && index === 0 && derivedPalette.length <= 6 && derivedPalette[0] === accentHex
      ? `var(--accent, ${CHART_ACCENT_FALLBACK})`
      : concrete(index),
  }
}

/** Black or white, whichever reads better on a concrete fill; undefined when
 * the fill cannot be resolved to sRGB. */
function inkOnFill(fill: string | undefined): string | undefined {
  const rgba = fill === undefined ? null : tryParseCssColor(fill)
  return rgba && rgba[3] === 1 ? contrastTextColor(toHex(rgba[0], rgba[1], rgba[2])) : undefined
}

function chartStyles(
  chart: PositionedXYChart,
  interactive: boolean,
  themeAccent?: string,
  bgColor?: string,
  options: RenderOptions = {},
  styleFace?: Readonly<InternalStyleFace>,
): string {
  const renderStyle = resolveRenderStyle(options, XY_STYLE_DEFAULTS, styleFace)
  const cc = resolveChartColors(chart, renderStyle)
  const colorIndices = new Set<number>()
  for (const bar of chart.bars) colorIndices.add(bar.colorIndex)
  for (const line of chart.lines) colorIndices.add(line.colorIndex)

  const colorVarDefs: string[] = []
  const seriesPalette = resolveSeriesPalette(chart, themeAccent, bgColor)
  for (const index of [...colorIndices].sort((a, b) => a - b)) {
    colorVarDefs.push(`    --xychart-color-${index}: ${seriesPalette.css(index)};`)
  }

  const seriesRules: string[] = []
  for (const index of [...colorIndices].sort((a, b) => a - b)) {
    const color = `var(--xychart-color-${index})`
    seriesRules.push(`  .xychart-bar.xychart-color-${index} { fill: ${color}; }`)
    seriesRules.push(`  path.xychart-color-${index}, line.xychart-color-${index} { stroke: ${color}; }`)
    seriesRules.push(`  circle.xychart-color-${index} { fill: ${color}; }`)
  }

  const tipRules = interactive ? tooltipCss('xychart', ['xychart-bar-group', 'xychart-dot-group']) : ''

  const colorVarsBlock = colorVarDefs.length > 0 ? `\n  svg {\n${colorVarDefs.join('\n')}\n  }` : ''

  const extraThemeCss = chart.theme.themeCss ? `\n${chart.theme.themeCss}\n` : ''
  return `
  .xychart-grid { stroke: ${cc.gridStroke}; stroke-width: 1${renderStyle.edgeStrokeColor ? '; opacity: 0.25' : ''}; }
  .xychart-axis-line { fill: none; }
  .xychart-tick { fill: none; }
  .xychart-x-axis-line { stroke: ${cc.xAxisLineColor}; }
  .xychart-y-axis-line { stroke: ${cc.yAxisLineColor}; }
  .xychart-x-tick { stroke: ${cc.xAxisTickColor}; }
  .xychart-y-tick { stroke: ${cc.yAxisTickColor}; }
  .xychart-bar { stroke: none; }
  .xychart-line { fill: none; stroke-width: ${renderStyle.lineWidth}; stroke-linecap: round; stroke-linejoin: round; }
  .xychart-dot { stroke: var(--bg); stroke-width: 2; }
  .xychart-label { fill: ${cc.labelColor}; }
  .xychart-x-label { fill: ${cc.xAxisLabelColor}; }
  .xychart-y-label { fill: ${cc.yAxisLabelColor}; }
  .xychart-axis-title { fill: ${cc.axisTitleColor}; }
  .xychart-x-axis-title { fill: ${cc.xAxisTitleColor}; }
  .xychart-y-axis-title { fill: ${cc.yAxisTitleColor}; }
  .xychart-title { fill: ${cc.titleColor}; }
  .xychart-data-label { pointer-events: none; }${chart.legend.length > 0 ? `\n  .xychart-legend-label { fill: ${cc.legendTextColor}; }` : ''}${colorVarsBlock}
${seriesRules.join('\n')}${tipRules}${extraThemeCss}
`
}

function roleStyleAttributes(fill: boolean, stroke: boolean, width: boolean): SvgAttribute[] {
  if (!fill && !stroke && !width) return []
  return [{ name: 'style', escape: 'xml', value: { source: 'style', declarations: [
    ...(fill ? [{ property: 'fill' as const, value: v.paint('fill') }] : []),
    ...(stroke ? [{ property: 'stroke' as const, value: v.paint('stroke') }] : []),
    ...(width ? [{ property: 'stroke-width' as const, value: v.paint('strokeWidth') }] : []),
  ] } }]
}

function polylinePath(points: Array<{ x: number; y: number }>): string {
  if (points.length === 0) return ''
  let path = `M${r(points[0]!.x)},${r(points[0]!.y)}`
  for (let i = 1; i < points.length; i++) {
    path += ` L${r(points[i]!.x)},${r(points[i]!.y)}`
  }
  return path
}

/** Round to the same 2-decimal grid the crisp serializer uses, so semantic
 *  geometry numbers String()-equal their crisp attributes. */
function rn(value: number): number {
  return Math.round(value * 100) / 100
}

function r(value: number): string {
  return rn(value).toString()
}

function buildSvgMetadata(chart: PositionedXYChart): {
  width: string
  height: string
  style?: string
  attributes: readonly SvgAttribute[]
  title?: { domId: string; text: string }
  description?: { domId: string; text: string }
} {
  const svgId = `mermaid-${hashChart(chart)}`
  const accTitleId = chart.accessibility?.title ? `chart-title-${svgId}` : undefined
  const accDescId = chart.accessibility?.description ? `chart-desc-${svgId}` : undefined
  const responsiveWidth = chart.config.useWidth ?? chart.width
  const width = chart.config.useMaxWidth ? '100%' : String(responsiveWidth)
  const height = chart.config.useMaxWidth
    ? '100%'
    : String(Math.round(chart.height * (responsiveWidth / Math.max(1, chart.width))))
  const style = chart.config.useMaxWidth ? `max-width:${responsiveWidth}px` : undefined

  return {
    width, height, style,
    attributes: [
      { name: 'id', value: v.meta(svgId) }, { name: 'class', value: v.meta('xychart') },
      ...((accTitleId || accDescId) ? [{ name: 'role' as const, value: v.meta('img') }] : []),
      { name: 'aria-roledescription', value: v.meta('xychart') },
      ...(accTitleId ? [{ name: 'aria-labelledby' as const, value: v.meta(accTitleId) }] : []),
      ...(accDescId ? [{ name: 'aria-describedby' as const, value: v.meta(accDescId) }] : []),
    ],
    title: chart.accessibility?.title ? { domId: accTitleId!, text: chart.accessibility.title } : undefined,
    description: chart.accessibility?.description ? { domId: accDescId!, text: chart.accessibility.description } : undefined,
  }
}

function hashChart(chart: PositionedXYChart): string {
  const text = [
    chart.width,
    chart.height,
    chart.title?.text ?? '',
    chart.accessibility?.title ?? '',
    chart.accessibility?.description ?? '',
    chart.bars.length,
    chart.lines.length,
  ].join('|')
  let hash = 5381
  for (let i = 0; i < text.length; i++) {
    hash = ((hash << 5) + hash) ^ text.charCodeAt(i)
  }
  return Math.abs(hash >>> 0).toString(36)
}
