/*******************************************************************************
 * Copyright (c) 2012, 2014, 2017, 2019, 2020, 2022 Kiel University and others.
 *
 * This program and the accompanying materials are made available under the
 * terms of the Eclipse Public License 2.0 which is available at
 * http://www.eclipse.org/legal/epl-2.0.
 * SPDX-License-Identifier: EPL-2.0
 *******************************************************************************/
import type { LayoutNode, LayoutPort, LayoutEdge, LayoutLabel } from './graph.ts'
import { enumOption, numberOption } from './options.ts'
import type { Options } from './options.ts'

type Node = LayoutNode
type Port = LayoutPort
type Edge = LayoutEdge
type Label = LayoutLabel
type Side = Port['side']
type LabelSide = NonNullable<Label['labelSide']>
type Rect = { x: number; y: number; width: number; height: number }
interface LabelCell {
  labels: Label[]
  rect: Rect
  minimum: { x: number; y: number }
  horizontal: boolean
  horizontalAlignment: 'LEFT' | 'CENTER' | 'RIGHT'
  verticalAlignment: 'TOP' | 'CENTER' | 'BOTTOM'
  gap: number
}
export interface EndLabelState { cells: Map<Node, Map<Port, LabelCell>>; maxEdgeThickness: Map<Port, number> }
const placement = (label: Label): 'CENTER' | 'HEAD' | 'TAIL' => enumOption(label.options, 'edgeLabels.placement', ['CENTER', 'HEAD', 'TAIL'] as const, 'CENTER')
function compare(a: number, b: number): number {
  if (a < b) return -1
  if (a > b) return 1
  if (a === b) return a === 0 ? compare(1 / a, 1 / b) : 0
  return Number.isNaN(a) ? Number.isNaN(b) ? 0 : 1 : -1
}
function gatherLabels(port: Port, state: EndLabelState): Label[] | null {
  const labels: Label[] = []
  let maximum = -1
  const gather = (current: Port): void => {
    for (const edge of current.incoming.concat(current.outgoing)) {
      maximum = Math.max(maximum, numberOption(edge.options, 'edge.thickness', 1))
      const required = edge.source === current ? 'TAIL' : 'HEAD'
      for (const label of edge.labels) if (placement(label) === required) { label.endLabelEdge ??= edge; labels.push(label) }
    }
  }
  gather(port)
  for (const dummy of port.portDummy?.ports ?? []) if (dummy.originPort === port) gather(dummy)
  if (labels.length > 0) state.maxEdgeThickness.set(port, maximum)
  return maximum !== -1 ? labels : null
}
function createCell(labels: Label[] | null, gap: number, horizontal: boolean): LabelCell | null {
  if (labels === null || labels.length === 0) return null
  const minimum = { x: 0, y: 0 }
  for (let i = 0; i < labels.length; i++) {
    const label = labels[i]!
    if (horizontal) { minimum.x = Math.max(minimum.x, label.width); minimum.y += label.height; if (i > 0) minimum.y += gap }
    else { minimum.x += label.width; minimum.y = Math.max(minimum.y, label.height); if (i > 0) minimum.x += gap }
  }
  return { labels, minimum, horizontal, gap, rect: { x: 0, y: 0, width: minimum.x + 0 + 0, height: minimum.y + 0 + 0 }, horizontalAlignment: 'CENTER', verticalAlignment: 'CENTER' }
}
function placeCell(port: Port, cell: LabelCell, edgeSpacing: number, thickness: number): void {
  const node = port.node, rect = cell.rect, anchorX = 0 + port.x + port.anchorX, anchorY = 0 + port.y + port.anchorY
  const above = (cell.labels[0]!.labelSide ?? 'UNKNOWN') === 'ABOVE'
  if (port.side === 'NORTH' || port.side === 'SOUTH') {
    cell.verticalAlignment = port.side === 'NORTH' ? 'BOTTOM' : 'TOP'
    rect.y = port.side === 'NORTH' ? -node.margin.top - edgeSpacing - rect.height : node.height + node.margin.bottom + edgeSpacing
    cell.horizontalAlignment = above ? 'RIGHT' : 'LEFT'
    rect.x = above ? anchorX - thickness - edgeSpacing - rect.width : anchorX + thickness + edgeSpacing
  } else if (port.side === 'EAST' || port.side === 'WEST') {
    cell.horizontalAlignment = port.side === 'EAST' ? 'LEFT' : 'RIGHT'
    rect.x = port.side === 'EAST' ? node.width + node.margin.right + edgeSpacing : -node.margin.left - edgeSpacing - rect.width
    cell.verticalAlignment = above ? 'BOTTOM' : 'TOP'
    rect.y = above ? anchorY - thickness - edgeSpacing - rect.height : anchorY + thickness + edgeSpacing
  }
}
interface RectangleNode { original: Rect; rect: Rect; overlaps: RectangleNode[] }
function removeLabelOverlaps(node: Node, cells: Map<Port, LabelCell>, side: Side, gap: number, edgeSpacing: number): void {
  const vertical = side === 'NORTH' || side === 'SOUTH'
  const start = side === 'NORTH' ? -node.margin.top - edgeSpacing : side === 'SOUTH' ? node.height + node.margin.bottom + edgeSpacing : side === 'EAST' ? node.width + node.margin.right + edgeSpacing : -node.margin.left - edgeSpacing
  const rectangles: RectangleNode[] = []
  for (const port of node.ports) if (port.side === side) {
    const cell = cells.get(port)
    if (cell !== undefined) {
      const original = cell.rect
      rectangles.push({ original, rect: vertical ? original : { x: original.y, y: 0, width: original.height, height: original.width }, overlaps: [] })
    }
  }
  rectangles.sort((a, b) => compare(a.rect.x, b.rect.x))
  const active: RectangleNode[] = []
  for (const current of rectangles) {
    while (active.length > 0 && active[0]!.rect.x + active[0]!.rect.width < current.rect.x) active.shift()
    for (const other of active) { other.overlaps.push(current); current.overlaps.push(other) }
    const border = current.rect.x + current.rect.width
    let index = 0
    while (index < active.length && compare(active[index]!.rect.x + active[index]!.rect.width, border) < 0) index++
    // The source TreeSet compares right borders only, so an equal border does
    // not insert a second active interval.
    if (index === active.length || compare(active[index]!.rect.x + active[index]!.rect.width, border) !== 0) active.splice(index, 0, current)
  }
  const placed = new Set<RectangleNode>()
  for (const current of rectangles) {
    let y = 0
    current.overlaps.sort((a, b) => compare(a.rect.y, b.rect.y))
    for (const other of current.overlaps) if (placed.has(other)) {
      if (y < other.rect.y + other.rect.height + gap && y + current.rect.height + gap > other.rect.y) y = other.rect.y + other.rect.height + gap
    }
    current.rect.y = y; placed.add(current)
  }
  for (const current of rectangles) {
    if (side === 'NORTH') current.original.y = start - current.rect.height - current.rect.y
    else if (side === 'SOUTH') current.original.y += start
    else if (side === 'WEST') current.original.x = start - current.rect.height - current.rect.y
    else current.original.x = start + current.rect.y
  }
}
function updateMargins(node: Node, cells: Map<Port, LabelCell>): void {
  const rect = { x: -node.margin.left, y: -node.margin.top, width: node.margin.left + node.width + node.margin.right, height: node.margin.top + node.height + node.margin.bottom }
  for (const cell of cells.values()) {
    let x1 = Math.min(rect.x, cell.rect.x), y1 = Math.min(rect.y, cell.rect.y)
    let x2 = Math.max(rect.x + rect.width, cell.rect.x + cell.rect.width), y2 = Math.max(rect.y + rect.height, cell.rect.y + cell.rect.height)
    if (x2 < x1) { const value = x1; x1 = x2; x2 = value }
    if (y2 < y1) { const value = y1; y1 = y2; y2 = value }
    rect.x = x1; rect.y = y1; rect.width = x2 - x1; rect.height = y2 - y1
  }
  node.margin.left = -rect.x; node.margin.top = -rect.y
  node.margin.right = rect.width - node.margin.left - node.width; node.margin.bottom = rect.height - node.margin.top - node.height
}

