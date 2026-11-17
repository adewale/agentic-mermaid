/*******************************************************************************
 * Copyright (c) 2010, 2014, 2015, 2018, 2019, 2020 Kiel University and others.
 *
 * This program and the accompanying materials are made available under the
 * terms of the Eclipse Public License 2.0 which is available at
 * http://www.eclipse.org/legal/epl-2.0.
 * SPDX-License-Identifier: EPL-2.0
 *******************************************************************************/
import type { Random } from './random.ts'
import type { LayoutNode, LayoutPort, LayoutEdge, LayoutLabel, PortConstraints } from './graph.ts'
import { booleanOption, enumOption, numberOption } from './options.ts'
import type { Options } from './options.ts'

type Node = LayoutNode
type Port = LayoutPort
type Edge = LayoutEdge
type Label = LayoutLabel
type Side = Port['side']
type Point = { x: number; y: number }
type LoopType = 'ONE_SIDE' | 'TWO_SIDES_CORNER' | 'TWO_SIDES_OPPOSING' | 'THREE_SIDES' | 'FOUR_SIDES'
type Alignment = 'CENTER' | 'LEFT' | 'RIGHT' | 'TOP'
const sides: Side[] = ['UNDEFINED', 'NORTH', 'EAST', 'SOUTH', 'WEST']
const cardinalSides = sides.slice(1)
const right = (side: Side): Side => sides[sides.indexOf(side) % 4 + 1]!
const left = (side: Side): Side => sides[(sides.indexOf(side) + 2) % 4 + 1]!
const orderFixed = (constraints: PortConstraints): boolean => constraints === 'FIXED_ORDER' || constraints === 'FIXED_RATIO' || constraints === 'FIXED_POS'
const outgoing = (node: Node): Edge[] => node.ports.flatMap(port => port.outgoing)
const ownSpacing = (node: Node, options: Options, key: string, fallback: number): number => numberOption(node.individualSpacings, key, numberOption(options, key, fallback))
const ordering = (node: Node): 'STACKED' | 'REVERSE_STACKED' | 'SEQUENCED' => enumOption(node.options, 'layered.edgeRouting.selfLoopOrdering', ['STACKED', 'REVERSE_STACKED', 'SEQUENCED'] as const, 'STACKED')

interface SelfLoopPort {
  port: Port
  hadOnlySelfLoops: boolean
  hidden: boolean
  incoming: SelfLoopEdge[]
  outgoing: SelfLoopEdge[]
}
interface SelfLoopEdge { edge: Edge; source: SelfLoopPort; target: SelfLoopPort; loop: SelfHyperLoop }
interface SelfLoopLabels {
  labels: Label[]
  position: Point
  size: Point
  vertical: boolean
  spacing: number
  side: Side
  alignment: Alignment
  reference?: SelfLoopPort
  id: number
}
interface SelfHyperLoop {
  holder: SelfLoopHolder
  ports: SelfLoopPort[]
  edges: Set<SelfLoopEdge>
  labels?: SelfLoopLabels
  type: LoopType
  bySide: Map<Side, SelfLoopPort[]>
  occupied: Set<Side>
  first: SelfLoopPort
  last: SelfLoopPort
  slots: number[]
}
interface SelfLoopHolder {
  node: Node
  loops: SelfHyperLoop[]
  ports: Map<Port, SelfLoopPort>
  hidden: boolean
  originalConstraints: PortConstraints
  slotCounts: number[]
}
export interface SelfLoopState { holders: Map<Node, SelfLoopHolder> }

