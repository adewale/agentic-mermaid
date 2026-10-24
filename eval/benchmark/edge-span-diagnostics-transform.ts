import { createHash } from 'node:crypto'
export interface SourceTransform { path: string; originalSha256: string; transformedSha256: string; before: string; after: string; edits: { anchor: string; replacement: string }[] }
export const instrumentedModules = ['agentic-layered-core.ts', 'cycle-layout-search.ts', 'agentic-compound-core.ts', 'agentic-producer-core.ts']
export function instrumentExpansionSource(path: string, source: string, collector: string): SourceTransform {
  const edits: SourceTransform['edits'] = []
  let after = source
  const replace = (anchor: string, replacement: string): void => {
    if (after.split(anchor).length !== 2) throw new Error(`Diagnostic anchor must match exactly once: ${path}: ${anchor}`)
    edits.push({ anchor, replacement }); after = after.replace(anchor, replacement)
  }
  const prepend = `import { begin as __begin, phase as __phase, event as __event, expansion as __expansion, normalized as __normalized, end as __end, traceEvent as __traceEvent } from ${JSON.stringify(collector)}\n`
  if (path.endsWith('agentic-layered-core.ts')) {
    replace('): AgenticLayout {\n  const { nodes, edges, padding, nodeSpacing, layerSpacing } = input', '): AgenticLayout {\n  const __frame = __begin("layered", input, { routingWork, searchWork }); try {\n  const { nodes, edges, padding, nodeSpacing, layerSpacing } = input')
    replace('  if (hasLoops) {', '  __phase(__frame, "dispatch")\n  if (hasLoops) {\n    __event(__frame, "loop-expansion", { selfLoops: edges.filter(edge => edge.source === edge.target).length })')
    replace('  if (shared) return shared', '  if (shared) { __event(__frame, "fast-path", { kind: "shared-fan" }); return shared }')
    replace('  if (forest) return { ...forest, expandedVertices: nodes.length }', '  if (forest) { __event(__frame, "fast-path", { kind: "forest" }); return { ...forest, expandedVertices: nodes.length } }')
    replace('  const rank = new Uint32Array(nodes.length)', '  __phase(__frame, "ranking")\n  const rank = new Uint32Array(nodes.length)')
    replace('  const vertices: Vertex[] = nodes.map', '  __expansion(__frame, input, rank, expandedSize)\n  const vertices: Vertex[] = nodes.map')
    replace('  const bands: number[][] = Array.from', '  __normalized(__frame, nodes.length, vertices.length, labelVertices.filter(value => value !== undefined).length, chains)\n  const bands: number[][] = Array.from')
    replace('  let bestScore = crossingScore()', '  __phase(__frame, "ordering")\n  let bestScore = crossingScore()')
    replace('  const crossingScore = (): number => {', '  let __crossingCalls = 0\n  const crossingScore = (): number => {\n    __crossingCalls++')
    replace('  const previousReal = new Int32Array', '  __phase(__frame, "coordinates", { crossingScoreCalls: __crossingCalls })\n  const previousReal = new Int32Array')
    replace('  const sourcePort = new Float64Array', '  __phase(__frame, "ports")\n  const sourcePort = new Float64Array')
    replace('  const channels: ChannelStep[][] = Array.from', '  __phase(__frame, "channel-routing")\n  const channels: ChannelStep[][] = Array.from')
    const routeEmissionAnchor = '  const positionedEdges = input.placementOnly && !input.cycleOriented && !input.loopPorts?.length'
    replace(routeEmissionAnchor, '  __phase(__frame, "route-emission", { channels: channels.length, channelSteps: channels.reduce((sum, channel) => sum + channel.length, 0), skippedForPlacement: !!(input.placementOnly && !input.cycleOriented && !input.loopPorts?.length) })\n' + routeEmissionAnchor)
  } else if (path.endsWith('cycle-layout-search.ts')) {
    replace('): AgenticLayout {\n  const { nodes, edges } = input', '): AgenticLayout {\n  const __frame = __begin("cycle-search", input, { routingWork, search }); try {\n  const { nodes, edges } = input')
    replace('    const reversed = edges.map', '    __event(__frame, "candidate-attempt", { reverseNodes, reverseEdges })\n    const reversed = edges.map')
    replace('  let best = place(primary, unsupported, routingWork)', '  __phase(__frame, "primary-placement")\n  let best = place(primary, unsupported, routingWork)\n  __phase(__frame, "candidate-search")')
    replace('        best = alternative; bestScore = value;', '        __event(__frame, "candidate-selected", { crossings: value, bends, area })\n        best = alternative; bestScore = value;')
    replace('      if (!(error instanceof OptionalOrderDecline)) throw error', '      if (!(error instanceof OptionalOrderDecline)) throw error\n      __event(__frame, "candidate-declined", { reason: String(error) })')
  } else if (path.endsWith('agentic-compound-core.ts')) {
    replace('): AgenticLayout {\n  const groups = input.groups!', '): AgenticLayout {\n  const __frame = __begin("compound", input, { routingWork }); try {\n  const groups = input.groups!')
    replace('    const placed = layout(flat)', '    __event(__frame, "scope", { scope, nodes: nodes.length, edges: edges.length, direction })\n    const placed = layout(flat)')
    replace('  return routeCrossHierarchy(input, result,', '  __phase(__frame, "boundary-routing", { liftedEdges: lifted.size, selectedExpandedVertices: expandedVertices })\n  return routeCrossHierarchy(input, result,')
  } else if (path.endsWith('agentic-producer-core.ts')) {
    replace("  const geometry = measureRenderStage('agentic', () => layoutAgenticGraph(measured))", "  __traceEvent('measured-model', { nodeIds: measured.nodes.map(node => node.id), nodes: measured.nodes.length, edges: measured.edges.length, groups: measured.groups.length, labels: measured.edges.filter(edge => edge.label).length, authoredCycleOrder: measured.authoredCycleOrder ?? false, compactPrivateRanks: measured.compactPrivateRanks ?? false })\n  const geometry = measureRenderStage('agentic', () => layoutAgenticGraph(measured))\n  __traceEvent('selected-measured-geometry', { expandedVertices: geometry.expandedVertices, topology: geometry.topology })")
  } else throw new Error(`Unsupported diagnostic source: ${path}`)
  if (!path.endsWith('agentic-producer-core.ts')) {
    if (!after.endsWith('}\n')) throw new Error(`Unexpected function ending: ${path}`)
    after = after.slice(0, -2) + '  } finally { __end(__frame) }\n}\n'
  }
  after = prepend + after
  const sha = (text: string) => createHash('sha256').update(text).digest('hex')
  return { path, originalSha256: sha(source), transformedSha256: sha(after), before: source, after, edits }
}