/** EndLabelPreprocessor, ELK v0.11.0 at 54123e884b1ae743b453260f713b20c9bf5787f2. */
export function prepareEndLabels(layers: Node[][], options: Options): EndLabelState {
  const state: EndLabelState = { cells: new Map(), maxEdgeThickness: new Map() }
  const edgeSpacing = numberOption(options, 'spacing.edgeLabel', 2), labelSpacing = numberOption(options, 'spacing.labelLabel', 0)
  const direction = enumOption(options, 'direction', ['UNDEFINED', 'RIGHT', 'LEFT', 'DOWN', 'UP'] as const, 'RIGHT'), vertical = direction === 'UP' || direction === 'DOWN'
  for (const layer of layers) for (const node of layer) {
    const cells = new Map<Port, LabelCell>()
    for (const port of node.ports) { const cell = createCell(gatherLabels(port, state), labelSpacing, !vertical); if (cell !== null) cells.set(port, cell) }
    for (const port of node.ports) { const cell = cells.get(port); if (cell !== undefined) placeCell(port, cell, edgeSpacing, state.maxEdgeThickness.get(port)!) }
    removeLabelOverlaps(node, cells, vertical ? 'EAST' : 'NORTH', 2 * labelSpacing, edgeSpacing)
    removeLabelOverlaps(node, cells, vertical ? 'WEST' : 'SOUTH', 2 * labelSpacing, edgeSpacing)
    if (cells.size > 0) { state.cells.set(node, cells); updateMargins(node, cells) }
  }
  return state
}