function setSide(port: Port, side: Side): void {
  port.side = side
  if (port.explicitAnchor) return
  if (side === 'NORTH') { port.anchorX = port.width / 2; port.anchorY = 0 }
  else if (side === 'EAST') { port.anchorX = port.width; port.anchorY = port.height / 2 }
  else if (side === 'SOUTH') { port.anchorX = port.width / 2; port.anchorY = port.height }
  else if (side === 'WEST') { port.anchorX = 0; port.anchorY = port.height / 2 }
}
function addLabels(loop: SelfHyperLoop, labels: Label[], options: Options): void {
  if (labels.length === 0) return
  const direction = enumOption(options, 'direction', ['UNDEFINED', 'RIGHT', 'LEFT', 'DOWN', 'UP'] as const, 'RIGHT')
  const box = loop.labels ??= { labels: [], position: { x: 0, y: 0 }, size: { x: 0, y: 0 }, vertical: direction === 'UP' || direction === 'DOWN', spacing: ownSpacing(loop.holder.node, options, 'spacing.labelLabel', 0), side: 'UNDEFINED', alignment: 'CENTER', id: 0 }
  for (const label of labels) {
    box.labels.push(label)
    if (box.vertical) {
      box.size.x += label.width; box.size.y = Math.max(box.size.y, label.height)
      if (box.labels.length > 1) box.size.x += box.spacing
    } else {
      box.size.x = Math.max(box.size.x, label.width); box.size.y += label.height
      if (box.labels.length > 1) box.size.y += box.spacing
    }
  }
}
function createHolder(node: Node, options: Options): SelfLoopHolder {
  const holder: SelfLoopHolder = { node, loops: [], ports: new Map(), hidden: false, originalConstraints: node.originalPortConstraints ?? node.portConstraints, slotCounts: [0, 0, 0, 0, 0] }
  const portFor = (port: Port): SelfLoopPort => {
    let value = holder.ports.get(port)
    if (value === undefined) {
      value = { port, hadOnlySelfLoops: port.incoming.concat(port.outgoing).every(edge => edge.source.node === edge.target.node), hidden: false, incoming: [], outgoing: [] }
      holder.ports.set(port, value)
    }
    return value
  }
  for (const edge of outgoing(node)) if (edge.source.node === edge.target.node) {
    const source = portFor(edge.source), target = portFor(edge.target)
    const slEdge = { edge, source, target } as SelfLoopEdge
    source.outgoing.push(slEdge); target.incoming.push(slEdge)
  }
  const visited = new Set<SelfLoopPort>()
  for (const start of holder.ports.values()) if (!visited.has(start)) {
    const loop = { holder, ports: [], edges: new Set(), bySide: new Map(), occupied: new Set(), slots: [0, 0, 0, 0, 0] } as unknown as SelfHyperLoop
    const queue = [start]
    for (let i = 0; i < queue.length; i++) {
      const port = queue[i]!
      visited.add(port)
      const add = (edge: SelfLoopEdge, next: SelfLoopPort): void => {
        if (!loop.edges.has(edge)) {
          loop.edges.add(edge); edge.loop = loop
          if (!loop.ports.includes(edge.source)) loop.ports.push(edge.source)
          if (!loop.ports.includes(edge.target)) loop.ports.push(edge.target)
          addLabels(loop, edge.edge.labels, options)
        }
        if (!visited.has(next)) queue.push(next)
      }
      for (const edge of port.outgoing) add(edge, edge.target)
      for (const edge of port.incoming) add(edge, edge.source)
    }
    holder.loops.push(loop)
  }
  return holder
}

/** SelfLoopPreProcessor, ELK v0.11.0 at 54123e884b1ae743b453260f713b20c9bf5787f2. */
export function preprocessSelfLoops(nodes: Node[], options: Options): SelfLoopState {
  const state: SelfLoopState = { holders: new Map() }
  for (const node of nodes) if (node.type === 'NORMAL' && outgoing(node).some(edge => edge.source.node === edge.target.node)) {
    const holder = createHolder(node, options)
    state.holders.set(node, holder)
    // The native graph retains stable endpoint/owner references. Active graph
    // membership is carried by these ordered adjacency and ownership arrays.
    for (const loop of holder.loops) for (const { edge } of loop.edges) {
      edge.source.outgoing.splice(edge.source.outgoing.indexOf(edge), 1)
      edge.target.incoming.splice(edge.target.incoming.indexOf(edge), 1)
    }
    if (!orderFixed(node.portConstraints)) for (const port of holder.ports.values()) if (port.hadOnlySelfLoops) {
      node.ports.splice(node.ports.indexOf(port.port), 1)
      port.hidden = true; holder.hidden = true
    }
  }
  return state
}

