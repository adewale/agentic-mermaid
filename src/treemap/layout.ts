import { format } from 'd3-format'
import type { TreemapBody, TreemapCell, TreemapConfig, PositionedTreemap, TreemapNode } from './types.ts'
import type { RenderOptions } from '../types.ts'
import type { InternalStyleFace } from '../scene/style-registry.ts'
import { FLOWCHART_STYLE_DEFAULTS, resolveRenderStyle, diagramTitleBand, positionDiagramTitle } from '../styles.ts'
import { preparePixelText } from '../shared/prepared-text.ts'
import { hierarchyChildren, validateHierarchy } from '../shared/hierarchy-model.ts'

export function resolveTreemapConfig(input: Record<string, unknown> = {}): TreemapConfig {
  const number = (key: string, fallback: number, minimum = 0): number => {
    const value = input[key]
    if (value === undefined) return fallback
    if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum || value > 10000) return fallback
    return value
  }
  return {
    width: number('nodeWidth', 96, 1) * 10,
    height: number('nodeHeight', 50, 1) * 10,
    padding: number('padding', 10),
    diagramPadding: number('diagramPadding', 16),
    showValues: input.showValues !== false,
    labelFontSize: number('labelFontSize', 14, 1),
    valueFontSize: number('valueFontSize', 12, 1),
    borderWidth: number('borderWidth', 1),
    valueFormat: typeof input.valueFormat === 'string' ? input.valueFormat : ',',
  }
}

export function formatTreemapValue(value: number, spec: string): string {
  if (spec === '$0,0') spec = '$,'
  try {
    return format(spec)(value)
  } catch {
    throw new Error(`Invalid treemap.valueFormat ${JSON.stringify(spec)}`)
  }
}

interface Tile {
  id: string
  value: number
  x: number
  y: number
  width: number
  height: number
}

/** Bruls/Huizing/van Wijk squarification. Partition coordinates, never label
 * widths, encode the data; equal weights retain authored tie order. */
export function squarifyTreemap(values: readonly { id: string; value: number }[], box: { x: number; y: number; width: number; height: number }): Tile[] {
  const sorted = values
    .map((value, index) => ({ ...value, index }))
    .filter(item => item.value > 0)
    .sort((a, b) => b.value - a.value || a.index - b.index)
  const total = sorted.reduce((sum, item) => sum + item.value, 0)
  if (!Number.isFinite(total)) throw new Error('Treemap total exceeds the finite numeric range')
  const scale = total > 0 ? (box.width * box.height) / total : 0
  const pending = sorted.map(item => ({ ...item, area: item.value * scale }))
  const result: Tile[] = []
  let { x, y, width, height } = box
  let cursor = 0
  while (cursor < pending.length && width > 0 && height > 0) {
    const side = Math.min(width, height)
    let end = cursor + 1
    let sum = pending[cursor]!.area
    let min = sum
    const max = sum
    const worst = (area: number, smallest: number) => Math.max((side * side * max) / (area * area), (area * area) / (side * side * smallest))
    let ratio = worst(sum, min)
    while (end < pending.length) {
      const area = pending[end]!.area
      const next = worst(sum + area, Math.min(min, area))
      if (next > ratio) break
      ratio = next
      sum += area
      min = Math.min(min, area)
      end++
    }
    const vertical = width >= height
    const thickness = vertical ? Math.min(width, sum / height) : Math.min(height, sum / width)
    let along = vertical ? y : x
    for (let index = cursor; index < end; index++) {
      const item = pending[index]!
      const extent = index === end - 1 ? (vertical ? y + height : x + width) - along : item.area / thickness
      result.push({ id: item.id, value: item.value, x: vertical ? x : along, y: vertical ? along : y, width: vertical ? thickness : extent, height: vertical ? extent : thickness })
      along += extent
    }
    if (vertical) {
      x += thickness
      width = Math.max(0, width - thickness)
    } else {
      y += thickness
      height = Math.max(0, height - thickness)
    }
    cursor = end
  }
  for (const item of values) if (item.value <= 0) result.push({ ...item, x: box.x, y: box.y, width: 0, height: 0 })
  return result
}

