/*******************************************************************************
 * Copyright (c) 2010, 2014, 2015, 2016, 2017, 2013 Kiel University and others.
 * This program and the accompanying materials are made available under the
 * terms of the Eclipse Public License 2.0 which is available at
 * https://www.eclipse.org/legal/epl-2.0/.
 * SPDX-License-Identifier: EPL-2.0
 *******************************************************************************/
import { providePort, isSideFixed, type LayoutNode, type LayoutPort, type LayoutEdge, type LayoutGraph, type LayoutLabel } from './graph.ts'
import { createExternalPortDummy } from './external-ports.ts'
import { booleanOption, enumOption, numberOption, setOption, type Options } from './options.ts'

type Flow = 'INPUT' | 'OUTPUT'
export interface HierarchySegment { edge: LayoutEdge; graph: LayoutGraph; type: Flow }
export interface CompoundState { root: LayoutGraph; segments: Map<LayoutEdge, HierarchySegment[]> }
interface ExternalPort { originalEdges: LayoutEdge[]; newEdge: LayoutEdge; dummyNode: LayoutNode; outerPort: LayoutPort; type: Flow; exported: boolean }
const nodesOf = (graph: LayoutGraph): LayoutNode[] => graph.layerlessNodes ?? graph.nodes.filter(node => !node.noLayout)
function detach(edge: LayoutEdge): void { const source = edge.source.outgoing.indexOf(edge), target = edge.target.incoming.indexOf(edge); if (source >= 0) edge.source.outgoing.splice(source, 1); if (target >= 0) edge.target.incoming.splice(target, 1) }
function attach(edge: LayoutEdge, source: LayoutPort, target: LayoutPort): void { detach(edge); edge.source = source; edge.target = target; source.outgoing.push(edge); target.incoming.push(edge) }
function dummyEdge(original: LayoutEdge, source: LayoutPort, target: LayoutPort): LayoutEdge {
  const edge: LayoutEdge = { ...original, options: new Map(original.options), labels: [], sourceLabels: [], bends: [], junctions: undefined }
  edge.options.delete('junctionPoints'); attach(edge, source, target); return edge
}
function descendant(child: LayoutNode, parent: LayoutNode): boolean { for (let node = child.layoutGraph?.parentNode; node !== undefined; node = node.layoutGraph?.parentNode) if (node === parent) return true; return false }
function setSide(port: LayoutPort, side: LayoutPort['side']): void {
  port.side = side
  if (port.explicitAnchor) return
  if (side === 'NORTH') { port.anchorX = port.width / 2; port.anchorY = 0 }
  else if (side === 'EAST') { port.anchorX = port.width; port.anchorY = port.height / 2 }
  else if (side === 'SOUTH') { port.anchorX = port.width / 2; port.anchorY = port.height }
  else if (side === 'WEST') { port.anchorX = 0; port.anchorY = port.height / 2 }
}
function netFlow(port: LayoutPort): number {
  const node = port.node, inside = booleanOption(node.options, 'insideSelfLoops.activate', false)
  let output = 0, input = 0
  for (const edge of port.outgoing) {
    const loop = edge.target.node === node, inner = loop && inside && booleanOption(edge.options, 'insideSelfLoops.yo', false)
    if (inner) input++; else if (loop) output++; else if (edge.target.node.layoutGraph?.parentNode === node) input++; else output++
  }
  for (const edge of port.incoming) {
    const loop = edge.source.node === node, inner = loop && inside && booleanOption(edge.options, 'insideSelfLoops.yo', false)
    if (inner) output++; else if (loop) input++; else if (edge.source.node.layoutGraph?.parentNode === node) output++; else input++
  }
  return output - input
}
function labelInsidePart(label: LayoutLabel, port: LayoutPort): number {
  if (port.side === 'NORTH') return Math.max(0, label.height + label.y - (port.height + 0))
  if (port.side === 'SOUTH') return Math.max(0, -label.y - 0)
  if (port.side === 'EAST') return Math.max(0, -label.x - 0)
  if (port.side === 'WEST') return Math.max(0, label.width + label.x - (port.width + 0))
  return 0
}
function duplicatePortLabel(label: LayoutLabel): LayoutLabel { return { data: {}, text: '', active: true, inputX: 0, inputY: 0, inputWidth: 0, inputHeight: 0, x: 0, y: 0, width: label.width, height: label.height, options: new Map() } }