function assignPortSides(holder: SelfLoopHolder): void {
  const distribution = enumOption(holder.node.options, 'layered.edgeRouting.selfLoopDistribution', ['EQUALLY', 'NORTH', 'NORTH_SOUTH'] as const, 'NORTH')
  if (distribution === 'NORTH') {
    for (const loop of holder.loops) for (const port of loop.ports) if (port.hidden) setSide(port.port, 'NORTH')
  } else if (distribution === 'NORTH_SOUTH') {
    let north = 0, south = 0
    for (const loop of holder.loops) {
      const ports = loop.ports.filter(port => port.hidden), side = north <= south ? 'NORTH' : 'SOUTH'
      if (side === 'NORTH') north += ports.length; else south += ports.length
      for (const port of ports) setSide(port.port, side)
    }
  } else {
    const targets: Array<[Side, Side]> = [['NORTH', 'NORTH'], ['SOUTH', 'SOUTH'], ['EAST', 'EAST'], ['WEST', 'WEST'], ['WEST', 'NORTH'], ['NORTH', 'EAST'], ['SOUTH', 'WEST'], ['EAST', 'SOUTH']]
    const loops = holder.loops.slice().sort((a, b) => b.ports.length - a.ports.length)
    for (let i = 0; i < loops.length; i++) {
      const loop = loops[i]!, [first, second] = targets[i % targets.length]!
      if (first !== second) loop.ports.sort((a, b) => (a.port.incoming.length - a.port.outgoing.length) - (b.port.incoming.length - b.port.outgoing.length))
      const split = Math.trunc(loop.ports.length / 2)
      for (let j = 0; j < loop.ports.length; j++) if (loop.ports[j]!.hidden) setSide(loop.ports[j]!.port, j < split ? first : second)
    }
  }
}
function computePortsPerSide(loop: SelfHyperLoop): void {
  loop.bySide.clear()
  for (const port of loop.ports) {
    const side = port.port.side
    if (side === 'UNDEFINED') throw new Error('Port sides must not contain UNDEFINED')
    if (!loop.bySide.has(side)) loop.bySide.set(side, [])
    loop.bySide.get(side)!.push(port)
  }
  const count = loop.bySide.size
  loop.type = count === 1 ? 'ONE_SIDE' : count === 3 ? 'THREE_SIDES' : count === 4 ? 'FOUR_SIDES' : loop.bySide.has('EAST') && loop.bySide.has('WEST') || loop.bySide.has('NORTH') && loop.bySide.has('SOUTH') ? 'TWO_SIDES_OPPOSING' : 'TWO_SIDES_CORNER'
}
function twoSides(loop: SelfHyperLoop): Side[] {
  const result = [...loop.bySide.keys()].sort((a, b) => sides.indexOf(a) - sides.indexOf(b))
  if (result[0] === 'NORTH' && result[1] === 'WEST') { result[0] = 'WEST'; result[1] = 'NORTH' }
  return result
}
function restorePorts(holder: SelfLoopHolder): void {
  const areas = new Map<Side, SelfLoopPort[][]>()
  for (const side of sides) areas.set(side, [[], [], []])
  const byType = (type: LoopType): SelfHyperLoop[] => holder.loops.filter(loop => loop.type === type)
  const add = (ports: SelfLoopPort[], side: Side, area: number, prepend: boolean): void => {
    const hidden = ports.filter(port => port.hidden).reverse(), target = areas.get(side)![area]!
    if (prepend) target.unshift(...hidden); else target.push(...hidden)
  }
  const addLoop = (loop: SelfHyperLoop, side: Side, area: number, prepend: boolean): void => add(loop.bySide.get(side)!, side, area, prepend)
  const strategy = ordering(holder.node), oneSideLoops = byType('ONE_SIDE')
  if (strategy === 'REVERSE_STACKED') oneSideLoops.reverse()
  for (const loop of oneSideLoops) {
    const side = loop.ports[0]!.port.side
    const ports = loop.ports.slice().sort((a, b) => (a.incoming.length - a.outgoing.length) - (b.incoming.length - b.outgoing.length))
    if (strategy === 'SEQUENCED') add(ports, side, 1, false)
    else {
      let positive = 0
      while (positive < ports.length && ports[positive]!.incoming.length - ports[positive]!.outgoing.length <= 0) positive++
      let nonnegative = 0
      while (nonnegative < ports.length && ports[nonnegative]!.incoming.length - ports[nonnegative]!.outgoing.length <= 0) nonnegative++
      const split = positive > 0 && positive < ports.length - 1 ? positive : nonnegative > 0 && positive < ports.length - 1 ? nonnegative : Math.trunc(ports.length / 2)
      add(ports.slice(0, split), side, 1, true); add(ports.slice(split), side, 1, false)
    }
  }
  for (const loop of byType('TWO_SIDES_CORNER')) { const pair = twoSides(loop); addLoop(loop, pair[0]!, 2, true); addLoop(loop, pair[1]!, 0, false) }
  for (const loop of byType('THREE_SIDES')) {
    const missing = cardinalSides.find(side => !loop.bySide.has(side))!
    const first = right(missing), middle = right(first), last = right(middle)
    addLoop(loop, first, 2, true); addLoop(loop, middle, 1, false); addLoop(loop, last, 0, false)
  }
  for (const loop of byType('FOUR_SIDES')) for (const side of loop.bySide.keys()) addLoop(loop, side, 1, false)
  for (const loop of byType('TWO_SIDES_OPPOSING')) { const pair = twoSides(loop); addLoop(loop, pair[0]!, 2, true); addLoop(loop, pair[1]!, 0, false) }
  const node = holder.node, old = node.ports.slice()
  node.ports.length = 0
  let next = 0
  const append = (side: Side, area: number): void => { for (const port of areas.get(side)![area]!) node.ports.push(port.port) }
  const burst = (test: (port: Port) => boolean): void => { while (next < old.length && test(old[next]!)) node.ports.push(old[next++]!) }
  const connects = (port: Port, side: Side): boolean => port.portDummy?.ports.some(dummy => dummy.originPort === port && dummy.incoming.length + dummy.outgoing.length > 0 && dummy.side === side) ?? false
  append('NORTH', 0); burst(port => port.side === 'NORTH' && connects(port, 'WEST')); append('NORTH', 1); burst(port => port.side === 'NORTH'); append('NORTH', 2)
  append('EAST', 0); append('EAST', 1); burst(port => port.side === 'EAST'); append('EAST', 2)
  append('SOUTH', 0); burst(port => port.side === 'SOUTH' && connects(port, 'EAST')); append('SOUTH', 1); burst(port => port.side === 'SOUTH'); append('SOUTH', 2)
  append('WEST', 0); burst(port => port.side === 'WEST'); append('WEST', 1); append('WEST', 2)
  for (const side of sides) for (const area of areas.get(side)!) for (const port of area) port.hidden = false
  holder.hidden = false
}

