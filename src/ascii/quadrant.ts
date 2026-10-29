import { terminalArtifact, serializeTerminalArtifact, type TerminalArtifact } from './terminal-artifact.ts'
// ============================================================================
// ASCII renderer — Quadrant chart
//
// Renders a bordered SQUARE grid divided into four quadrants. Quadrant labels
// sit in their regions, points are plotted at scaled positions marked ●
// (Unicode) / * (ASCII), and a legend below lists every point's coordinates.
//
// Mermaid quadrant numbering: 1=top-right, 2=top-left, 3=bottom-left,
// 4=bottom-right. Normalized coords (x,y) ∈ [0,1]², y grows UP. Scaling
// follows the xychart convention: round(t * (extent - 1)).
// ============================================================================

import { parseQuadrantChart } from '../quadrant/parser.ts'
import { resolvePointVisual } from '../quadrant/point-style.ts'
import type { AsciiConfig, AsciiTheme, ColorMode } from './types.ts'
import { TerminalDocument, measuredText } from './terminal-document.ts'
import { visualWidth } from './width.ts'
import { wrapText } from './wrap.ts'
import { oneRowDisplayText as oneRow } from './multiline-utils.ts'
import { displayText } from '../multiline-utils.ts'

/** Interior plot dimensions in cells (odd so the dividers land cleanly). */
const GRID_W = 41
const GRID_H = 21

