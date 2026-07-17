import type { MindmapDiagram, MindmapNode, PositionedMindmapDiagram, PositionedMindmapEdge, PositionedMindmapNode } from './types.ts'
import { mindmapHorizontalBoundaryX } from './geometry.ts'
import { measureMultilineText } from '../text-metrics.ts'
import { wrapLabelToWidth } from '../shared/label-wrap.ts'

export interface MindmapLayoutOptions {
  padding?: number
  maxNodeWidth?: number
  nodeGap?: number
  layerGap?: number
  /** Mermaid's force-directed default is represented by a deterministic bilateral tree. */
  layout?: 'radial' | 'tidy-tree'
}

const FONT_SIZE = 13
const FONT_WEIGHT = 500

export function layoutMindmap(diagram: MindmapDiagram, options: MindmapLayoutOptions = {}): PositionedMindmapDiagram {
  const padding = finite(options.padding, 32)
  const maxNodeWidth = finite(options.maxNodeWidth, 180)
  const nodeGap = finite(options.nodeGap, 40)
  const layerGap = finite(options.layerGap, 20)
  const entries = measureNodes(diagram.root, maxNodeWidth)

  return options.layout === 'tidy-tree'
    ? layoutTidy(diagram, entries, padding, nodeGap, layerGap)
    : layoutBilateral(diagram, entries, padding, nodeGap, layerGap)
}

function measureNodes(root: MindmapNode, maxNodeWidth: number): Map<string, PositionedMindmapNode> {
  const entries = new Map<string, PositionedMindmapNode>()
  const measure = (node: MindmapNode, depth: number, parentId?: string): void => {
    const label = wrapLabelToWidth(node.label, maxNodeWidth, FONT_SIZE, FONT_WEIGHT)
    const metrics = measureMultilineText(label, FONT_SIZE, FONT_WEIGHT)
    let width = Math.max(56, metrics.width + 24)
    let height = Math.max(34, metrics.height + 18 + (node.icon ? 14 : 0))
    if (node.shape === 'circle') width = height = Math.max(width, height, 54)
    if (node.shape === 'bang' || node.shape === 'cloud') { width += 18; height += 10 }
    entries.set(node.id, {
      id: node.id, label, shape: node.shape, markdown: node.markdown, icon: node.icon, className: node.className,
      ...(parentId ? { parentId } : {}), depth, side: depth === 0 ? 'root' : 'right', x: 0, y: 0, width, height,
    })
    for (const child of node.children) measure(child, depth + 1, node.id)
  }
  measure(root, 0)
  return entries
}

function layoutTidy(
  diagram: MindmapDiagram,
  entries: Map<string, PositionedMindmapNode>,
  padding: number,
  nodeGap: number,
  layerGap: number,
): PositionedMindmapDiagram {
  const maxWidthAtDepth = widthsByDepth(entries)
  const xAtDepth = new Map<number, number>([[0, padding]])
  const maxDepth = Math.max(...Array.from(entries.values(), node => node.depth))
  for (let depth = 1; depth <= maxDepth; depth++) {
    xAtDepth.set(depth, xAtDepth.get(depth - 1)! + (maxWidthAtDepth.get(depth - 1) ?? 0) + layerGap)
  }
  let cursorY = padding
  const assignY = (node: MindmapNode): number => {
    const positioned = entries.get(node.id)!
    positioned.side = positioned.depth === 0 ? 'root' : 'right'
    positioned.x = xAtDepth.get(positioned.depth)!
    if (node.children.length === 0) {
      positioned.y = cursorY
      cursorY += positioned.height + nodeGap
      return positioned.y + positioned.height / 2
    }
    const childCenters = node.children.map(assignY)
    const center = (childCenters[0]! + childCenters.at(-1)!) / 2
    positioned.y = Math.max(padding, center - positioned.height / 2)
    return positioned.y + positioned.height / 2
  }
  assignY(diagram.root)
  normalizeY(entries, padding)
  return finish(diagram, entries, padding)
}

