import { requirementArrow, requirementArrowPortSpan, requirementContains, requirementContainsPortSpan, requirementMarkerTerminal } from './markers.ts'
import { elkMeasuredAdapter } from '../layout/elk-measured-adapter.ts'
import { nativeMeasuredAdapter } from '../layout/native-measured-adapter.ts'
import { solveMeasuredLayout } from '../layout/measured-backend.ts'
import type { MeasuredGraph, MeasuredRoutes } from '../layout/measured-graph.ts'
import { fitMeasuredLayout } from '../layout/fit-measured-layout.ts'
import { runMeasuredGraphBackend } from '../layout/backend.ts'
import { measureRenderStage } from '../render-stages.ts'
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
  const indices = new Map(nodes.map((node, index) => [node.id, index]))
  const labels = model.relations.map(e => preparePixelText(`<<${e.type}>>`, { fontSize: style.edgeLabelFontSize, fontWeight: style.edgeLabelFontWeight, transform: style.edgeTextTransform, letterSpacing: style.edgeLetterSpacing }))
  for (const edge of model.relations) {
    if (!indices.has(edge.src) || !indices.has(edge.dst)) throw new Error(`Requirement relation ${edge.id} references an undeclared endpoint`)
  }
  const nodeSpacing = options.nodeSpacing ?? metric('nodeSpacing', 40, 0, Infinity),
    layerSpacing = options.layerSpacing ?? metric('rankSpacing', 72, 0, Infinity)
  const terminalLead = model.relations.some(edge => edge.type !== 'contains') ? requirementMarkerTerminal(requirementArrow.id, style.lineWidth, 'end') + style.edgeBendRadius : 0
  const elkTerminalLead = Math.max(terminalLead, model.relations.some(edge => edge.type === 'contains') ? requirementMarkerTerminal(requirementContains.id, style.lineWidth, 'start') + style.edgeBendRadius : 0)
  const measuredEdges = model.relations.map((edge, index) => ({ source: indices.get(edge.src)!, target: indices.get(edge.dst)!, minSpan: 1,
    label: { width: labels[index]!.width + 16, height: labels[index]!.height + 10 } }))
  const incidences = new Uint32Array(nodes.length), containsSources = new Uint8Array(nodes.length)
  for (const edge of model.relations) {
    const source = indices.get(edge.src)!, target = indices.get(edge.dst)!
    incidences[source] = incidences[source]! + 1; incidences[target] = incidences[target]! + 1
    if (edge.type === 'contains') containsSources[source] = 1
  }
  const horizontal = model.direction === 'LR' || model.direction === 'RL'
  const capacityNodes = nodes.map((node, index) => {
    if (!containsSources[index] || incidences[index]! < 2) return { id: node.id, width: node.width, height: node.height }
    // Feedback can put all incidences on one face. This is measured card
    // capacity, shared by solvers; no attempt mutates the emitted card.
    const minimum = (incidences[index]! - 1) * requirementContainsPortSpan + 16
    return { id: node.id, width: horizontal ? node.width : Math.max(node.width, minimum), height: horizontal ? Math.max(node.height, minimum) : node.height, minimumPortSpacing: requirementContainsPortSpan }
  })
  const strokes = nodes.map(node => {
    const authored = node.style['stroke-width']?.trim()
    return authored === undefined ? style.nodeLineWidth : /^(?:\d+(?:\.\d*)?|\.\d+)(?:px)?$/.test(authored) ? Number.parseFloat(authored) : NaN
  })
  // CSS-dependent paint and rounded shafts retain their existing family paths.
  // Canonical measured requests carry the same physical demands to all solvers.
  const physical: MeasuredGraph | undefined = style.lineWidth > 0 && strokes.every(stroke => Number.isFinite(stroke) && stroke > 0) ? {
    nodes: capacityNodes.map((node, index) => ({ ...node, contact: style.cornerRadius ? 'rounded-rectangle' as const : 'rectangle' as const,
      sizePolicy: 'minimum', paintCornerRadius: style.cornerRadius ?? 0, paintStrokeWidth: strokes[index]! })),
    edges: measuredEdges.map((edge, index) => ({ ...edge,
      sourcePortSpan: model.relations[index]!.type === 'contains' ? Math.max(style.lineWidth, requirementContainsPortSpan) : style.lineWidth,
      targetPortSpan: model.relations[index]!.type === 'contains' ? style.lineWidth : Math.max(style.lineWidth, requirementArrowPortSpan) })),
    direction: model.direction, padding: pad, nodeSpacing, layerSpacing, edgeSpacing: Math.max(6, style.lineWidth + 4),
    minimumTerminalLead: elkTerminalLead, maximumEdgeStrokeWidth: style.lineWidth, maximumEdgeBendRadius: style.edgeBendRadius,
  } : undefined
  const measured = style.edgeBendRadius === 0 ? physical : undefined
  const result = runMeasuredGraphBackend<MeasuredRoutes>(options, () => {
    return measureRenderStage('agentic', () => {
      const demand = measured ?? {
        nodes: capacityNodes, edges: measuredEdges,
        direction: model.direction, padding: pad, nodeSpacing, layerSpacing, ...(terminalLead ? { minimumTerminalLead: terminalLead } : {}), edgeSpacing: Math.max(6, style.lineWidth + 4),
      }
      const placed = fitMeasuredLayout(demand, solveMeasuredLayout({ role: 'routed', graph: demand }, nativeMeasuredAdapter))
      for (const [index, at] of placed.nodes.entries()) {
        at.width ??= demand.nodes[index]!.width
        at.height ??= demand.nodes[index]!.height
      }
      return placed
    })
  }, () => {
    // Zero clearance lets ELK put the first routing track on the card border.
    // Contains owns a source marker, so it needs its painted terminal lead too.
    return solveMeasuredLayout({ role: 'routed', graph: measured ?? {
      nodes: nodes.map(node => ({ id: node.id, width: node.width, height: node.height })),
      edges: measuredEdges,
      direction: model.direction, padding: pad, nodeSpacing, layerSpacing,
    } }, elkMeasuredAdapter({ rootId: 'requirement-layout', edgeNodeSpacing: elkTerminalLead, labelText: labels.map(label => label.text) }))
  }, false, undefined)
  const band = diagramTitleBand(model.title, style),
    titleHeight = band?.height ?? 0
  const width = Math.max(result.width ?? 0, (band?.width ?? 0) + pad * 2, pad * 2),
    height = (result.height ?? pad * 2) + titleHeight
  for (const [index, position] of result.nodes.entries()) {
    const node = nodes[index]!
    // Only selected geometry publishes body growth. Declined attempts cannot
    // leak resized cards into fallback or later emission.
    node.width = position.width ?? node.width
    node.height = position.height ?? node.height
    node.x = position.x + (width - result.width) / 2
    node.y = position.y + titleHeight
  }
  const edges = model.relations.map((edge, i) => {
    const output = result.edges[i]
    const points = (output?.points ?? []).map(p => ({ x: p.x + (width - result.width) / 2, y: p.y + titleHeight }))
    if (points.length < 2) throw new Error(`No route for requirement relation ${edge.id}`)
    const label = labels[i]!,
      placed = output?.labelPosition,
      midpoint = points[Math.floor(points.length / 2)]!
    const labelPosition = placed ? { x: placed.x + (width - result.width) / 2, y: placed.y + titleHeight } : midpoint
    return { ...edge, points, label, labelPosition }
  })
  return { model, width, height, nodes, edges, style, ...(band ? { title: positionDiagramTitle(band, width, pad) } : {}) }
}