/** SelfLoopPortRestorer; call after crossing and before node/port sizing. */
export function restoreSelfLoopPorts(layers: Node[][], state: SelfLoopState): void {
  for (const layer of layers) for (const node of layer) {
    const holder = state.holders.get(node)
    if (node.type !== 'NORMAL' || holder === undefined) continue
    if (holder.hidden) {
      const original = holder.originalConstraints
      if (original === 'UNDEFINED' || original === 'FREE') assignPortSides(holder)
      if (original === 'UNDEFINED' || original === 'FREE' || original === 'FIXED_SIDE') {
        for (const loop of holder.loops) computePortsPerSide(loop)
        restorePorts(holder)
      }
    } else for (const loop of holder.loops) computePortsPerSide(loop)
  }
}

function determineLoopRoutes(holder: SelfLoopHolder): void {
  const ids = new Map(holder.node.ports.map((port, index) => [port, index]))
  let penalties: number[] | undefined
  const penalty = (first: SelfLoopPort, last: SelfLoopPort): number => {
    if (penalties === undefined) {
      penalties = []; let sum = 0
      for (const port of holder.node.ports) { sum += port.incoming.length === 0 && port.outgoing.length === 0 ? 1 : 3; penalties.push(sum) }
    }
    const start = ids.get(first.port)!, end = ids.get(last.port)!, beforeEnd = end - 1 < 0 ? holder.node.ports.length - 1 : end - 1
    return start <= beforeEnd ? penalties[beforeEnd]! - penalties[start]! : penalties.at(-1)! - penalties[start]! + penalties[beforeEnd]!
  }
  for (const loop of holder.loops) {
    loop.ports.sort((a, b) => ids.get(a.port)! - ids.get(b.port)!)
    const lowest = (side: Side): SelfLoopPort => loop.bySide.get(side)!.reduce((a, b) => ids.get(a.port)! <= ids.get(b.port)! ? a : b)
    const highest = (side: Side): SelfLoopPort => loop.bySide.get(side)!.reduce((a, b) => ids.get(a.port)! >= ids.get(b.port)! ? a : b)
    const assign = (first: Side, last: Side): void => { loop.first = lowest(first); loop.last = highest(last) }
    if (loop.type === 'ONE_SIDE') assign(loop.ports[0]!.port.side, loop.ports[0]!.port.side)
    else if (loop.type === 'TWO_SIDES_CORNER') { const pair = twoSides(loop); assign(pair[0]!, pair[1]!) }
    else if (loop.type === 'TWO_SIDES_OPPOSING') {
      const pair = [...loop.bySide.keys()], first1 = lowest(pair[0]!), last1 = highest(pair[1]!), first2 = lowest(pair[1]!), last2 = highest(pair[0]!)
      if (penalty(first1, last1) <= penalty(first2, last2)) { loop.first = first1; loop.last = last1 }
      else { loop.first = first2; loop.last = last2 }
    } else if (loop.type === 'THREE_SIDES') {
      const missing = cardinalSides.find(side => !loop.bySide.has(side))!
      assign(right(missing), left(missing))
    } else {
      let worstFirst = loop.ports.at(-1)!, worstLast = loop.ports[0]!, worstPenalty = penalty(worstFirst, worstLast)
      for (let i = 1; i < loop.ports.length; i++) {
        const first = loop.ports[i - 1]!, last = loop.ports[i]!, current = penalty(first, last)
        if (current > worstPenalty) { worstFirst = first; worstLast = last; worstPenalty = current }
      }
      loop.first = worstLast; loop.last = worstFirst
    }
    let side = loop.first.port.side
    while (side !== loop.last.port.side) { loop.occupied.add(side); side = right(side) }
    loop.occupied.add(side)
  }
}