/** CompoundGraphPreprocessor, retaining stable hidden original endpoint references. */
export function preprocessCompound(root: LayoutGraph): CompoundState {
  const state: CompoundState = { root, segments: new Map() }, dummyNodes = new Map<LayoutPort, LayoutNode>()
  const initialize = (graph: LayoutGraph): void => { graph.layerlessNodes = graph.nodes.filter(node => !node.noLayout); for (const node of graph.layerlessNodes) if (node.nestedGraph !== undefined) initialize(node.nestedGraph) }
  initialize(root)
  const remember = (original: LayoutEdge, edge: LayoutEdge, graph: LayoutGraph, type: Flow): void => { let list = state.segments.get(original); if (list === undefined) { list = []; state.segments.set(original, list) }; list.push({ edge, graph, type }) }
  const outerPortFor = (dummy: LayoutNode, parent: LayoutNode, type: Flow): LayoutPort => {
    const direction = parent.layoutGraph!.direction
    const side = direction === 'RIGHT' ? type === 'OUTPUT' ? 'EAST' : 'WEST' : direction === 'LEFT' ? type === 'OUTPUT' ? 'WEST' : 'EAST' : direction === 'DOWN' ? type === 'OUTPUT' ? 'SOUTH' : 'NORTH' : type === 'OUTPUT' ? 'NORTH' : 'SOUTH'
    const port = providePort(parent, type, side, false); port.borderOffset = dummy.externalPortBorderOffset ?? 0; return port
  }
  const externalDummy = (graph: LayoutGraph, parent: LayoutNode, type: Flow, side: LayoutPort['side'], original: LayoutEdge): LayoutNode => {
    const outside = type === 'INPUT' ? original.source : original.target
    let dummy: LayoutNode | undefined
    if (outside.node === parent) {
      dummy = dummyNodes.get(outside)
      if (dummy === undefined) { dummy = createExternalPortDummy(outside, parent.portConstraints, side, netFlow(outside), null, { x: outside.x, y: outside.y }, { x: outside.width, y: outside.height }, graph.direction, graph); dummy.originPort = outside; dummyNodes.set(outside, dummy) }
    } else {
      const properties: Options = new Map([['port.borderOffset', String(numberOption(graph.options, 'spacing.edgeEdge', 10) / 2)]])
      dummy = createExternalPortDummy(properties, parent.portConstraints, side, type === 'INPUT' ? -1 : 1, null, { x: 0, y: 0 }, { x: 0, y: 0 }, graph.direction, graph)
      const outer = outerPortFor(dummy, parent, type); dummy.originPort = outer; dummyNodes.set(outer, dummy)
    }
    graph.hasExternalPorts = true
    const constraints = enumOption(graph.options, 'portConstraints', ['UNDEFINED', 'FREE', 'FIXED_SIDE', 'FIXED_ORDER', 'FIXED_RATIO', 'FIXED_POS'] as const, 'FREE')
    graph.options.set('portConstraints', isSideFixed(constraints) ? 'FIXED_SIDE' : 'FREE')
    return dummy
  }
  const introduce = (graph: LayoutGraph, parent: LayoutNode, original: LayoutEdge, opposite: LayoutPort, type: Flow, current: ExternalPort | undefined): ExternalPort => {
    const parentPort = type === 'INPUT' && original.source.node === parent ? original.source : type === 'OUTPUT' && original.target.node === parent ? original.target : undefined
    let external = current
    if (external === undefined || !booleanOption(graph.options, 'layered.mergeHierarchyEdges', true) || parentPort !== undefined) {
      const side = parentPort?.side ?? (isSideFixed(parent.portConstraints) ? type === 'INPUT' ? 'WEST' : 'EAST' : 'UNDEFINED')
      const dummy = externalDummy(graph, parent, type, side, original), inner = dummy.ports[0]!
      const edge = type === 'INPUT' ? dummyEdge(original, inner, opposite) : dummyEdge(original, opposite, inner)
      external = { originalEdges: [original], newEdge: edge, dummyNode: dummy, outerPort: dummy.originPort!, type, exported: parentPort === undefined }
    } else { external.originalEdges.push(original); external.newEdge.options.set('edge.thickness', String(Math.max(numberOption(external.newEdge.options, 'edge.thickness', 1), numberOption(original.options, 'edge.thickness', 1)))) }
    remember(original, external.newEdge, graph, type); return external
  }
  const insertCreated = (graph: LayoutGraph, created: ExternalPort[], exported: ExternalPort[]): void => { for (const port of created) { if (!nodesOf(graph).includes(port.dummyNode)) nodesOf(graph).push(port.dummyNode); if (port.exported) exported.push(port) } }
  const insideLoops = (graph: LayoutGraph, parent: LayoutNode): void => {
    if (!booleanOption(parent.options, 'insideSelfLoops.activate', false)) return
    for (const port of parent.ports) for (const original of port.outgoing.slice()) if (original.target.node === parent && booleanOption(original.options, 'insideSelfLoops.yo', false)) {
      const make = (port: LayoutPort, flow: number): LayoutNode => { let node = dummyNodes.get(port); if (node === undefined) { node = createExternalPortDummy(port, 'FREE', port.side, flow, null, null, { x: port.width, y: port.height }, graph.direction, graph); node.originPort = port; dummyNodes.set(port, node); nodesOf(graph).push(node) }; return node }
      const source = make(original.source, -1), target = make(original.target, 1)
      remember(original, dummyEdge(original, source.ports[0]!, target.ports[0]!), graph, 'OUTPUT'); graph.hasExternalPorts = true
    }
  }
  const transform = (graph: LayoutGraph, parent?: LayoutNode): ExternalPort[] => {
    const contained: ExternalPort[] = []
    for (const node of nodesOf(graph)) if (node.nestedGraph !== undefined) {
      const nested = node.nestedGraph; contained.push(...transform(nested, node)); insideLoops(nested, node)
      if (nested.hasExternalPorts) {
        const flags = setOption(node.options, 'portLabels.placement', ['OUTSIDE', 'INSIDE', 'NEXT_TO_PORT_IF_POSSIBLE', 'ALWAYS_SAME_SIDE', 'ALWAYS_OTHER_SAME_SIDE', 'SPACE_EFFICIENT'] as const, ['OUTSIDE']), inside = flags.has('INSIDE'), fixed = !flags.has('INSIDE') && !flags.has('OUTSIDE')
        for (const port of node.ports) {
          let dummy = dummyNodes.get(port)
          if (dummy === undefined) { dummy = createExternalPortDummy(port, node.portConstraints, port.side, -(port.incoming.length - port.outgoing.length), null, { x: 0, y: 0 }, { x: port.width, y: port.height }, nested.direction, nested); dummy.originPort = port; dummyNodes.set(port, dummy); nodesOf(nested).push(dummy) }
          for (const label of port.labels) { const copy = duplicatePortLabel(label); dummy.ports[0]!.labels.push(copy); if (!inside) { const part = fixed ? labelInsidePart(label, port) : 0; if (node.portConstraints === 'FREE' || port.side === 'EAST' || port.side === 'WEST') copy.width = part; else copy.height = part } }
        }
      }
    }
    const exported: ExternalPort[] = [], created: ExternalPort[] = []
    for (const port of contained) {
      let current: ExternalPort | undefined
      for (const original of port.originalEdges) {
        const oppositeNode = port.type === 'OUTPUT' ? original.target.node : original.source.node
        if (oppositeNode.layoutGraph === graph) {
          const edge = port.type === 'OUTPUT' ? dummyEdge(original, port.outerPort, original.target) : dummyEdge(original, original.source, port.outerPort)
          remember(original, edge, graph, port.type)
        } else if (parent === undefined || descendant(oppositeNode, parent)) {
          if (port.type === 'INPUT') continue
          const target = contained.find(other => other !== port && other.originalEdges.includes(original))!
          remember(original, dummyEdge(original, port.outerPort, target.outerPort), graph, port.type)
        } else {
          const external = introduce(graph, parent, original, port.outerPort, port.type, current)
          if (external !== current) created.push(external)
          if (external.exported) current = external
        }
      }
    }
    insertCreated(graph, created, exported)
    if (parent !== undefined) {
      const created: ExternalPort[] = []
      for (const node of nodesOf(graph)) for (const port of node.ports) {
        let currentOutput: ExternalPort | undefined
        for (const edge of port.outgoing.slice()) if (!descendant(edge.target.node, parent)) { const external = introduce(graph, parent, edge, edge.source, 'OUTPUT', currentOutput); if (external !== currentOutput) created.push(external); if (external.exported) currentOutput = external }
        let currentInput: ExternalPort | undefined
        for (const edge of port.incoming.slice()) if (!descendant(edge.source.node, parent)) { const external = introduce(graph, parent, edge, edge.target, 'INPUT', currentInput); if (external !== currentInput) created.push(external); if (external.exported) currentInput = external }
      }
      insertCreated(graph, created, exported)
    }
    return exported
  }
  transform(root)
  for (const [original, list] of state.segments) {
    const sorted = sortSegments(root, list)
    for (let i = 0; i < original.labels.length;) {
      const label = original.labels[i]!, placement = enumOption(label.options, 'edgeLabels.placement', ['CENTER', 'HEAD', 'TAIL'] as const, 'CENTER')
      let target = placement === 'HEAD' ? sorted.length - 1 : placement === 'TAIL' ? 0 : -1
      if (placement === 'CENTER') { for (let j = 0; j < sorted.length; j++) { if (sorted[j]!.type === 'INPUT') { target = j === 0 ? 0 : j - 1; break }; if (j === sorted.length - 1) target = j } }
      if (target >= 0) { sorted[target]!.edge.labels.push(label); label.originalLabelEdge = original; original.labels.splice(i, 1) } else i++
    }
    detach(original)
  }
  for (const [port, node] of dummyNodes) { node.originPort = port; port.portDummy = node; port.insideConnections = true; setSide(port, node.externalPortSide!); port.node.portConstraints = 'FIXED_SIDE' }
  dummyNodes.clear()
  return state
}
function hierarchyLevel(graph: LayoutGraph, root: LayoutGraph): number { let level = 0; while (graph !== root) { graph = graph.parentNode!.layoutGraph!; level++ }; return level }
export function sortSegments(root: LayoutGraph, list: HierarchySegment[]): HierarchySegment[] { return list.slice().sort((a, b) => a.type !== b.type ? a.type === 'OUTPUT' ? -1 : 1 : a.type === 'OUTPUT' ? hierarchyLevel(b.graph, root) - hierarchyLevel(a.graph, root) : hierarchyLevel(a.graph, root) - hierarchyLevel(b.graph, root)) }

