import type { AsciiGraph, AsciiNode, Direction } from './types.ts'
import { Up, Down, Left, Right } from './types.ts'
import { maxLineWidth, lineCount } from './multiline-utils.ts'

/** Allocate complete parallel/reciprocal demand at the cell-layout boundary.
 * Authored endpoints remain unchanged; only face slots and empty grid capacity
 * grow. The final cell router consumes these slots rather than guessing a
 * second offset while painting. */
export function reserveGraphEdgeCapacity(graph: AsciiGraph): void {
  const pairs = new Map<AsciiNode, Map<AsciiNode, number>>()
  const directed = new Map<AsciiNode, Map<AsciiNode, number>>()
  let congested = false
  for (const edge of graph.edges) {
    if (edge.style === 'invisible') continue
    const a = edge.from.index <= edge.to.index ? edge.from : edge.to
    const b = a === edge.from ? edge.to : edge.from
    const targets = pairs.get(a) ?? new Map<AsciiNode, number>()
    const count = (targets.get(b) ?? 0) + 1
    targets.set(b, count); pairs.set(a, targets)
    // The ordinary two-cycle already has independent lanes. Repeated arrows
    // in one direction and larger reciprocal sets need the complete allocator.
    const outgoing = directed.get(edge.from) ?? new Map<AsciiNode, number>()
    const parallels = (outgoing.get(edge.to) ?? 0) + 1
    outgoing.set(edge.to, parallels); directed.set(edge.from, outgoing)
    if (count >= 3 || parallels >= 2) congested = true
  }
  if (!congested && !graph.compoundRepacked) return
  const faces = new Map<AsciiNode, Map<Direction, number>>()
  const faceCounts = new Map<AsciiNode, Map<Direction, number>>()
  const slot = (node: AsciiNode, face: Direction, demand: number): number => {
    const perFace = faces.get(node) ?? new Map<Direction, number>()
    const before = perFace.get(face) ?? 1
    perFace.set(face, before + demand + 2); faces.set(node, perFace)
    const counts = faceCounts.get(node) ?? new Map<Direction, number>()
    counts.set(face, (counts.get(face) ?? 0) + 1); faceCounts.set(node, counts)
    return before + Math.floor(demand / 2)
  }
  for (const edge of graph.edges) {
    if (edge.style === 'invisible') continue
    const a = edge.from.gridCoord!, b = edge.to.gridCoord!
    const dx = Math.abs(a.x - b.x), dy = Math.abs(a.y - b.y)
    const horizontal = dx > dy || dx === dy && graph.config.graphDirection === 'LR'
    const forward = horizontal ? a.x < b.x : a.y < b.y
    edge.startDir = horizontal ? forward ? Right : Left : forward ? Down : Up
    edge.endDir = horizontal ? forward ? Left : Right : forward ? Up : Down
    if (edge.from === edge.to) { edge.startDir = Right; edge.endDir = Right }
    const demand = horizontal || edge.from === edge.to ? lineCount(edge.text) : Math.max(1, maxLineWidth(edge.text))
    edge.cellAllocation = {
      startOffset: slot(edge.from, edge.startDir, demand),
      endOffset: slot(edge.to, edge.endDir, demand),
    }
    const width = Math.max(1, maxLineWidth(edge.text)), height = Math.max(1, lineCount(edge.text))
    if (edge.from !== edge.to) {
      const coordinate = horizontal ? Math.max(a.x, b.x) - 1 : Math.max(a.y, b.y) - 1
      const sizes = horizontal ? graph.columnWidth : graph.rowHeight
      // Multiline text keeps a separate adjacent run and two bends, so reverse
      // projection never depends on wire cells hidden beneath readable text.
      sizes.set(coordinate, Math.max(sizes.get(coordinate) ?? 0, horizontal ? width + (height > 1 ? 12 : 8) : height + 8))
    }
  }
  for (const [node, perFace] of faces) for (const [face, demand] of perFace) {
    const horizontal = face === Left || face === Right
    const index = horizontal ? node.gridCoord!.y + 1 : node.gridCoord!.x + 1
    const sizes = horizontal ? graph.rowHeight : graph.columnWidth
    sizes.set(index, Math.max(sizes.get(index) ?? 0, demand))
    const spacers = horizontal ? graph.columnWidth : graph.rowHeight
    const coordinate = horizontal ? node.gridCoord!.x : node.gridCoord!.y
    const spacer = coordinate + (face === Left || face === Up ? -1 : 3)
    if (spacer >= 0) spacers.set(spacer, Math.max(spacers.get(spacer) ?? 0, 3 + faceCounts.get(node)!.get(face)! * 2))
  }
}
