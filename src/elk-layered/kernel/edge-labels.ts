/*******************************************************************************
 * Copyright (c) 2012, 2017, 2020 Kiel University and others.
 * This program and the accompanying materials are made available under the
 * terms of the Eclipse Public License 2.0 which is available at
 * https://www.eclipse.org/legal/epl-2.0/.
 * SPDX-License-Identifier: EPL-2.0
 *******************************************************************************/
import type { LayoutNode, LayoutEdge, LayoutLabel, LayoutPort } from './graph.ts'
import { createDummy, splitEdge, joinAt } from './long-edges.ts'
import { booleanOption, enumOption, numberOption, type Options } from './options.ts'

type Side = 'ABOVE' | 'BELOW' | 'INLINE'
interface LabelDummy { node: LayoutNode; edge: LayoutEdge; labels: LayoutLabel[]; side?: Side }
export interface CenterLabelState { dummies: Map<LayoutNode, LabelDummy> }
const placement = (label: LayoutLabel): 'CENTER' | 'HEAD' | 'TAIL' => enumOption(label.options, 'edgeLabels.placement', ['CENTER', 'HEAD', 'TAIL'] as const, 'CENTER')
const incoming = (node: LayoutNode): LayoutEdge => node.ports.flatMap(port => port.incoming)[0]!
const outgoing = (node: LayoutNode): LayoutEdge => node.ports.flatMap(port => port.outgoing)[0]!
const inline = (dummy: LabelDummy): boolean => dummy.labels.every(label => booleanOption(label.options, 'edgeLabels.inline', false))

/** LabelDummyInserter. Graph mutation is delayed until the source traversal ends. */
export function insertLabelDummies(nodes: LayoutNode[], options: Options): CenterLabelState {
  const state: CenterLabelState = { dummies: new Map() }, added: LayoutNode[] = []
  const edgeLabelSpacing = numberOption(options, 'spacing.edgeLabel', 2), labelLabelSpacing = numberOption(options, 'spacing.labelLabel', 0)
  const direction = enumOption(options, 'direction', ['UNDEFINED', 'RIGHT', 'LEFT', 'DOWN', 'UP'] as const, 'RIGHT'), vertical = direction === 'DOWN' || direction === 'UP'
  for (const node of nodes) for (const port of node.ports) for (const edge of port.outgoing) {
    if (edge.source.node === edge.target.node || !edge.labels.some(label => placement(label) === 'CENTER')) continue
    let thickness = numberOption(edge.options, 'edge.thickness', 1)
    if (thickness < 0) { thickness = 0; edge.options.set('edge.thickness', '0') }
    const dummy = createDummy('LABEL'), labels: LayoutLabel[] = []
    dummy.longEdgeSource = edge.source; dummy.longEdgeTarget = edge.target
    splitEdge(edge, dummy)
    for (const dummyPort of dummy.ports) dummyPort.y = Math.floor(thickness / 2)
    const record: LabelDummy = { node: dummy, edge, labels }; state.dummies.set(dummy, record); added.push(dummy)
    for (let i = 0; i < edge.labels.length;) {
      const label = edge.labels[i]!
      if (placement(label) !== 'CENTER') { i++; continue }
      if (vertical) { dummy.width += label.width + labelLabelSpacing; dummy.height = Math.max(dummy.height, label.height) }
      else { dummy.width = Math.max(dummy.width, label.width); dummy.height += label.height + labelLabelSpacing }
      labels.push(label); edge.labels.splice(i, 1)
    }
    if (vertical) { dummy.width -= labelLabelSpacing; dummy.height += edgeLabelSpacing + thickness }
    else dummy.height += edgeLabelSpacing - labelLabelSpacing + thickness
  }
  nodes.push(...added)
  return state
}