/**
 * Deterministic central layout. First-level subtrees are greedily balanced by
 * measured leaf-span, then each side is a tidy tree growing away from the root.
 * The side is assigned once at the root boundary and inherited, making an
 * impossible state (a subtree crossing through the root) unrepresentable.
 */
function layoutBilateral(
  diagram: MindmapDiagram,
  entries: Map<string, PositionedMindmapNode>,
  padding: number,
  nodeGap: number,
  layerGap: number,
): PositionedMindmapDiagram {
  const root = entries.get(diagram.root.id)!

  const subtreeSpan = (node: MindmapNode): number => {
    const own = entries.get(node.id)!.height
    if (node.children.length === 0) return own
    return Math.max(own, node.children.reduce((sum, child) => sum + subtreeSpan(child), 0) + nodeGap * (node.children.length - 1))
  }
  const left: MindmapNode[] = []
  const right: MindmapNode[] = []
  let leftWeight = 0
  let rightWeight = 0
  diagram.root.children.forEach((child, index) => {
    const weight = subtreeSpan(child) + nodeGap
    // Seed opposite sides, then greedily balance. Source order within each side
    // remains unchanged, so geometry is deterministic and serializer-stable.
    const chooseLeft = index === 1 || (index > 1 && leftWeight < rightWeight)
    if (chooseLeft) { left.push(child); leftWeight += weight } else { right.push(child); rightWeight += weight }
  })

  const assignSide = (node: MindmapNode, side: 'left' | 'right'): void => {
    entries.get(node.id)!.side = side
    node.children.forEach(child => assignSide(child, side))
  }
  left.forEach(node => assignSide(node, 'left'))
  right.forEach(node => assignSide(node, 'right'))

  // The former global width-per-depth table charged both sides for the widest
  // label on either side and then added a full 80px at every layer. A single
  // long right-hand label therefore created empty columns on the left and a
  // very wide, very short diagram. Size each side independently and right-align
  // left nodes / left-align right nodes within compact columns.
  const widthsFor = (side: 'left' | 'right'): Map<number, number> => {
    const widths = new Map<number, number>()
    for (const node of entries.values()) {
      if (node.side !== side) continue
      widths.set(node.depth, Math.max(widths.get(node.depth) ?? 0, node.width))
    }
    return widths
  }
  const leftWidths = widthsFor('left')
  const rightWidths = widthsFor('right')
  const sideExtent = (widths: Map<number, number>): number =>
    [...widths.values()].reduce((sum, width) => sum + width + layerGap, 0)
  root.x = padding + sideExtent(leftWidths)

  const xByDepth = (side: 'left' | 'right', widths: Map<number, number>): Map<number, number> => {
    const result = new Map<number, number>()
    let cursor = side === 'left' ? root.x : root.x + root.width
    const maxDepth = Math.max(0, ...widths.keys())
    for (let depth = 1; depth <= maxDepth; depth++) {
      const width = widths.get(depth) ?? 0
      if (side === 'left') {
        cursor -= layerGap + width
        result.set(depth, cursor)
      } else {
        cursor += layerGap
        result.set(depth, cursor)
        cursor += width
      }
    }
    return result
  }
  const leftX = xByDepth('left', leftWidths)
  const rightX = xByDepth('right', rightWidths)

  const placeSide = (roots: MindmapNode[], side: 'left' | 'right'): { min: number; max: number } => {
    let cursor = padding
    const widths = side === 'left' ? leftWidths : rightWidths
    const positions = side === 'left' ? leftX : rightX
    const place = (node: MindmapNode): number => {
      const positioned = entries.get(node.id)!
      const columnX = positions.get(positioned.depth)!
      positioned.x = side === 'left'
        ? columnX + (widths.get(positioned.depth)! - positioned.width)
        : columnX
      if (node.children.length === 0) {
        positioned.y = cursor
        cursor += positioned.height + nodeGap
        return positioned.y + positioned.height / 2
      }
      const centers = node.children.map(place)
      const center = (centers[0]! + centers.at(-1)!) / 2
      positioned.y = center - positioned.height / 2
      return center
    }
    roots.forEach(place)
    return { min: padding, max: Math.max(padding, cursor - nodeGap) }
  }

  const leftBounds = placeSide(left, 'left')
  const rightBounds = placeSide(right, 'right')
  const contentHeight = Math.max(root.height, leftBounds.max - leftBounds.min, rightBounds.max - rightBounds.min)
  root.y = padding + Math.max(0, (contentHeight - root.height) / 2)
  const alignSide = (roots: MindmapNode[], bounds: { min: number; max: number }): void => {
    if (roots.length === 0) return
    const sideHeight = bounds.max - bounds.min
    const delta = padding + (contentHeight - sideHeight) / 2 - bounds.min
    const shift = (node: MindmapNode): void => {
      entries.get(node.id)!.y += delta
      node.children.forEach(shift)
    }
    roots.forEach(shift)
  }
  alignSide(left, leftBounds)
  alignSide(right, rightBounds)
  normalizeY(entries, padding)
  return finish(diagram, entries, padding)
}

