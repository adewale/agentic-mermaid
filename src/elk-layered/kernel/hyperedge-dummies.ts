/*******************************************************************************
 * Copyright (c) 2010, 2018 Kiel University and others.
 * This program and the accompanying materials are made available under the
 * terms of the Eclipse Public License 2.0 which is available at
 * https://www.eclipse.org/legal/epl-2.0/.
 * SPDX-License-Identifier: EPL-2.0
 *******************************************************************************/
import type { LayoutNode, LayoutPort } from './graph.ts'
import type { Options } from './options.ts'

/** HyperedgeDummyMerger, ELK v0.11.0, commit 54123e884b1ae743b453260f713b20c9bf5787f2. */
export function mergeHyperedgeDummies(layers: LayoutNode[][], _options: Options): void {
  const ports = layers.flatMap(layer => layer.flatMap(node => node.ports)), ids = new Map<LayoutPort, number>()
  for (const port of ports) ids.set(port, -1)
  const dfs = (port: LayoutPort, index: number): void => {
    ids.set(port, index)
    for (const edge of port.incoming.concat(port.outgoing)) {
      const other = edge.source === port ? edge.target : edge.source
      if (ids.get(other) === -1) dfs(other, index)
    }
    if (port.node.type === 'LONG_EDGE') for (const other of port.node.ports) if (other !== port && ids.get(other) === -1) dfs(other, index)
  }
  let next = 0
  for (const port of ports) if (ids.get(port) === -1) dfs(port, next++)
  for (const layer of layers) {
    let last: LayoutNode | undefined
    for (let index = 0; index < layer.length; index++) {
      let current = layer[index]!
      if (current.type === 'LONG_EDGE' && last?.type === 'LONG_EDGE') {
        const sameSource = current.longEdgeSource !== undefined && current.longEdgeSource === last.longEdgeSource
        const sameTarget = current.longEdgeTarget !== undefined && current.longEdgeTarget === last.longEdgeTarget
        const currentLabels = current.longEdgeHasLabelDummies === true, lastLabels = last.longEdgeHasLabelDummies === true
        let allowed: boolean
        if (!currentLabels && !lastLabels) allowed = ids.get(current.ports[0]!) === ids.get(last.ports[0]!)
        else {
          const sourceEligible = (!currentLabels || current.longEdgeBeforeLabelDummy === true) && (!lastLabels || last.longEdgeBeforeLabelDummy === true)
          const targetEligible = (!currentLabels || current.longEdgeBeforeLabelDummy !== true) && (!lastLabels || last.longEdgeBeforeLabelDummy !== true)
          allowed = sameSource && sourceEligible || sameTarget && targetEligible
        }
        if (allowed) {
          const input = last.ports.find(port => port.side === 'WEST')!, output = last.ports.find(port => port.side === 'EAST')!
          for (const port of current.ports) {
            while (port.incoming.length > 0) {
              const edge = port.incoming[0]!
              edge.target.incoming.splice(edge.target.incoming.indexOf(edge), 1); edge.target = input; input.incoming.push(edge)
            }
            while (port.outgoing.length > 0) {
              const edge = port.outgoing[0]!
              edge.source.outgoing.splice(edge.source.outgoing.indexOf(edge), 1); edge.source = output; output.outgoing.push(edge)
            }
          }
          if (!sameSource) last.longEdgeSource = undefined
          if (!sameTarget) last.longEdgeTarget = undefined
          layer.splice(index--, 1); current = last
        }
      }
      last = current
    }
  }
}
