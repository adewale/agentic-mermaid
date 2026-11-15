/*******************************************************************************
 * Copyright (c) 2010, 2018 Kiel University and others.
 * This program and the accompanying materials are made available under the
 * terms of the Eclipse Public License 2.0 which is available at
 * https://www.eclipse.org/legal/epl-2.0/.
 * SPDX-License-Identifier: EPL-2.0
 *******************************************************************************/
import { providePort, type LayoutEdge, type LayoutNode } from './graph.ts'
import { booleanOption, enumOption, numberOption, type Options } from './options.ts'

/** LongEdgeSplitter; dummy nodes are appended to the next layer in visit order. */
export function splitLongEdges(layers: LayoutNode[][]): void {
  if (layers.length <= 2) return
  for (let index = 0; index + 1 < layers.length; index++) {
    const layer = layers[index]!, next = layers[index + 1]!
    for (const node of layer) for (const port of node.ports) for (const edge of port.outgoing) {
      if (edge.target.node.rank === index || edge.target.node.rank === index + 1) continue
      if (edge.target.node.rank < index) throw new Error('ELK TypeScript port: backward edge remains after cycle breaking')
      const dummy = createDummy('LONG_EDGE', index + 1)
      next.push(dummy)
      splitEdge(edge, dummy)
    }
  }
}
export function splitEdge(edge: LayoutEdge, dummy: LayoutNode): LayoutEdge {
  const oldTarget = edge.target
  let thickness = numberOption(edge.options, 'edge.thickness', 1)
  if (thickness < 0) { thickness = 0; edge.options.set('edge.thickness', '0') }
  dummy.height = thickness
  const position = Math.floor(thickness / 2), input = providePort(dummy, 'INPUT', 'WEST', false), output = providePort(dummy, 'OUTPUT', 'EAST', false)
  input.y = position; output.y = position
  oldTarget.incoming.splice(oldTarget.incoming.indexOf(edge), 1); edge.target = input; input.incoming.push(edge)
  const next: LayoutEdge = { data: edge.data, source: output, target: oldTarget, priorityDirection: edge.priorityDirection, priorityShortness: edge.priorityShortness, options: new Map(edge.options), reversed: edge.reversed, labels: [], sourceLabels: edge.sourceLabels, bends: [] }
  if (edge.modelOrder !== undefined) next.modelOrder = edge.modelOrder
  output.outgoing.push(next); oldTarget.incoming.push(next)
  const sourceNode = edge.source.node, targetNode = next.target.node
  if (sourceNode.type === 'LONG_EDGE' || sourceNode.type === 'LABEL') { dummy.longEdgeSource = sourceNode.longEdgeSource; dummy.longEdgeTarget = sourceNode.longEdgeTarget; dummy.longEdgeHasLabelDummies = sourceNode.type === 'LABEL' ? true : sourceNode.longEdgeHasLabelDummies }
  else if (targetNode.type === 'LABEL') { dummy.longEdgeSource = targetNode.longEdgeSource; dummy.longEdgeTarget = targetNode.longEdgeTarget; dummy.longEdgeHasLabelDummies = true }
  else { dummy.longEdgeSource = edge.source; dummy.longEdgeTarget = next.target }
  for (let index = 0; index < edge.labels.length;) {
    const label = edge.labels[index]!
    if (enumOption(label.options, 'edgeLabels.placement', ['CENTER', 'HEAD', 'TAIL'] as const, 'CENTER') === 'HEAD') { label.endLabelEdge ??= edge; edge.labels.splice(index, 1); next.labels.push(label) }
    else index++
  }
  return next
}

export function createDummy(type: LayoutNode['type'], rank = 0): LayoutNode {
  return { padding: { top: 0, right: 0, bottom: 0, left: 0 }, minimumSize: { x: 0, y: 0 }, type, crossingMinimizationGroupId: 0, crossingMinimizationGroupIdentity: 0, portConstraints: 'FIXED_POS', margin: { top: 0, right: 0, bottom: 0, left: 0 }, individualSpacings: new Map(), data: null, id: '', key: null, sourceIndex: -1, options: new Map(), x: 0, y: 0, width: 0, height: 0, priority: 0, ports: [], sourcePorts: [], labels: [], sourceLabels: [], children: [], rank, noLayout: false }
}
/** LongEdgeJoiner: surviving target insertion precedes removal of dropped edge. */
export function joinLongEdges(layers: LayoutNode[][], options: Options): void {
  const unnecessary = booleanOption(options, 'layered.unnecessaryBendpoints', false)
  for (const layer of layers) for (let index = 0; index < layer.length;) {
    const dummy = layer[index]!
    if (dummy.type !== 'LONG_EDGE') { index++; continue }
    joinAt(dummy, unnecessary)
    layer.splice(index, 1)
  }
}

/** LongEdgeJoiner.joinAt, also used by center label dummy removal. */
export function joinAt(dummy: LayoutNode, unnecessary: boolean): void {
  const input = dummy.ports.find(port => port.side === 'WEST')!, output = dummy.ports.find(port => port.side === 'EAST')!, first = dummy.ports[0]!
  const bend = { x: dummy.x + first.x + first.anchorX, y: dummy.y + first.y + first.anchorY }
  let remaining = input.incoming.length
  while (remaining-- > 0) {
    const surviving = input.incoming[0]!, dropped = output.outgoing[0]!, target = dropped.target, insertion = target.incoming.indexOf(dropped)
    surviving.target.incoming.splice(surviving.target.incoming.indexOf(surviving), 1); surviving.target = target; target.incoming.splice(insertion, 0, surviving)
    dropped.source.outgoing.splice(dropped.source.outgoing.indexOf(dropped), 1); dropped.target.incoming.splice(dropped.target.incoming.indexOf(dropped), 1)
    if (unnecessary) surviving.bends.push({ ...bend })
    for (const point of dropped.bends) surviving.bends.push({ ...point })
    surviving.labels.push(...dropped.labels)
    if (dropped.junctions !== undefined) { surviving.junctions ??= []; for (const point of dropped.junctions) surviving.junctions.push({ ...point }) }
  }
}
