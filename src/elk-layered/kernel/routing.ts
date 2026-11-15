/*******************************************************************************
 * Copyright (c) 2010, 2020 Kiel University and others.
 * This program and the accompanying materials are made available under the
 * terms of the Eclipse Public License 2.0 which is available at
 * https://www.eclipse.org/legal/epl-2.0/.
 * SPDX-License-Identifier: EPL-2.0
 *******************************************************************************/
import type { Random } from '../java/util/Random.ts'
import type { LayoutEdge, LayoutNode, LayoutPort } from './graph.ts'
import { enumOption, numberOption, type Options } from './options.ts'

interface Segment { ports: LayoutPort[]; incomingCoordinates: number[]; outgoingCoordinates: number[]; incoming: Dependency[]; outgoing: Dependency[]; start: number; end: number; slot: number; mark: number; inWeight: number; outWeight: number; criticalIn: number; criticalOut: number; splitPartner?: Segment; splitBy?: Segment }
interface Dependency { source: Segment; target: Segment; weight: number; critical: boolean }
const TOLERANCE = 1e-3

/** OrthogonalEdgeRouter with the west-to-east routing direction strategy. */
export function routeOrthogonal(layers: LayoutNode[][], options: Options, random: Random): { width: number; height: number; offsetY: number } {
  let minY = Number.POSITIVE_INFINITY, maxY = Number.NEGATIVE_INFINITY
  const widths: number[] = []
  for (const layer of layers) {
    let width = 0
    for (const node of layer) width = Math.max(width, node.width + node.margin.left + node.margin.right)
    widths.push(width)
    if (layer.length === 0) continue
    const first = layer[0]!, last = layer.at(-1)!
    minY = Math.min(minY, first.y - first.margin.top)
    maxY = Math.max(maxY, last.y + last.height + last.margin.bottom)
  }
  if (!layers.some(layer => layer.length > 0)) { minY = 0; maxY = 0 }
  const edgeSpacing = numberOption(options, 'layered.spacing.edgeEdgeBetweenLayers', 10), nodeSpacing = numberOption(options, 'layered.spacing.nodeNodeBetweenLayers', 20), edgeNodeSpacing = numberOption(options, 'layered.spacing.edgeNodeBetweenLayers', 10)
  let x = 0, left: LayoutNode[] | null = null
  for (let index = 0; index <= layers.length; index++) {
    const right = layers[index] ?? null
    if (left !== null) { placeHorizontally(left, widths[index - 1]!, x); x += widths[index - 1]! }
    const slots = routeGap(left, right, left === null ? x : x + edgeNodeSpacing, edgeSpacing, random)
    const leftExternal = left === null || left.every(node => node.type === 'EXTERNAL_PORT'), rightExternal = right === null || right.every(node => node.type === 'EXTERNAL_PORT')
    if (slots > 0) {
      let width = (slots - 1) * edgeSpacing
      if (left !== null) width += edgeNodeSpacing
      if (right !== null) width += edgeNodeSpacing
      if (width < nodeSpacing && !leftExternal && !rightExternal) width = nodeSpacing
      x += width
    } else if (!leftExternal && !rightExternal) x += nodeSpacing
    left = right
  }
  return { width: x, height: maxY - minY, offsetY: 0 - minY }
}
function placeHorizontally(layer: LayoutNode[], width: number, offset: number): void {
  let maxLeft = 0, maxRight = 0
  for (const node of layer) { maxLeft = Math.max(maxLeft, node.margin.left); maxRight = Math.max(maxRight, node.margin.right) }
  for (const node of layer) {
    const alignment = enumOption(node.options, 'alignment', ['AUTOMATIC', 'LEFT', 'RIGHT', 'CENTER'] as const, 'AUTOMATIC')
    let ratio: number
    if (alignment === 'LEFT') ratio = 0
    else if (alignment === 'RIGHT') ratio = 1
    else if (alignment === 'CENTER') ratio = 0.5
    else { let incoming = 0, outgoing = 0; for (const port of node.ports) { if (port.incoming.length > 0) incoming++; if (port.outgoing.length > 0) outgoing++ }; ratio = incoming + outgoing === 0 ? 0.5 : outgoing / (incoming + outgoing) }
    let x = (width - node.width) * ratio
    if (ratio > 0.5) x -= maxRight * 2 * (ratio - 0.5)
    else if (ratio < 0.5) x += maxLeft * 2 * (0.5 - ratio)
    if (x < node.margin.left) x = node.margin.left
    if (x > width - node.margin.right - node.width) x = width - node.margin.right - node.width
    node.x = offset + x
  }
}
function newSegment(): Segment { return { ports: [], incomingCoordinates: [], outgoingCoordinates: [], incoming: [], outgoing: [], start: Number.NaN, end: Number.NaN, slot: 0, mark: 0, inWeight: 0, outWeight: 0, criticalIn: 0, criticalOut: 0 } }
function addPort(segment: Segment, port: LayoutPort, map: Map<LayoutPort, Segment>): void {
  map.set(port, segment); segment.ports.push(port)
  const value = port.node.y + port.y + port.anchorY, positions = port.side === 'EAST' ? segment.incomingCoordinates : segment.outgoingCoordinates
  let index = 0
  while (index < positions.length) { const next = positions[index]!; if (next === value) break; if (next > value) break; index++ }
  if (positions[index] !== value) positions.splice(index, 0, value)
  segment.start = Number.NaN; segment.end = Number.NaN
  for (const list of [segment.incomingCoordinates, segment.outgoingCoordinates]) if (list.length > 0) { segment.start = Number.isNaN(segment.start) ? list[0]! : Math.min(segment.start, list[0]!); segment.end = Number.isNaN(segment.end) ? list.at(-1)! : Math.max(segment.end, list.at(-1)!) }
  for (const edge of port.incoming) if (!map.has(edge.source)) addPort(segment, edge.source, map)
  for (const edge of port.outgoing) if (!map.has(edge.target)) addPort(segment, edge.target, map)
}
function routeGap(left: LayoutNode[] | null, right: LayoutNode[] | null, start: number, spacing: number, random: Random): number {
  const map = new Map<LayoutPort, Segment>(), segments: Segment[] = []
  for (const [nodes, side] of [[left, 'EAST'], [right, 'WEST']] as const) if (nodes !== null) for (const node of nodes) for (const port of node.ports) if (port.side === side && port.outgoing.length > 0 && !map.has(port)) { const segment = newSegment(); segments.push(segment); addPort(segment, port, map) }
  let minimum = Number.MAX_VALUE
  for (const incoming of [true, false]) {
    const coordinates = segments.flatMap(segment => incoming ? segment.incomingCoordinates : segment.outgoingCoordinates).sort((a, b) => a - b).filter((value, index, values) => index === 0 || value !== values[index - 1])
    for (let index = 1; index < coordinates.length; index++) minimum = Math.min(minimum, coordinates[index]! - coordinates[index - 1]!)
  }
  const critical = 0.2 * minimum
  let criticalCount = 0
  for (let first = 0; first < segments.length - 1; first++) for (let second = first + 1; second < segments.length; second++) criticalCount += createDependencies(segments[first]!, segments[second]!, spacing * 0.5, critical)
  if (criticalCount >= 2) splitSegments(detectCycles(segments, true, random), segments, spacing * 0.5, critical)
  for (const dependency of detectCycles(segments, false, random)) {
    if (dependency.weight === 0) removeDependency(dependency)
    else {
      const source = dependency.source, target = dependency.target
      source.outgoing.splice(source.outgoing.indexOf(dependency), 1); dependency.source = target; target.outgoing.push(dependency)
      target.incoming.splice(target.incoming.indexOf(dependency), 1); dependency.target = source; source.incoming.push(dependency)
    }
  }
  numberSlots(segments)
  let rank = -1
  const junctions: { x: number; y: number }[] = []
  for (const segment of segments) {
    if (Math.abs(segment.start - segment.end) < TOLERANCE) continue
    rank = Math.max(rank, segment.slot)
    if (segment.splitPartner !== undefined && segment.splitBy === undefined) continue
    const x = start + segment.slot * spacing
    for (const port of segment.ports) {
      const sourceY = port.node.y + port.y + port.anchorY
      for (const edge of port.outgoing) {
        if (edge.source.node === edge.target.node) continue
        const target = edge.target, targetY = target.node.y + target.y + target.anchorY
        if (Math.abs(sourceY - targetY) > TOLERANCE) {
          let currentX = x, currentSegment = segment
          const add = (y: number): void => { const point = { x: currentX, y }; edge.bends.push(point); if (!junctions.some(junction => junction.x === point.x && junction.y === point.y) && needsJunction(currentSegment, y)) { edge.junctions ??= []; edge.junctions.push({ ...point }); junctions.push(point) } }
          add(sourceY)
          if (segment.splitPartner !== undefined) { const splitY = segment.splitPartner.incomingCoordinates[0]!; add(splitY); currentX = start + segment.splitPartner.slot * spacing; currentSegment = segment.splitPartner; add(splitY) }
          add(targetY)
        }
      }
    }
  }
  return rank + 1
}
function needsJunction(segment: Segment, value: number): boolean {
  if (value > segment.start && value < segment.end) return true
  const incoming = segment.incomingCoordinates, outgoing = segment.outgoingCoordinates
  return incoming.length > 0 && outgoing.length > 0 && ((Math.abs(value - incoming[0]!) < TOLERANCE && Math.abs(value - outgoing[0]!) < TOLERANCE) || (Math.abs(value - incoming.at(-1)!) < TOLERANCE && Math.abs(value - outgoing.at(-1)!) < TOLERANCE))
}
function addDependency(source: Segment, target: Segment, weight: number, critical: boolean): void { const result: Dependency = { source, target, weight, critical }; source.outgoing.push(result); target.incoming.push(result) }
function removeDependency(dependency: Dependency): void { dependency.source.outgoing.splice(dependency.source.outgoing.indexOf(dependency), 1); dependency.target.incoming.splice(dependency.target.incoming.indexOf(dependency), 1) }
function countConflicts(first: number[], second: number[], threshold: number, critical: number): number {
  if (first.length === 0 || second.length === 0) return 0
  let a = 0, b = 0, conflicts = 0
  for (;;) {
    const x = first[a]!, y = second[b]!
    if (x > y - critical && x < y + critical) return -1
    if (x > y - threshold && x < y + threshold) conflicts++
    if (x <= y && a + 1 < first.length) a++
    else if (y <= x && b + 1 < second.length) b++
    else return conflicts
  }
}
function crossings(coordinates: number[], start: number, end: number): number { let result = 0; for (const position of coordinates) { if (position > end) break; if (position >= start) result++ }; return result }
function createDependencies(first: Segment, second: Segment, threshold: number, critical: number): number {
  if (Math.abs(first.start - first.end) < TOLERANCE || Math.abs(second.start - second.end) < TOLERANCE) return 0
  const a = countConflicts(first.outgoingCoordinates, second.incomingCoordinates, threshold, critical), b = countConflicts(second.outgoingCoordinates, first.incomingCoordinates, threshold, critical)
  if (a === -1 || b === -1) { if (a === -1) addDependency(second, first, 1, true); if (b === -1) addDependency(first, second, 1, true); return (a === -1 ? 1 : 0) + (b === -1 ? 1 : 0) }
  const costA = a + 16 * (crossings(first.outgoingCoordinates, second.start, second.end) + crossings(second.incomingCoordinates, first.start, first.end)), costB = b + 16 * (crossings(second.outgoingCoordinates, first.start, first.end) + crossings(first.incomingCoordinates, second.start, second.end))
  if (costA < costB) addDependency(first, second, costB - costA, false)
  else if (costA > costB) addDependency(second, first, costA - costB, false)
  else if (costA > 0 && costB > 0) { addDependency(first, second, 0, false); addDependency(second, first, 0, false) }
  return 0
}
function detectCycles(segments: Segment[], criticalOnly: boolean, random: Random): Dependency[] {
  const sources: Segment[] = [], sinks: Segment[] = []
  for (let index = 0; index < segments.length; index++) {
    const segment = segments[index]!; segment.mark = -index - 1
    segment.criticalIn = segment.incoming.reduce((sum, dependency) => sum + (dependency.critical ? dependency.weight : 0), 0); segment.criticalOut = segment.outgoing.reduce((sum, dependency) => sum + (dependency.critical ? dependency.weight : 0), 0)
    segment.inWeight = criticalOnly ? segment.criticalIn : segment.incoming.reduce((sum, dependency) => sum + dependency.weight, 0); segment.outWeight = criticalOnly ? segment.criticalOut : segment.outgoing.reduce((sum, dependency) => sum + dependency.weight, 0)
    if (segment.outWeight === 0) sinks.push(segment); else if (segment.inWeight === 0) sources.push(segment)
  }
  // The source TreeSet orders the initial negative marks, hence reverse order.
  const unprocessed = new Set(segments.toReversed()), base = segments.length
  let nextSink = base - 1, nextSource = base + 1, sourceHead = 0, sinkHead = 0
  const update = (segment: Segment): void => {
    for (const dependency of segment.outgoing) if ((!criticalOnly || dependency.critical) && dependency.target.mark < 0 && dependency.weight > 0) { const target = dependency.target; target.inWeight -= dependency.weight; if (dependency.critical) target.criticalIn -= dependency.weight; if (target.inWeight <= 0 && target.outWeight > 0) sources.push(target) }
    for (const dependency of segment.incoming) if ((!criticalOnly || dependency.critical) && dependency.source.mark < 0 && dependency.weight > 0) { const source = dependency.source; source.outWeight -= dependency.weight; if (dependency.critical) source.criticalOut -= dependency.weight; if (source.outWeight <= 0 && source.inWeight > 0) sinks.push(source) }
  }
  while (unprocessed.size > 0) {
    while (sinkHead < sinks.length) { const sink = sinks[sinkHead++]!; unprocessed.delete(sink); sink.mark = nextSink--; update(sink) }
    while (sourceHead < sources.length) { const source = sources[sourceHead++]!; unprocessed.delete(source); source.mark = nextSource++; update(source) }
    let maximum = -2147483648; const choices: Segment[] = []
    for (const segment of unprocessed) {
      if (!criticalOnly && segment.criticalOut > 0 && segment.criticalIn <= 0) { choices.length = 0; choices.push(segment); break }
      const outflow = segment.outWeight - segment.inWeight
      if (outflow >= maximum) { if (outflow > maximum) { choices.length = 0; maximum = outflow }; choices.push(segment) }
    }
    if (choices.length > 0) { const segment = choices[random.nextInt(choices.length)]!; unprocessed.delete(segment); segment.mark = nextSource++; update(segment) }
  }
  for (const segment of segments) if (segment.mark < base) segment.mark += segments.length + 1
  const result: Dependency[] = []
  for (const segment of segments) for (const dependency of segment.outgoing) if ((!criticalOnly || dependency.critical) && segment.mark > dependency.target.mark) result.push(dependency)
  return result
}
function numberSlots(segments: Segment[]): void {
  const sources: Segment[] = [], targets: Segment[] = []
  for (const segment of segments) { segment.inWeight = segment.incoming.length; segment.outWeight = segment.outgoing.length; if (segment.inWeight === 0) sources.push(segment); if (segment.outWeight === 0 && segment.incomingCoordinates.length === 0) targets.push(segment) }
  let max = -1
  for (let index = 0; index < sources.length; index++) for (const dependency of sources[index]!.outgoing) { const target = dependency.target; target.slot = Math.max(target.slot, sources[index]!.slot + 1); max = Math.max(max, target.slot); target.inWeight--; if (target.inWeight === 0) sources.push(target) }
  if (max > -1) {
    for (const target of targets) target.slot = max
    for (let index = 0; index < targets.length; index++) for (const dependency of targets[index]!.incoming) { const source = dependency.source; if (source.incomingCoordinates.length > 0) continue; source.slot = Math.min(source.slot, targets[index]!.slot - 1); source.outWeight--; if (source.outWeight === 0) targets.push(source) }
  }
}

