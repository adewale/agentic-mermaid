import type { AsciiContext } from '../agent/families.ts'
import { checkAllGraphAuthoredStyles } from '../shared/style-props.ts'
import { parseSwimlaneRenderSource } from '../swimlane/parser.ts'
import { convertToAsciiGraph } from './converter.ts'
import { drawNode } from './draw.ts'
import { terminalArtifact, type TerminalArtifact } from './terminal-artifact.ts'
import { TerminalDocument, type TerminalOwner } from './terminal-document.ts'
import { paintTerminalFrame } from './terminal-geometry.ts'
import { prepareCellText } from './prepared-text.ts'
import { allocateBoxRoutes, paintBoxRoute, paintBoxText, type TerminalBox } from './class-like-layout.ts'
import { swimlanePartitions } from '../swimlane/model.ts'
import type { MermaidSubgraph } from '../types.ts'
import { AsciiWidthError } from './width-error.ts'
import { frontmatterTitle } from '../mermaid-source.ts'

interface Item extends TerminalBox {
  children: Item[]
  lines: readonly string[]
  parent?: string
}

/** The terminal graph compositor retains authored lane identities, nested
 * memberships and shape-specific cards. Lane packing owns cell geometry;
 * the existing box router owns physical cross-lane connector ports. */
export function renderSwimlaneTerminal(context: AsciiContext): TerminalArtifact {
  const parsed = parseSwimlaneRenderSource(context.source.authoredFamilyBody ?? context.source.familyBody, context.source.familyBody)
  checkAllGraphAuthoredStyles(parsed)
  const config = { ...context.config, graphDirection: parsed.direction === 'LR' || parsed.direction === 'RL' ? 'LR' as const : 'TD' as const,
    reverseDirection: parsed.direction === 'RL' }
  const graph = convertToAsciiGraph(parsed, config)
  const horizontal = parsed.direction === 'LR' || parsed.direction === 'RL'
  const reversed = parsed.direction === 'RL' || parsed.direction === 'BT'
  const degree = new Map<string, number>()
  for (const edge of parsed.edges) for (const id of [edge.source, edge.target]) degree.set(id, (degree.get(id) ?? 0) + 1)
  const asciiNodes = new Map(graph.nodes.map(node => [node.name, node]))
  const maxWidth = context.options.targetWidth ?? context.options.maxWidth ?? context.config.maxWidth
  const text = (value: string) => prepareCellText(value, { display: 'formatted', ...(maxWidth ? { maxWidth: Math.max(1, maxWidth - 10) } : {}) })
  const leaf = (id: string, parent: string): Item | undefined => {
    const node = asciiNodes.get(id)
    if (!node) return undefined
    const block = text(node.displayLabel), capacity = (degree.get(id) ?? 0) * 3 + 2
    node.displayLabel = block.lines.join('\n')
    return { id, parent, x: 0, y: 0, width: Math.max(6, block.width + 4, capacity), height: Math.max(block.lines.length + 2, capacity), lines: block.lines, children: [] }
  }
  const container = (id: string, label: string, children: Item[], parent?: string): Item => {
    const block = text(label), headerHeight = block.lines.length + 2
    const main = children.reduce((sum, child) => sum + (horizontal ? child.width : child.height) + 10, 0)
    const cross = Math.max(2, ...children.map(child => horizontal ? child.height : child.width))
    const width = Math.max(block.width + 10, horizontal ? main + 2 : cross + 10, (degree.get(id) ?? 0) * 3 + 2)
    const height = Math.max(horizontal ? cross + headerHeight + 10 : main + headerHeight + 2, (degree.get(id) ?? 0) * 3 + 2)
    let cursor = horizontal ? 5 : headerHeight + 5
    for (const child of reversed ? [...children].reverse() : children) {
      child.x = horizontal ? cursor : Math.floor((width - child.width) / 2)
      child.y = horizontal ? headerHeight + 5 : cursor
      cursor += (horizontal ? child.width : child.height) + 10
    }
    return { id, parent, x: 0, y: 0, width, height, container: true, headerHeight, children, lines: block.lines }
  }
  const group = (source: MermaidSubgraph, parent: string): Item => container(source.id, source.label,
    [...source.nodeIds.flatMap(id => { const node = leaf(id, source.id); return node ? [node] : [] }), ...source.children.map(child => group(child, source.id))], parent)
  const lanes = swimlanePartitions(parsed).map(lane => container(lane.id, lane.label,
    [...(lane.source?.nodeIds ?? [...lane.nodes]).flatMap(id => { const node = leaf(id, lane.id); return node ? [node] : [] }), ...(lane.source?.children ?? []).map(child => group(child, lane.id))]))
  const extent = Math.max(8, ...lanes.map(lane => horizontal ? lane.width : lane.height))
  let cursor = 4
  const boxes: Item[] = []
  const position = (item: Item, dx: number, dy: number): void => {
    item.x += dx; item.y += dy; boxes.push(item)
    item.children.forEach(child => position(child, item.x, item.y))
  }
  for (const lane of lanes) {
    if (horizontal) lane.width = extent
    else lane.height = extent
    position(lane, horizontal ? 4 : cursor, horizontal ? cursor : 4)
    cursor += (horizontal ? lane.height : lane.width) + 4
  }
  const document = new TerminalDocument()
  for (const box of boxes.filter(box => box.container)) {
    const owner: TerminalOwner = { id: box.id, kind: 'subgraph', ...(box.parent ? { parent: { id: box.parent, kind: 'subgraph' } } : {}), members: box.children.map(child => child.id) }
    paintTerminalFrame(document, box, owner, config.useAscii)
    document.textBlock(box.x + 2, box.y + 1, box.lines, { owner, role: 'text' })
  }
  const relations = parsed.edges.map((edge, index) => ({ id: edge.id ?? `${edge.source}->${edge.target}#${index}`, from: edge.source, to: edge.target,
    ...(edge.label ? { lines: text(edge.label).lines } : {}) }))
  const routes = allocateBoxRoutes(boxes, relations, parsed.direction)
  for (const [index, route] of routes.entries()) {
    const edge = parsed.edges[index]!
    if (edge.style === 'invisible') continue
    const owner: TerminalOwner = { id: route.relation.id, kind: 'edge', from: edge.source, to: edge.target, route: 'connected' }
    paintBoxRoute(document, route, owner, config.useAscii, edge.style === 'dotted')
    for (const end of ['start', 'end'] as const) {
      const enabled = end === 'start' ? edge.hasArrowStart : edge.hasArrowEnd
      const port = end === 'start' ? route.source : route.target
      const shape = (end === 'start' ? edge.startMarker : edge.endMarker) ?? 'arrow'
      const marker = { shape: shape === 'arrow' ? 'open-arrow' as const : shape,
        direction: ({ T: 'B', B: 'T', L: 'R', R: 'L' } as const)[port.side], ascii: config.useAscii }
      document.expectMarkers(owner, end, enabled ? [marker] : [])
      if (enabled) document.marker(port.x, port.y, marker, { owner, role: 'arrow' })
    }
    paintBoxText(document, route.label, owner)
  }
  for (const box of boxes.filter(box => !box.container)) {
    const node = asciiNodes.get(box.id)!
    node.gridCoord = { x: 0, y: 0 }
    graph.columnWidth = new Map([[0, 1], [1, box.width - 2]])
    graph.rowHeight = new Map([[0, 1], [1, box.height - 2]])
    const drawing = drawNode(node, graph)
    document.region({ id: box.id, kind: 'node', parent: { id: box.parent!, kind: 'subgraph' } }, box)
    document.overlay(drawing, box.x, box.y)
  }
  if (maxWidth && document.width > maxWidth) throw new AsciiWidthError(maxWidth, document.width, 'swimlane', 'MINIMUM_GEOMETRY')
  const title = frontmatterTitle(context.source.frontmatter)
  if (title) {
    const output = new TerminalDocument(), lines = text(title).lines
    output.textBlock(0, 0, lines, { owner: { id: 'title', kind: 'label' }, role: 'text' })
    output.overlay(document, 0, lines.length + 1)
    return terminalArtifact(output, { colorMode: context.colorMode, theme: context.theme })
  }
  return terminalArtifact(document, { colorMode: context.colorMode, theme: context.theme })
}