export function renderQuadrantTerminal(
  lines: string[],
  config: AsciiConfig,
  colorMode: ColorMode,
  theme: AsciiTheme,
  targetWidth?: number,
): TerminalArtifact {
  targetWidth ??= config.maxWidth
  const chart = parseQuadrantChart(lines)
  const pointVisuals = chart.points.map(point => resolvePointVisual(point, chart.classDefs, { radius: 5 }))
  const pointMarkers = pointVisuals.map(point => {
    const hollow = point.fill?.trim().toLowerCase() === 'none' || point.fill?.trim().toLowerCase() === 'transparent'
    return {
      glyph: hollow ? (config.useAscii ? 'o' : '○') : (config.useAscii ? '*' : '●'),
      color: (hollow ? point.stroke : point.fill) ?? pointColor(theme),
    }
  })

  // Interior grid (rows × cols of single characters). Row 0 = top.
  const grid = new TerminalDocument(GRID_W + 2, GRID_H + 2)
  const frameOwner = { id: 'quadrant-plot', kind: 'plot' as const }
  const stroke = (col: number, row: number, ports: number): void => grid.stroke(col, row, ports, { ascii: config.useAscii, role: 'border', owner: frameOwner })
  const midCol = Math.floor(GRID_W / 2)
  const midRow = Math.floor(GRID_H / 2)

  // Dividers.
  for (let r = 0; r < GRID_H; r++) stroke(midCol + 1, r + 1, 5)
  for (let c = 0; c < GRID_W; c++) stroke(c + 1, midRow + 1, 10)

  // Points — scaled into the grid. x grows right, y grows up (invert row).
  // Plotted first so quadrant labels (decorative) never clobber a data point.
  const occupied = new Set<string>()
  chart.points.forEach((p, index) => {
    const col = Math.round(p.x * (GRID_W - 1))
    const row = Math.round((1 - p.y) * (GRID_H - 1))
    const marker = pointMarkers[index]!
    grid.put(col + 1, row + 1, marker.glyph, { role: 'arrow', kind: 'marker', color: marker.color, owner: { id: `point-${index}`, kind: 'node' } })
    occupied.add(`${row},${col}`)
  })

  // Quadrant labels. When points exist, Mermaid renders quadrant text near the
  // TOP of each region (so it doesn't fight the data); with no points it sits
  // in the center. We follow that, and never overwrite a plotted point.
  const top = chart.points.length > 0
  const deferred: Array<{ quadrant: number; text: string }> = []
  for (const [quadrant, rowStart, colStart, rowEnd, colEnd] of [
    [2, 0, 0, midRow, midCol],
    [1, 0, midCol + 1, midRow, GRID_W],
    [3, midRow + 1, 0, GRID_H, midCol],
    [4, midRow + 1, midCol + 1, GRID_H, GRID_W],
  ] as const) {
    const text = placeLabel(grid, occupied, chart.quadrants[quadrant - 1], rowStart, colStart, rowEnd, colEnd, top, quadrant)
    if (text !== undefined) deferred.push({ quadrant, text })
  }

  // Frame the grid with a border, with axis labels on the edges.
  const document = new TerminalDocument()
  pointVisuals.forEach((visual, index) => {
    const point = chart.points[index]!
    const classStyle = point.className && Object.hasOwn(chart.classDefs, point.className) ? chart.classDefs[point.className] : undefined
    const authoredRadius = point.style?.radius ?? classStyle?.radius
    if (authoredRadius !== undefined) document.report({
      code: 'TERMINAL_FAMILY_PROJECTION', feature: `quadrant.point-${index}.radius`,
      message: `Quadrant point-${index} radius=${visual.radius}px is represented by one terminal marker cell; normalized coordinates and the complete point label are retained.`,
    })
    if (visual.stroke !== undefined || visual.strokeWidth !== undefined) document.report({
      code: 'TERMINAL_FAMILY_PROJECTION', feature: `quadrant.point-${index}.stroke`,
      message: `Quadrant point-${index} stroke=${JSON.stringify(visual.stroke ?? 'theme default')}, stroke-width=${JSON.stringify(visual.strokeWidth ?? 'theme default')} is projected to a single ${pointMarkers[index]!.glyph} marker; a separate pixel outline and its width are unavailable. Hollow markers use the resolved stroke paint.`,
    })
  })
  if (chart.title) {
    for (const text of wrapText(displayText(chart.title), targetWidth)) document.line([{ text: centerText(text, GRID_W + 2), role: 'text', textGroup: 'title', owner: { id: 'title', kind: 'label' } }])
  }

  stroke(0, 0, 6); stroke(GRID_W + 1, 0, 12)
  stroke(0, GRID_H + 1, 3); stroke(GRID_W + 1, GRID_H + 1, 9)
  for (let col = 1; col <= GRID_W; col++) {
    stroke(col, 0, col === midCol + 1 ? 14 : 10)
    stroke(col, GRID_H + 1, col === midCol + 1 ? 11 : 10)
  }
  for (let row = 1; row <= GRID_H; row++) {
    stroke(0, row, row === midRow + 1 ? 7 : 5)
    stroke(GRID_W + 1, row, row === midRow + 1 ? 13 : 5)
  }
  grid.region(frameOwner, { x: 0, y: 0, width: GRID_W + 2, height: GRID_H + 2 })
  for (const [number, x, y, width, height] of [
    [1, midCol + 2, 1, GRID_W - midCol - 1, midRow],
    [2, 1, 1, midCol, midRow],
    [3, 1, midRow + 2, midCol, GRID_H - midRow - 1],
    [4, midCol + 2, midRow + 2, GRID_W - midCol - 1, GRID_H - midRow - 1],
  ] as const) grid.region({ id: `quadrant#${number}`, kind: 'compartment' }, { x, y, width, height })
  document.overlay(grid, 0, document.height)

  // x-axis labels under the grid (left + right).
  if (chart.xAxis) {
    const near = oneRow(chart.xAxis.near)
    const far = chart.xAxis.far === undefined ? undefined : oneRow(chart.xAxis.far)
    const width = targetWidth ?? Math.max(GRID_W + 2, visualWidth(near) + (far ? visualWidth(far) + 1 : 0))
    const columnWidth = far ? Math.max(1, Math.floor((width - 1) / 2)) : width
    const nearLines = wrapText(near, columnWidth)
    const farLines = far ? wrapText(far, columnWidth) : []
    const row = document.height
    document.textBlock(0, row, nearLines.join('\n'), { role: 'text', owner: { id: 'x-axis-near', kind: 'label' } })
    if (far) document.textBlock(width - Math.max(...farLines.map(visualWidth)), row, farLines.join('\n'), { role: 'text', owner: { id: 'x-axis-far', kind: 'label' } })
  }
  // y-axis labels as a separate annotated line.
  if (chart.yAxis) {
    const prefix = 'y-axis  bottom: '
    const near = oneRow(chart.yAxis.near)
    const far = chart.yAxis.far ? oneRow(chart.yAxis.far) : undefined
    const whole = prefix + near + (far ? `  |  top: ${far}` : '')
    if (targetWidth === undefined || visualWidth(whole) <= targetWidth) {
      document.line([
        { text: prefix, role: 'border', kind: 'text', owner: { id: 'y-axis-near:prefix', kind: 'label', parent: { id: 'y-axis-near', kind: 'label' } } },
        { text: near, role: 'text', owner: { id: 'y-axis-near', kind: 'label' } },
        ...(far ? [{ text: '  |  top: ', role: 'border' as const, kind: 'text' as const, owner: { id: 'y-axis-far:prefix', kind: 'label' as const, parent: { id: 'y-axis-far', kind: 'label' as const } } }, { text: far, role: 'text' as const, owner: { id: 'y-axis-far', kind: 'label' as const } }] : []),
      ])
    } else {
      for (const [id, label, value] of [['y-axis-near', 'bottom: ', near], ['y-axis-far', 'top: ', far]] as const) {
        if (value === undefined) continue
        const lines = wrapText(value, Math.max(1, targetWidth - visualWidth(label)))
        const row = document.height
        document.textBlock(0, row, label, { role: 'border', kind: 'text', owner: { id: `${id}:prefix`, kind: 'label', parent: { id, kind: 'label' } } })
        document.textBlock(visualWidth(label), row, lines.join('\n'), { role: 'text', owner: { id, kind: 'label' } })
      }
    }
  }

  // A label that cannot fit its quadrant gets a separate attributed lane.
  // Never omit characters or overwrite the data to satisfy a decorative slot.
  for (const { quadrant, text } of deferred) {
    const prefix = `quadrant-${quadrant}: `
    const lines = wrapText(text, Math.max(1, (targetWidth ?? GRID_W + 2) - visualWidth(prefix)))
    lines.forEach((line, index) => document.line([
      { text: index === 0 ? prefix : ' '.repeat(visualWidth(prefix)), role: 'border', kind: index === 0 ? 'text' : 'surface', owner: { id: `quadrant-label#${quadrant}:prefix`, kind: 'label', parent: { id: `quadrant-label#${quadrant}`, kind: 'label' } } },
      { text: line, role: 'text', textGroup: 'label', owner: { id: `quadrant-label#${quadrant}`, kind: 'label' } },
    ]))
  }

  // Legend — every point with its coordinates.
  if (chart.points.length > 0) {
    document.line()
    for (const [pointIndex, p] of chart.points.entries()) {
      const suffix = `: [${fmt(p.x)}, ${fmt(p.y)}]`
      const labelLines = wrapText(displayText(p.label), targetWidth ? Math.max(1, targetWidth - visualWidth(suffix) - 2) : undefined)
      labelLines.forEach((text, index) => document.line([
        { text: pointMarkers[pointIndex]!.glyph, role: 'arrow', kind: 'marker', color: pointMarkers[pointIndex]!.color, owner: { id: `point-${pointIndex}:legend`, kind: 'label', parent: { id: `point-${pointIndex}`, kind: 'node' } } },
        { text: ' ', kind: 'surface' },
        { text, role: 'text', textGroup: 'legend', owner: { id: `point-${pointIndex}`, kind: 'node' } },
        { text: index === labelLines.length - 1 ? suffix : '', role: 'text', owner: { id: `point-${pointIndex}:coordinates`, kind: 'label', parent: { id: `point-${pointIndex}`, kind: 'node' } } },
      ]))
    }
  }

  return terminalArtifact(document, { colorMode, theme })
}

