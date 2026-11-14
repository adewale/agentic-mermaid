import { VISIBLE_SHAFT, labelHaloExtension } from '../shared/edge-label-geometry.ts'
import type { ChannelWork } from './channel-tracks.ts'
import type { Direction, MermaidGraph, MermaidSubgraph, PositionedGraph, PositionedNode, PositionedEdge, PositionedGroup } from '../types.ts'
import type { ResolvedRenderStyle } from '../styles.ts'
import type { AgenticGraphBindings, AgenticGraphOptions } from '../layout-engine.ts'
import type { MeasuredGraph, MeasuredRoutes } from './measured-graph.ts'
import type { MarkerPaint } from './compound-marker-seating.ts'
import { fitMeasuredLayout } from './fit-measured-layout.ts'
import { LayoutWorkLimitError } from './backend.ts'
import { paintedStrokeExtent } from '../scene/bounds.ts'
import { shapeOutline } from '../shape-outline.ts'
import { flowchartImageViewport } from '../flowchart-image.ts'

interface ProjectionCompletion { mergeEdges: boolean; sharedEdges?: readonly number[] }
const markerResourceOperands = ['hasArrowStart', 'hasArrowEnd', 'style', 'curve'] as const

/** One owner for measured glyph/CSS demand and authored graph projection.
 * Existing Native completion stays explicit; owned routes need no legacy repair. */