function placeLabels(holder: SelfLoopHolder): void {
  const sequenced = ordering(holder.node) === 'SEQUENCED', northern: SelfHyperLoop[] = [], southern: SelfHyperLoop[] = []
  const assign = (loop: SelfHyperLoop, side: Side, alignment: Alignment, reference?: SelfLoopPort): void => {
    const box = loop.labels!; box.side = side; box.alignment = alignment; box.reference = reference
  }
  const clearInline = (loop: SelfHyperLoop): void => { for (const label of loop.labels!.labels) label.options.delete('edgeLabels.inline') }
  for (const loop of holder.loops) {
    if (loop.labels === undefined) continue
    if (loop.type === 'ONE_SIDE') {
      const side = cardinalSides.find(value => loop.occupied.has(value))!
      if (sequenced && side === 'NORTH') northern.push(loop)
      else if (sequenced && side === 'SOUTH') southern.push(loop)
      else {
        clearInline(loop)
        if (side === 'EAST' || side === 'WEST') assign(loop, side, 'TOP', loop.last.port.y < loop.first.port.y ? loop.last : loop.first)
        else assign(loop, side, 'CENTER')
      }
    } else if (loop.type === 'TWO_SIDES_CORNER') {
      clearInline(loop)
      if (loop.first.port.side === 'NORTH') assign(loop, 'NORTH', 'LEFT', loop.first)
      else if (loop.last.port.side === 'NORTH') assign(loop, 'NORTH', 'RIGHT', loop.last)
      else if (loop.first.port.side === 'SOUTH') assign(loop, 'SOUTH', 'RIGHT', loop.first)
      else if (loop.last.port.side === 'SOUTH') assign(loop, 'SOUTH', 'LEFT', loop.last)
    } else if (loop.type === 'FOUR_SIDES') {
      clearInline(loop)
      // The source tests the leftmost port twice here.
      assign(loop, loop.first.port.side === 'NORTH' ? 'SOUTH' : 'NORTH', 'CENTER')
    } else {
      const inline = loop.labels.labels.some(label => booleanOption(label.options, 'edgeLabels.inline', false))
      if (!loop.occupied.has('NORTH')) assign(loop, 'SOUTH', 'CENTER')
      else if (!loop.occupied.has('SOUTH')) assign(loop, 'NORTH', 'CENTER')
      else if (!loop.occupied.has('WEST')) assign(loop, inline ? 'EAST' : 'NORTH', inline ? 'CENTER' : 'LEFT', inline ? undefined : loop.first)
      else if (!loop.occupied.has('EAST')) assign(loop, inline ? 'WEST' : 'NORTH', inline ? 'CENTER' : 'RIGHT', inline ? undefined : loop.last)
    }
  }
  for (const [loops, side] of [[northern, 'NORTH'], [southern, 'SOUTH']] as const) {
    const ids = new Map(holder.node.ports.map((port, index) => [port, index]))
    loops.sort((a, b) => side === 'NORTH' ? ids.get(a.first.port)! - ids.get(b.first.port)! : ids.get(b.first.port)! - ids.get(a.first.port)!)
    let first = 0, last = loops.length - 1
    while (first < last) {
      const a = loops[first++]!, b = loops[last--]!
      assign(a, side, 'RIGHT', side === 'NORTH' ? a.last : a.first)
      assign(b, side, 'LEFT', side === 'NORTH' ? b.first : b.last)
    }
    if (first === last) assign(loops[first]!, side, 'CENTER')
  }
  for (const loop of holder.loops) if (loop.labels !== undefined) {
    const box = loop.labels, reference = box.reference?.port
    if (box.alignment === 'CENTER') box.position.x = (holder.node.width - box.size.x) / 2
    else if (box.alignment === 'LEFT') box.position.x = reference!.x + reference!.anchorX
    else if (box.alignment === 'RIGHT') box.position.x = reference!.x + reference!.anchorX - box.size.x
    else box.position.y = reference!.y + reference!.anchorY
  }
}