function pointColor(theme: AsciiTheme): string {
  return theme.accent ?? theme.fg
}

function fmt(n: number): string {
  return Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100)
}

/**
 * Place a label horizontally centered within a sub-rectangle of the grid.
 * When `top` is set the label sits one row down from the region top; otherwise
 * it is vertically centered. Never overwrites a plotted point.
 */
function placeLabel(
  grid: TerminalDocument,
  occupied: Set<string>,
  label: string | undefined,
  rowStart: number,
  colStart: number,
  rowEnd: number,
  colEnd: number,
  top: boolean,
  quadrant: number,
): string | undefined {
  if (!label) return
  const regionW = colEnd - colStart
  const regionH = rowEnd - rowStart
  const text = oneRow(label)
  if (regionW <= 0 || regionH <= 0) return text
  const lines = wrapText(text, regionW).map(measuredText)
  if (lines.length > regionH || lines.some(line => line.width > regionW)) return text
  const preferred = top ? rowStart + 1 : rowStart + Math.floor((regionH - lines.length) / 2)
  const candidates = [preferred, ...Array.from({ length: regionH - lines.length + 1 }, (_, offset) => rowStart + offset)]
  for (const row of new Set(candidates)) {
    if (row < rowStart || row + lines.length > rowEnd) continue
    const placements = lines.map((line, index) => ({ text: line, row: row + index, column: colStart + Math.floor((regionW - line.width) / 2) }))
    const free = placements.every(line => Array.from({ length: line.text.width }, (_, offset) => !occupied.has(`${line.row},${line.column + offset}`)).every(Boolean))
    if (!free) continue
    for (const line of placements) grid.textBlock(line.column + 1, line.row + 1, line.text, { role: 'text', textGroup: 'label', owner: { id: `quadrant-label#${quadrant}`, kind: 'label' } })
    return
  }
  return text
}

function centerText(text: string, width: number): string {
  const textWidth = visualWidth(text)
  if (textWidth >= width) return text
  const pad = Math.floor((width - textWidth) / 2)
  return ' '.repeat(pad) + text
}

/** Compatibility string entry point; native dispatch retains the drawing. */
export function renderQuadrantAscii(...args: Parameters<typeof renderQuadrantTerminal>): string {
  return serializeTerminalArtifact(renderQuadrantTerminal(...args))
}
