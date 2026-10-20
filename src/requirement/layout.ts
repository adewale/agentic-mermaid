import type { ElkExtendedEdge, ElkNode } from 'elkjs'
import { elkLayoutSync } from '../elk-instance.ts'
import { emitGraphLayoutDecision, selectElkForGraphFamily } from '../layout/backend.ts'
import { resolveRoleStyle } from '../scene/roles.ts'
import type { InternalStyleFace } from '../scene/style-registry.ts'
import { assertRequirementDiagramWork } from '../shared/diagram-limits.ts'
import { preparePixelText } from '../shared/prepared-text.ts'
import { layoutTextRows } from '../shared/text-rows.ts'
import { checkedAuthoredStyle, parseStyleProps } from '../shared/style-props.ts'
import { diagramTitleBand, positionDiagramTitle, resolveRenderStyle } from '../styles.ts'
import type { RenderOptions } from '../types.ts'
import type { PositionedRequirementDiagram, RequirementBody, RequirementCard } from './types.ts'

export function layoutRequirementDiagram(model: RequirementBody, options: RenderOptions = {}, face?: Readonly<InternalStyleFace>, config: Record<string, unknown> = {}): PositionedRequirementDiagram {
  assertRequirementDiagramWork(model)
  if (options.graphLayout) emitGraphLayoutDecision(selectElkForGraphFamily(options, 'requirement'))
  const relationship = resolveRoleStyle(face, 'relationship', {}, { includeFallback: false }),
    style = resolveRenderStyle(options, undefined, relationship ? { ...face, edge: { ...face?.edge, ...relationship } } : face),
    pad = options.padding ?? 32
  const maxWidth = typeof config.maxWidth === 'number' && config.maxWidth > 0 ? config.maxWidth : 320
  const metric = (key: string, fallback: number, minimum = 0, maximum = 2000): number => (typeof config[key] === 'number' && Number.isFinite(config[key]) && config[key] >= minimum ? Math.min(config[key] as number, maximum) : fallback)
  const inset = metric('rect_padding', 16),
    insetX = config.rect_padding === undefined ? (face?.node?.paddingX ?? inset) : inset,
    insetY = config.rect_padding === undefined ? (face?.node?.paddingY ?? inset) : inset,
    minWidth = metric('rect_min_width', 140, 1),
    minHeight = metric('rect_min_height', 0),
    rowStride = metric('line_height', 0)
  const configuredStyle: Record<string, string> = {}
  for (const [key, property] of [
    ['rect_fill', 'fill'],
    ['text_color', 'color'],
    ['rect_border_color', 'stroke'],
    ['rect_border_size', 'stroke-width'],
  ])
    if (typeof config[key!] === 'string' || (key === 'rect_border_size' && typeof config[key!] === 'number' && Number.isFinite(config[key!]))) configuredStyle[property!] = String(config[key!])
  checkedAuthoredStyle(configuredStyle, 'requirement config')
  const nodes: RequirementCard[] = [...model.requirements.map(requirement => ({ requirement, element: undefined })), ...model.elements.map(element => ({ requirement: undefined, element }))].map(({ requirement, element }) => {
    const record = requirement ?? element!,
      props = checkedAuthoredStyle({ ...configuredStyle, ...parseStyleProps(record.cssStyles.join(',')) }, `style ${record.name}`)
    const fontSize = Number.parseFloat(props['font-size'] ?? '') || metric('fontSize', style.nodeLabelFontSize, 1)
    const authoredWeight = props['font-weight']?.trim().toLowerCase(),
      fontWeight = authoredWeight === undefined ? undefined : authoredWeight === 'normal' ? 400 : authoredWeight === 'bold' ? 700 : Number(authoredWeight)
    if (fontWeight !== undefined && (!Number.isFinite(fontWeight) || fontWeight < 1 || fontWeight > 1000)) throw new Error(`style ${record.name}: font-weight must be normal, bold, or a number from 1 to 1000`)
    const header = preparePixelText(`<<${requirement?.type ?? 'Element'}>>\n${record.name}`, { fontSize, fontWeight: fontWeight ?? style.nodeLabelFontWeight, maxWidth, transform: style.nodeTextTransform, letterSpacing: style.nodeLetterSpacing, fontFamily: options.font })
    const fields = requirement
      ? [
          ['ID', requirement.requirementId],
          ['Text', requirement.text],
          ['Risk', requirement.risk],
          ['Verification', requirement.verifyMethod],
        ]
      : [
          ['Type', element!.type],
          ['Doc Ref', element!.docRef],
        ]
    const headerHeight = header.height + Math.max(12, insetY * 1.5)
    const measured = layoutTextRows(fields
      .filter(([, value]) => value)
      .map(([key, value]) => {
        const block = preparePixelText(`${key}: ${value}`, { fontSize, fontWeight: fontWeight ?? 400, maxWidth, transform: style.nodeTextTransform, letterSpacing: style.nodeLetterSpacing, fontFamily: options.font })
        return { label: key!, block }
      }), { top: headerHeight + 8, gap: 9, minRowHeight: rowStride, align: 'start', trailingGap: true })
    const rows = measured.rows.map(({ item, textY }) => ({ ...item, y: textY }))
    const height = Math.max(minHeight, measured.bottom + 8),
      width = Math.max(minWidth, header.width + insetX * 2, measured.width + insetX * 2)
    return { id: record.name, requirement, element, x: 0, y: 0, width, height, header, rows, paddingX: insetX, headerHeight, style: props }
  })
  const byId = new Map(nodes.map(n => [n.id, n])),
    idMap = new Map(nodes.map((n, i) => [n.id, `n${i}`]))
  const labels = model.relations.map(e => preparePixelText(`<<${e.type}>>`, { fontSize: style.edgeLabelFontSize, fontWeight: style.edgeLabelFontWeight, transform: style.edgeTextTransform, letterSpacing: style.edgeLetterSpacing }))
  const elkEdges: ElkExtendedEdge[] = model.relations.map((edge, i) => {
    if (!byId.has(edge.src) || !byId.has(edge.dst)) throw new Error(`Requirement relation ${edge.id} references an undeclared endpoint`)
    return { id: `e${i}`, sources: [idMap.get(edge.src)!], targets: [idMap.get(edge.dst)!], labels: [{ text: labels[i]!.text, width: labels[i]!.width + 16, height: labels[i]!.height + 10 }] }
  })
  const graph: ElkNode = {
    id: 'requirement-layout',
    layoutOptions: {
      'elk.algorithm': 'layered',
      'elk.direction': ({ TB: 'DOWN', BT: 'UP', LR: 'RIGHT', RL: 'LEFT' } as const)[model.direction],
      'elk.edgeRouting': 'ORTHOGONAL',
      'elk.spacing.nodeNode': String(options.nodeSpacing ?? metric('nodeSpacing', 40, 0, Infinity)),
      'elk.layered.spacing.nodeNodeBetweenLayers': String(options.layerSpacing ?? metric('rankSpacing', 72, 0, Infinity)),
      'elk.padding': `[top=${pad},left=${pad},bottom=${pad},right=${pad}]`,
    },
    children: nodes.map(n => ({ id: idMap.get(n.id)!, width: n.width, height: n.height })),
    edges: elkEdges,
  }
  const result = nodes.length ? elkLayoutSync(graph) : { ...graph, width: pad * 2, height: pad * 2 }
  const band = diagramTitleBand(model.title, style),
    titleHeight = band?.height ?? 0
  const width = Math.max(result.width ?? 0, (band?.width ?? 0) + pad * 2, pad * 2),
    height = (result.height ?? pad * 2) + titleHeight
  for (const child of result.children ?? []) {
    const node = nodes[Number(child.id.slice(1))]!
    node.x = (child.x ?? 0) + (width - (result.width ?? width)) / 2
    node.y = (child.y ?? 0) + titleHeight
  }
  const edges = model.relations.map((edge, i) => {
    const output = result.edges?.[i],
      sections = output?.sections ?? []
    const points = sections.flatMap(s => [s.startPoint, ...(s.bendPoints ?? []), s.endPoint]).map(p => ({ x: p.x + (width - (result.width ?? width)) / 2, y: p.y + titleHeight }))
    if (points.length < 2) throw new Error(`No route for requirement relation ${edge.id}`)
    const label = labels[i]!,
      placed = output?.labels?.[0],
      midpoint = points[Math.floor(points.length / 2)]!
    const labelPosition = placed?.x !== undefined ? { x: placed.x + (placed.width ?? 0) / 2 + (width - (result.width ?? width)) / 2, y: (placed.y ?? 0) + (placed.height ?? 0) / 2 + titleHeight } : midpoint
    return { ...edge, points, label, labelPosition }
  })
  return { model, width, height, nodes, edges, style, ...(band ? { title: positionDiagramTitle(band, width, pad) } : {}) }
}
