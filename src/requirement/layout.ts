import { requirementArrow, requirementArrowPortSpan, requirementContains, requirementContainsPortSpan, requirementMarkerTerminal } from './markers.ts'
import { elkMeasuredAdapter } from '../layout/elk-measured-adapter.ts'
import { nativeMeasuredAdapter } from '../layout/native-measured-adapter.ts'
import { trinityMeasuredAdapter } from '../layout/trinity.ts'
import { solveMeasuredLayout } from '../layout/measured-backend.ts'
import type { MeasuredRoutes } from '../layout/measured-graph.ts'
import { fitMeasuredLayout } from '../layout/fit-measured-layout.ts'
import { GraphLayoutUnsupportedError, runMeasuredGraphBackend } from '../layout/backend.ts'
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
  const result = runMeasuredGraphBackend<MeasuredRoutes>(options, () => {
    return measureRenderStage('agentic', () => {
      const incidences = new Uint32Array(nodes.length), containsSources = new Uint8Array(nodes.length)
      for (const edge of model.relations) {
        const source = indices.get(edge.src)!, target = indices.get(edge.dst)!
        incidences[source] = incidences[source]! + 1
        incidences[target] = incidences[target]! + 1
        if (edge.type === 'contains') containsSources[source] = 1
      }
      const horizontal = model.direction === 'LR' || model.direction === 'RL'
      const measured = {
        nodes: nodes.map((node, index) => {
          if (!containsSources[index] || incidences[index]! < 2) return { id: node.id, width: node.width, height: node.height }
          // Feedback edges can share a face after private cycle reversal.
          // Reserve every incidence plus the allocator's two 8px margins.
          const minimum = (incidences[index]! - 1) * requirementContainsPortSpan + 16
          return { id: node.id, width: horizontal ? node.width : Math.max(node.width, minimum), height: horizontal ? Math.max(node.height, minimum) : node.height, minimumPortSpacing: requirementContainsPortSpan }
        }),
        edges: model.relations.map((edge, index) => ({ source: indices.get(edge.src)!, target: indices.get(edge.dst)!, minSpan: 1,
          label: { width: labels[index]!.width + 16, height: labels[index]!.height + 10 } })),
        direction: model.direction, padding: pad, nodeSpacing, layerSpacing, ...(terminalLead ? { minimumTerminalLead: terminalLead } : {}), edgeSpacing: Math.max(6, style.lineWidth + 4),
      }
      const placed = fitMeasuredLayout(measured, solveMeasuredLayout({ role: 'routed', graph: measured }, nativeMeasuredAdapter))
      // A declined Native attempt must leave the ELK fallback's measured cards
      // untouched. Publish capacity growth only with the successful placement.
      for (const [index, node] of nodes.entries()) {
        node.width = measured.nodes[index]!.width
        node.height = measured.nodes[index]!.height
      }
      return placed
    })
  }, () => {
    // Zero clearance lets ELK put the first routing track on the card border.
    // Contains owns a source marker, so it needs its painted terminal lead too.
    const elkTerminalLead = Math.max(terminalLead, model.relations.some(edge => edge.type === 'contains') ? requirementMarkerTerminal(requirementContains.id, style.lineWidth, 'start') + style.edgeBendRadius : 0)
    return solveMeasuredLayout({ role: 'routed', graph: {
      nodes: nodes.map(node => ({ id: node.id, width: node.width, height: node.height })),
      edges: model.relations.map((edge, index) => ({ source: indices.get(edge.src)!, target: indices.get(edge.dst)!, minSpan: 1,
        label: { width: labels[index]!.width + 16, height: labels[index]!.height + 10 } })),
      direction: model.direction, padding: pad, nodeSpacing, layerSpacing,
    } }, elkMeasuredAdapter({ rootId: 'requirement-layout', edgeNodeSpacing: elkTerminalLead, labelText: labels.map(label => label.text) }))
  }, false, undefined, () => measureRenderStage('trinity', () => {
    if (style.lineWidth <= 0) throw new GraphLayoutUnsupportedError('Requirement zero-width shafts are outside the Trinity slice', 'Trinity')
    const measured = {
      nodes: nodes.map(node => {
        const authoredStroke = node.style['stroke-width']?.trim()
        // Relative/CSS-dependent paint is unknown here; do not manufacture a
        // pixel measurement with parseFloat and let it authorize placement.
        if (authoredStroke !== undefined && !/^(?:\d+(?:\.\d*)?|\.\d+)(?:px)?$/.test(authoredStroke)) throw new GraphLayoutUnsupportedError('Requirement stroke width needs an absolute pixel measurement', 'Trinity')
        const stroke = authoredStroke === undefined ? style.nodeLineWidth : Number.parseFloat(authoredStroke)
        if (!Number.isFinite(stroke) || stroke <= 0) throw new GraphLayoutUnsupportedError('Requirement contacts need a finite positive pixel stroke', 'Trinity')
        return { id: node.id, width: node.width, height: node.height, contact: style.cornerRadius ? 'rounded-rectangle' as const : 'rectangle' as const,
          sizePolicy: 'minimum' as const, paintCornerRadius: style.cornerRadius ?? 0, paintStrokeWidth: stroke, minimumPortSpacing: requirementContainsPortSpan }
      }),
      edges: model.relations.map((edge, index) => ({ source: indices.get(edge.src)!, target: indices.get(edge.dst)!, minSpan: 1,
        sourcePortSpan: edge.type === 'contains' ? Math.max(style.lineWidth, requirementContainsPortSpan) : style.lineWidth,
        targetPortSpan: edge.type === 'contains' ? style.lineWidth : Math.max(style.lineWidth, requirementArrowPortSpan),
        label: { width: labels[index]!.width + 16, height: labels[index]!.height + 10 } })),
      direction: model.direction, padding: pad, nodeSpacing, layerSpacing, edgeSpacing: Math.max(6, style.lineWidth + 4),
      minimumTerminalLead: Math.max(terminalLead, model.relations.some(edge => edge.type === 'contains') ? requirementMarkerTerminal(requirementContains.id, style.lineWidth, 'start') + style.edgeBendRadius : 0),
      maximumEdgeStrokeWidth: style.lineWidth, maximumEdgeBendRadius: style.edgeBendRadius,
    }
    const placed = solveMeasuredLayout({ role: 'routed', graph: measured }, trinityMeasuredAdapter({ pairs: 1_000_000, arcs: 65536, swaps: 1_000_000 }))
    for (const [index, at] of placed.nodes.entries()) {
      nodes[index]!.width = at.width ?? nodes[index]!.width
      nodes[index]!.height = at.height ?? nodes[index]!.height
    }
    return placed
  }))
  const band = diagramTitleBand(model.title, style),
    titleHeight = band?.height ?? 0
  const width = Math.max(result.width ?? 0, (band?.width ?? 0) + pad * 2, pad * 2),
    height = (result.height ?? pad * 2) + titleHeight
  for (const [index, position] of result.nodes.entries()) {
    const node = nodes[index]!
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
