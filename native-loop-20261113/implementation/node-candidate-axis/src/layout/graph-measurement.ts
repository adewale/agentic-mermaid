import type { MermaidSubgraph, PositionedGraph, PositionedGroup } from '../types.ts'
import type { ResolvedRenderStyle } from '../styles.ts'
import { graphTextBlock } from '../graph-text.ts'
import { resolveLabelContent } from '../shared/display-text.ts'
import { preparePixelText } from '../shared/prepared-text.ts'
import { iconFallbackToken } from '../shared/icon-fallback.ts'
import { resolveMindmapIcon } from '../mindmap/icons.ts'
import { flowchartImageViewport, flowchartImageContent } from '../flowchart-image.ts'

/** The width a titled group needs so its header title stays inside the frame.
 * A group with nothing in it is laid out without one: it has no frame to hold
 * the title, which is drawn from where the group sits. An explicit family
 * minimum additionally reserves that empty group's actual title footprint. */
export function groupTitleWidth(sg: Pick<MermaidSubgraph, 'label' | 'labelContent' | 'concurrencyRegion' | 'titleOffset' | 'nodeIds' | 'children' | 'headerMinHeight'>, style: ResolvedRenderStyle): number {
  if (!sg.label || sg.concurrencyRegion || (sg.headerMinHeight === undefined && sg.nodeIds.length === 0 && sg.children.length === 0)) return 0
  const width = graphTextBlock(resolveLabelContent(sg.label, sg.labelContent), style, 'group').width
  return Math.ceil((sg.titleOffset ?? style.groupLabelPaddingX) + width + style.groupLabelPaddingX)
}

/** One measured strip is shared by both placement producers and retention. */
export function groupHeaderHeight(
  group: Pick<MermaidSubgraph, 'label' | 'labelContent' | 'concurrencyRegion' | 'headerMinHeight'>,
  style: ResolvedRenderStyle,
  block = graphTextBlock(resolveLabelContent(group.label, group.labelContent), style, 'group'),
): number {
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
    const image = flowchartImageViewport(node)
    if (image) node.imageCaptionOffset = flowchartImageContent(image, node.labelBlock, style).captionOffset
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

