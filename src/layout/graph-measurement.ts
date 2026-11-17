import { graphTextBlock } from '../graph-text.ts'
import { resolveMindmapIcon } from '../mindmap/icons.ts'
import { type DisplayTextInput, resolveLabelContent } from '../shared/display-text.ts'
import { iconFallbackToken } from '../shared/icon-fallback.ts'
import { type PixelTextBlock, preparePixelText } from '../shared/prepared-text.ts'
import type { ResolvedStateVisualConfig } from '../state/config.ts'
import type { ResolvedRenderStyle } from '../styles.ts'
import type { Direction, MermaidSubgraph, PositionedGraph, PositionedGroup } from '../types.ts'

// ============================================================================
// Graph node sizing
// ============================================================================

export function estimateNodeSize(id: string, label: DisplayTextInput, shape: string, style: ResolvedRenderStyle, direction: Direction = 'TB', stateVisual?: ResolvedStateVisualConfig, labelBlock?: PixelTextBlock): { width: number; height: number } {
  void id
  const metrics = labelBlock ?? graphTextBlock(label, style, 'node')

  // State pseudostates (plan §State 2): fork/join bars run PERPENDICULAR to
  // the flow (wide+thin in vertical flows, tall+thin in horizontal flows);
  // choice is a small unlabeled diamond; history is a small (H) circle.
  if (shape === 'state-fork' || shape === 'state-join') {
    const horizontalFlow = direction === 'LR' || direction === 'RL'
    const length = stateVisual?.forkWidth ?? 70
    const thickness = stateVisual?.forkHeight ?? 10
    return horizontalFlow ? { width: thickness, height: length } : { width: length, height: thickness }
  }
  if (shape === 'state-choice') {
    return { width: 36, height: 36 }
  }
  if (shape === 'state-history') {
    return { width: 32, height: 32 }
  }

  let width = metrics.width + style.nodePaddingX * 2
  let height = metrics.height + style.nodePaddingY * 2

  if (shape === 'service') {
    width = Math.max(width + 34, 120)
    height = Math.max(height + 6, 48)
  }

  if (shape === 'diamond') {
    const side = Math.max(width, height) + style.diamondExtraPadding
    width = side
    height = side
  }

  if (shape === 'circle' || shape === 'doublecircle') {
    const diameter = Math.ceil(Math.sqrt(width * width + height * height)) + 8
    width = shape === 'doublecircle' ? diameter + 12 : diameter
    height = width
  }

  if (shape === 'ellipse') {
    // Enclose the padded label rectangle inside the curved boundary.
    width = Math.ceil(width * Math.SQRT2)
    height = Math.ceil(height * Math.SQRT2)
  }

  if (shape === 'hexagon') {
    width += style.nodePaddingX
  }

  if (shape === 'trapezoid' || shape === 'trapezoid-alt' || shape === 'lean-r' || shape === 'lean-l') {
    width += style.nodePaddingX
  }

  if (shape === 'asymmetric') {
    width += 12
  }

  if (shape === 'cylinder') {
    height += 14
  }

  if (shape === 'state-start' || shape === 'state-end') {
    return { width: 28, height: 28 }
  }

  width = Math.max(width, 60)
  height = Math.max(height, 36)

  return { width, height }
}

/** The width a titled group needs so its header title stays inside the frame.
 * A group with nothing in it is laid out without one: it has no frame to hold
 * the title, which is drawn from where the group sits. An explicit family
 * minimum additionally reserves that empty group's actual title footprint. */
export function groupTitleWidth(sg: Pick<MermaidSubgraph, 'label' | 'labelContent' | 'concurrencyRegion' | 'titleOffset' | 'nodeIds' | 'children' | 'headerMinHeight'>, style: ResolvedRenderStyle): number {
  if (!sg.label || sg.concurrencyRegion || (sg.headerMinHeight === undefined && sg.nodeIds.length === 0 && sg.children.length === 0)) return 0
  const width = graphTextBlock(resolveLabelContent(sg.label, sg.labelContent), style, 'group').width
  return Math.ceil((sg.titleOffset ?? style.groupLabelPaddingX) + width + style.groupLabelPaddingX)
}

/** One measured strip is shared by ELK preparation and positioned-text retention. */
export function groupHeaderHeight(group: Pick<MermaidSubgraph, 'label' | 'labelContent' | 'concurrencyRegion' | 'headerMinHeight'>, style: ResolvedRenderStyle, block = graphTextBlock(resolveLabelContent(group.label, group.labelContent), style, 'group')): number {
  if (group.concurrencyRegion) return 0
  const measured = style.groupHeaderFontSize + 16 + block.height - block.lineHeight
  if (group.headerMinHeight === undefined) return measured
  if (!Number.isFinite(group.headerMinHeight) || group.headerMinHeight <= 0) throw new RangeError('Invalid internal group header minimum')
  return Math.max(measured, group.headerMinHeight)
}

/** Prepared text survives all subsequent geometry-only passes. */
export function retainGraphText(positioned: Pick<PositionedGraph, 'nodes' | 'edges' | 'groups'>, style: ResolvedRenderStyle): void {
  for (const node of positioned.nodes) {
    node.labelBlock ??= graphTextBlock(resolveLabelContent(node.label, node.labelContent), style, 'node')
    if (node.icon && !node.iconFallbackBlock && !resolveMindmapIcon(node.icon)) node.iconFallbackBlock = preparePixelText(iconFallbackToken(node.icon), { fontSize: 10, fontWeight: 400 })
  }
  for (const edge of positioned.edges) if (edge.label !== undefined) edge.labelBlock ??= graphTextBlock(resolveLabelContent(edge.label, edge.labelContent), style, 'edge')
  const group = (value: PositionedGroup): void => {
    value.labelBlock ??= graphTextBlock(resolveLabelContent(value.label, value.labelContent), style, 'group')
    value.headerHeight = groupHeaderHeight(value, style, value.labelBlock)
    value.children.forEach(group)
  }
  positioned.groups.forEach(group)
}
