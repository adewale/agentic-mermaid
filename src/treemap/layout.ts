import { format } from 'd3-format'
import type { InternalStyleFace } from '../scene/style-registry.ts'
import { hierarchyChildren, validateHierarchy } from '../shared/hierarchy-model.ts'
import { preparePixelText } from '../shared/prepared-text.ts'
import { diagramTitleBand, FLOWCHART_STYLE_DEFAULTS, positionDiagramTitle, resolveRenderStyle } from '../styles.ts'
import type { RenderOptions } from '../types.ts'
import type { PositionedTreemap, TreemapBody, TreemapCell, TreemapConfig, TreemapNode } from './types.ts'

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

/** Compile per request so every value shares the same locale and format. */
export function compileTreemapValueFormat(spec: string): (value: number) => string {
  if (spec === '$0,0') spec = '$,'
  try {
    return format(spec)
  } catch {
    throw new Error(`Invalid treemap.valueFormat ${JSON.stringify(spec)}`)
  }
}

export function formatTreemapValue(value: number, spec: string): string {
  return compileTreemapValueFormat(spec)(value)
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
  // A header can consume its container's content area. Its descendants still
  // have authored quantities and identities, even when no area remains.
  for (; cursor < pending.length; cursor++) {
    const item = pending[cursor]!
    result.push({ id: item.id, value: item.value, x: box.x, y: box.y, width: 0, height: 0 })
  }
  for (const item of values) if (item.value <= 0) result.push({ ...item, x: box.x, y: box.y, width: 0, height: 0 })
  return result
}

export function layoutTreemapDiagram(body: TreemapBody, options: RenderOptions = {}, config = resolveTreemapConfig(), styleFace?: InternalStyleFace): PositionedTreemap {
  validateHierarchy(body.nodes, node => node.value === undefined)
  const style = resolveRenderStyle(options, { ...FLOWCHART_STYLE_DEFAULTS, nodeLabelFontSize: config.labelFontSize, groupHeaderFontSize: config.labelFontSize, groupHeaderFontWeight: FLOWCHART_STYLE_DEFAULTS.nodeLabelFontWeight }, styleFace)
  const children = hierarchyChildren(body.nodes)
  const totals = new Map<string, number>()
  for (const node of [...body.nodes].reverse()) totals.set(node.id, node.value ?? (children.get(node.id) ?? []).reduce((sum, child) => sum + (totals.get(child.id) ?? 0), 0))
  const titleBand = diagramTitleBand(body.title, style)
  const padding = config.diagramPadding
  const width = Math.max(config.width, (titleBand?.width ?? 0) + padding * 2)
  const height = config.height + (titleBand?.height ?? 0) + padding * 2
  const cells: TreemapCell[] = []
  const hiddenLabels: string[] = []
  let formatValue: ReturnType<typeof compileTreemapValueFormat> | undefined
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
      const inner = children.get(node.id)
      let labelHeight = 0
      if (tile.width > 0 && tile.height > 0) {
        const section = node.value === undefined,
          face = section ? styleFace?.group : styleFace?.node,
          paddingX = face?.paddingX ?? 6,
          paddingY = face?.paddingY ?? 6,
          maxWidth = Math.max(1, tile.width - paddingX * 2),
          fontFamily = section ? (style.groupFont ?? options.font) : options.font,
          letterSpacing = section ? style.groupLetterSpacing : style.nodeLetterSpacing,
          transform = section ? style.groupTextTransform : style.nodeTextTransform
        const label = preparePixelText(node.label, { fontSize: section ? style.groupHeaderFontSize : style.nodeLabelFontSize, fontWeight: section ? style.groupHeaderFontWeight : style.nodeLabelFontWeight, letterSpacing, transform, fontFamily, maxWidth })
        const valueLabel = config.showValues
          ? preparePixelText((formatValue ??= compileTreemapValueFormat(config.valueFormat))(tile.value), { fontSize: face?.fontSize ?? styleFace?.text?.fontSize ?? config.valueFontSize, fontWeight: face?.fontWeight ?? styleFace?.text?.fontWeight ?? 400, letterSpacing, transform, fontFamily, maxWidth })
          : undefined
        labelHeight = label.height + (valueLabel ? valueLabel.height + 4 : 0) + paddingY * 2
        if (label.width <= tile.width - paddingX * 2 && labelHeight <= tile.height) {
          cell.label = label
          cell.valueLabel = valueLabel
          cell.labelY = tile.y + paddingY + label.height / 2
          if (valueLabel) cell.valueY = tile.y + paddingY + 4 + label.height + valueLabel.height / 2
          if (section && style.groupHeaderFillColor !== undefined) cell.headerHeight = labelHeight
        } else hiddenLabels.push(node.label)
      } else hiddenLabels.push(node.label)
      cells.push(cell)
      if (inner?.length) {
        const header = cell.label ? labelHeight : 0
        const gap = Math.min(config.padding, tile.width / 4, Math.max(0, tile.height - header) / 4)
        const gapX = styleFace?.group?.paddingX === undefined ? gap : Math.min(styleFace.group.paddingX, tile.width / 4),
          gapY = styleFace?.group?.paddingY === undefined ? gap : Math.min(styleFace.group.paddingY, Math.max(0, tile.height - header) / 4)
        pending.push({ items: inner, box: { x: tile.x + gapX, y: tile.y + header + gapY, width: Math.max(0, tile.width - 2 * gapX), height: Math.max(0, tile.height - header - 2 * gapY) }, depth: plan.depth + 1, category })
      }
    }
  }
  // Stable authored paint/text order, independent of the partition's sort order.
  const order = new Map(body.nodes.map((node, index) => [node.id, index]))
  cells.sort((a, b) => order.get(a.node.id)! - order.get(b.node.id)!)
  return { width, height, body, cells, config, hiddenLabels, options, ...(titleBand ? { title: positionDiagramTitle(titleBand, width, padding) } : {}) }
}
