/*******************************************************************************
 * Copyright (c) 2010, 2020 Kiel University and others.
 * This program and the accompanying materials are made available under the
 * terms of the Eclipse Public License 2.0 which is available at
 * https://www.eclipse.org/legal/epl-2.0/.
 * SPDX-License-Identifier: EPL-2.0
 *******************************************************************************/
import { reverseEdge, isSideFixed, type LayoutNode, type LayoutEdge, type LayoutPort } from './graph.ts'

type Constraint = NonNullable<LayoutNode['layerConstraint']>
const constraint = (node: LayoutNode): Constraint => node.layerConstraint ?? 'NONE'
const incoming = (node: LayoutNode): LayoutEdge[] => node.ports.flatMap(port => port.incoming)
const outgoing = (node: LayoutNode): LayoutEdge[] => node.ports.flatMap(port => port.outgoing)
const connected = (node: LayoutNode): LayoutEdge[] => node.ports.flatMap(port => port.incoming.concat(port.outgoing))
/** EdgeAndLayerConstraintEdgeReverser, including the source OUTGOING_ONLY assignment for LAST. */
export function reverseConstrainedEdges(nodes: LayoutNode[]): void {
  const remaining: LayoutNode[] = []
  const reverse = (node: LayoutNode, type: 'INPUT' | 'OUTPUT' | 'UNDEFINED'): void => {
    for (const port of node.ports.slice()) {
      if (type === 'INPUT' || type === 'UNDEFINED') for (const edge of port.outgoing.slice()) if (!edge.reversed && !(constraint(node) === 'LAST' && edge.target.node.type === 'LABEL') && constraint(edge.target.node) !== 'LAST_SEPARATE') reverseEdge(edge, true)
      if (type === 'OUTPUT' || type === 'UNDEFINED') for (const edge of port.incoming.slice()) if (!edge.reversed && !(constraint(node) === 'FIRST' && edge.source.node.type === 'LABEL') && constraint(edge.source.node) !== 'FIRST_SEPARATE') reverseEdge(edge, true)
    }
  }
  const handle = (node: LayoutNode): boolean => {
    const value = constraint(node)
    if (value === 'FIRST' || value === 'FIRST_SEPARATE' || value === 'LAST' || value === 'LAST_SEPARATE') { node.edgeConstraint = 'OUTGOING_ONLY'; reverse(node, value === 'FIRST' || value === 'FIRST_SEPARATE' ? 'OUTPUT' : 'INPUT'); return true }
    return false
  }
  for (const node of nodes) if (!handle(node)) remaining.push(node)
  for (const node of remaining) if (!handle(node) && isSideFixed(node.portConstraints) && node.ports.length > 0) {
    let reversed = true
    for (const port of node.ports) {
      const flow = port.incoming.length - port.outgoing.length
      if (!(port.side === 'EAST' && flow > 0 || port.side === 'WEST' && flow < 0)) { reversed = false; break }
      for (const edge of port.outgoing) if (constraint(edge.target.node) === 'LAST' || constraint(edge.target.node) === 'LAST_SEPARATE') { reversed = false; break }
      for (const edge of port.incoming) if (constraint(edge.source.node) === 'FIRST' || constraint(edge.source.node) === 'FIRST_SEPARATE') { reversed = false; break }
    }
    if (reversed) reverse(node, 'UNDEFINED')
  }
}
export interface HiddenLayerState { nodes: LayoutNode[]; missing: Map<LayoutEdge, { port: LayoutPort; source: boolean }> }
function designation(node: LayoutNode): string { return node.labels[0]?.text || node.id || '-1' }
/** LayerConstraintPreprocessor. Hidden endpoint references remain stable but leave active adjacency. */
export function hideSeparateLayers(nodes: LayoutNode[]): HiddenLayerState {
  const state: HiddenLayerState = { nodes: [], missing: new Map() }, connections = new Map<LayoutNode, 'FIRST_SEPARATE' | 'LAST_SEPARATE' | 'BOTH'>()
  for (let i = 0; i < nodes.length;) {
    const node = nodes[i]!, value = constraint(node)
    if (value !== 'FIRST_SEPARATE' && value !== 'LAST_SEPARATE') { i++; continue }
    for (const edge of value === 'FIRST_SEPARATE' ? incoming(node) : outgoing(node)) if (!(edge.source.node.type === 'EXTERNAL_PORT' && edge.target.node.type === 'EXTERNAL_PORT')) {
      throw new Error("org.eclipse.elk.core.UnsupportedConfigurationException: Node '" + designation(node) + "' has its layer constraint set to " + value + ', but has at least one ' + (value === 'FIRST_SEPARATE' ? 'incoming' : 'outgoing') + ' edge. ' + value + ' nodes must not have ' + (value === 'FIRST_SEPARATE' ? 'incoming' : 'outgoing') + ' edges.')
    }
    for (const edge of connected(node)) {
      const isOutgoing = edge.source.node === node, port = isOutgoing ? edge.target : edge.source
      if (isOutgoing) port.incoming.splice(port.incoming.indexOf(edge), 1); else port.outgoing.splice(port.outgoing.indexOf(edge), 1)
      state.missing.set(edge, { port, source: !isOutgoing })
      const opposite = port.node
      if (opposite.layerConstraintSet) continue
      const previous = connections.get(opposite), combined = previous === undefined || previous === value ? value : 'BOTH'; connections.set(opposite, combined)
      if (connected(opposite).length > 0) continue
      if (combined !== 'BOTH') { opposite.layerConstraint = combined === 'FIRST_SEPARATE' ? 'FIRST' : 'LAST'; opposite.layerConstraintSet = true }
    }
    state.nodes.push(node); nodes.splice(i, 1)
  }
  return state
}
function moveNode(locations: Map<LayoutNode, LayoutNode[]>, node: LayoutNode, target: LayoutNode[]): void {
  const old = locations.get(node)
  if (old !== undefined) old.splice(old.indexOf(node), 1)
  target.push(node); locations.set(node, target)
}
/** LayerConstraintPostprocessor, preserving snapshot traversal and append order. */
export function restoreSeparateLayers(layers: LayoutNode[][], state: HiddenLayerState): void {
  if (layers.length > 0) {
    const locations = new Map<LayoutNode, LayoutNode[]>(); for (const layer of layers) for (const node of layer) locations.set(node, layer)
    const first = layers[0]!, last = layers[layers.length - 1]!, firstLabels: LayoutNode[] = [], lastLabels: LayoutNode[] = []
    for (const layer of layers) for (const node of layer.slice()) {
      const value = constraint(node)
      if (value !== 'FIRST' && value !== 'LAST') continue
      for (const edge of value === 'FIRST' ? incoming(node) : outgoing(node)) if ((value === 'FIRST' ? edge.source.node : edge.target.node).type !== 'LABEL') {
        throw new Error("org.eclipse.elk.core.UnsupportedConfigurationException: Node '" + (node.labels[0]?.text || node.id || String(locations.get(node)?.indexOf(node) ?? -1)) + "' has its layer constraint set to " + value + ', but has at least one ' + (value === 'FIRST' ? 'incoming' : 'outgoing') + ' edge that  does not ' + (value === 'FIRST' ? 'come from a FIRST_SEPARATE' : 'go to a LAST_SEPARATE') + ' node. That must not happen.')
      }
      moveNode(locations, node, value === 'FIRST' ? first : last)
      for (const edge of value === 'FIRST' ? incoming(node) : outgoing(node)) {
        const possible = value === 'FIRST' ? edge.source.node : edge.target.node
        if (possible.type === 'LABEL') moveNode(locations, possible, value === 'FIRST' ? firstLabels : lastLabels)
      }
    }
    for (let i = 0; i < layers.length;) { if (layers[i]!.length === 0) layers.splice(i, 1); else i++ }
    if (firstLabels.length > 0) layers.unshift(firstLabels)
    if (lastLabels.length > 0) layers.push(lastLabels)
  }
  if (state.nodes.length > 0) {
    const first: LayoutNode[] = [], last: LayoutNode[] = []
    for (const node of state.nodes) {
      if (constraint(node) === 'FIRST_SEPARATE') first.push(node); else if (constraint(node) === 'LAST_SEPARATE') last.push(node)
      for (const edge of connected(node)) {
        const missing = state.missing.get(edge)
        if (missing === undefined) continue
        if (missing.source) missing.port.outgoing.push(edge); else missing.port.incoming.push(edge)
        state.missing.delete(edge)
      }
    }
    if (first.length > 0) layers.unshift(first)
    if (last.length > 0) layers.push(last)
  }
  for (let i = 0; i < layers.length; i++) for (const node of layers[i]!) node.rank = i
}

/** InLayerConstraintProcessor, preserving snapshot traversal and detached reinsertion. */
export function enforceInLayerConstraints(layers: LayoutNode[][]): void {
  for (const layer of layers) {
    let topInsertionIndex = -1
    const bottom: LayoutNode[] = []
    const nodes = layer.slice()
    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i]!, value = node.inLayerConstraint ?? 'NONE'
      if (topInsertionIndex === -1) { if (value !== 'TOP') topInsertionIndex = i }
      else if (value === 'TOP') { layer.splice(layer.indexOf(node), 1); layer.splice(topInsertionIndex++, 0, node) }
      if (value === 'BOTTOM') bottom.push(node)
    }
    for (const node of bottom) { layer.splice(layer.indexOf(node), 1); layer.push(node) }
  }
}
