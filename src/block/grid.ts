// Adapted from Pele (458322a5b8abb1ae57ddf127c32017ab9fb14a92), copyright (c) 2026 kepano.
// MIT license; see pele-license.txt in this directory.
import { PeleError } from './errors.ts'
export interface Cell {
  children: Cell[]
  // Grid width of this container: a positive count, or -1 to put every child on one row.
  columns: number
  span: number
  space: boolean
  // Height reserved above a container's grid for its title.
  head: number
  // Explicit group Style padding overrides the default inter-cell gap inset.
  insetX?: number
  insetY?: number
  // Size the content needs. Set by the caller for leaves, computed here for containers.
  nw: number
  nh: number
  // Placement: grid position, then center and size in pixels.
  col: number
  row: number
  cols: number
  heights: number[]
  x: number
  y: number
  w: number
  h: number
}
const MAX_SPAN = 1000
export function cell(nw: number, nh: number, span = 1): Cell {
  return { children: [], columns: -1, span, space: false, head: 0, nw, nh, col: 0, row: 0, cols: 0, heights: [], x: 0, y: 0, w: 0, h: 0 }
}
export function calculateBlockPosition(
  columns: number,
  position: number,
): {
  px: number
  py: number
} {
  if (columns === 0 || !Number.isInteger(columns)) {
    throw new PeleError('Columns must be an integer !== 0.', 'semantic', { type: 'block' })
  }
  if (position < 0 || !Number.isInteger(position)) {
    throw new PeleError('Position must be a non-negative integer.' + position, 'semantic', { type: 'block' })
  }
  if (columns < 0) return { px: position, py: 0 }
  return { px: position % columns, py: Math.floor(position / columns) }
}
// Puts each child in its grid cell and sizes the container. Every column is as wide as the widest
// block needs. Every row that holds a plain block is as tall as the tallest block in the container,
// as in Mermaid; a row of nothing but containers is only as tall as they need.
function measure(box: Cell, gap: number, insetX: number, insetY: number): void {
  const columns = box.columns
  const heights: number[] = []
  let position = 0
  let cols = 0
  let cw = 0
  let tallest = 0
  for (const child of box.children) {
    const { px, py } = calculateBlockPosition(columns, position)
    // Mermaid lets a block wider than the rest of its row stick out of the grid. Here it stops at the last column.
    let span = child.span >= 1 ? Math.min(child.span, MAX_SPAN) : 1
    if (columns > 0 && span > columns - px) span = columns - px
    child.span = span
    child.col = px
    child.row = py
    position += span
    if (px + span > cols) cols = px + span
    if (py === heights.length) heights.push(0)
    if (child.children.length === 0) heights[py]! = -1
    else if (heights[py]! >= 0 && child.nh > heights[py]!) heights[py]! = child.nh
    if (child.space) continue
    const width = (child.nw - gap * (span - 1)) / span
    if (width > cw) cw = width
    if (child.nh > tallest) tallest = child.nh
  }
  let height = (heights.length - 1) * gap
  for (let row = 0; row < heights.length; row++) {
    if (heights[row]! < 0) heights[row]! = tallest
    height += heights[row]!
  }
  box.cols = cols
  box.heights = heights
  box.nw = Math.max(box.nw, cols * cw + (cols - 1) * gap + 2 * insetX)
  box.nh = height + 2 * insetY + box.head
}
// Gives each child its cell, sharing out any room the container has beyond what it needs.
function arrange(box: Cell, gap: number, insetX: number, insetY: number): void {
  const { cols, heights } = box
  const rows = heights.length
  const cw = (box.w - 2 * insetX - (cols - 1) * gap) / cols
  const room = box.h - 2 * insetY - box.head - (rows - 1) * gap
  let needed = 0
  for (const height of heights) needed += height
  const scale = needed > 0 ? room / needed : 0
  const share = needed > 0 ? 0 : room / rows
  const left = box.x - box.w / 2 + insetX
  let top = box.y - box.h / 2 + insetY + box.head
  let row = 0
  for (const child of box.children) {
    for (; row < child.row; row++) top += heights[row]! * scale + share + gap
    child.w = cw * child.span + gap * (child.span - 1)
    child.h = heights[row]! * scale + share
    child.x = left + child.col * (cw + gap) + child.w / 2
    child.y = top + child.h / 2
  }
}
// Lays out a tree of cells in place. The root has no border, so its grid starts at the origin.
export function layout(
  root: Cell,
  gap: number,
): {
  width: number
  height: number
} {
  const order = [root]
  for (let i = 0; i < order.length; i++) {
    for (const child of order[i]!.children) order.push(child)
  }
  for (let i = order.length - 1; i >= 0; i--) {
    const box = order[i]!
    if (box.children.length > 0) measure(box, gap, i === 0 ? 0 : (box.insetX ?? gap), i === 0 ? 0 : (box.insetY ?? gap))
  }
  root.w = root.nw
  root.h = root.nh
  root.x = root.w / 2
  root.y = root.h / 2
  for (let i = 0; i < order.length; i++) {
    const box = order[i]!
    if (box.children.length > 0) arrange(box, gap, i === 0 ? 0 : (box.insetX ?? gap), i === 0 ? 0 : (box.insetY ?? gap))
  }
  return { width: root.w, height: root.h }
}
