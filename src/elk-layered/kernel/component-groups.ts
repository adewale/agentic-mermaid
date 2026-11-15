/*******************************************************************************
 * Copyright (c) 2012, 2015 Kiel University and others.
 * This program and the accompanying materials are made available under the
 * terms of the Eclipse Public License 2.0 which is available at
 * https://www.eclipse.org/legal/epl-2.0/.
 * SPDX-License-Identifier: EPL-2.0
 *******************************************************************************/
import type { Component, ComponentPackingOptions, ComponentPackingResult } from './components.ts'

// ComponentGroup.CONSTRAINTS, with the four PortSide enum-set bits N=1,E=2,S=4,W=8.
const conflicts: readonly (readonly number[])[] = [
  [15],
  [15, 11],
  [7, 15],
  [3, 11, 7],
  [14, 15],
  [10, 15, 11, 14],
  [6, 14, 7],
  [2, 10, 3, 6, 11, 14, 7, 15],
  [15, 13],
  [9, 11, 13],
  [5, 13, 7, 15],
  [1, 5, 9, 3, 15, 11, 13, 7],
  [12, 14, 13],
  [8, 10, 9, 12, 11, 14, 13, 15],
  [4, 5, 12, 6, 14, 13, 7, 15],
  [0, 8, 2, 1, 4, 5, 10, 11, 14, 13, 7, 15],
]
type Size = { x: number; y: number }
type Group = Map<number, Component[]>
function maximum(...values: number[]): number { let max = -Number.MAX_VALUE; for (const value of values) if (value > max) max = value; return max }
function offset(component: Component, x: number, y: number): void {
  for (const node of component.nodes) { node.x += x; node.y += y }
  for (const point of component.points ?? []) { point.x += x; point.y += y }
}
function move(components: Component[], x: number, y: number): void { for (const component of components) offset(component, x, y) }
function line(components: Component[], spacing: number, horizontal: boolean): Size {
  const size = { x: 0, y: 0 }
  for (const component of components) {
    offset(component, horizontal ? size.x : 0.0, horizontal ? 0.0 : size.y)
    if (horizontal) { size.x += component.width + spacing; size.y = Math.max(size.y, component.height) }
    else { size.y += component.height + spacing; size.x = Math.max(size.x, component.width) }
  }
  if (horizontal) { if (size.y > 0.0) size.y += spacing }
  else if (size.x > 0.0) size.x += spacing
  return size
}
function rows(components: Component[], options: ComponentPackingOptions): Size {
  if (components.length === 0) return { x: 0, y: 0 }
  let maxWidth = 0, area = 0
  for (const component of components) { maxWidth = Math.max(maxWidth, component.width); area += component.width * component.height }
  maxWidth = Math.max(maxWidth, Math.sqrt(area) * options.aspectRatio)
  const spacing = options.spacing
  let x = 0, y = 0, highest = 0, broadest = spacing
  for (const component of components) {
    if (x + component.width > maxWidth) { x = 0; y += highest + spacing; highest = 0 }
    offset(component, x, y)
    broadest = Math.max(broadest, x + component.width); highest = Math.max(highest, component.height)
    x += component.width + spacing
  }
  return { x: broadest + spacing, y: y + highest + spacing }
}
function place(group: Group, options: ComponentPackingOptions): Size {
  const get = (mask: number): Component[] => group.get(mask) ?? [], spacing = options.spacing
  const c = rows(get(0), options), n = line(get(1), spacing, true), s = line(get(4), spacing, true), w = line(get(8), spacing, false), e = line(get(2), spacing, false)
  const nw = line(get(9), spacing, true), ne = line(get(3), spacing, true), sw = line(get(12), spacing, true), se = line(get(6), spacing, true)
  const we = line(get(10), spacing, false), ns = line(get(5), spacing, true), nwe = line(get(11), spacing, true), swe = line(get(14), spacing, true), wns = line(get(13), spacing, false), ens = line(get(7), spacing, false), all = line(get(15), spacing, true)
  const left = maximum(nw.x, w.x, sw.x, wns.x), mid = maximum(n.x, c.x, s.x, all.x), nsWidth = ns.x, right = maximum(ne.x, e.x, se.x, ens.x)
  const top = maximum(nw.y, n.y, ne.y, nwe.y), middle = maximum(w.y, c.y, e.y, all.y), weHeight = we.y, bottom = maximum(sw.y, s.y, se.y, swe.y)
  move(get(0), left + nsWidth, top + weHeight)
  move(get(15), left + nsWidth, top + weHeight)
  move(get(1), left + nsWidth, 0.0)
  move(get(4), left + nsWidth, top + weHeight + middle)
  move(get(8), 0.0, top + weHeight)
  move(get(2), left + nsWidth + mid, top + weHeight)
  move(get(3), left + nsWidth + mid, 0.0)
  move(get(12), 0.0, top + weHeight + middle)
  move(get(6), left + nsWidth + mid, top + weHeight + middle)
  move(get(10), 0.0, top)
  move(get(5), left, 0.0)
  move(get(14), 0.0, top + weHeight + middle)
  move(get(7), left + nsWidth + mid, 0.0)
  return { x: maximum(left + mid + nsWidth + right, we.x, nwe.x, swe.x), y: maximum(top + middle + weHeight + bottom, ns.y, wns.y, ens.y) }
}
/** ComponentGroupGraphPlacer.combine, including all sixteen external-side sectors. */
export function packComponentGroups(components: Component[], options: ComponentPackingOptions): ComponentPackingResult {
  if (components.length === 0) return { width: 0, height: 0 }
  const groups: Group[] = []
  for (const component of components) {
    const mask = component.connections ?? 0
    let target = groups.find(group => conflicts[mask]!.every(conflict => (group.get(conflict)?.length ?? 0) === 0))
    if (target === undefined) { target = new Map(); groups.push(target) }
    let list = target.get(mask)
    if (list === undefined) { list = []; target.set(mask, list) }
    list.push(component)
  }
  // GWT's private enum-set hash buckets can traverse a group differently by
  // session. These post-solver operations independently translate disjoint
  // completed components; authored JSON containment arrays remain separate.
  const cursor = { x: 0, y: 0 }
  for (const group of groups) {
    const size = place(group, options)
    for (const list of group.values()) move(list, cursor.x, cursor.y)
    cursor.x += size.x; cursor.y += size.y
  }
  for (const group of groups) for (const list of group.values()) for (const component of list) {
    component.offsetX += 0; component.offsetY += 0
    offset(component, component.offsetX, component.offsetY)
  }
  return { width: cursor.x - options.spacing, height: cursor.y - options.spacing, order: groups.flatMap(group => [...group.values()].flat()) }
}