export function prepareMeasuredGraphCandidate(
  graph: MermaidGraph, options: AgenticGraphOptions, style: ResolvedRenderStyle,
  bindings: AgenticGraphBindings,
  purpose: 'legacy-routed' | 'legacy-placement' | 'native-routed' | 'owned-routed' | 'owned-placement' = 'legacy-routed',
) {
  const ownedPlacement = purpose === 'owned-placement'
  const placementOnly = purpose === 'legacy-placement' || ownedPlacement
  const physical = purpose === 'owned-routed'
  // Authored curves keep their existing knot/terminal projection. The early
  // physical capacity request describes only translated orthogonal routes.
  const nativeCapacity = purpose === 'native-routed' && graph.edges.every(edge => edge.curve === undefined)
  let diamondContacts = false
  const { edgeSelectorIndices, graphEdgeMarkerPaintRegions, DEFAULTS, LABEL_PILL_PADDING, measureRenderStage, graphTextBlock, resolveLabelContent, groupTitleWidth, groupHeaderHeight, estimateNodeSize, resolveNodeInlineStyle, resolveEdgeInlineStyle, resolveClassInlineStyle, containsNonFiniteNumber, finishGraphGeometry } = bindings
  if (options.preserveSubgraphChildOrder) bindings.unsupported('family-specific graph geometry')
  if (physical) {
    if (graph.stateNotes?.length || graph.floatingStateNotes?.length) bindings.unsupported('note geometry is outside the measured slice')
    if (graph.nodes.size > 64 || graph.edges.length > 128) bindings.unsupported('routed slice is limited to 64 subjects and 128 edges')
    for (const node of graph.nodes.values()) {
      if (node.shape === 'diamond') diamondContacts = true
      const pseudo = node.shape === 'state-start' || node.shape === 'state-end'
      if (node.semanticShape && !(node.semanticShape === 'image' && flowchartImageViewport(node)) || node.shape !== 'rectangle' && node.shape !== 'rounded' && node.shape !== 'diamond' && node.shape !== 'circle' && !pseudo) bindings.unsupported('only measured rectangular, rounded, diamond and fixed circle contacts are supported')
      if (node.shape === 'circle' && graph.subgraphs.length) bindings.unsupported('ordinary circle contacts require a flat measured graph')
      if (pseudo && (node.label || node.labelContent || node.labelBlock?.text || node.icon || node.image)) bindings.unsupported('labelled and media pseudostates are outside the fixed circle slice')
    }
    if (graph.edges.some(edge => edge.curve !== undefined)) bindings.unsupported('authored curve paint is outside the orthogonal measured slice')
    if (style.lineWidth <= 0) bindings.unsupported('zero-width shafts are outside the flat measured slice')
  }
  const opts = { ...DEFAULTS, ...options }
  const groupSources: MermaidSubgraph[] = []
  const routingWork: ChannelWork = { pairs: 1_000_000, arcs: 65536, swaps: 1_000_000 }
  routingWork.arcs -= 2 // ledger record and its private preparation closure
  const pay = (pairs: number, slots = 0): void => {
    routingWork.pairs -= pairs; routingWork.arcs -= slots
    if ((physical || ownedPlacement) && routingWork.pairs < 0) throw new LayoutWorkLimitError('pairs')
    if ((physical || ownedPlacement) && routingWork.arcs < 0) throw new LayoutWorkLimitError('arcs')
    if (routingWork.pairs < 0 || routingWork.arcs < 0) bindings.unsupported('agentic marker preparation work limit')
  }
  const measured = measureRenderStage('graph-preparation', () => {
    const groups: NonNullable<MeasuredGraph['groups']>[number][] = []
    const groupIndices = new Map<string, number>()
    const membership = new Map<string, { parent: number; direction: Direction }>()
    const visit = (source: MermaidSubgraph, parent: number | undefined, inherited: Direction): void => {
      if (physical && graph.nodes.size + groups.length >= 64) bindings.unsupported('routed slice is limited to 64 subjects and 128 edges')
      const index = groups.length, direction = source.direction ?? inherited
      const header = groupHeaderHeight(source, style)
      const divider = source.concurrencyRegion ? (options.stateVisual?.dividerMargin ?? 0) : 0
      groupIndices.set(source.id, index); groupSources.push(source)
      if (physical && graph.classAssignments.has(source.id)) bindings.unsupported('styled compound frames require measured paint')
      groups.push({ id: source.id, parent, direction, minWidth: groupTitleWidth(source, style), headerHeight: header, padding: {
        top: header + style.groupPaddingY + divider, bottom: style.groupPaddingY + divider,
        left: style.groupPaddingX + divider, right: style.groupPaddingX + divider,
      }, ...(physical ? { paintStrokeWidth: style.groupLineWidth, paintCornerRadius: style.groupCornerRadius } : {}) })
      for (const id of source.nodeIds) membership.set(id, { parent: index, direction })
      source.children.forEach(child => visit(child, index, direction))
    }
    graph.subgraphs.forEach(group => visit(group, undefined, graph.direction))
    if (physical && graph.nodes.size + groups.length > 64) bindings.unsupported('routed slice is limited to 64 subjects and 128 edges')
    const measurePortFaces = !placementOnly && (physical || nativeCapacity || !groups.length && !options.stateVisual)
    if (measurePortFaces) pay(0, graph.nodes.size + 1)
    const portFaces = measurePortFaces ? new Uint8Array(graph.nodes.size) : undefined
    const nodes: MeasuredGraph['nodes'][number][] = [...graph.nodes].map(([id, node], index) => {
      if (portFaces) portFaces[index] = Number((!node.semanticShape || !!flowchartImageViewport(node)) && (node.shape === 'rectangle' || node.shape === 'subroutine' || nativeCapacity && node.shape === 'rounded' || physical && (node.shape === 'rounded' || node.shape === 'state-start' || node.shape === 'state-end')))
      if (groupIndices.has(id)) bindings.unsupported('overlapping node and frame identities')
      const owner = membership.get(id)
      return { id, ...(owner ? { parent: owner.parent } : {}), ...(options.nodeSizes?.get(id) ?? estimateNodeSize(id, resolveLabelContent(node.label, node.labelContent), node.shape, style, owner?.direction ?? graph.direction, options.stateVisual, node.labelBlock, node)) }
    })
    const indices = new Map(nodes.map((node, index) => [node.id, index]))
    for (const [id, index] of groupIndices) indices.set(id, nodes.length + index)
    const rankedParents = new Set<number>()
    for (const [id, partition] of Object.entries(options.layoutHints?.ranks ?? {})) {
      const index = indices.get(id)
      if (index === undefined || !graph.nodes.has(id)) throw new Error(`LAYOUT_HINT_INVALID: unknown node "${id}"`)
      if (!Number.isSafeInteger(partition) || partition < 0 || partition > 10000) throw new Error(`LAYOUT_HINT_INVALID: rank for "${id}" must be an integer in [0,10000]`)
      const node = nodes[index]!
      node.partition = partition
      rankedParents.add(node.parent ?? -1)
    }
    for (const node of nodes) if (rankedParents.has(node.parent ?? -1) && node.partition === undefined) node.partition = 0
    for (const group of groups) if (rankedParents.has(group.parent ?? -1)) group.partition = 0
    if (options.layoutHints?.adjacent?.length) {
      const siblings = new Map<number, number[]>()
      const subjects = [...nodes, ...groups]
      subjects.forEach((subject, index) => {
        const parent = subject.parent ?? -1, children = siblings.get(parent) ?? []
        children.push(index); siblings.set(parent, children)
      })
      const positions = new Map<number, number>()
      for (const children of siblings.values()) children.forEach((subject, position) => positions.set(subject, position))
      const grouped = new Set<number>(), blocks = new Map<number, Map<number, number[]>>()
      for (const ids of options.layoutHints.adjacent) {
        if (ids.length < 2) throw new Error('LAYOUT_HINT_INVALID: adjacent needs two or more nodes')
        const members = ids.map(id => {
          const index = indices.get(id)
          if (index === undefined || !graph.nodes.has(id)) throw new Error(`LAYOUT_HINT_INVALID: unknown node "${id}"`)
          return index
        })
        const parent = nodes[members[0]!]!.parent ?? -1
        if (members.some(index => (nodes[index]!.parent ?? -1) !== parent)) throw new Error('LAYOUT_HINT_INVALID: adjacent nodes need the same container')
        for (const index of members) {
          if (grouped.has(index)) throw new Error('LAYOUT_HINT_INVALID: a node cannot repeat in adjacency groups')
          grouped.add(index)
        }
        const local = blocks.get(parent) ?? new Map<number, number[]>()
        local.set(Math.min(...members.map(index => positions.get(index)!)), members)
        blocks.set(parent, local)
      }
      for (const [parent, local] of blocks) {
        let order = 0
        siblings.get(parent)!.forEach((index, position) => {
          const block = local.get(position)
          if (block) for (const member of block) subjects[member]!.modelOrder = order++
          else if (!grouped.has(index)) subjects[index]!.modelOrder = order++
        })
      }
    }
    let preferred: Set<number> | undefined
    if (options.layoutHints?.shortEdges?.length) {
      preferred = new Set<number>()
      const selectors = edgeSelectorIndices(graph.edges)
      for (const id of options.layoutHints.shortEdges) {
        const index = selectors.get(id)
        if (index === undefined) throw new Error(`LAYOUT_HINT_INVALID: unknown edge "${id}"`)
        preferred.add(index)
      }
    }
    if (ownedPlacement) {
      const edges: MeasuredGraph['edges'] = graph.edges.map(edge => {
        pay(6, 3)
        const source = indices.get(edge.source), target = indices.get(edge.target)
        if (source === undefined || target === undefined) throw new TypeError('Measured placement endpoint is undeclared')
        if (edge.label || edge.labelContent || edge.style === 'invisible' || edge.length !== undefined && edge.length !== 1 || edge.curve !== undefined || preferred?.size) bindings.unsupported('labelled or constrained placement edges are outside the forest slice')
        return { source, target, minSpan: 1 }
      })
      return { nodes, groups, edges, direction: graph.direction, padding: opts.padding, nodeSpacing: opts.nodeSpacing, layerSpacing: opts.layerSpacing }
    }
    const ancestorEnd = groups.length ? (source: number, target: number): 'start' | 'end' | undefined => {
      const encloses = (group: number, subject: number): boolean => {
        for (let parent = subject < nodes.length ? nodes[subject]!.parent : groups[subject - nodes.length]!.parent; parent !== undefined; parent = groups[parent]!.parent) {
          if (parent === group) return true
        }
        return false
      }
      if (source >= nodes.length && encloses(source - nodes.length, target)) return 'start'
      if (target >= nodes.length && encloses(target - nodes.length, source)) return 'end'
      return undefined
    } : undefined
    // The ordinary arrow resource bounds are complete conservative support.
    // Unknown shapes, authored frame terminals and custom CSS keep their
    // existing producer; they do not acquire partial physical proof metadata.
    let nativeMarkerTemplates = nativeCapacity && groups.length > 0 && !options.stateVisual && style.edgeBendRadius === 0
      && !graph.nodeStyles.size && !graph.linkStyles.size && !graph.classAssignments.size
    if (nativeMarkerTemplates) {
      // Reflect only the operands used by the new admission. Accessors retain
      // the legacy path and its original evaluation count/order.
      pay(0, 7) // The local descriptor helper and the two iteration records.
      const ownDescriptor = (subject: object, field: string): PropertyDescriptor | undefined => {
        pay(8)
        const own = Object.hasOwn(subject, field)
        // An absent property creates no descriptor. A native descriptor owns
        // four fields plus its record; reserve it before the reflective call.
        if (own) pay(0, 5)
        return own ? Object.getOwnPropertyDescriptor(subject, field) : undefined
      }
      for (const node of graph.nodes.values()) {
        const shape = ownDescriptor(node, 'shape'), semantic = ownDescriptor(node, 'semanticShape')
        if (!shape || !('value' in shape) || shape.value !== 'rectangle'
          || (semantic ? !('value' in semantic) || semantic.value !== undefined : 'semanticShape' in node)) { nativeMarkerTemplates = false; break }
      }
      if (nativeMarkerTemplates) for (const edge of graph.edges) {
        const source = ownDescriptor(edge, 'source'), target = ownDescriptor(edge, 'target')
        const start = ownDescriptor(edge, 'startMarker'), end = ownDescriptor(edge, 'endMarker')
        if (!source || !('value' in source) || !target || !('value' in target)
          || !graph.nodes.has(source.value) || !graph.nodes.has(target.value)
          || (start ? !('value' in start) || start.value !== undefined && start.value !== 'arrow' : 'startMarker' in edge)
          || (end ? !('value' in end) || end.value !== undefined && end.value !== 'arrow' : 'endMarker' in edge)) { nativeMarkerTemplates = false; break }
        for (let operand = 0; operand < markerResourceOperands.length; operand++) {
          const field = markerResourceOperands[operand]!, descriptor = ownDescriptor(edge, field)
          if (descriptor ? !('value' in descriptor) : field in edge) { nativeMarkerTemplates = false; break }
        }
        if (!nativeMarkerTemplates) break
      }
    }
    let lead = 0, doubleDepth = 0, maximumStroke = 0, knownClearance = true
    pay(0, 4 * nodes.length + 5)
    const portSpans = new Float64Array(2 * nodes.length), incoming = new Uint32Array(nodes.length), outgoing = new Uint32Array(nodes.length)
    type MarkerRoom = { start: number; end: number; startSpan: number; endSpan: number; span: number; boundaryInset: number; boundaryHeight: number; boundaryCount: number; startPresent?: boolean; endPresent?: boolean; markerPaint?: MarkerPaint }
    const footprints = new Map<string, MarkerRoom>()
    const numericWidth = (value: string | number): number | undefined => {
      pay(4 + (typeof value === 'string' ? value.length : 0), 1)
      if (typeof value === 'string' && !/^\s*(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?(?:px)?\s*$/i.test(value)) return undefined
      const width = typeof value === 'number' ? value : Number.parseFloat(value)
      return Number.isFinite(width) && width > 0 ? width : undefined
    }
    const edges = graph.edges.map((edge, index) => {
      const source = indices.get(edge.source), target = indices.get(edge.target)
      if (source === undefined || target === undefined) bindings.unsupported('unknown endpoint')
      const block = edge.label ? graphTextBlock(resolveLabelContent(edge.label, edge.labelContent), style, 'edge') : undefined
      const boundaryEnd = ancestorEnd?.(source, target)
      let boundaryMarker: { inset: number; height: number } | undefined
      const inline = resolveEdgeInlineStyle(index, graph)
      const marked = !placementOnly && edge.style !== 'invisible' && (edge.hasArrowStart || edge.hasArrowEnd)
      const shaft = numericWidth(inline?.['stroke-width'] ?? style.lineWidth * (edge.style === 'thick' ? 2 : 1))
      if (edge.style !== 'invisible' && shaft === undefined) knownClearance = false
      if (edge.style !== 'invisible' && shaft !== undefined) maximumStroke = Math.max(maximumStroke, shaft)
      let footprint: MarkerRoom | undefined
      if ((marked || boundaryEnd) && shaft !== undefined) {
        // The existing ancestor projection is retained verbatim; ordinary
        // reservations use the same actual resource factory on a cardinal ray.
        pay(12, 15)
        const emptyStroke = (inline?.stroke ?? style.edgeStrokeColor) === 'none'
        const fixed = Boolean(inline?.['stroke-width'])
        // Paint-only colors cannot enlarge geometry. Reserve the opaque
        // builtin support for every tint; none retains its earlier support.
        const key = JSON.stringify([boundaryEnd ?? null, edge.style, edge.hasArrowStart, edge.hasArrowEnd, edge.startMarker, edge.endMarker, emptyStroke, fixed])
        footprint = footprints.get(key)
        if (!footprint) {
          // No tint set: at most12 builtin/fixed descriptors (resource pool
          // <400 field/reference slots), connector/region/JSON scratch <624.
          pay(emptyStroke ? 4096 : 2048, emptyStroke ? 2048 : 1024)
          const points = boundaryEnd === 'end' ? [{ x: 1, y: 0 }, { x: 0, y: 0 }] : [{ x: 0, y: 0 }, { x: 1, y: 0 }]
          const markers = graphEdgeMarkerPaintRegions({ ...edge, id: 'marker-room', source: '', target: '', points,
            inlineStyle: fixed ? { 'stroke-width': '1' } : undefined },
          { lineWidth: style.lineWidth, ...(emptyStroke ? { edgeStrokeColor: 'none' } : {}) })
          let start = 0, end = 0, startSpan = 0, endSpan = 0, span = 0, boundaryInset = 0, boundaryHeight = 0, boundaryCount = 0
          let startPresent = false, endPresent = false
          for (const marker of markers) {
            pay(18)
            if (diamondContacts) { pay(2); if (marker.position === 'start') startPresent = true; if (marker.position === 'end') endPresent = true }
            const box = marker.bounds
            if (!box || !Number.isFinite(box.x0) || !Number.isFinite(box.x1) || !Number.isFinite(box.y0) || !Number.isFinite(box.y1) || box.x0 > box.x1 || box.y0 > box.y1) bindings.unsupported('agentic marker paint bounds')
            const depth = marker.position === 'start' ? (boundaryEnd === 'end' ? 1 - box.x0 : box.x1) : (boundaryEnd === 'end' ? box.x1 : 1 - box.x0)
            if (marker.position === 'start') { start = Math.max(start, depth); startSpan = Math.max(startSpan, 2 * Math.max(Math.abs(box.y0), Math.abs(box.y1))) }
            else if (marker.position === 'end') { end = Math.max(end, depth); endSpan = Math.max(endSpan, 2 * Math.max(Math.abs(box.y0), Math.abs(box.y1))) }
            span = Math.max(span, box.y1 - box.y0)
            if (marker.position === boundaryEnd) {
              boundaryCount++
              boundaryInset = Math.max(boundaryInset, box.x1)
              boundaryHeight = Math.max(boundaryHeight, 2 * Math.max(Math.abs(box.y0), Math.abs(box.y1)))
            }
          }
          pay(diamondContacts ? 2 : 0, diamondContacts ? 13 : 9)
          footprint = { start, end, startSpan, endSpan, span, boundaryInset, boundaryHeight, boundaryCount, ...(diamondContacts ? { startPresent, endPresent } : undefined) }
          if (nativeMarkerTemplates) {
            pay(8 * markers.length, 18 * markers.length + 1)
            const markerPaint: MarkerPaint = {}
            for (const marker of markers) {
              if (marker.position !== 'start' && marker.position !== 'end' || !marker.bounds) continue
              const box = marker.bounds, anchor = marker.anchor, sourceEnd = marker.position === 'start'
              const x0 = sourceEnd ? box.x0 - anchor.x : anchor.x - box.x1
              const x1 = sourceEnd ? box.x1 - anchor.x : anchor.x - box.x0
              const y0 = sourceEnd ? box.y0 - anchor.y : anchor.y - box.y1
              const y1 = sourceEnd ? box.y1 - anchor.y : anchor.y - box.y0
              markerPaint[marker.position] = [{ kind: 'polygon', points: [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }] }]
            }
            footprint.markerPaint = markerPaint
          }
          footprints.set(key, footprint)
        }
        const { start: startDepth, end: endDepth, span } = footprint
        if (marked) {
          pay(4) // Retain source and target marker demand independently.
          lead = Math.max(lead, startDepth + VISIBLE_SHAFT + style.edgeBendRadius, endDepth + VISIBLE_SHAFT + style.edgeBendRadius, span)
          doubleDepth = Math.max(doubleDepth, startDepth + endDepth)
          if (edge.hasArrowStart && source < nodes.length) portSpans[2 * source] = Math.max(portSpans[2 * source]!, span)
          if (edge.hasArrowEnd && target < nodes.length) portSpans[2 * target + 1] = Math.max(portSpans[2 * target + 1]!, span)
        }
      }
      if (edge.style !== 'invisible') {
        pay(2)
        if (source < nodes.length) outgoing[source] = outgoing[source]! + 1
        if (target < nodes.length) incoming[target] = incoming[target]! + 1
      }
      if (boundaryEnd) {
        const boundaryMarked = edge.style !== 'invisible' && (boundaryEnd === 'start' ? edge.hasArrowStart : edge.hasArrowEnd)
        if (boundaryMarked && (!footprint || !footprint.boundaryCount)) bindings.unsupported('ancestor marker paint bounds')
        boundaryMarker = { inset: boundaryMarked ? footprint!.boundaryInset : 0, height: boundaryMarked ? footprint!.boundaryHeight : 0 }
      }
      // Owned demand includes the complete opaque body from the drawing owner.
      // Keep legacy Native's existing ordinary/ancestor sizing unchanged.
      const halo = block ? physical ? labelHaloExtension(edge, style.lineWidth)
        : boundaryEnd ? Math.max(4, style.lineWidth * (edge.style === 'thick' ? 2 : 1) * 2) : 0 : 0
      pay(0, 2)
      if (diamondContacts) pay(2) // Bounds checks before leaf-only marker metadata.
      const endpointSpans = shaft !== undefined && (source !== target || physical) ? {
        ...(physical || portFaces?.[source] ? { sourcePortSpan: Math.max(shaft, footprint?.startSpan ?? 0) } : {}),
        ...(physical || portFaces?.[target] ? { targetPortSpan: Math.max(shaft, footprint?.endSpan ?? 0) } : {}),
      } : {}
      if (nativeMarkerTemplates) pay(0, 3)
      return { source, target, ...(nativeMarkerTemplates ? {
        sourceTerminalLead: footprint?.start ? footprint.start + VISIBLE_SHAFT + style.edgeBendRadius : 0,
        targetTerminalLead: footprint?.end ? footprint.end + VISIBLE_SHAFT + style.edgeBendRadius : 0,
        ...(footprint?.markerPaint ? { markerPaint: footprint.markerPaint } : {}),
      } : {}), ...(diamondContacts && source < nodes.length && graph.nodes.get(nodes[source]!.id)?.shape === 'diamond' ? { sourceMarkerPresent: footprint ? footprint.startPresent : false } : {}), ...(diamondContacts && target < nodes.length && graph.nodes.get(nodes[target]!.id)?.shape === 'diamond' ? { targetMarkerPresent: footprint ? footprint.endPresent : false } : {}), ...endpointSpans, minSpan: edge.length ?? 1, ...(preferred?.has(index) ? { short: true as const } : {}), ...(boundaryMarker ? { boundaryMarker } : {}), ...(edge.style === 'invisible' ? { visible: false } : {}), ...(block ? { label: { width: block.width + 2 * LABEL_PILL_PADDING + 2 * halo, height: block.height + 2 * LABEL_PILL_PADDING + 2 * halo } } : {}) }
    })
    const shareCompleteFans = !options.stateVisual && !groups.length && [...graph.nodes.values()].every(node => node.shape === 'rectangle' && !node.semanticShape)
      && graph.edges.every((edge, index) => {
        if (edge.label || edge.style !== 'solid' || edge.hasArrowStart || !edge.hasArrowEnd || (edge.endMarker && edge.endMarker !== 'arrow')) return false
        const inline = resolveEdgeInlineStyle(index, graph)
        return !inline || Object.keys(inline).length === 0
      })
    let border = Math.max(style.nodeLineWidth, style.groupLineWidth) / 2
    for (const [id] of graph.nodes) {
      const inline = resolveNodeInlineStyle(id, graph)
      const width = numericWidth(inline?.['stroke-width'] ?? style.nodeLineWidth)
      pay(3)
      if (width !== undefined) border = Math.max(border, width / 2)
      else knownClearance = false
      // Native retains its broad producer and caps. Adopt the same physical
      // planner only for measured canonical bodies; compatible confluent fans
      // and thin weighted faces keep their established packing contract.
      if (nativeCapacity) pay(8)
      const nativeFace = nativeCapacity && !options.stateVisual && !graph.nodes.get(id)!.semanticShape
        && (graph.nodes.get(id)!.shape === 'rectangle' || graph.nodes.get(id)!.shape === 'rounded')
        && Math.max(portSpans[2 * indices.get(id)!]!, portSpans[2 * indices.get(id)! + 1]!) > 8
      if ((physical || nativeFace) && width !== undefined) {
        pay(8, 4)
        const node = nodes[indices.get(id)!]!, authored = graph.nodes.get(id)!
        if (authored.shape === 'diamond') {
          pay(96, 64)
          const outline = shapeOutline({ ...authored, ...node, x: 0, y: 0 }, { fill: inline?.fill ?? style.nodeFillColor ?? 'var(--_node-fill)', stroke: inline?.stroke ?? style.nodeBorderColor ?? 'var(--_node-stroke)', strokeWidth: inline?.['stroke-width'] ?? String(style.nodeLineWidth) }, style.cornerRadius)
          pay(3 + (outline.paint.strokeWidth?.length ?? 0) + (outline.paint.stroke?.length ?? 0))
          const extent = paintedStrokeExtent(outline.paint, true)
          if (outline.routing.kind !== 'polygon' || outline.routing.points.length !== 4 || extent === undefined || !Number.isFinite(extent) || extent < 0) bindings.unsupported('diamond needs measured polygon stroke support')
          node.contact = 'diamond'; node.contactDiamond = { strokeExtent: extent }; node.paintStrokeWidth = extent === 0 ? 0 : width; node.paintCornerRadius = 0
          node.sizePolicy = options.nodeSizes?.has(id) ? 'fixed' : 'minimum'
          continue
        }
        if (authored.shape === 'circle' || authored.shape === 'state-start' || authored.shape === 'state-end') {
          pay(32, 32)
          const outline = shapeOutline({ ...authored, ...node, x: 0, y: 0 }, { fill: authored.shape === 'circle' ? inline?.fill ?? 'var(--_node-fill)' : 'var(--_node-fill)', stroke: authored.shape === 'circle' ? inline?.stroke ?? 'var(--_node-stroke)' : 'var(--_node-stroke)', strokeWidth: String(width) }, style.cornerRadius)
          const boundary = outline.routing
          if (boundary.kind !== 'ellipse' || boundary.cx !== node.width / 2 || boundary.cy !== node.height / 2) bindings.unsupported('circle needs a centered ellipse boundary')
          const stroke = Math.max(...(outline.childPaints ?? [outline.paint]).map(paint => paint.stroke === 'none' ? 0 : numericWidth(paint.strokeWidth ?? width) ?? NaN))
          if (!Number.isFinite(stroke)) bindings.unsupported('circle paint needs an absolute stroke measurement')
          node.contact = 'ellipse'
          node.contactEllipse = { rx: boundary.rx, ry: boundary.ry }
          node.paintStrokeWidth = stroke
          node.sizePolicy = 'fixed'
          continue
        }
        const radius = style.cornerRadius ?? (authored.shape === 'rounded' ? 6 : 0)
        node.paintStrokeWidth = width
        node.paintCornerRadius = radius
        node.contact = radius ? 'rounded-rectangle' : 'rectangle'
        node.sizePolicy = options.nodeSizes?.has(id) ? 'fixed' : 'minimum'
      }
    }
    for (const source of groupSources) if (source.stateComposite) {
      const width = numericWidth(resolveClassInlineStyle(source.id, graph)?.['stroke-width'] ?? style.groupLineWidth)
      if (width !== undefined) border = Math.max(border, width / 2)
      else knownClearance = false
    }
    const margin = border + maximumStroke / 2
    if (physical && !knownClearance) bindings.unsupported('paint needs an absolute positive pixel stroke measurement')
    const edgeSpacing = Math.max(6, style.lineWidth + 4)
    if (nativeMarkerTemplates) {
      pay(12 * edges.length + 3 * nodes.length + 3 * groups.length)
      // Caller size overrides own dimensions, not physical paint authority.
      for (const node of nodes) { node.paintStrokeWidth = style.nodeLineWidth; node.paintCornerRadius = style.cornerRadius ?? 0 }
      for (const group of groups) { group.paintStrokeWidth = style.groupLineWidth; group.paintCornerRadius = style.groupCornerRadius }
      for (const edge of edges) {
        if (edge.sourceTerminalLead) edge.sourceTerminalLead += margin
        if (edge.targetTerminalLead) edge.targetTerminalLead += margin
        if (edge.visible === false || nodes[edge.source]!.parent === nodes[edge.target]!.parent) continue
        for (let role = 0; role < 2; role++) {
          const endpoint = role === 0 ? edge.source : edge.target, parent = nodes[endpoint]!.parent
          if (parent === undefined) continue
          const group = groups[parent]!, direction = group.direction ?? graph.direction
          const side = direction === 'LR' ? role === 0 ? 'right' : 'left'
            : direction === 'RL' ? role === 0 ? 'left' : 'right'
              : direction === 'BT' ? role === 0 ? 'top' : 'bottom'
                : role === 0 ? 'bottom' : 'top'
          const demand = Math.max(8, (role === 0 ? edge.sourceTerminalLead : edge.targetTerminalLead) ?? 0)
          // North alone includes the physical title and the exact existing
          // header obstacle halo. Equality with its boundary remains clear.
          const header = side === 'top' ? (group.headerHeight ?? 0) + Math.max(2, edgeSpacing / 2) : 0
          group.padding[side] = Math.max(group.padding[side], header + demand)
        }
      }
    }
    if (portFaces && knownClearance) pay(0, 1)
    const minimumTerminalLead = lead + margin > Math.max(12, edgeSpacing) ? lead + margin : undefined
    for (let index = 0; !physical && index < nodes.length; index++) {
      pay(12)
      const node = nodes[index]!, authored = graph.nodes.get(node.id)!, degree = Math.max(incoming[index]!, outgoing[index]!)
      const sourceSpan = portSpans[2 * index]!, targetSpan = portSpans[2 * index + 1]!, span = Math.max(sourceSpan, targetSpan)
      const pitch = span + maximumStroke
      if (node.contact || degree < 2 || span <= 0 || authored.shape !== 'rectangle' || authored.semanticShape || options.nodeSizes?.has(node.id)) continue
      const horizontal = (membership.get(node.id)?.direction ?? graph.direction) === 'LR' || (membership.get(node.id)?.direction ?? graph.direction) === 'RL'
      // Ordinary heads need authored-end capacity before routing. Incoming
      // markers must not borrow the degree of unrelated outgoing shafts.
      // Preserve shared fans, roomy rectangles and fixed body dimensions.
      let required = 0
      if (span <= 8) {
        pay(20)
        if (shareCompleteFans) continue
        required = Math.max(sourceSpan > 0 ? (outgoing[index]! + 1) * (sourceSpan + maximumStroke) : 0, targetSpan > 0 ? (incoming[index]! + 1) * (targetSpan + maximumStroke) : 0)
        if ((horizontal ? node.height : node.width) >= required) continue
      }
      const size = (degree - 1) * pitch, minimum = span <= 8 ? required : size <= 32 ? size * 1.5 : size + 16
      if (!Number.isFinite(minimum)) bindings.unsupported('agentic marker spacing range')
      if (horizontal) node.height = Math.max(node.height, minimum)
      else node.width = Math.max(node.width, minimum)
      // Thin faces already carry per-edge paint spans for weighted packing.
      if (span > 8) node.minimumPortSpacing = pitch
    }
    if (!Number.isFinite(doubleDepth + margin) || !Number.isFinite(minimumTerminalLead ?? 0) || !Number.isFinite(2 * (doubleDepth + margin))) bindings.unsupported('agentic marker spacing range')
    return { nodes, groups, edges, shareCompleteFans: physical ? false : shareCompleteFans, direction: graph.direction, padding: opts.padding, nodeSpacing: opts.nodeSpacing,
      layerSpacing: Math.max(opts.layerSpacing, 2 * (doubleDepth + margin)), edgeSpacing,
      ...(physical ? { minimumTerminalLead: lead + margin, maximumEdgeStrokeWidth: maximumStroke || style.lineWidth, maximumEdgeBendRadius: style.edgeBendRadius, nodeClearance: 0 }
        : { ...(nativeMarkerTemplates && knownClearance ? { maximumEdgeStrokeWidth: maximumStroke || style.lineWidth, maximumEdgeBendRadius: style.edgeBendRadius } : {}), ...(minimumTerminalLead !== undefined ? { minimumTerminalLead } : {}), ...(portFaces && knownClearance ? { nodeClearance: margin } : {}) }),
    }

  })
  pay(0, 2)
  return { measured, routingWork, project(initial: MeasuredRoutes, completion?: ProjectionCompletion): PositionedGraph {
    let geometry = initial
  // Missing subjects or non-finite geometry are engine defects, not an
  // eligibility refusal that can be concealed by running another producer.
  if (geometry.nodes.length !== measured.nodes.length || (geometry.groups?.length ?? 0) !== measured.groups.length || !placementOnly && geometry.edges.length !== graph.edges.length || containsNonFiniteNumber(geometry)
    || completion?.sharedEdges?.some(index => !Number.isInteger(index) || index < 0 || index >= graph.edges.length)
    || !placementOnly && geometry.edges.some((edge, index) => edge.points.length < 2 || (measured.edges[index]!.label && !edge.labelPosition))) {
    throw new TypeError('Agentic graph producer returned malformed geometry')
  }
  if (completion && !placementOnly) geometry = fitMeasuredLayout(measured, geometry)
  const nodes = measured.nodes.map((node, index): PositionedNode => {
    const authored = graph.nodes.get(node.id)!
    const assigned = graph.classAssignments.get(node.id)
    return { ...authored, id: node.id, width: node.width, height: node.height, ...geometry.nodes[index]!, inlineStyle: resolveNodeInlineStyle(node.id, graph), classNames: assigned?.split(/\s+/).filter(Boolean) }
  })
  const edges = placementOnly ? [] : graph.edges.map((edge, index): PositionedEdge => ({
    ...edge, ...geometry.edges[index]!, edgeIndex: index, inlineStyle: resolveEdgeInlineStyle(index, graph),
    ...(edge.id && graph.classAssignments.has(edge.id) ? { classNames: graph.classAssignments.get(edge.id)!.split(/\s+/).filter(Boolean) } : {}),
  }))
  const frames = groupSources.map((source, index): PositionedGroup => {
    const frame: PositionedGroup = {
      id: source.id, label: source.label, ...(source.labelContent ? { labelContent: source.labelContent } : {}),
      ...geometry.groups![index]!, children: [], ...(source.concurrencyRegion ? { concurrencyRegion: true as const } : {}),
      ...(source.headerMinHeight === undefined ? {} : { headerMinHeight: source.headerMinHeight }),
      ...(source.stateComposite ? { inlineStyle: resolveClassInlineStyle(source.id, graph) } : {}),
    }
    // Family rendering consumes the measured strip without generic cleanup.
    if (placementOnly || physical) frame.headerHeight = measured.groups[index]!.headerHeight
    return frame
  })
  const groups: PositionedGroup[] = []
  frames.forEach((frame, index) => {
    const parent = measured.groups[index]!.parent
    if (parent === undefined) groups.push(frame)
    else frames[parent]!.children.push(frame)
  })
  // A family placement is deliberately unfinished graph geometry: it has no
  // reusable routes or graph certificate. Architecture owns the final routes,
  // labels, actual ring contacts and independent family/paint certification.
  if (placementOnly) return { width: geometry.width, height: geometry.height, nodes, edges: [], groups }
  if (!completion) return { width: geometry.width, height: geometry.height, nodes, edges, groups }
  // Forest fans use shared trunks. Layered placement reserves private label
  // corridors; generic bundling can move foreign routes into those corridors.
  const positioned = finishGraphGeometry({ width: geometry.width, height: geometry.height, nodes, edges, groups }, graph, completion.mergeEdges, opts.padding, style, options.stateVisual?.noteMargin ?? 18, undefined, completion.sharedEdges, true).positioned
  if (containsNonFiniteNumber(positioned)) throw new TypeError('Agentic graph pipeline returned non-finite geometry')
  return positioned
  } }
}