interface Segment { incoming: Dependency[]; outgoing: Dependency[]; mark: number; inWeight: number; outWeight: number; slot: number }
interface Dependency { source: Segment; target: Segment; weight: number }
function breakNonCriticalCycles(segments: Segment[], random: Random): void {
  const sources: Segment[] = [], sinks: Segment[] = []
  for (let i = 0; i < segments.length; i++) {
    const segment = segments[i]!; segment.mark = -i - 1
    // GWT's IntStream.sum narrows its long accumulator with toInt_0 here.
    segment.inWeight = segment.incoming.reduce((sum, edge) => sum + edge.weight, 0) | 0
    segment.outWeight = segment.outgoing.reduce((sum, edge) => sum + edge.weight, 0) | 0
    if (segment.outWeight === 0) sinks.push(segment)
    else if (segment.inWeight === 0) sources.push(segment)
  }
  const unprocessed = new Set(segments.toReversed()), base = segments.length
  let nextSink = base - 1, nextSource = base + 1, sourceHead = 0, sinkHead = 0
  const update = (segment: Segment): void => {
    for (const edge of segment.outgoing) if (edge.target.mark < 0 && edge.weight > 0) { edge.target.inWeight -= edge.weight; if (edge.target.inWeight <= 0 && edge.target.outWeight > 0) sources.push(edge.target) }
    for (const edge of segment.incoming) if (edge.source.mark < 0 && edge.weight > 0) { edge.source.outWeight -= edge.weight; if (edge.source.outWeight <= 0 && edge.source.inWeight > 0) sinks.push(edge.source) }
  }
  while (unprocessed.size > 0) {
    while (sinkHead < sinks.length) { const segment = sinks[sinkHead++]!; unprocessed.delete(segment); segment.mark = nextSink--; update(segment) }
    while (sourceHead < sources.length) { const segment = sources[sourceHead++]!; unprocessed.delete(segment); segment.mark = nextSource++; update(segment) }
    let maximum = -2147483648; const choices: Segment[] = []
    for (const segment of unprocessed) {
      const flow = segment.outWeight - segment.inWeight
      if (flow >= maximum) { if (flow > maximum) { maximum = flow; choices.length = 0 }; choices.push(segment) }
    }
    if (choices.length > 0) { const segment = choices[random.nextInt(choices.length)]!; unprocessed.delete(segment); segment.mark = nextSource++; update(segment) }
  }
  for (const segment of segments) if (segment.mark < base) segment.mark += segments.length + 1
  const reverse: Dependency[] = []
  for (const segment of segments) for (const edge of segment.outgoing) if (segment.mark > edge.target.mark) reverse.push(edge)
  for (const edge of reverse) {
    const source = edge.source, target = edge.target
    source.outgoing.splice(source.outgoing.indexOf(edge), 1); target.incoming.splice(target.incoming.indexOf(edge), 1)
    if (edge.weight !== 0) { edge.source = target; edge.target = source; target.outgoing.push(edge); source.incoming.push(edge) }
  }
}
function setSlot(loop: SelfHyperLoop, side: Side, slot: number): void {
  const index = sides.indexOf(side)
  loop.slots[index] = slot; loop.holder.slotCounts[index] = Math.max(loop.holder.slotCounts[index]!, slot + 1)
}
function assignRoutingSlots(holder: SelfLoopHolder, random: Random): void {
  let labelCount = 0
  for (const loop of holder.loops) if (loop.labels !== undefined) loop.labels.id = labelCount++
  const crossing = Array.from({ length: labelCount }, () => new Array<boolean>(labelCount).fill(false))
  for (let i = 0; i < holder.loops.length; i++) for (let j = i + 1; j < holder.loops.length; j++) {
    const a = holder.loops[i]!.labels, b = holder.loops[j]!.labels
    if (a !== undefined && b !== undefined && a.side === b.side && a.side !== 'EAST' && a.side !== 'WEST') {
      const overlap = a.position.x <= b.position.x + b.size.x && a.position.x + a.size.x >= b.position.x
      crossing[a.id]![b.id] = overlap; crossing[b.id]![a.id] = overlap
    }
  }
  const segments: Segment[] = holder.loops.map(() => ({ incoming: [], outgoing: [], mark: 0, inWeight: 0, outWeight: 0, slot: 0 }))
  const ids = new Map(holder.node.ports.map((port, index) => [port, index]))
  const activity = holder.loops.map(loop => {
    const active = new Array<boolean>(holder.node.ports.length).fill(false)
    let index = ids.get(loop.first.port)! - 1
    const target = ids.get(loop.last.port)!
    while (index !== target) { index = (index + 1) % active.length; active[index] = true }
    return active
  })
  const add = (source: Segment, target: Segment, weight: number): void => { const edge = { source, target, weight }; source.outgoing.push(edge); target.incoming.push(edge) }
  const labelsOverlap = (a: SelfHyperLoop, b: SelfHyperLoop): boolean => a.labels !== undefined && b.labels !== undefined && crossing[a.labels.id]![b.labels.id]!
  for (let i = 0; i < holder.loops.length - 1; i++) for (let j = i + 1; j < holder.loops.length; j++) {
    const a = holder.loops[i]!, b = holder.loops[j]!
    const first = a.ports.reduce((sum, port) => sum + (activity[j]![ids.get(port.port)!] ? 1 : 0), 0)
    const second = b.ports.reduce((sum, port) => sum + (activity[i]![ids.get(port.port)!] ? 1 : 0), 0)
    if (first < second) add(segments[i]!, segments[j]!, second - first)
    else if (second < first) add(segments[j]!, segments[i]!, first - second)
    else if (first !== 0 || labelsOverlap(a, b)) { add(segments[i]!, segments[j]!, 0); add(segments[j]!, segments[i]!, 0) }
  }
  breakNonCriticalCycles(segments, random)
  const sinks: Segment[] = []
  for (const segment of segments) {
    segment.inWeight = segment.incoming.length; segment.outWeight = segment.outgoing.length
    if (segment.outWeight === 0) { segment.slot = 0; sinks.push(segment) }
  }
  for (let i = 0; i < sinks.length; i++) {
    const segment = sinks[i]!, next = segment.slot + 1
    for (const edge of segment.incoming) { edge.source.slot = Math.max(edge.source.slot, next); edge.source.outWeight--; if (edge.source.outWeight === 0) sinks.push(edge.source) }
  }
  for (let i = 0; i < holder.loops.length; i++) for (const side of cardinalSides) if (holder.loops[i]!.occupied.has(side)) setSlot(holder.loops[i]!, side, segments[i]!.slot)
  const nextFree = new Array<number>(holder.node.ports.length).fill(0)
  for (const side of cardinalSides) {
    const loops = holder.loops.filter(loop => loop.occupied.has(side)).sort((a, b) => a.slots[sides.indexOf(side)]! - b.slots[sides.indexOf(side)]!)
    let min = 2147483647, max = -2147483648
    for (const port of holder.node.ports) if (port.side === side) { min = Math.min(min, ids.get(port)!); max = Math.max(max, ids.get(port)!) }
    if (min === 2147483647) { for (let i = 0; i < loops.length; i++) setSlot(loops[i]!, side, i); continue }
    const labelSlots = new Array<number>(labelCount).fill(-1)
    for (const loop of loops) {
      const active = activity[holder.loops.indexOf(loop)]!
      let lowest = 0
      for (let i = min; i <= max; i++) if (active[i]) lowest = Math.max(lowest, nextFree[i]!)
      if (loop.labels !== undefined) {
        const conflicts = new Set<number>()
        for (let i = 0; i < labelCount; i++) if (crossing[loop.labels.id]![i]) conflicts.add(labelSlots[i]!)
        while (conflicts.has(lowest)) lowest++
      }
      setSlot(loop, side, lowest)
      for (let i = min; i <= max; i++) if (active[i]) nextFree[i] = lowest + 1
      if (loop.labels !== undefined) labelSlots[loop.labels.id] = lowest
    }
  }
}