/** The end-label portion of LabelSideSelector, at its source phase slot. */
export function selectEndLabelSides(layers: Node[][], options: Options, state: EndLabelState): void {
  const mode = enumOption(options, 'layered.edgeLabels.sideSelection', ['ALWAYS_UP', 'ALWAYS_DOWN', 'DIRECTION_UP', 'DIRECTION_DOWN', 'SMART_UP', 'SMART_DOWN'] as const, 'SMART_DOWN')
  const defaultSide: LabelSide = mode.endsWith('_UP') ? 'ABOVE' : 'BELOW'
  const assign = (labels: Label[], side: LabelSide): void => { for (const label of labels) label.labelSide = side }
  if (mode.startsWith('ALWAYS') || mode.startsWith('DIRECTION')) {
    for (const layer of layers) for (const node of layer) for (const port of node.ports) for (const edge of port.outgoing) {
      const side = mode.startsWith('DIRECTION') && edge.reversed ? defaultSide === 'ABOVE' ? 'BELOW' : 'ABOVE' : defaultSide
      assign(edge.labels, side)
    }
  } else {
    for (const layer of layers) for (const node of layer) if (node.type === 'NORMAL') {
      let side: Side | undefined, queue: Label[][] = []
      const flush = (): void => {
        if (queue.length === 2) {
          const first = side === 'NORTH' || side === 'EAST' ? 'ABOVE' : 'BELOW'
          assign(queue[0]!, first); assign(queue[1]!, first === 'ABOVE' ? 'BELOW' : 'ABOVE')
        } else for (const labels of queue) assign(labels, defaultSide)
      }
      for (const port of node.ports) {
        if (port.side !== side) { if (queue.length > 0) flush(); queue = []; side = port.side }
        const labels = gatherLabels(port, state)
        if (labels !== null) queue.push(labels)
      }
      if (queue.length > 0) flush()
    }
  }
}

/** EndLabelSorter, after long-edge joining and loop restoration. */
export function sortEndLabels(layers: Node[][], state: EndLabelState): void {
  for (const layer of layers) for (const node of layer) if (node.type === 'NORMAL' && state.cells.has(node)) {
    let ids: Map<Node | Port, number> | undefined
    for (const port of node.ports) {
      let count = 0
      for (const edge of port.incoming) if (edge.labels.some(label => placement(label) === 'HEAD')) count++
      for (const edge of port.outgoing) if (edge.labels.some(label => placement(label) === 'TAIL')) count++
      if (count < 2) continue
      if (ids === undefined) {
        ids = new Map(); let id = 0
        for (const row of layers) for (const n of row) { ids.set(n, id++); for (const p of n.ports) ids.set(p, id++) }
      }
      const cell = state.cells.get(node)!.get(port)!, groups = new Map<Edge | undefined, Label[]>()
      for (const label of cell.labels) { const edge = label.endLabelEdge; if (!groups.has(edge)) groups.set(edge, []); groups.get(edge)!.push(label) }
      const sorted = [...groups]
      sorted.sort(([a], [b]) => compare(ids!.get(a!.source)!, ids!.get(b!.source)!) || compare(ids!.get(a!.target.node)!, ids!.get(b!.target.node)!) || compare(ids!.get(b!.target)!, ids!.get(a!.target)!))
      cell.labels.length = 0
      for (const [, labels] of sorted) cell.labels.push(...labels)
    }
  }
}

/** EndLabelPostprocessor, after reversed-edge restoration. */
export function finishEndLabels(layers: Node[][], state: EndLabelState): void {
  for (const layer of layers) for (const node of layer) if ((node.type === 'NORMAL' || node.type === 'EXTERNAL_PORT') && state.cells.has(node)) {
    for (const cell of state.cells.get(node)!.values()) {
      const rect = cell.rect
      rect.x += node.x; rect.y += node.y
      if (cell.horizontal) {
        let y = rect.y
        if (cell.verticalAlignment === 'CENTER') y += (rect.height - cell.minimum.y) / 2
        else if (cell.verticalAlignment === 'BOTTOM') y += rect.height - cell.minimum.y
        for (const label of cell.labels) {
          label.y = y; y += label.height + cell.gap
          label.x = cell.horizontalAlignment === 'LEFT' ? rect.x + 0 : cell.horizontalAlignment === 'CENTER' ? rect.x + 0 + (rect.width - label.width) / 2 : rect.x + rect.width - 0 - label.width
        }
      } else {
        let x = rect.x
        if (cell.horizontalAlignment === 'CENTER') x += (rect.width - cell.minimum.x) / 2
        else if (cell.horizontalAlignment === 'RIGHT') x += rect.width - cell.minimum.x
        for (const label of cell.labels) {
          label.x = x; x += label.width + cell.gap
          label.y = cell.verticalAlignment === 'TOP' ? rect.y + 0 : cell.verticalAlignment === 'CENTER' ? rect.y + 0 + (rect.height - label.height) / 2 : rect.y + rect.height - 0 - label.height
        }
      }
    }
    state.cells.delete(node)
  }
}
