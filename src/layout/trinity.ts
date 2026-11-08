import { assertMarkerPaint } from './compound-marker-seating.ts'
import { GraphLayoutUnsupportedError, LayoutWorkLimitError } from './backend.ts'
import { AGENTIC_MAX_RANKS, AGENTIC_MAX_EXPANDED_VERTICES } from './agentic-limits.ts'
import { assignChannelTracks, type ChannelStep, type ChannelWork } from './channel-tracks.ts'
import type { MeasuredGraph, MeasuredLayoutAdapter, MeasuredLayoutRequest, MeasuredLayoutResult, MeasuredLayoutRole, MeasuredRoutes } from './measured-graph.ts'

const decline = (reason: string): never => { throw new GraphLayoutUnsupportedError(reason, 'Trinity') }
const size = (value: number, positive = false): boolean => Number.isFinite(value) && (positive ? value > 0 : value >= 0)

/** A bounded, uncached flat rectangular kernel. Its caller owns the ledger across
 * attempts. No legacy completion or private Native search flag enters here. */
export function trinityMeasuredAdapter(work: ChannelWork): MeasuredLayoutAdapter<MeasuredLayoutRole> {
  return {
    solve(request: MeasuredLayoutRequest): MeasuredLayoutResult {
      const geometry = solveTrinity(request.graph, work, request.role)
      return request.role === 'placement' ? { kind: 'placed', geometry } : { kind: 'routed', geometry }
    },
  }
}

