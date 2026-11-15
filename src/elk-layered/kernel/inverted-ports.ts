/*******************************************************************************
 * Copyright (c) 2011, 2019 Kiel University and others.
 * This program and the accompanying materials are made available under the
 * terms of the Eclipse Public License 2.0 which is available at
 * https://www.eclipse.org/legal/epl-2.0/.
 * SPDX-License-Identifier: EPL-2.0
 *******************************************************************************/
import { providePort, isSideFixed, type LayoutGraph, type LayoutNode, type LayoutPort, type LayoutEdge } from './graph.ts'
import { createDummy } from './long-edges.ts'
import { enumOption } from './options.ts'

/** InvertedPortProcessor, after side assignment and before port-list sorting. */
export function insertInvertedPortDummies(layers: LayoutNode[][], graph: LayoutGraph): void {
  let previous: LayoutNode[] | undefined
  const pending: LayoutNode[] = []
  const create = (port: LayoutPort, edge: LayoutEdge, east: boolean): void => {
    if ((east ? edge.source.node : edge.target.node) === port.node) return
    const dummy = createDummy('LONG_EDGE'); dummy.layoutGraph = graph; dummy.portConstraints = 'FIXED_POS'; pending.push(dummy)
    const input = providePort(dummy, 'INPUT', 'WEST', false), output = providePort(dummy, 'OUTPUT', 'EAST', false), oldTarget = edge.target
    oldTarget.incoming.splice(oldTarget.incoming.indexOf(edge), 1); edge.target = input; input.incoming.push(edge)
    const next: LayoutEdge = { ...edge, source: output, target: east ? port : oldTarget, options: new Map(edge.options), labels: [], sourceLabels: edge.sourceLabels, bends: [], junctions: undefined }
    next.options.delete('junctionPoints'); output.outgoing.push(next); next.target.incoming.push(next)
    const source = edge.source, target = next.target
    dummy.longEdgeSource = source.node.type === 'LONG_EDGE' ? source.node.longEdgeSource : source
    dummy.longEdgeTarget = target.node.type === 'LONG_EDGE' ? target.node.longEdgeTarget : target
    for (let i = 0; i < edge.labels.length;) {
      const label = edge.labels[i]!
      if (enumOption(label.options, 'edgeLabels.placement', ['CENTER', 'HEAD', 'TAIL'] as const, 'CENTER') !== 'HEAD') { i++; continue }
      if (east) label.endLabelEdge ??= edge; else label.endLabelEdge = edge
      edge.labels.splice(i, 1); next.labels.push(label)
    }
  }
  for (const layer of layers) {
    if (previous !== undefined) previous.push(...pending)
    pending.length = 0
    for (const node of layer) {
      if (node.type !== 'NORMAL' || !isSideFixed(node.portConstraints)) continue
      for (const port of node.ports) if (port.side === 'EAST' && port.incoming.length > 0) for (const edge of port.incoming.slice()) create(port, edge, true)
      for (const port of node.ports) if (port.side === 'WEST' && port.outgoing.length > 0) for (const edge of port.outgoing.slice()) create(port, edge, false)
    }
    previous = layer
  }
  if (previous !== undefined) previous.push(...pending)
  for (let i = 0; i < layers.length; i++) for (const node of layers[i]!) node.rank = i
}