/** LabelDummySwitcher, preserving real endpoint mutations when swapping layers. */
export function switchLabelDummies(layers: LayoutNode[][], options: Options, state: CenterLabelState): void {
  const strategies = ['MEDIAN_LAYER', 'TAIL_LAYER', 'HEAD_LAYER', 'SPACE_EFFICIENT_LAYER', 'WIDEST_LAYER', 'CENTER_LAYER'] as const
  const defaults = enumOption(options, 'layered.edgeLabels.centerLabelPlacementStrategy', strategies, 'MEDIAN_LAYER')
  const infos = layers.flatMap(layer => layer.flatMap(node => { const record = state.dummies.get(node); return record === undefined ? [] : [record] }))
  const direction = enumOption(options, 'direction', ['UNDEFINED', 'RIGHT', 'LEFT', 'DOWN', 'UP'] as const, 'RIGHT')
  const widths = layers.map(layer => direction === 'UP' || direction === 'DOWN' ? 0 : Math.max(0, ...layer.filter(node => node.type === 'NORMAL').map(node => node.width)))
  const indexed = infos.map(record => {
    let strategy = defaults
    for (const label of record.labels) if (label.options.has('layered.edgeLabels.centerLabelPlacementStrategy')) { strategy = enumOption(label.options, 'layered.edgeLabels.centerLabelPlacementStrategy', strategies, defaults); break }
    const left: LayoutNode[] = [], right: LayoutNode[] = []
    for (let node = incoming(record.node).source.node; node.type === 'LONG_EDGE'; node = incoming(node).source.node) left.push(node)
    left.reverse()
    for (let node = outgoing(record.node).target.node; node.type === 'LONG_EDGE'; node = outgoing(node).target.node) right.push(node)
    return { record, strategy, chain: [...left, record.node, ...right] }
  })
  const widthBased = (strategy: string): boolean => strategy === 'CENTER_LAYER' || strategy === 'WIDEST_LAYER' || strategy === 'SPACE_EFFICIENT_LAYER'
  const layerWidths = indexed.some(info => widthBased(info.strategy)) ? widths : widths.map(() => 0)
  for (const widthPass of [false, true]) for (const strategy of strategies) if (widthBased(strategy) === widthPass) for (const info of indexed) if (info.strategy === strategy) {
    const { record, chain } = info
    let target = 0
    if (strategy === 'MEDIAN_LAYER') target = Math.trunc((chain.length - 1) / 2)
    else if (strategy === 'HEAD_LAYER' || strategy === 'TAIL_LAYER') {
      const reversed = incoming(record.node).reversed || outgoing(record.node).reversed, head = strategy === 'HEAD_LAYER'
      target = head !== reversed ? chain.length - 1 : 0
      record.node.options.set('alignment', head !== reversed ? 'RIGHT' : 'LEFT')
    } else if (strategy === 'WIDEST_LAYER') {
      for (let i = 1; i < chain.length; i++) if (layerWidths[chain[i]!.rank]! > layerWidths[chain[target]!.rank]!) target = i
    } else if (strategy === 'CENTER_LAYER') {
      const gap = Math.max(numberOption(options, 'layered.spacing.edgeNodeBetweenLayers', 10) * 2, numberOption(options, 'layered.spacing.nodeNodeBetweenLayers', 20)), sums: number[] = []
      let sum = -gap
      for (const node of chain) { sum += layerWidths[node.rank]! + gap; sums.push(sum) }
      target = sums.findIndex(sum => sum >= sums[sums.length - 1]! / 2)
    } else throw new Error('ELK TypeScript port: space-efficient center-label layers are not implemented yet')
    if (chain[target] !== record.node) swapNodes(layers, record.node, chain[target]!)
    layerWidths[record.node.rank] = Math.max(layerWidths[record.node.rank]!, record.node.width)
    for (let node = incoming(record.node).source.node; node.type === 'LONG_EDGE'; node = incoming(node).source.node) node.longEdgeBeforeLabelDummy = true
  }
}
function swapNodes(layers: LayoutNode[][], first: LayoutNode, second: LayoutNode): void {
  const firstLayer = layers[first.rank]!, secondLayer = layers[second.rank]!, firstIndex = firstLayer.indexOf(first), secondIndex = secondLayer.indexOf(second)
  const firstInput = first.ports.find(port => port.incoming.length > 0)!, firstOutput = first.ports.find(port => port.outgoing.length > 0)!, secondInput = second.ports.find(port => port.incoming.length > 0)!, secondOutput = second.ports.find(port => port.outgoing.length > 0)!
  const firstIncoming = firstInput.incoming.slice(), firstOutgoing = firstOutput.outgoing.slice(), secondIncoming = secondInput.incoming.slice(), secondOutgoing = secondOutput.outgoing.slice()
  firstLayer.splice(firstIndex, 1); secondLayer.splice(secondIndex, 0, first); first.rank = second.rank
  for (const edge of secondIncoming) setTarget(edge, firstInput)
  for (const edge of secondOutgoing) setSource(edge, firstOutput)
  secondLayer.splice(secondLayer.indexOf(second), 1); firstLayer.splice(firstIndex, 0, second); second.rank = layers.indexOf(firstLayer)
  for (const edge of firstIncoming) setTarget(edge, secondInput)
  for (const edge of firstOutgoing) setSource(edge, secondOutput)
}
function setTarget(edge: LayoutEdge, target: LayoutPort): void { edge.target.incoming.splice(edge.target.incoming.indexOf(edge), 1); edge.target = target; target.incoming.push(edge) }
function setSource(edge: LayoutEdge, source: LayoutPort): void { edge.source.outgoing.splice(edge.source.outgoing.indexOf(edge), 1); edge.source = source; source.outgoing.push(edge) }

