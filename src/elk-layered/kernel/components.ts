/*******************************************************************************
 * Copyright (c) 2012, 2022 Kiel University and others.
 *
 * This program and the accompanying materials are made available under the
 * terms of the Eclipse Public License 2.0 which is available at
 * http://www.eclipse.org/legal/epl-2.0.
 *
 * SPDX-License-Identifier: EPL-2.0
 *******************************************************************************/

export interface ComponentNode {
  x: number
  y: number
  priority: number
}

export interface Component {
  connections?: number
  nodes: ComponentNode[]
  width: number
  height: number
  offsetX: number
  offsetY: number
  priority?: number
  points?: { x: number; y: number }[]
}

export interface ComponentPackingOptions {
  spacing: number
  aspectRatio: number
  preserveModelOrder: boolean
}

export interface ComponentPackingResult {
  order?: Component[]
  width: number
  height: number
}

// GWT's java.lang.Double.compare, including signed zero and NaN ordering.
function compareNumbers(a: number, b: number): number {
  if (a < b) return -1
  if (a > b) return 1
  if (a === b) return a === 0 ? compareNumbers(1 / a, 1 / b) : 0
  return Number.isNaN(a) ? (Number.isNaN(b) ? 0 : 1) : -1
}

/**
 * SimpleRowGraphPlacer.combine/sortComponents/placeComponents and the node
 * movement from AbstractGraphPlacer, ELK v0.11.0 (54123e884b1ae743b453260f713b20c9bf5787f2).
 * Numeric operations follow the published elkjs 0.11.1 GWT worker.
 * Components already contain their completed layouts; padding belongs to the caller.
 */
export function packComponents(components: Component[], options: ComponentPackingOptions): ComponentPackingResult {
  if (components.length === 1) {
    const source = components[0]!
    source.offsetX += 0
    source.offsetY += 0
    for (const node of source.nodes) {
      node.x += source.offsetX
      node.y += source.offsetY
    }
    for (const point of source.points ?? []) { point.x += source.offsetX; point.y += source.offsetY }
    return { width: source.width, height: source.height }
  }
  if (components.length === 0) return { width: 0, height: 0 }

  if (!options.preserveModelOrder) {
    for (const component of components) {
      let priority = 0
      for (const node of component.nodes) priority += node.priority
      component.priority = priority
    }
    components.sort((a, b) => {
      const priority = b.priority! - a.priority!
      return priority === 0 ? compareNumbers(a.width * a.height, b.width * b.height) : priority
    })
  }

  let maxRowWidth = 0
  let totalArea = 0
  for (const component of components) {
    maxRowWidth = Math.max(maxRowWidth, component.width)
    totalArea += component.width * component.height
  }
  maxRowWidth = Math.max(maxRowWidth, Math.sqrt(totalArea) * options.aspectRatio)

  const componentSpacing = options.spacing
  let xpos = 0
  let ypos = 0
  let highestBox = 0
  let broadestRow = componentSpacing
  for (const component of components) {
    if (xpos + component.width > maxRowWidth) {
      xpos = 0
      ypos += highestBox + componentSpacing
      highestBox = 0
    }
    const offsetX = xpos + component.offsetX
    const offsetY = ypos + component.offsetY
    for (const node of component.nodes) {
      node.x += offsetX
      node.y += offsetY
    }
    for (const point of component.points ?? []) { point.x += offsetX; point.y += offsetY }
    component.offsetX = 0
    component.offsetY = 0
    broadestRow = Math.max(broadestRow, xpos + component.width)
    highestBox = Math.max(highestBox, component.height)
    xpos += component.width + componentSpacing
  }

  // AbstractGraphPlacer.moveGraphs also adds the now-reset component offsets.
  for (const component of components) {
    for (const node of component.nodes) {
      node.x += component.offsetX
      node.y += component.offsetY
    }
    for (const point of component.points ?? []) { point.x += component.offsetX; point.y += component.offsetY }
  }
  return { width: broadestRow, height: ypos + highestBox }
}