function solveTrinity(input: MeasuredGraph, work: ChannelWork, role: MeasuredLayoutRole): MeasuredRoutes {
  const n = input.nodes.length, m = input.edges.length
  // This first slice has deliberately local admission, not a larger product cap.
  if (n > 64 || m > 128) decline('flat slice is limited to 64 nodes and 128 edges')
  if (![input.padding, input.nodeSpacing, input.layerSpacing].every(value => size(value))) throw new TypeError('Invalid measured spacing')
  if (!['TD', 'TB', 'BT', 'LR', 'RL'].includes(input.direction)) throw new TypeError('Invalid measured direction')
  for (const key of ['pairs', 'arcs', 'swaps'] as const) { if (!Number.isFinite(work[key])) throw new TypeError('Invalid Trinity work ledger'); if (work[key] < 0) throw new LayoutWorkLimitError(key) }
  const spend = (count = 1): void => { work.pairs -= count; if (work.pairs < 0) throw new LayoutWorkLimitError('pairs') }
  const arc = (): void => { work.arcs -= 2; if (work.arcs < 0) throw new LayoutWorkLimitError('arcs') }
  if (input.groups?.length || input.shareCompleteFans) decline('compound scopes and shared fans are not implemented')
  const horizontal = input.direction === 'LR' || input.direction === 'RL', reverse = input.direction === 'BT' || input.direction === 'RL'
  if (input.edgeSpacing === undefined || input.minimumTerminalLead === undefined || input.maximumEdgeStrokeWidth === undefined) decline('explicit shaft, track spacing and terminal lead measurements are required')
  const spacing = input.edgeSpacing!, lead = input.minimumTerminalLead!
  if (input.nodeClearance !== undefined && !size(input.nodeClearance) || input.maximumEdgeStrokeWidth !== undefined && !size(input.maximumEdgeStrokeWidth, true)) throw new TypeError('Invalid measured paint clearance')
  const clearance = (input.nodeClearance ?? 0) + input.maximumEdgeStrokeWidth! / 2
  if (!size(spacing, true) || !size(lead, true) || !size(clearance) || input.maximumEdgeBendRadius !== undefined && !size(input.maximumEdgeBendRadius)) throw new TypeError('Invalid measured routing demand')
  if (input.maximumEdgeBendRadius) decline('rounded route paint is not implemented')
  const ids = new Set<string>()
  const widths: number[] = [], heights: number[] = []
  for (const node of input.nodes) {
    if (node.paintStrokeWidth === undefined) decline('explicit node stroke measurements are required')
    if (typeof node.id !== 'string' || ids.has(node.id)) throw new TypeError('Measured node identities must be unique strings')
    ids.add(node.id)
    if (!size(node.width, true) || !size(node.height, true)) throw new TypeError('Invalid measured body size')
    if (node.parent !== undefined || node.partition !== undefined || node.modelOrder !== undefined) decline('scope and authored ordering constraints are not implemented')
    if (node.contact !== 'rectangle' && node.contact !== 'rounded-rectangle') decline('explicit rectangular contact geometry is required')
    if (node.contact === 'rounded-rectangle' && node.paintCornerRadius === undefined) decline('rounded contact radius must be measured')
    if (node.contact === 'rectangle' && node.paintCornerRadius) throw new TypeError('Rectangular contact has a rounded paint radius')
    if (node.sizePolicy !== undefined && node.sizePolicy !== 'fixed' && node.sizePolicy !== 'minimum') throw new TypeError('Invalid measured size policy')
    for (const value of [node.paintStrokeWidth, node.minimumPortSpacing]) if (value !== undefined && !size(value, true)) throw new TypeError('Invalid measured contact demand')
    if (node.paintCornerRadius !== undefined && !size(node.paintCornerRadius)) throw new TypeError('Invalid measured contact radius')
    widths.push(horizontal ? node.height : node.width); heights.push(horizontal ? node.width : node.height)
  }
  const sourceSupports = new Float64Array(m), targetSupports = new Float64Array(m)
  const outgoing: number[][] = Array.from({ length: n }, () => []), loops: number[][] = Array.from({ length: n }, () => [])
  for (let e = 0; e < m; e++) {
    const edge = input.edges[e]!
    if (!Number.isInteger(edge.source) || !Number.isInteger(edge.target) || edge.source < 0 || edge.source >= n || edge.target < 0 || edge.target >= n) throw new TypeError('Measured endpoint is outside the node array')
    if (!Number.isSafeInteger(edge.minSpan) || edge.minSpan < 1) throw new TypeError('Invalid measured minimum span')
    if (edge.sourcePortSpan === undefined || edge.targetPortSpan === undefined) decline('explicit endpoint support measurements are required')
    if (edge.source === edge.target && edge.minSpan !== 1) decline('long self-loop span constraints are not implemented')
    for (const value of [edge.sourcePortSpan, edge.targetPortSpan]) if (value !== undefined && !size(value, true)) throw new TypeError('Invalid measured port span')
    // The graph-wide stroke maximum is a conservative envelope, not each
    // edge's own width. Thin-edge support in a mixed-width graph remains valid.
    sourceSupports[e] = Math.max(edge.sourcePortSpan!, input.maximumEdgeStrokeWidth!)
    targetSupports[e] = Math.max(edge.targetPortSpan!, input.maximumEdgeStrokeWidth!)
    if (edge.label && (!size(edge.label.width, true) || !size(edge.label.height, true))) throw new TypeError('Invalid measured label body')
    if (edge.markerPaint !== undefined) assertMarkerPaint(edge.markerPaint)
    if (edge.short !== undefined && edge.short !== true || edge.visible !== undefined && typeof edge.visible !== 'boolean') throw new TypeError('Invalid measured edge preference')
    if (edge.short || edge.boundaryMarker || edge.markerPaint || edge.visible === false) decline('short edges, boundary artwork and invisible constraints are not implemented')
    if (edge.source === edge.target) loops[edge.source]!.push(e)
    else outgoing[edge.source]!.push(e)
  }
  if (!n) { const extent = input.padding * 2; if (!Number.isFinite(extent)) throw new TypeError('Trinity extent overflow'); return { width: extent, height: extent, nodes: [], edges: [] } }

  // Condense cycles before choosing a private order. External inlets are
  // placed late and external outlets early inside an SCC, avoiding an extra
  // rank solely because DFS happened to enter that cycle at an authored node.
  const discovery = new Int32Array(n).fill(-1), low = new Int32Array(n), active = new Uint8Array(n), component = new Uint32Array(n), stack: number[] = [], components: number[][] = []
  let serial = 0
  const visit = (node: number): void => {
    discovery[node] = serial; low[node] = serial++; active[node] = 1; stack.push(node)
    for (const e of outgoing[node]!) {
      spend(); const target = input.edges[e]!.target
      if (discovery[target] === -1) { visit(target); low[node] = Math.min(low[node]!, low[target]!) }
      else if (active[target]) low[node] = Math.min(low[node]!, discovery[target]!)
    }
    if (low[node] === discovery[node]) {
      const members: number[] = []
      let member: number
      do { member = stack.pop()!; active[member] = 0; component[member] = components.length; members.push(member) } while (member !== node)
      components.push(members)
    }
  }
  for (let node = 0; node < n; node++) if (discovery[node] === -1) visit(node)
  const bias = new Int32Array(n), privateOrder = new Uint32Array(n), backward = new Uint8Array(m)
  for (const edge of input.edges) if (component[edge.source] !== component[edge.target]) { bias[edge.source] = bias[edge.source]! + 1; bias[edge.target] = bias[edge.target]! - 1 }
  for (const members of components) {
    members.sort((a, b) => bias[b]! - bias[a]! || a - b)
    members.forEach((node, order) => { privateOrder[node] = order })
  }
  for (let e = 0; e < m; e++) { const edge = input.edges[e]!; if (edge.source !== edge.target && component[edge.source] === component[edge.target] && privateOrder[edge.source]! > privateOrder[edge.target]!) backward[e] = 1 }
  const sources = new Uint32Array(m), targets = new Uint32Array(m), indegree = new Uint32Array(n)
  const forward: number[][] = Array.from({ length: n }, () => []), incoming: number[][] = Array.from({ length: n }, () => [])
  for (let e = 0; e < m; e++) {
    const edge = input.edges[e]!, source = backward[e] ? edge.target : edge.source, target = backward[e] ? edge.source : edge.target
    sources[e] = source; targets[e] = target; if (source === target) continue
    forward[source]!.push(e); incoming[target]!.push(e); indegree[target] = indegree[target]! + 1
  }
  const queue: number[] = []
  for (let node = 0; node < n; node++) if (!indegree[node]) queue.push(node)
  const ranks: number[] = Array(n).fill(0)
  for (let cursor = 0; cursor < queue.length; cursor++) for (const e of forward[queue[cursor]!]!) {
    spend(); const target = targets[e]!, rank = ranks[queue[cursor]!]! + input.edges[e]!.minSpan * 2
    if (rank >= AGENTIC_MAX_RANKS) decline('expanded rank limit')
    ranks[target] = Math.max(ranks[target]!, rank); indegree[target] = indegree[target]! - 1
    if (!indegree[target]) queue.push(target)
  }
  if (queue.length !== n) throw new TypeError('Trinity private cycle orientation is inconsistent')

  // Capacity is a sizing constraint, established before any coordinate exists.
  // A fixed body declines rather than compressing incident ports into contact.
  const pitch = new Float64Array(n), margin = new Float64Array(n), loopPitch = new Float64Array(n), loopStride = new Float64Array(n), loopOrdinal = new Uint32Array(m)
  for (let node = 0; node < n; node++) {
    const body = input.nodes[node]!
    const cornerMargin = (body.paintCornerRadius ?? 0) + body.paintStrokeWidth! / 2
    margin[node] = Math.max(8, cornerMargin)
    let demand = Math.max(8, body.minimumPortSpacing ?? 0)
    for (const e of forward[node]!) demand = Math.max(demand, (backward[e] ? targetSupports[e] : sourceSupports[e]) ?? 0)
    for (const e of incoming[node]!) demand = Math.max(demand, (backward[e] ? sourceSupports[e] : targetSupports[e]) ?? 0)
    let support = 0
    for (const e of forward[node]!) support = Math.max(support, (backward[e] ? targetSupports[e] : sourceSupports[e])!)
    for (const e of incoming[node]!) support = Math.max(support, (backward[e] ? sourceSupports[e] : targetSupports[e])!)
    margin[node] = Math.max(margin[node]!, cornerMargin + support / 2)
    pitch[node] = demand + spacing
    const count = Math.max(forward[node]!.length, incoming[node]!.length)
    const required = count > 1 ? (count - 1) * pitch[node]! + margin[node]! * 2 : margin[node]! * 2
    if (count && widths[node]! < required) {
      if (body.sizePolicy !== 'minimum') decline('fixed body has insufficient physical port capacity')
      widths[node] = required
    }
    if (loops[node]!.length) {
      let labelCross = 0, loopSupport = 0, loopDemand = Math.max(8, body.minimumPortSpacing ?? 0)
      loops[node]!.forEach((e, index) => {
        const edge = input.edges[e]!, label = edge.label
        loopOrdinal[e] = index; loopSupport = Math.max(loopSupport, sourceSupports[e]!, targetSupports[e]!)
        loopDemand = Math.max(loopDemand, sourceSupports[e]!, targetSupports[e]!, label ? (horizontal ? label.width : label.height) + 2 * clearance : 0)
        labelCross = Math.max(labelCross, label ? (horizontal ? label.height : label.width) : 0)
      })
      loopPitch[node] = loopDemand + spacing
      loopStride[node] = labelCross + 2 * lead + 2 * clearance + spacing + body.paintStrokeWidth!
      const required = (loops[node]!.length * 2 - 1) * loopPitch[node]! + Math.max(8, cornerMargin + loopSupport / 2) * 2
      if (heights[node]! < required) {
        if (body.sizePolicy !== 'minimum') decline('fixed body has insufficient loop contact capacity')
        heights[node] = required
      }
    }
  }

  const paths: number[][] = [], labelVertices = new Int32Array(m).fill(-1)
  for (let e = 0; e < m; e++) {
    if (sources[e] === targets[e]) { paths.push([sources[e]!]); continue }
    const path = [sources[e]!], end = ranks[targets[e]!]!, start = ranks[sources[e]!]!
    const labelRank = Math.floor((start + end) / 2)
    for (let rank = start + 1; rank < end; rank++) {
      spend(); if (widths.length >= AGENTIC_MAX_EXPANDED_VERTICES) decline('expanded vertex limit')
      const vertex = widths.length, label = rank === labelRank ? input.edges[e]!.label : undefined
      widths.push(label ? (horizontal ? label.height : label.width) : spacing + 2 * clearance)
      heights.push(label ? (horizontal ? label.width : label.height) : 0)
      ranks.push(rank); path.push(vertex); arc(); if (label) labelVertices[e] = vertex
    }
    path.push(targets[e]!); paths.push(path)
  }
  const footprints = widths.map((width, vertex) => width + (vertex < n ? loops[vertex]!.length * loopStride[vertex]! : 0))
  const levels: number[][] = Array.from({ length: Math.max(...ranks) + 1 }, () => [])
  const previous: number[][] = widths.map(() => []), next: number[][] = widths.map(() => []), previousEdges: number[][] = widths.map(() => []), nextEdges: number[][] = widths.map(() => [])
  for (let vertex = 0; vertex < widths.length; vertex++) levels[ranks[vertex]!]!.push(vertex)
  for (let e = 0; e < m; e++) { const path = paths[e]!; for (let i = 1; i < path.length; i++) {
    arc(); previous[path[i]!]!.push(path[i - 1]!); previousEdges[path[i]!]!.push(e)
    next[path[i - 1]!]!.push(path[i]!); nextEdges[path[i - 1]!]!.push(e)
  } }
  const order = new Uint32Array(widths.length), score = new Float64Array(widths.length)
  const refreshOrder = (): void => { for (const row of levels) row.forEach((vertex, index) => { order[vertex] = index }) }
  refreshOrder()
  for (let sweep = 0; sweep < 4; sweep++) {
    const down = sweep % 2 === 0
    for (let index = 0; index < levels.length; index++) {
      const row = levels[down ? index : levels.length - index - 1]!
      for (const vertex of row) { const peers = (down ? previous : next)[vertex]!; let total = 0; for (const peer of peers) { spend(); total += order[peer]! } score[vertex] = peers.length ? total / peers.length : order[vertex]! }
      row.sort((a, b) => { spend(); if (--work.swaps < 0) throw new LayoutWorkLimitError('swaps'); return score[a]! - score[b]! || order[a]! - order[b]! || a - b }); row.forEach((vertex, index) => { order[vertex] = index })
    }
  }
  const sourceOffsets = new Float64Array(m), targetOffsets = new Float64Array(m)
  for (let node = 0; node < n; node++) {
    const out = forward[node]!, into = incoming[node]!
    out.sort((a, b) => order[paths[a]![1]!]! - order[paths[b]![1]!]! || a - b)
    into.sort((a, b) => order[paths[a]!.at(-2)!]! - order[paths[b]!.at(-2)!]! || a - b)
    out.forEach((e, i) => { sourceOffsets[e] = (i - (out.length - 1) / 2) * pitch[node]! })
    into.forEach((e, i) => { targetOffsets[e] = (i - (into.length - 1) / 2) * pitch[node]! })
  }
  const cross = new Float64Array(widths.length), main = new Float64Array(widths.length), bands = new Float64Array(levels.length)
  const paintMargin = Math.max(...input.nodes.map(node => node.paintStrokeWidth! / 2), m ? input.maximumEdgeStrokeWidth! / 2 : 0), canvasPadding = input.padding + paintMargin
  const nodeGap = Math.max(input.nodeSpacing, 2 * clearance + spacing + paintMargin * 2)
  for (const row of levels) {
    let cursor = 0
    for (const vertex of row) { cross[vertex] = cursor; cursor += footprints[vertex]! + nodeGap; bands[ranks[vertex]!] = Math.max(bands[ranks[vertex]!]!, heights[vertex]! + (vertex < n ? input.nodes[vertex]!.paintStrokeWidth! : 0)) }
  }
  // Ordered row constraints become monotone translations after subtracting
  // each body's packing prefix. Pool adjacent violating blocks to minimize the
  // squared displacement from port-aligned neighbor centers, in linear work.
  const prefix = new Float64Array(widths.length), sums = new Float64Array(widths.length), counts = new Uint32Array(widths.length), ends = new Uint32Array(widths.length)
  for (let sweep = 0; sweep < 4; sweep++) for (let index = 0; index < levels.length; index++) {
    const down = sweep % 2 === 0, row = levels[down ? index : levels.length - index - 1]!
    let cursor = 0, blocks = 0
    for (let i = 0; i < row.length; i++) {
      const vertex = row[i]!, peers = (down ? previous : next)[vertex]!, edges = (down ? previousEdges : nextEdges)[vertex]!
      let desired = 0
      for (let j = 0; j < peers.length; j++) {
        spend(); const peer = peers[j]!, e = edges[j]!
        const peerPort = down ? (peer === sources[e] ? sourceOffsets[e]! : 0) : (peer === targets[e] ? targetOffsets[e]! : 0)
        const ownPort = down ? (vertex === targets[e] ? targetOffsets[e]! : 0) : (vertex === sources[e] ? sourceOffsets[e]! : 0)
        desired += cross[peer]! + widths[peer]! / 2 + peerPort - ownPort - widths[vertex]! / 2
      }
      desired = peers.length ? desired / peers.length : cross[vertex]!
      prefix[i] = cursor; sums[blocks] = desired - cursor; counts[blocks] = 1; ends[blocks] = i + 1; blocks++
      while (blocks > 1 && sums[blocks - 2]! / counts[blocks - 2]! > sums[blocks - 1]! / counts[blocks - 1]!) {
        spend(); sums[blocks - 2] = sums[blocks - 2]! + sums[blocks - 1]!; counts[blocks - 2] = counts[blocks - 2]! + counts[blocks - 1]!; ends[blocks - 2] = ends[blocks - 1]!; blocks--
      }
      cursor += footprints[vertex]! + nodeGap
    }
    let start = 0
    for (let block = 0; block < blocks; block++) {
      const translation = sums[block]! / counts[block]!
      for (let i = start; i < ends[block]!; i++) cross[row[i]!] = translation + prefix[i]!
      start = ends[block]!
    }
  }
  let origin = Infinity
  for (const value of cross) origin = Math.min(origin, value)
  for (let vertex = 0; vertex < cross.length; vertex++) { cross[vertex] = cross[vertex]! - origin; if (!Number.isFinite(cross[vertex])) throw new TypeError('Trinity coordinate overflow') }
  let crossExtent = 0
  for (let v = 0; v < widths.length; v++) crossExtent = Math.max(crossExtent, cross[v]! + footprints[v]!)
  const channels: ChannelStep[][] = Array.from({ length: Math.max(0, levels.length - 1) }, () => []), steps: ChannelStep[][] = paths.map(() => [])
  for (let e = 0; e < m; e++) for (let i = 1; i < paths[e]!.length; i++) {
    const path = paths[e]!, a = path[i - 1]!, b = path[i]!
    const step = { sourceCross: cross[a]! + widths[a]! / 2 + (i === 1 ? sourceOffsets[e]! : 0), targetCross: cross[b]! + widths[b]! / 2 + (i + 1 === path.length ? targetOffsets[e]! : 0), offset: 0, track: 0 }
    channels[ranks[a]!]!.push(step); steps[e]!.push(step)
  }
  let extent = 0
  const gapStarts = new Float64Array(levels.length)
  for (let rank = 0; rank < levels.length; rank++) {
    for (const vertex of levels[rank]!) main[vertex] = extent + (bands[rank]! - heights[vertex]!) / 2
    extent += bands[rank]!; gapStarts[rank] = extent
    if (rank + 1 < levels.length) {
      const labelBand = bands[rank % 2 ? rank : rank + 1]!, baseGap = Math.max(0, (input.layerSpacing - labelBand) / 2)
      extent += assignChannelTracks(channels[rank]!, baseGap, spacing, crossExtent, work, reason => { for (const resource of ['pairs', 'arcs', 'swaps'] as const) if (work[resource] < 0) throw new LayoutWorkLimitError(resource); return decline(reason) }, undefined, {
        source: levels[rank]!.some(vertex => vertex < n) ? lead : clearance,
        target: levels[rank + 1]!.some(vertex => vertex < n) ? lead : clearance,
      })
    }
  }
  const project = (routes: MeasuredRoutes['edges']): MeasuredRoutes => {
    const projectPoint = (point: { x: number; y: number }): void => {
      const x = point.x, y = reverse ? extent - point.y : point.y
      point.x = canvasPadding + (horizontal ? y : x)
      point.y = canvasPadding + (horizontal ? x : y)
    }
    const nodes = input.nodes.map((_, i) => {
      const node = { x: cross[i]!, y: reverse ? main[i]! + heights[i]! : main[i]!, width: horizontal ? heights[i]! : widths[i]!, height: horizontal ? widths[i]! : heights[i]! }
      projectPoint(node)
      return node
    })
    for (const route of routes) { route.points.forEach(projectPoint); if (route.labelPosition) projectPoint(route.labelPosition) }
    const result = { width: (horizontal ? extent : crossExtent) + canvasPadding * 2, height: (horizontal ? crossExtent : extent) + canvasPadding * 2, nodes, edges: routes }
    if (!size(result.width) || !size(result.height)) throw new TypeError('Trinity extent overflow')
    return result
  }
  if (role === 'placement') return project([])
  const routes: MeasuredRoutes['edges'] = []
  for (let e = 0; e < m; e++) {
    const path = paths[e]!, points: Array<{ x: number; y: number }> = []
    const append = (x: number, y: number): void => {
      const last = points.at(-1); if (last?.x === x && last.y === y) return
      if (!Number.isFinite(x) || !Number.isFinite(y)) throw new TypeError('Trinity coordinate overflow')
      const previous = points.at(-2)
      if (previous && last && (previous.x === last.x && last.x === x && (last.y - previous.y) * (y - last.y) >= 0
        || previous.y === last.y && last.y === y && (last.x - previous.x) * (x - last.x) >= 0)) { last.x = x; last.y = y }
      else points.push({ x, y })
    }
    if (sources[e] === targets[e]) {
      const node = sources[e]!, ordinal = loopOrdinal[e]!, right = cross[node]! + widths[node]!, outer = right + (ordinal + 0.5) * loopStride[node]!
      const first = main[node]! + heights[node]! / 2 + (2 * ordinal - (loops[node]!.length * 2 - 1) / 2) * loopPitch[node]!
      const last = first + loopPitch[node]!
      arc(); arc(); arc(); append(right, first); append(outer, first); append(outer, last); append(right, last)
      routes.push({ points, ...(input.edges[e]!.label ? { labelPosition: { x: outer, y: (first + last) / 2 } } : {}) })
      continue
    }
    for (let i = 1; i < path.length; i++) {
      const a = path[i - 1]!, b = path[i]!, rank = ranks[a]!
      const ax = cross[a]! + widths[a]! / 2 + (i === 1 ? sourceOffsets[e]! : 0), bx = cross[b]! + widths[b]! / 2 + (i + 1 === path.length ? targetOffsets[e]! : 0)
      const step = steps[e]![i - 1]!, track = gapStarts[rank]! + step.offset
      append(ax, main[a]! + heights[a]!); append(ax, track)
      if (step.targetEscape !== undefined) {
        append(step.targetEscape, track); append(step.targetEscape, gapStarts[rank]! + step.targetExit!); append(bx, gapStarts[rank]! + step.targetExit!)
      } else append(bx, track)
      append(bx, main[b]!)
    }
    if (backward[e]) points.reverse()
    const label = labelVertices[e]!
    routes.push({ points, ...(label >= 0 ? { labelPosition: { x: cross[label]! + widths[label]! / 2, y: main[label]! + heights[label]! / 2 } } : {}) })
  }
  // Caption bodies may mask their own shaft, but never an endpoint body or
  // another caption. These are measured occupied bodies, independent of text.
  for (let e = 0; e < m; e++) {
    const label = input.edges[e]!.label, at = routes[e]!.labelPosition
    if (!label || !at) continue
    const width = horizontal ? label.height : label.width, height = horizontal ? label.width : label.height
    const overlaps = (x: number, y: number, w: number, h: number, pad: number): boolean => at.x + width / 2 > x - pad && at.x - width / 2 < x + w + pad && at.y + height / 2 > y - pad && at.y - height / 2 < y + h + pad
    for (let node = 0; node < n; node++) { spend(); if (overlaps(cross[node]!, main[node]!, widths[node]!, heights[node]!, input.nodes[node]!.paintStrokeWidth! / 2)) decline('caption overlaps a painted body') }
    for (let other = 0; other < e; other++) {
      const body = input.edges[other]!.label, anchor = routes[other]!.labelPosition
      if (!body || !anchor) continue
      spend(); const w = horizontal ? body.height : body.width, h = horizontal ? body.width : body.height
      if (overlaps(anchor.x - w / 2, anchor.y - h / 2, w, h, 0)) decline('caption bodies overlap')
    }
  }
  // A returned route must clear every foreign body, including occupied labels.
  // This is local solver admission, not a replacement for final written-ink proof.
  for (let e = 0; e < m; e++) {
    const edge = input.edges[e]!, route = routes[e]!.points
    for (let i = 1; i < route.length; i++) {
      const a = route[i - 1]!, b = route[i]!
      const enters = (left: number, top: number, width: number, height: number, pad: number): boolean =>
        Math.max(a.x, b.x) > left - pad && Math.min(a.x, b.x) < left + width + pad && Math.max(a.y, b.y) > top - pad && Math.min(a.y, b.y) < top + height + pad
      for (let vertex = 0; vertex < n; vertex++) {
        spend(); if (vertex === edge.source || vertex === edge.target) continue
        const pad = clearance + (input.nodes[vertex]!.paintStrokeWidth ?? 1) / 2
        if (enters(cross[vertex]!, main[vertex]!, widths[vertex]!, heights[vertex]!, pad)) decline('foreign body clearance could not be preserved')
      }
      for (let other = 0; other < m; other++) {
        const label = input.edges[other]!.label, at = routes[other]!.labelPosition
        if (other === e || !label || !at) continue
        spend(); const width = horizontal ? label.height : label.width, height = horizontal ? label.width : label.height
        if (enters(at.x - width / 2, at.y - height / 2, width, height, clearance)) decline('foreign label clearance could not be preserved')
      }
    }
  }

  return project(routes)
}
