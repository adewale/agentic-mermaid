/*******************************************************************************
 * Copyright (c) 2011, 2015 Kiel University and others.
 * This program and the accompanying materials are made available under the
 * terms of the Eclipse Public License 2.0 which is available at
 * https://www.eclipse.org/legal/epl-2.0/.
 * SPDX-License-Identifier: EPL-2.0
 *******************************************************************************/
import { providePort, isSideFixed, type LayoutNode, type LayoutPort, type LayoutEdge } from './graph.ts'
import { createDummy } from './long-edges.ts'
import { sort } from './sort.ts'
import { booleanOption, enumOption, type Options } from './options.ts'

type Node = LayoutNode
type Port = LayoutPort
type Edge = LayoutEdge
export interface NorthSouthPortState { readonly detachedLoops: Map<Edge, { source: Port; target: Port }>; readonly crossingHints: Map<Node, number> }
const sides: Record<Port['side'], number> = { UNDEFINED: 0, NORTH: 1, EAST: 2, SOUTH: 3, WEST: 4 }
const orderFixed = (node: Node): boolean => node.portConstraints === 'FIXED_ORDER' || node.portConstraints === 'FIXED_RATIO' || node.portConstraints === 'FIXED_POS'
const remove = <T>(array: T[], item: T): void => { const index = array.indexOf(item); if (index >= 0) array.splice(index, 1) }
function source(edge: Edge, port: Port): void { remove(edge.source.outgoing, edge); edge.source = port; port.outgoing.push(edge) }
function target(edge: Edge, port: Port): void { remove(edge.target.incoming, edge); edge.target = port; port.incoming.push(edge) }
function dummyFor(port: Port): Node { const node = createDummy('NORTH_SOUTH_PORT'); node.layoutGraph = port.node.layoutGraph; node.northSouthOrigin = port.node; return node }
function sortPorts(node: Node): void {
  let input = 0, both = node.ports.length, output = 2 * node.ports.length
  const ids = new Map<Port, number>()
  for (const port of node.ports) {
    if (port.side === 'EAST' || port.side === 'WEST') ids.set(port, -1)
    else if (port.side === 'NORTH' || port.side === 'SOUTH') ids.set(port, port.incoming.length > 0 && port.outgoing.length > 0 ? both++ : port.outgoing.length > 0 ? output++ : input++)
  }
  sort(node.ports, (a, b) => a.side !== b.side ? sides[a.side] - sides[b.side] : ids.get(a) === ids.get(b) ? 0 : a.side === 'NORTH' ? ids.get(a)! - ids.get(b)! : ids.get(b)! - ids.get(a)!)
}
function modelOrderPorts(ports: Port[]): Port[] {
  const input = ports.filter(port => port.incoming.length > 0), output = ports.filter(port => port.incoming.length === 0)
  // Lists.reverse(input).addAll(output) mutates the backing input list. The
  // source returns that backing list, rather than returning its reverse view.
  return output.toReversed().concat(input)
}
function createPorts(input: Port | undefined, output: Port | undefined, nodes: Node[], state: NorthSouthPortState): Node {
  const node = dummyFor((input ?? output)!)
  let hint = 0
  if (input !== undefined) {
    const port = providePort(node, 'INPUT', 'WEST', false); port.originPort = input
    for (const edge of input.incoming.slice()) target(edge, port)
    input.portDummy = node; hint++
  }
  if (output !== undefined) {
    const port = providePort(node, 'OUTPUT', 'EAST', false); port.originPort = output
    for (const edge of output.outgoing.slice()) source(edge, port)
    output.portDummy = node; hint++
  }
  state.crossingHints.set(node, hint); nodes.push(node)
  return node
}
function sameSideLoop(edge: Edge, nodes: Node[], state: NorthSouthPortState): void {
  const input = edge.target, output = edge.source, node = dummyFor(input)
  node.northSouthOrigin = edge
  const west = providePort(node, 'INPUT', 'WEST', false), east = providePort(node, 'OUTPUT', 'EAST', false)
  west.originPort = input; east.originPort = output; input.portDummy = node; output.portDummy = node
  state.detachedLoops.set(edge, { source: output, target: input })
  remove(output.outgoing, edge); remove(input.incoming, edge)
  state.crossingHints.set(node, 2); nodes.push(node)
}
function northSouthLoop(edge: Edge, northern: Node[], southern: Node[], state: NorthSouthPortState): void {
  const output = edge.source, input = edge.target, north = dummyFor(output), south = dummyFor(input)
  const northPort = providePort(north, 'OUTPUT', 'EAST', false), southPort = providePort(south, 'INPUT', 'EAST', false)
  northPort.originPort = output; southPort.originPort = input; output.portDummy = north; input.portDummy = south
  source(edge, northPort); target(edge, southPort)
  state.crossingHints.set(north, 1); state.crossingHints.set(south, 1)
  northern.unshift(north); southern.push(south)
}
function createDummies(ports: Port[], nodes: Node[], opposing: Node[] | undefined, associates: Node[], state: NorthSouthPortState): void {
  const sameSide: Edge[] = [], northToSouth: Edge[] = []
  for (const port of ports) for (const edge of port.outgoing) if (edge.source.node === edge.target.node) {
    if (port.side === edge.target.side) sameSide.push(edge)
    else if (port.side === 'NORTH' && edge.target.side === 'SOUTH') northToSouth.push(edge)
  }
  for (const edge of northToSouth) northSouthLoop(edge, nodes, opposing!, state)
  for (const edge of sameSide) sameSideLoop(edge, nodes, state)
  const inputs: Port[] = [], outputs: Port[] = [], both: Port[] = []
  for (const port of ports) {
    if (port.incoming.length > 0 && port.outgoing.length > 0) both.push(port)
    else if (port.incoming.length > 0) inputs.push(port)
    else if (port.outgoing.length > 0) outputs.push(port)
  }
  // USE_NEW_APPROACH is a source constant: inputs and outputs get separate dummies.
  for (const port of inputs) associates.push(createPorts(port, undefined, nodes, state))
  for (const port of outputs) associates.push(createPorts(undefined, port, nodes, state))
  for (const port of both) associates.push(createPorts(port, port, nodes, state))
}
/** NorthSouthPortPreprocessor, after SortByInputModelProcessor and before crossing. */
export function preprocessNorthSouthPorts(layers: Node[][], options: Options): NorthSouthPortState {
  const state: NorthSouthPortState = { detachedLoops: new Map(), crossingHints: new Map() }
  const modelOrder = enumOption(options, 'layered.considerModelOrder.strategy', ['NONE', 'NODES_AND_EDGES', 'PREFER_EDGES', 'PREFER_NODES'] as const, 'NONE') !== 'NONE'
  for (let index = 0; index < layers.length; index++) {
    const layer = layers[index]!
    let pointer = -1
    for (const node of layer.slice()) {
      pointer++
      if (node.type !== 'NORMAL' || !isSideFixed(node.portConstraints)) continue
      if (!orderFixed(node) && !modelOrder) sortPorts(node)
      node.inLayerLayoutUnit = node
      const north: Node[] = [], south: Node[] = [], associates: Node[] = []
      let ports = node.ports.filter(port => port.side === 'NORTH')
      if (modelOrder) ports = modelOrderPorts(ports)
      createDummies(ports, north, south, associates, state)
      const insertion = pointer
      for (const dummy of north) {
        layer.splice(insertion, 0, dummy); pointer++; dummy.rank = index; dummy.inLayerLayoutUnit = node
        if (!booleanOption(dummy.ports[0]!.originPort!.options, 'layered.allowNonFlowPortsToSwitchSides', false)) (dummy.inLayerSuccessors ??= []).push(node)
      }
      ports = node.ports.filter(port => port.side === 'SOUTH').reverse()
      if (modelOrder) ports = modelOrderPorts(ports)
      createDummies(ports, south, undefined, associates, state)
      for (const dummy of south) {
        layer.splice(++pointer, 0, dummy); dummy.rank = index; dummy.inLayerLayoutUnit = node
        if (!booleanOption(dummy.ports[0]!.originPort!.options, 'layered.allowNonFlowPortsToSwitchSides', false)) (node.inLayerSuccessors ??= []).push(dummy)
      }
      if (associates.length > 0) node.barycenterAssociates = associates
    }
  }
  return state
}
/** NorthSouthPortPostprocessor: ordinary non-spline bend and junction restoration. */
export function postprocessNorthSouthPorts(layers: Node[][], options: Options, _state: NorthSouthPortState): void {
  if (enumOption(options, 'edgeRouting', ['UNDEFINED', 'POLYLINE', 'ORTHOGONAL', 'SPLINES'] as const, 'ORTHOGONAL') === 'SPLINES') throw new Error('ELK TypeScript port: spline north/south port restoration is not implemented yet')
  for (const layer of layers) for (const node of layer.slice()) {
    if (node.type !== 'NORTH_SOUTH_PORT') continue
    const origin = node.northSouthOrigin!
    if (!('ports' in origin)) {
      const input = node.ports.find(port => port.side === 'WEST')!, output = node.ports.find(port => port.side === 'EAST')!
      source(origin, output.originPort!); target(origin, input.originPort!)
      origin.bends.push({ x: output.originPort!.node.x + output.originPort!.x + output.originPort!.anchorX, y: output.node.y })
      origin.bends.push({ x: input.originPort!.node.x + input.originPort!.x + input.originPort!.anchorX, y: input.node.y })
    } else {
      const same = node.ports.length >= 2 && node.ports.every(port => port.originPort === node.ports[0]!.originPort)
      for (const port of node.ports) {
        const original = port.originPort!, x = original.node.x + original.x + original.anchorX, y = node.y
        for (const edge of port.incoming.slice()) { target(edge, original); edge.bends.push({ x, y }); if (same) (edge.junctions ??= []).push({ x, y }) }
        for (const edge of port.outgoing.slice()) { source(edge, original); edge.bends.unshift({ x, y }); if (same) (edge.junctions ??= []).push({ x, y }) }
      }
    }
    remove(layer, node)
  }
}
