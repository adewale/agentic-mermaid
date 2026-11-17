/*******************************************************************************
 * Copyright (c) 2011, 2018 Kiel University and others.
 * This program and the accompanying materials are made available under the
 * terms of the Eclipse Public License 2.0 which is available at
 * https://www.eclipse.org/legal/epl-2.0/.
 * SPDX-License-Identifier: EPL-2.0
 *******************************************************************************/
import type { LayoutNode, LayoutPort } from './graph.ts'
import { enumOption, setOption, type Direction, type Insets, type Options } from './options.ts'

export interface TransformationGraph { width: number; height: number; offsetX: number; offsetY: number; padding: Insets; options: Options }
const ALIGNMENT = ['AUTOMATIC', 'LEFT', 'RIGHT', 'TOP', 'BOTTOM', 'CENTER'] as const
const LABEL_PLACEMENT = ['H_LEFT', 'H_CENTER', 'H_RIGHT', 'V_TOP', 'V_CENTER', 'V_BOTTOM', 'INSIDE', 'OUTSIDE', 'H_PRIORITY'] as const

/** GraphTransformer's internal LTR and final input-direction transformations. */
export function transformGraph(nodes: LayoutNode[], graph: TransformationGraph, direction: Direction, mode: 'TO_INTERNAL_LTR' | 'TO_INPUT_DIRECTION'): void {
  const input = mode === 'TO_INPUT_DIRECTION'
  const reading = enumOption(graph.options, 'layered.directionCongruency', ['READING_DIRECTION', 'ROTATION'] as const, 'READING_DIRECTION') === 'READING_DIRECTION'
  if (reading) {
    if (direction === 'LEFT') mirror(nodes, graph, true)
    else if (direction === 'DOWN') transpose(nodes, graph)
    else if (direction === 'UP') { if (!input) { transpose(nodes, graph); mirror(nodes, graph, false) } else { mirror(nodes, graph, false); transpose(nodes, graph) } }
  } else if (direction === 'LEFT') { mirror(nodes, graph, true); mirror(nodes, graph, false) }
  else if (direction === 'DOWN') { if (!input) { transpose(nodes, graph); mirror(nodes, graph, true) } else { mirror(nodes, graph, true); transpose(nodes, graph) } }
  else if (direction === 'UP') { if (!input) { mirror(nodes, graph, true); transpose(nodes, graph) } else { transpose(nodes, graph); mirror(nodes, graph, true) } }
}
function mirror(nodes: LayoutNode[], graph: TransformationGraph, horizontal: boolean): void {
  let offset = 0
  const size = horizontal ? graph.width : graph.height, graphOffset = horizontal ? graph.offsetX : graph.offsetY
  if (size === 0) for (const node of nodes) offset = Math.max(offset, horizontal ? node.x + node.width + node.margin.right : node.y + node.height + node.margin.bottom)
  else offset = size - graphOffset
  offset -= graphOffset
  for (const node of nodes) {
    if (horizontal) node.x = offset - node.width - node.x; else node.y = offset - node.height - node.y
    mirrorSpacing(node.padding, horizontal)
    mirrorPlacement(node.options, horizontal)
    if (node.position !== undefined) { if (horizontal) node.position.x = offset - node.width - node.position.x; else node.position.y = offset - node.height - node.position.y }
    const alignment = enumOption(node.options, 'alignment', ALIGNMENT, 'AUTOMATIC')
    if (horizontal && (alignment === 'LEFT' || alignment === 'RIGHT')) node.options.set('alignment', alignment === 'LEFT' ? 'RIGHT' : 'LEFT')
    if (!horizontal && (alignment === 'TOP' || alignment === 'BOTTOM')) node.options.set('alignment', alignment === 'TOP' ? 'BOTTOM' : 'TOP')
    for (const port of node.ports) {
      if (horizontal) { port.x = node.width - port.width - port.x; port.anchorX = port.width - port.anchorX; setPortSide(port, mirrorSide(port.side, true)) }
      else { port.y = node.height - port.height - port.y; port.anchorY = port.height - port.anchorY; setPortSide(port, mirrorSide(port.side, false)) }
      if (port.index !== undefined) port.index = -port.index
      for (const edge of port.outgoing) {
        for (const point of edge.bends) { if (horizontal) point.x = offset - point.x; else point.y = offset - point.y }
        for (const point of edge.junctions ?? []) { if (horizontal) point.x = offset - point.x; else point.y = offset - point.y }
        for (const label of edge.labels) { if (horizontal) label.x = offset - label.width - label.x; else label.y = offset - label.height - label.y }
      }
      for (const label of port.labels) { if (horizontal) label.x = port.width - label.width - label.x; else label.y = port.height - label.height - label.y }
    }
    if (node.type === 'EXTERNAL_PORT') {
      if (node.externalPortSide === undefined) throw new Error('ELK external port has no side')
      node.externalPortSide = mirrorSide(node.externalPortSide, horizontal)
      if (horizontal) node.layerConstraint = node.layerConstraint === 'FIRST' ? 'LAST' : node.layerConstraint === 'FIRST_SEPARATE' ? 'LAST_SEPARATE' : node.layerConstraint === 'LAST' ? 'FIRST' : node.layerConstraint === 'LAST_SEPARATE' ? 'FIRST_SEPARATE' : node.layerConstraint
      else node.inLayerConstraint = node.inLayerConstraint === 'TOP' ? 'BOTTOM' : node.inLayerConstraint === 'BOTTOM' ? 'TOP' : node.inLayerConstraint
    }
    for (const label of node.labels) { mirrorPlacement(label.options, horizontal); if (horizontal) label.x = node.width - label.width - label.x; else label.y = node.height - label.height - label.y }
  }
  mirrorSpacing(graph.padding, horizontal)
}
function mirrorSide(side: LayoutPort['side'], horizontal: boolean): LayoutPort['side'] { return horizontal ? side === 'EAST' ? 'WEST' : side === 'WEST' ? 'EAST' : side : side === 'NORTH' ? 'SOUTH' : side === 'SOUTH' ? 'NORTH' : side }
function mirrorSpacing(spacing: Insets, horizontal: boolean): void { if (horizontal) { const left = spacing.left; spacing.left = spacing.right; spacing.right = left } else { const top = spacing.top; spacing.top = spacing.bottom; spacing.bottom = top } }
function mirrorPlacement(options: Options, horizontal: boolean): void {
  if (!options.has('nodeLabels.placement')) return
  const placement = setOption(options, 'nodeLabels.placement', LABEL_PLACEMENT, []), first = horizontal ? 'H_LEFT' : 'V_TOP', second = horizontal ? 'H_RIGHT' : 'V_BOTTOM'
  if (placement.has(first)) { placement.delete(first); placement.add(second) } else if (placement.has(second)) { placement.delete(second); placement.add(first) }
  options.set('nodeLabels.placement', '[' + [...placement].join(',') + ']')
}
function transpose(nodes: LayoutNode[], graph: TransformationGraph): void {
  for (const node of nodes) {
    transposeShape(node); transposeSpacing(node.padding); transposePlacement(node.options)
    const minimum = node.minimumSize.x; node.minimumSize.x = node.minimumSize.y; node.minimumSize.y = minimum
    const alignment = enumOption(node.options, 'alignment', ALIGNMENT, 'AUTOMATIC')
    if (alignment === 'LEFT') node.options.set('alignment', 'TOP'); else if (alignment === 'RIGHT') node.options.set('alignment', 'BOTTOM'); else if (alignment === 'TOP') node.options.set('alignment', 'LEFT'); else if (alignment === 'BOTTOM') node.options.set('alignment', 'RIGHT')
    if (node.position !== undefined) transposePoint(node.position)
    for (const port of node.ports) {
      transposeShape(port); const anchor = port.anchorX; port.anchorX = port.anchorY; port.anchorY = anchor
      setPortSide(port, transposeSide(port.side)); if (port.index !== undefined) port.index = -port.index
      for (const edge of port.outgoing) { for (const point of edge.bends) transposePoint(point); for (const point of edge.junctions ?? []) transposePoint(point); for (const label of edge.labels) transposeShape(label) }
      for (const label of port.labels) transposeShape(label)
    }
    if (node.type === 'EXTERNAL_PORT') {
      if (node.externalPortSide === undefined) throw new Error('ELK external port has no side')
      node.externalPortSide = transposeSide(node.externalPortSide)
      if (node.layerConstraint === 'FIRST_SEPARATE') { node.layerConstraint = 'NONE'; node.inLayerConstraint = 'TOP' }
      else if (node.layerConstraint === 'LAST_SEPARATE') { node.layerConstraint = 'NONE'; node.inLayerConstraint = 'BOTTOM' }
      else if (node.inLayerConstraint === 'TOP') { node.layerConstraintSet = true; node.layerConstraint = 'FIRST_SEPARATE'; node.inLayerConstraint = 'NONE' }
      else if (node.inLayerConstraint === 'BOTTOM') { node.layerConstraintSet = true; node.layerConstraint = 'LAST_SEPARATE'; node.inLayerConstraint = 'NONE' }
    }
    for (const label of node.labels) { transposePlacement(label.options); transposeShape(label) }
  }
  const selections = ['ALWAYS_UP', 'ALWAYS_DOWN', 'DIRECTION_UP', 'DIRECTION_DOWN', 'SMART_UP', 'SMART_DOWN'] as const
  const selected = enumOption(graph.options, 'layered.edgeLabels.sideSelection', selections, 'SMART_DOWN'), index = selections.indexOf(selected)
  graph.options.set('layered.edgeLabels.sideSelection', selections[index % 2 === 0 ? index + 1 : index - 1]!)
  const offset = graph.offsetX; graph.offsetX = graph.offsetY; graph.offsetY = offset
  const width = graph.width; graph.width = graph.height; graph.height = width
  transposeSpacing(graph.padding)
}
function transposePoint(point: { x: number; y: number }): void { const x = point.x; point.x = point.y; point.y = x }
function transposeShape(shape: { x: number; y: number; width: number; height: number }): void { transposePoint(shape); const width = shape.width; shape.width = shape.height; shape.height = width }
function transposeSpacing(spacing: Insets): void { const top = spacing.top, bottom = spacing.bottom, left = spacing.left, right = spacing.right; spacing.top = left; spacing.bottom = right; spacing.left = top; spacing.right = bottom }
function transposeSide(side: LayoutPort['side']): LayoutPort['side'] { return side === 'NORTH' ? 'WEST' : side === 'WEST' ? 'NORTH' : side === 'SOUTH' ? 'EAST' : side === 'EAST' ? 'SOUTH' : 'UNDEFINED' }
function setPortSide(port: LayoutPort, side: LayoutPort['side']): void {
  port.side = side
  if (port.explicitAnchor) return
  if (side === 'NORTH') { port.anchorX = port.width / 2; port.anchorY = 0 }
  else if (side === 'EAST') { port.anchorX = port.width; port.anchorY = port.height / 2 }
  else if (side === 'SOUTH') { port.anchorX = port.width / 2; port.anchorY = port.height }
  else if (side === 'WEST') { port.anchorX = 0; port.anchorY = port.height / 2 }
}
function transposePlacement(options: Options): void {
  if (!options.has('nodeLabels.placement')) return
  const old = setOption(options, 'nodeLabels.placement', LABEL_PLACEMENT, [])
  if (old.size === 0) return
  const result = new Set<string>([old.has('INSIDE') ? 'INSIDE' : 'OUTSIDE'])
  if (!old.has('H_PRIORITY')) result.add('H_PRIORITY')
  if (old.has('H_LEFT')) result.add('V_TOP'); else if (old.has('H_CENTER')) result.add('V_CENTER'); else if (old.has('H_RIGHT')) result.add('V_BOTTOM')
  if (old.has('V_TOP')) result.add('H_LEFT'); else if (old.has('V_CENTER')) result.add('H_CENTER'); else if (old.has('V_BOTTOM')) result.add('H_RIGHT')
  options.set('nodeLabels.placement', '[' + [...result].join(',') + ']')
}