function routeOrthogonal(holder: SelfLoopHolder, options: Options): void {
  const node = holder.node, distance = ownSpacing(node, options, 'spacing.nodeSelfLoop', 10)
  const edgeDistance = ownSpacing(node, options, 'spacing.edgeEdge', 10), labelDistance = ownSpacing(node, options, 'spacing.edgeLabel', 2)
  const positions = holder.slotCounts.map(count => new Array<number>(count).fill(0))
  for (const side of ['NORTH', 'SOUTH'] as const) for (const loop of holder.loops) if (loop.labels?.side === side) {
    const index = sides.indexOf(side), slot = loop.slots[index]!
    positions[index]![slot] = Math.max(positions[index]![slot]!, loop.labels.size.y)
  }
  for (const side of cardinalSides) {
    const index = sides.indexOf(side), factor = side === 'NORTH' || side === 'WEST' ? -1 : 1
    let current = side === 'NORTH' ? -node.margin.top - distance : side === 'EAST' ? node.width + node.margin.right + distance : side === 'SOUTH' ? node.height + node.margin.bottom + distance : -node.margin.left - distance
    for (let slot = 0; slot < positions[index]!.length; slot++) {
      let labelSize = positions[index]![slot]!
      if (labelSize > 0) labelSize += labelDistance
      positions[index]![slot] = current
      current += factor * (labelSize + edgeDistance)
    }
  }
  const margins = { ...node.margin }
  const cover = (point: Point): void => {
    margins.left = Math.max(margins.left, -point.x); margins.right = Math.max(margins.right, point.x - node.width)
    margins.top = Math.max(margins.top, -point.y); margins.bottom = Math.max(margins.bottom, point.y - node.height)
  }
  const base = (loop: SelfHyperLoop, side: Side): Point => {
    const index = sides.indexOf(side), position = positions[index]![loop.slots[index]!]!
    return side === 'NORTH' || side === 'SOUTH' ? { x: 0, y: position } : { x: position, y: 0 }
  }
  for (const loop of holder.loops) {
    for (const edge of loop.edges) {
      const source = edge.source.port, target = edge.target.port
      const clockwise = source.side === target.side ? node.ports.indexOf(source) < node.ports.indexOf(target) : right(source.side) === target.side ? true : left(source.side) === target.side ? false : loop.occupied.has(right(source.side))
      const points: Point[] = []
      const outer = (port: Port): void => {
        const point = base(loop, port.side), anchor = { x: port.x + port.anchorX, y: port.y + port.anchorY }
        if (port.side === 'NORTH' || port.side === 'SOUTH') point.x += anchor.x
        else point.y += anchor.y
        points.push(point)
      }
      outer(source)
      if (source.side !== target.side) {
        const inline = edge.edge.labels.some(label => booleanOption(label.options, 'edgeLabels.inline', false))
        let current = source.side
        const adjust = (point: Point, side: Side): void => {
          if (!inline || loop.labels === undefined || side !== loop.labels.side) return
          if (side === 'NORTH') point.y -= loop.labels.size.y / 2
          else if (side === 'SOUTH') point.y += loop.labels.size.y / 2
          else if (side === 'WEST') point.x -= loop.labels.size.x / 2
          else if (side === 'EAST') point.x += loop.labels.size.x / 2
        }
        while (current !== target.side) {
          const next = clockwise ? right(current) : left(current), a = base(loop, current), b = base(loop, next)
          if (loop.labels?.side === current) adjust(a, current)
          else if (loop.labels?.side === next) adjust(b, next)
          points.push({ x: a.x + b.x, y: a.y + b.y }); current = next
        }
      }
      outer(target)
      edge.edge.bends.length = 0; edge.edge.bends.push(...points)
      for (const point of points) cover(point)
    }
    const box = loop.labels
    if (box !== undefined) {
      const index = sides.indexOf(box.side), slot = loop.slots[index]!
      let position = positions[index]![slot]!
      const spacing = box.labels.some(label => booleanOption(label.options, 'edgeLabels.inline', false)) ? 0 : labelDistance
      if (box.side === 'NORTH') { position -= spacing + box.size.y; box.position.y = position }
      else if (box.side === 'SOUTH') { position += spacing; box.position.y = position }
      else if (box.side === 'WEST') { position -= spacing + box.size.x; box.position.x = position }
      else if (box.side === 'EAST') { position += spacing; box.position.x = position }
      cover(box.position); cover({ x: box.position.x + box.size.x, y: box.position.y + box.size.y })
    }
  }
  node.margin.top = margins.top; node.margin.bottom = margins.bottom; node.margin.left = margins.left; node.margin.right = margins.right
}

