import type { MindmapDiagram, MindmapNode, PositionedMindmapDiagram, PositionedMindmapNode } from './types.ts'
import { measureMultilineText } from '../text-metrics.ts'
import { wrapLabelToWidth } from '../shared/label-wrap.ts'

export interface MindmapLayoutOptions {
  padding?: number
  maxNodeWidth?: number
  nodeGap?: number
  layerGap?: number
}

const FONT_SIZE = 13
const FONT_WEIGHT = 500

export function layoutMindmap(diagram: MindmapDiagram, options: MindmapLayoutOptions = {}): PositionedMindmapDiagram {
  const padding = finite(options.padding, 32)
  const maxNodeWidth = finite(options.maxNodeWidth, 180)
  const nodeGap = finite(options.nodeGap, 22)
  const layerGap = finite(options.layerGap, 80)
  const entries = new Map<string, PositionedMindmapNode>()
  const sourceById = new Map<string, MindmapNode>()

  const measure = (node: MindmapNode, depth: number, parentId?: string): PositionedMindmapNode => {
    const label = wrapLabelToWidth(node.label, maxNodeWidth, FONT_SIZE, FONT_WEIGHT)
    const metrics = measureMultilineText(label, FONT_SIZE, FONT_WEIGHT)
    let width = Math.max(56, metrics.width + 24)
    let height = Math.max(34, metrics.height + 18 + (node.icon ? 14 : 0))
    if (node.shape === 'circle') { width = height = Math.max(width, height, 54) }
    if (node.shape === 'bang' || node.shape === 'cloud') { width += 18; height += 10 }
    const positioned: PositionedMindmapNode = {
      id: node.id, label, shape: node.shape, icon: node.icon, className: node.className,
      ...(parentId ? { parentId } : {}), depth, x: 0, y: 0, width, height,
    }
    entries.set(node.id, positioned)
    sourceById.set(node.id, node)
    for (const child of node.children) measure(child, depth + 1, node.id)
    return positioned
  }
  measure(diagram.root, 0)
  const maxWidthAtDepth = new Map<number, number>()
  for (const node of entries.values()) maxWidthAtDepth.set(node.depth, Math.max(maxWidthAtDepth.get(node.depth) ?? 0, node.width))
  const xAtDepth = new Map<number, number>([[0, padding]])
  const maxDepth = Math.max(...entries.values().map(node => node.depth))
  for (let depth = 1; depth <= maxDepth; depth++) {
    xAtDepth.set(depth, xAtDepth.get(depth - 1)! + (maxWidthAtDepth.get(depth - 1) ?? 0) + layerGap)
  }

  let cursorY = padding
  const assignY = (node: MindmapNode): number => {
    const positioned = entries.get(node.id)!
    positioned.x = xAtDepth.get(positioned.depth)!
    if (node.children.length === 0) {
      positioned.y = cursorY
      cursorY += positioned.height + nodeGap
      return positioned.y + positioned.height / 2
    }
    const childCenters = node.children.map(assignY)
    const center = (childCenters[0]! + childCenters[childCenters.length - 1]!) / 2
    positioned.y = Math.max(padding, center - positioned.height / 2)
    return positioned.y + positioned.height / 2
  }
  assignY(diagram.root)

  // If a tall root was clamped upward, keep every node non-negative and retain
  // deterministic relative geometry.
  const minY = Math.min(...entries.values().map(node => node.y))
  if (minY < padding) for (const node of entries.values()) node.y += padding - minY

  const edges = [...entries.values()].flatMap(node => {
    if (!node.parentId) return []
    const parent = entries.get(node.parentId)!
    const start = { x: parent.x + parent.width, y: parent.y + parent.height / 2 }
    const end = { x: node.x, y: node.y + node.height / 2 }
    const middle = (start.x + end.x) / 2
    return [{ from: parent.id, to: node.id, points: [start, { x: middle, y: start.y }, { x: middle, y: end.y }, end] }]
  })
  const width = Math.max(...entries.values().map(node => node.x + node.width)) + padding
  const height = Math.max(...entries.values().map(node => node.y + node.height)) + padding
  return {
    width, height,
    accessibilityTitle: diagram.accessibilityTitle,
    accessibilityDescription: diagram.accessibilityDescription,
    nodes: [...entries.values()], edges,
  }
}

function finite(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : fallback
}