export function layoutTreemapDiagram(body: TreemapBody, options: RenderOptions = {}, config = resolveTreemapConfig(), styleFace?: InternalStyleFace): PositionedTreemap {
  validateHierarchy(body.nodes)
  const style = resolveRenderStyle(options, { ...FLOWCHART_STYLE_DEFAULTS, nodeLabelFontSize: config.labelFontSize }, styleFace)
  const children = hierarchyChildren(body.nodes)
  const totals = new Map<string, number>()
  for (const node of [...body.nodes].reverse()) totals.set(node.id, node.value ?? (children.get(node.id) ?? []).reduce((sum, child) => sum + (totals.get(child.id) ?? 0), 0))
  const titleBand = diagramTitleBand(body.title, style)
  const padding = config.diagramPadding
  const width = Math.max(config.width, (titleBand?.width ?? 0) + padding * 2)
  const height = config.height + (titleBand?.height ?? 0) + padding * 2
  const cells: TreemapCell[] = []
  const hiddenLabels: string[] = []
  const roots = children.get(undefined) ?? []
  const categories = new Map(roots.map((node, index) => [node.id, index]))
  const nodesById = new Map(body.nodes.map(node => [node.id, node]))
  const pending: { items: TreemapNode[]; box: { x: number; y: number; width: number; height: number }; depth: number; category?: number }[] = [{ items: roots, box: { x: padding, y: padding + (titleBand?.height ?? 0), width: width - padding * 2, height: config.height }, depth: 0 }]
  while (pending.length) {
    const plan = pending.pop()!
    const tiles = squarifyTreemap(
      plan.items.map(node => ({ id: node.id, value: totals.get(node.id) ?? 0 })),
      plan.box,
    )
    for (const tile of tiles) {
      const node = nodesById.get(tile.id)!
      const category = plan.category ?? categories.get(node.id) ?? 0
      const cell: TreemapCell = { node, total: tile.value, x: tile.x, y: tile.y, width: tile.width, height: tile.height, depth: plan.depth, category }
      const label = preparePixelText(node.label, { fontSize: style.nodeLabelFontSize, fontWeight: style.nodeLabelFontWeight, letterSpacing: style.nodeLetterSpacing, transform: style.nodeTextTransform, maxWidth: Math.max(1, tile.width - 12) })
      const valueLabel = config.showValues ? preparePixelText(formatTreemapValue(tile.value, config.valueFormat), { fontSize: config.valueFontSize, fontWeight: 400, maxWidth: Math.max(1, tile.width - 12) }) : undefined
      const inner = children.get(node.id)
      const labelHeight = label.height + (valueLabel ? valueLabel.height + 4 : 0) + 12
      if (label.width <= tile.width - 12 && labelHeight <= tile.height) {
        cell.label = label
        cell.valueLabel = valueLabel
        cell.labelY = tile.y + 6 + label.height / 2
        if (valueLabel) cell.valueY = tile.y + 10 + label.height + valueLabel.height / 2
      } else hiddenLabels.push(node.label)
      cells.push(cell)
      if (inner?.length) {
        const header = cell.label ? labelHeight : 0
        const gap = Math.min(config.padding, tile.width / 4, Math.max(0, tile.height - header) / 4)
        pending.push({ items: inner, box: { x: tile.x + gap, y: tile.y + header + gap, width: Math.max(0, tile.width - 2 * gap), height: Math.max(0, tile.height - header - 2 * gap) }, depth: plan.depth + 1, category })
      }
    }
  }
  // Stable authored paint/text order, independent of the partition's sort order.
  const order = new Map(body.nodes.map((node, index) => [node.id, index]))
  cells.sort((a, b) => order.get(a.node.id)! - order.get(b.node.id)!)
  return { width, height, body, cells, config, hiddenLabels, options, ...(titleBand ? { title: positionDiagramTitle(titleBand, width, padding) } : {}) }
}