/** SelfLoopRouter; call after innermost margins and before node placement. */
export function routeSelfLoops(layers: Node[][], options: Options, random: Random, state: SelfLoopState): void {
  const routing = enumOption(options, 'edgeRouting', ['UNDEFINED', 'POLYLINE', 'ORTHOGONAL', 'SPLINES'] as const, 'ORTHOGONAL')
  if (routing === 'POLYLINE' || routing === 'SPLINES') throw new Error('ELK TypeScript port: ' + routing + ' self-loop routing is not implemented yet')
  for (const layer of layers) for (const node of layer) {
    const holder = state.holders.get(node)
    if (node.type !== 'NORMAL' || holder === undefined) continue
    determineLoopRoutes(holder); placeLabels(holder); assignRoutingSlots(holder, random); routeOrthogonal(holder, options)
  }
}

/** SelfLoopPostProcessor; call after long-edge joining, before edge restoration. */
export function postprocessSelfLoops(layers: Node[][], state: SelfLoopState): void {
  for (const layer of layers) for (const node of layer) {
    const holder = state.holders.get(node)
    if (node.type !== 'NORMAL' || holder === undefined) continue
    for (const loop of holder.loops) for (const edge of loop.edges) {
      const outgoingIndex = edge.edge.source.outgoing.indexOf(edge.edge), incomingIndex = edge.edge.target.incoming.indexOf(edge.edge)
      if (outgoingIndex >= 0) edge.edge.source.outgoing.splice(outgoingIndex, 1)
      if (incomingIndex >= 0) edge.edge.target.incoming.splice(incomingIndex, 1)
      edge.edge.source = edge.source.port; edge.edge.target = edge.target.port
      edge.edge.source.outgoing.push(edge.edge); edge.edge.target.incoming.push(edge.edge)
      for (const point of edge.edge.bends) { point.x += node.x; point.y += node.y }
    }
    for (const loop of holder.loops) if (loop.labels !== undefined) {
      const box = loop.labels
      let x = box.position.x, y = box.position.y
      for (const label of box.labels) {
        if (box.vertical) {
          label.x = x; label.y = box.side === 'NORTH' ? y + box.size.y - label.height : y
        } else {
          label.x = box.alignment === 'LEFT' || box.side === 'EAST' ? x : box.alignment === 'RIGHT' || box.side === 'WEST' ? x + box.size.x - label.width : x + (box.size.x - label.width) / 2
          label.y = y
        }
        label.x += node.x; label.y += node.y
        if (box.vertical) x += label.width + box.spacing
        else y += label.height + box.spacing
      }
    }
  }
}
