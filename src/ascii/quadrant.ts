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
import type { QuadrantChart } from '../quadrant/types.ts'
import type { AsciiConfig, AsciiTheme, ColorMode } from './types.ts'
import { colorizeText } from './ansi.ts'

/** Interior plot dimensions in cells (odd so the dividers land cleanly). */
const GRID_W = 41
const GRID_H = 21

const UNI = {
  tl: '┌', tr: '┐', bl: '└', br: '┘',
  h: '─', v: '│',
  tDown: '┬', tUp: '┴', tLeft: '┤', tRight: '├', cross: '┼',
  point: '●',
} as const

const ASC = {
  tl: '+', tr: '+', bl: '+', br: '+',
  h: '-', v: '|',
  tDown: '+', tUp: '+', tLeft: '+', tRight: '+', cross: '+',
  point: '*',
} as const

export function renderQuadrantAscii(
  lines: string[],
  config: AsciiConfig,
  colorMode: ColorMode,
  theme: AsciiTheme,
): string {
  const chart = parseQuadrantChart(lines)
  const ch = config.useAscii ? ASC : UNI

  // Interior grid (rows × cols of single characters). Row 0 = top.
  const grid: string[][] = Array.from({ length: GRID_H }, () => Array.from({ length: GRID_W }, () => ' '))
  const midCol = Math.floor(GRID_W / 2)
  const midRow = Math.floor(GRID_H / 2)

  // Dividers.
  for (let r = 0; r < GRID_H; r++) grid[r]![midCol] = ch.v
  for (let c = 0; c < GRID_W; c++) grid[midRow]![c] = ch.h
  grid[midRow]![midCol] = ch.cross

  // Points — scaled into the grid. x grows right, y grows up (invert row).
  // Plotted first so quadrant labels (decorative) never clobber a data point.
  const occupied = new Set<string>()
  chart.points.forEach(p => {
    const col = Math.round(p.x * (GRID_W - 1))
    const row = Math.round((1 - p.y) * (GRID_H - 1))
    grid[row]![col] = ch.point
    occupied.add(`${row},${col}`)
  })

  // Quadrant labels. When points exist, Mermaid renders quadrant text near the
  // TOP of each region (so it doesn't fight the data); with no points it sits
  // in the center. We follow that, and never overwrite a plotted point.
  const top = chart.points.length > 0
  placeLabel(grid, occupied, chart.quadrants[1], 0, 0, midRow, midCol, top)                    // q2 top-left
  placeLabel(grid, occupied, chart.quadrants[0], 0, midCol + 1, midRow, GRID_W, top)           // q1 top-right
  placeLabel(grid, occupied, chart.quadrants[2], midRow + 1, 0, GRID_H, midCol, top)           // q3 bottom-left
  placeLabel(grid, occupied, chart.quadrants[3], midRow + 1, midCol + 1, GRID_H, GRID_W, top)  // q4 bottom-right

  // Frame the grid with a border, with axis labels on the edges.
  const out: string[] = []
  if (chart.title) out.push(centerText(chart.title, GRID_W + 2))

  out.push(ch.tl + ch.h.repeat(GRID_W) + ch.tr)
  for (let r = 0; r < GRID_H; r++) {
    // The mid divider row meets the border as ├ … ┤ junctions.
    const left = r === midRow ? ch.tRight : ch.v
    const right = r === midRow ? ch.tLeft : ch.v
    out.push(left + grid[r]!.join('') + right)
  }
  out.push(ch.bl + ch.h.repeat(GRID_W) + ch.br)

  // x-axis labels under the grid (left + right).
  if (chart.xAxis) {
    out.push(edgeAxisRow(chart.xAxis.near, chart.xAxis.far, GRID_W + 2))
  }
  // y-axis labels as a separate annotated line.
  if (chart.yAxis) {
    const top = chart.yAxis.far ? `top: ${chart.yAxis.far}` : ''
    const bottom = `bottom: ${chart.yAxis.near}`
    out.push(`y-axis  ${bottom}${top ? `  |  ${top}` : ''}`)
  }

  // Legend — every point with its coordinates.
  if (chart.points.length > 0) {
    out.push('')
    const pointGlyph = colorMode === 'none' ? ch.point : colorizeText(ch.point, pointColor(theme), colorMode)
    for (const p of chart.points) {
      out.push(`${pointGlyph} ${p.label}: [${fmt(p.x)}, ${fmt(p.y)}]`)
    }
  }

  return out.join('\n')
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
  grid: string[][],
  occupied: Set<string>,
  label: string | undefined,
  rowStart: number,
  colStart: number,
  rowEnd: number,
  colEnd: number,
  top: boolean,
): void {
  if (!label) return
  const regionW = colEnd - colStart
  const regionH = rowEnd - rowStart
  if (regionW <= 0 || regionH <= 0) return
  const text = label.length > regionW ? label.slice(0, regionW) : label
  const row = top ? rowStart + 1 : rowStart + Math.floor(regionH / 2)
  const col = colStart + Math.max(0, Math.floor((regionW - text.length) / 2))
  for (let i = 0; i < text.length && col + i < colEnd; i++) {
    if (occupied.has(`${row},${col + i}`)) continue
    grid[row]![col + i] = text[i]!
  }
}

function centerText(text: string, width: number): string {
  if (text.length >= width) return text
  const pad = Math.floor((width - text.length) / 2)
  return ' '.repeat(pad) + text
}

/** Bottom edge axis row: near label left-aligned, far label right-aligned. */
function edgeAxisRow(near: string, far: string | undefined, width: number): string {
  if (!far) return near
  const gap = width - near.length - far.length
  if (gap < 1) return `${near} ${far}`
  return near + ' '.repeat(gap) + far
}