/** Center-label portion of LabelSideSelector. End-label cell selection is separate. */
export function selectLabelSides(layers: LayoutNode[][], options: Options, state: CenterLabelState): void {
  const mode = enumOption(options, 'layered.edgeLabels.sideSelection', ['ALWAYS_UP', 'ALWAYS_DOWN', 'DIRECTION_UP', 'DIRECTION_DOWN', 'SMART_UP', 'SMART_DOWN'] as const, 'SMART_DOWN')
  const edgeLabelSpacing = numberOption(options, 'spacing.edgeLabel', 2), defaultSide: Side = mode.endsWith('UP') ? 'ABOVE' : 'BELOW'
  const apply = (node: LayoutNode, side: Side): void => {
    const record = state.dummies.get(node)
    if (record === undefined) return
    record.side = inline(record) ? 'INLINE' : side
    if (record.side !== 'BELOW') {
      const thickness = numberOption(record.edge.options, 'edge.thickness', 1)
      let y = 0
      if (record.side === 'ABOVE') y = node.height - Math.ceil(thickness / 2)
      else if (record.side === 'INLINE') { y = Math.ceil(node.height - edgeLabelSpacing - thickness) / 2; node.height -= edgeLabelSpacing; node.height -= thickness }
      for (const port of node.ports) port.y = y
    }
  }
  if (!mode.startsWith('SMART')) {
    for (const layer of layers) for (const node of layer) if (state.dummies.has(node)) apply(node, mode.startsWith('DIRECTION') && incoming(node).reversed && outgoing(node).reversed ? defaultSide === 'ABOVE' ? 'BELOW' : 'ABOVE' : defaultSide)
    return
  }
  const handleRun = (run: LayoutNode[], labelCount: number, top: boolean, bottom: boolean): void => {
    if (top && (!bottom || run.length > 1) && labelCount === 1 && run[0]!.type === 'LABEL') apply(run[0]!, 'ABOVE')
    else if (bottom && (!top || run.length > 1) && labelCount === 1 && run[run.length - 1]!.type === 'LABEL') apply(run[run.length - 1]!, 'BELOW')
    else if (run.length === 2) { apply(run[0]!, 'ABOVE'); apply(run[1]!, 'BELOW') }
    else {
      let group: LayoutNode[] = [], source: LayoutNode | undefined, target: LayoutNode | undefined
      const flush = (): void => { for (let i = 0; i < group.length; i++) apply(group[i]!, group.length === 2 ? i === 0 ? 'ABOVE' : 'BELOW' : defaultSide); group = [] }
      for (const node of run) { const nextSource = node.longEdgeSource?.node, nextTarget = node.longEdgeTarget?.node; if (source !== nextSource || target !== nextTarget) { flush(); source = nextSource; target = nextTarget }; group.push(node) }
      flush()
    }
  }
  for (const layer of layers) {
    let top = true, labels = 0, run: LayoutNode[] = []
    for (const node of layer) {
      if (node.type === 'LABEL' || node.type === 'LONG_EDGE') { run.push(node); if (node.type === 'LABEL') labels++ }
      else { if (run.length) handleRun(run, labels, top, false); run = []; top = false; labels = 0 }
    }
    if (run.length) handleRun(run, labels, top, true)
  }
}

/** LabelDummyRemover for orthogonal routes. */
export function removeLabelDummies(layers: LayoutNode[][], nodes: LayoutNode[], options: Options, state: CenterLabelState): void {
  const edgeLabelSpacing = numberOption(options, 'spacing.edgeLabel', 2), labelLabelSpacing = numberOption(options, 'spacing.labelLabel', 0)
  const direction = enumOption(options, 'direction', ['UNDEFINED', 'RIGHT', 'LEFT', 'DOWN', 'UP'] as const, 'RIGHT'), vertical = direction === 'DOWN' || direction === 'UP'
  for (const layer of layers) for (let i = 0; i < layer.length;) {
    const node = layer[i]!, record = state.dummies.get(node)
    if (record === undefined) { i++; continue }
    const thickness = numberOption(record.edge.options, 'edge.thickness', 1), below = record.side === 'BELOW', position = { x: node.x, y: node.y }
    if (below) position.y += thickness + edgeLabelSpacing
    const space = { x: node.width, y: node.height + (inline(record) ? 0 : -thickness - edgeLabelSpacing) }
    const labels = vertical && direction === 'UP' ? record.labels.slice().reverse() : record.labels
    for (const label of labels) {
      if (vertical) { label.x = position.x; label.y = inline(record) ? position.y + (space.y - label.height) / 2 : below ? position.y : position.y + space.y - label.height; position.x += label.width + labelLabelSpacing }
      else { label.x = position.x + (space.x - label.width) / 2.0; label.y = position.y; position.y += label.height + labelLabelSpacing }
    }
    record.edge.labels.push(...record.labels)
    joinAt(node, false); layer.splice(i, 1)
    const index = nodes.indexOf(node); if (index >= 0) nodes.splice(index, 1)
  }
}