function widthsByDepth(entries: Map<string, PositionedMindmapNode>): Map<number, number> {
  const widths = new Map<number, number>()
  for (const node of entries.values()) widths.set(node.depth, Math.max(widths.get(node.depth) ?? 0, node.width))
  return widths
}

function normalizeY(entries: Map<string, PositionedMindmapNode>, padding: number): void {
  const minY = Math.min(...Array.from(entries.values(), node => node.y))
  if (minY < padding) for (const node of entries.values()) node.y += padding - minY
}

function finish(
  diagram: MindmapDiagram,
  entries: Map<string, PositionedMindmapNode>,
  padding: number,
): PositionedMindmapDiagram {
  const edges: PositionedMindmapEdge[] = Array.from(entries.values()).flatMap(node => {
    if (!node.parentId) return []
    const parent = entries.get(node.parentId)!
    const leftward = node.side === 'left'
    const start = {
      x: mindmapHorizontalBoundaryX(parent, leftward ? 'left' : 'right'),
      y: parent.y + parent.height / 2,
    }
    const end = {
      x: mindmapHorizontalBoundaryX(node, leftward ? 'right' : 'left'),
      y: node.y + node.height / 2,
    }
    // Keep cubic controls ordered between their endpoints. The old 24px
    // minimum (and 0.52 ratio) crossed controls on short parent/child gaps,
    // producing a visible hook immediately before otherwise straight branches.
    const bend = Math.abs(end.x - start.x) * 0.42
    const c1 = { x: start.x + (leftward ? -bend : bend), y: start.y }
    const c2 = { x: end.x + (leftward ? bend : -bend), y: end.y }
    return [{
      from: parent.id, to: node.id, points: [start, c1, c2, end],
      d: `M ${round(start.x)} ${round(start.y)} C ${round(c1.x)} ${round(c1.y)} ${round(c2.x)} ${round(c2.y)} ${round(end.x)} ${round(end.y)}`,
    }]
  })
  const minX = Math.min(...Array.from(entries.values(), node => node.x))
  if (minX < padding) {
    const delta = padding - minX
    for (const node of entries.values()) node.x += delta
    for (const edge of edges) {
      edge.points.forEach(point => { point.x += delta })
      const [start, c1, c2, end] = edge.points
      edge.d = `M ${round(start!.x)} ${round(start!.y)} C ${round(c1!.x)} ${round(c1!.y)} ${round(c2!.x)} ${round(c2!.y)} ${round(end!.x)} ${round(end!.y)}`
    }
  }
  const width = Math.max(...Array.from(entries.values(), node => node.x + node.width)) + padding
  const height = Math.max(...Array.from(entries.values(), node => node.y + node.height)) + padding
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

function round(value: number): number { return Math.round(value * 1000) / 1000 }