interface FreeArea { start: number; end: number; size: number }
interface AreaRating { dependencies: number; crossings: number }
function recomputeExtent(segment: Segment): void {
  segment.start = Number.NaN; segment.end = Number.NaN
  for (const positions of [segment.incomingCoordinates, segment.outgoingCoordinates]) if (positions.length > 0) { segment.start = Number.isNaN(segment.start) ? positions[0]! : Math.min(segment.start, positions[0]!); segment.end = Number.isNaN(segment.end) ? positions.at(-1)! : Math.max(segment.end, positions.at(-1)!) }
}
function splitSegments(dependencies: Dependency[], segments: Segment[], threshold: number, critical: number): void {
  if (dependencies.length === 0) return
  const free: FreeArea[] = [], coordinates = segments.flatMap(segment => segment.incomingCoordinates).concat(segments.flatMap(segment => segment.outgoingCoordinates)).sort((a, b) => a - b)
  const area = (start: number, end: number): FreeArea => ({ start, end, size: end - start })
  for (let index = 1; index < coordinates.length; index++) if (coordinates[index]! - coordinates[index - 1]! >= 2 * critical) free.push(area(coordinates[index - 1]! + critical, coordinates[index]! - critical))
  const selected = new Set<Segment>()
  for (const dependency of dependencies) {
    if (selected.has(dependency.source) || selected.has(dependency.target)) continue
    let segment = dependency.source, cause = dependency.target
    if (segment.incomingCoordinates.length + segment.outgoingCoordinates.length > 2 && cause.incomingCoordinates.length + cause.outgoingCoordinates.length <= 2) { segment = dependency.target; cause = dependency.source }
    selected.add(segment); segment.splitBy = cause
  }
  const singleOrdering = (left: Segment, right: Segment): number => crossings(left.outgoingCoordinates, right.start, right.end) + crossings(right.incomingCoordinates, left.start, left.end)
  const rate = (original: Segment, left: Segment, right: Segment, freeArea: FreeArea): AreaRating => {
    const center = (freeArea.start + freeArea.end) / 2
    left.outgoingCoordinates.length = 0; left.outgoingCoordinates.push(center); right.incomingCoordinates.length = 0; right.incomingCoordinates.push(center)
    const result: AreaRating = { dependencies: 0, crossings: 0 }
    const update = (a: Segment, b: Segment): void => { const first = singleOrdering(a, b), second = singleOrdering(b, a); if (first === second) { if (first > 0) { result.dependencies += 2; result.crossings += first } } else { result.dependencies += 1; result.crossings += Math.min(first, second) } }
    for (const dependency of original.incoming) { update(left, dependency.source); update(right, dependency.source) }
    for (const dependency of original.outgoing) { update(left, dependency.target); update(right, dependency.target) }
    result.dependencies += 2; result.crossings += singleOrdering(left, original.splitBy!); result.crossings += singleOrdering(original.splitBy!, right)
    return result
  }
  for (const segment of [...selected].sort((a, b) => (a.end - a.start) - (b.end - b.start))) {
    let first = -1, last = -1
    for (let index = 0; index < free.length; index++) { const current = free[index]!; if (current.start > segment.end) break; if (current.end >= segment.start) { if (first < 0) first = index; last = index } }
    let position = (segment.start + segment.end) / 2
    if (first >= 0) {
      let best = first
      if (first < last) {
        const simulated = newSegment(), partner = newSegment()
        simulated.incomingCoordinates.push(...segment.incomingCoordinates); simulated.splitBy = segment.splitBy; simulated.splitPartner = partner; recomputeExtent(simulated)
        partner.outgoingCoordinates.push(...segment.outgoingCoordinates); partner.splitPartner = simulated; recomputeExtent(partner)
        let bestArea = free[best]!, bestRating = rate(segment, simulated, partner, bestArea)
        for (let index = first + 1; index <= last; index++) { const current = free[index]!, rating = rate(segment, simulated, partner, current); if (rating.crossings < bestRating.crossings || rating.crossings === bestRating.crossings && (rating.dependencies < bestRating.dependencies || rating.dependencies === bestRating.dependencies && current.size > bestArea.size)) { best = index; bestArea = current; bestRating = rating } }
      }
      const old = free[best]!; position = (old.start + old.end) / 2; free.splice(best, 1)
      if (old.size / 2 >= critical) { let insertion = best; const center = (old.start + old.end) / 2; if (old.start <= center - critical) free.splice(insertion++, 0, area(old.start, center - critical)); if (center + critical <= old.end) free.splice(insertion, 0, area(center + critical, old.end)) }
    }
    const partner = newSegment(); segment.splitPartner = partner; partner.splitPartner = segment
    partner.outgoingCoordinates.push(...segment.outgoingCoordinates); segment.outgoingCoordinates.length = 0; segment.outgoingCoordinates.push(position); partner.incomingCoordinates.push(position)
    recomputeExtent(segment); recomputeExtent(partner)
    while (segment.incoming.length > 0) removeDependency(segment.incoming[0]!); while (segment.outgoing.length > 0) removeDependency(segment.outgoing[0]!)
    segments.push(partner)
    addDependency(segment, segment.splitBy!, 1, true); addDependency(segment.splitBy!, partner, 1, true)
    for (const other of segments) if (other !== segment.splitBy && other !== segment && other !== partner) { createDependencies(other, segment, threshold, critical); createDependencies(other, partner, threshold, critical) }
  }
}