/** LGraphUtil.changeCoordSystem; graph offsets are the unpadded phase offsets. */
export function changeCoordinateSystem(point: { x: number; y: number }, oldGraph: LayoutGraph, newGraph: LayoutGraph): void {
  if (oldGraph === newGraph) return
  let graph = oldGraph
  for (;;) {
    const geometry = graph.geometry ?? graph
    point.x += geometry.offsetX; point.y += geometry.offsetY
    const parent = graph.parentNode
    if (parent === undefined) break
    point.x += geometry.padding.left; point.y += geometry.padding.top
    point.x += parent.x; point.y += parent.y
    graph = parent.layoutGraph!
  }
  graph = newGraph
  for (;;) {
    const geometry = graph.geometry ?? graph
    point.x -= geometry.offsetX; point.y -= geometry.offsetY
    const parent = graph.parentNode
    if (parent === undefined) break
    point.x -= geometry.padding.left; point.y -= geometry.padding.top
    point.x -= parent.x; point.y -= parent.y
    graph = parent.layoutGraph!
  }
}
function actualPort(port: LayoutPort): LayoutPort { return port.node.type === 'EXTERNAL_PORT' ? port.node.originPort! : port }
function absoluteAnchor(port: LayoutPort): { x: number; y: number } { return { x: port.node.x + port.x + port.anchorX, y: port.node.y + port.y + port.anchorY } }
/** CompoundGraphPostprocessor: joins the laid-out segments in source-to-target order. */
export function postprocessCompound(state: CompoundState): void {
  const unnecessary = booleanOption(state.root.options, 'layered.unnecessaryBendpoints', false), dummyEdges = new Set<LayoutEdge>()
  for (const [original, list] of state.segments) {
    const segments = sortSegments(state.root, list), source = actualPort(segments[0]!.edge.source), target = actualPort(segments.at(-1)!.edge.target)
    const reference = descendant(target.node, source.node) ? source.node.nestedGraph! : source.node.layoutGraph!
    let junctions = original.junctions
    if (segments.some(segment => (segment.edge.junctions?.length ?? 0) > 0)) {
      if (junctions === undefined) { junctions = []; original.junctions = junctions } else junctions.length = 0
    } else if (junctions !== undefined) original.junctions = undefined
    original.bends.length = 0
    let last: { x: number; y: number } | undefined
    for (const segment of segments) {
      const offset = { x: 0, y: 0 }; changeCoordinateSystem(offset, segment.graph, reference)
      const edge = segment.edge, bends = edge.bends.map(point => ({ x: point.x + offset.x, y: point.y + offset.y }))
      const sourcePoint = absoluteAnchor(edge.source), targetPoint = absoluteAnchor(edge.target)
      sourcePoint.x += offset.x; sourcePoint.y += offset.y; targetPoint.x += offset.x; targetPoint.y += offset.y
      if (last !== undefined) {
        const next = bends[0] ?? targetPoint, xDiff = Math.abs(last.x - next.x) > 1e-3, yDiff = Math.abs(last.y - next.y) > 1e-3
        if (unnecessary ? xDiff || yDiff : xDiff && yDiff) original.bends.push(sourcePoint)
      }
      original.bends.push(...bends); last = bends.at(-1) ?? sourcePoint
      if (edge.junctions !== undefined) for (const point of edge.junctions) junctions!.push({ x: point.x + offset.x, y: point.y + offset.y })
      if (actualPort(edge.target) === target) {
        const targetGraph = target.node.layoutGraph!
        if (targetGraph !== segment.graph) { offset.x = 0; offset.y = 0; changeCoordinateSystem(offset, targetGraph, reference) }
        original.targetOffset = offset
      }
      for (let i = 0; i < edge.labels.length;) {
        const label = edge.labels[i]!
        if (label.originalLabelEdge !== original) { i++; continue }
        changeCoordinateSystem(label, edge.source.node.layoutGraph!, reference)
        edge.labels.splice(i, 1); original.labels.push(label)
      }
      dummyEdges.add(edge)
    }
    attach(original, source, target)
  }
  for (const edge of dummyEdges) detach(edge)
}
