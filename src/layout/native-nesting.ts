import type { AgenticLayout, MeasuredGraph } from './agentic-layered-core.ts'
import type { ChannelWork } from './channel-tracks.ts'
import { routeCrossHierarchy } from './compound-boundary-routes.ts'

interface Nesting {
  input: MeasuredGraph
  parent: Int32Array
  top: Uint32Array
  bottom: Uint32Array
  order: Float64Array
}

// Custody belongs to one synchronous Native solve. Public measured requests
// cannot declare private vertices or use them to bypass authored input caps.
const pending = new WeakMap<MeasuredGraph, Nesting>()
export const nativeNestingOf = (input: MeasuredGraph) => pending.get(input)

export function placeNativeNesting(
  input: MeasuredGraph, owners: Int32Array, children: readonly number[][],
  lifted: ReadonlyMap<number, { source: number; target: number; host: number }>,
  layout: (flat: MeasuredGraph) => AgenticLayout, work: ChannelWork, limit: number,
  fail: (reason: string) => never,
): AgenticLayout | undefined {
  const groups = input.groups!, n = input.nodes.length, g = groups.length
  const direction = input.direction === 'TD' ? 'TB' : input.direction
  // These existing contracts retain the recursive implementation. No edge or
  // local direction is silently translated into the new common-direction solve.
  if (!n || !lifted.size || groups.some((group, i) => !children[i + 1]!.length || group.partition !== undefined || group.modelOrder !== undefined
    || group.direction !== undefined && (group.direction === 'TD' ? 'TB' : group.direction) !== direction)
    || input.nodes.some(node => node.partition !== undefined || node.modelOrder !== undefined)
    || input.edges.some(edge => edge.source >= n || edge.target >= n || edge.source === edge.target)) return undefined
  const size = n + 2 * g + 1, root = size - 1
  const reserve = (pairs: number, slots: number): void => {
    work.pairs -= pairs; work.arcs -= slots
    if (work.pairs < 0 || work.arcs < 0) fail('agentic global nesting work limit')
  }
  if (size > limit) fail('agentic local compound-expansion limit')
  const subjects = n + g, edgeCount = input.edges.length
  const quotientPairs = 2 * subjects + 4 * edgeCount, quotientSlots = 3 * subjects + 2 * edgeCount
  if (work.pairs < quotientPairs + 24 * (size + edgeCount) || work.arcs < quotientSlots + 2 * size + 4 * g + edgeCount) return undefined
  reserve(quotientPairs, quotientSlots)
  // Grouping is harmless when every sibling quotient is acyclic: retain the
  // established compact placement there. Global ranks repair the structural
  // loss when collapsing distinct leaves invents a cycle. Include ordinary
  // hosted edges too; lifted edges alone can miss A→B→group→A.
  const heads = new Uint32Array(subjects), next = new Uint32Array(edgeCount), targets = new Uint32Array(edgeCount)
  const degree = new Uint32Array(subjects), queue = new Uint32Array(subjects)
  for (let i = 0; i < edgeCount; i++) {
    const edge = lifted.get(i) ?? input.edges[i]!
    next[i] = heads[edge.source]!; targets[i] = edge.target; heads[edge.source] = i + 1
    degree[edge.target] = degree[edge.target]! + 1
  }
  let queued = 0
  for (let i = 0; i < subjects; i++) if (!degree[i]) queue[queued++] = i
  for (let cursor = 0; cursor < queued; cursor++) for (let link = heads[queue[cursor]!]!; link; link = next[link - 1]!) {
    const target = targets[link - 1]!
    degree[target] = degree[target]! - 1
    if (!degree[target]) queue[queued++] = target
  }
  if (queued === subjects) return undefined
  reserve(24 * (size + input.edges.length), 2 * size + 4 * g + input.edges.length)
  // This strategy admits acyclic leaf constraints. Do not run feedback-order
  // searches only to discard every cyclic result into recursive compatibility.
  const outgoing: number[][] = Array.from({ length: n }, () => []), leafDegree = new Uint32Array(n), leafQueue: number[] = []
  input.edges.forEach((edge, i) => { outgoing[edge.source]!.push(i); leafDegree[edge.target] = leafDegree[edge.target]! + 1 })
  for (let leaf = 0; leaf < n; leaf++) if (!leafDegree[leaf]) leafQueue.push(leaf)
  for (let cursor = 0; cursor < leafQueue.length; cursor++) for (const i of outgoing[leafQueue[cursor]!]!) {
    const target = input.edges[i]!.target
    leafDegree[target] = leafDegree[target]! - 1
    if (!leafDegree[target]) leafQueue.push(target)
  }
  if (leafQueue.length !== n) return undefined
  const parent = new Int32Array(size).fill(-1), top = new Uint32Array(g), bottom = new Uint32Array(g)
  const groupOrder = new Float64Array(g).fill(Infinity)
  let maxDepth = 0
  for (let i = 0; i < n; i++) {
    let depth = 0
    parent[i] = owners[i]!
    for (let group = owners[i]!; group >= 0; group = groups[group]!.parent ?? -1) {
      depth++; reserve(1, 0); groupOrder[group] = Math.min(groupOrder[group]!, i)
    }
    maxDepth = Math.max(maxDepth, depth)
  }
  const nodes = input.nodes.map(({ parent: _parent, ...node }) => node)
  const ids = new Set([...input.nodes.map(node => node.id), ...groups.map(group => group.id)])
  let suffix = 0
  const identity = () => { let id: string; do { id = '\0native-nesting:' + suffix++ } while (ids.has(id)); ids.add(id); return id }
  const horizontal = direction === 'LR' || direction === 'RL', reverse = direction === 'BT' || direction === 'RL'
  for (let group = 0; group < g; group++) {
    const padding = groups[group]!.padding
    const before = horizontal ? reverse ? padding.right : padding.left : reverse ? padding.bottom : padding.top
    const after = horizontal ? reverse ? padding.left : padding.right : reverse ? padding.top : padding.bottom
    top[group] = nodes.length; parent[nodes.length] = group
    nodes.push({ id: identity(), width: horizontal ? before : 0, height: horizontal ? 0 : before })
    bottom[group] = nodes.length; parent[nodes.length] = group
    nodes.push({ id: identity(), width: horizontal ? after : 0, height: horizontal ? 0 : after })
  }
  nodes.push({ id: identity(), width: 0, height: 0 })
  const factor = 2 * maxDepth + 1
  if (input.edges.some(edge => edge.minSpan * factor * 2 >= 4096)) return undefined
  const edges = input.edges.map(edge => ({ ...edge, minSpan: edge.minSpan * factor }))
  const add = (source: number, target: number) => { reserve(2, 1); edges.push({ source, target, minSpan: 1, visible: false }) }
  for (let scope = 0; scope < children.length; scope++) for (const child of children[scope]!) {
    const start = child < n ? child : top[child - n]!, end = child < n ? child : bottom[child - n]!
    if (scope) { add(top[scope - 1]!, start); add(end, bottom[scope - 1]!) }
    else add(root, start)
  }
  const flat: MeasuredGraph = { ...input, nodes, edges, layerSpacing: input.layerSpacing / factor, groups: undefined, compactPrivateRanks: true, cycleOriented: true }
  pending.set(flat, { input, parent, top, bottom, order: groupOrder })
  let placed: AgenticLayout
  try { placed = layout(flat) } finally { pending.delete(flat) }
  const result: AgenticLayout = { ...placed, nodes: placed.nodes.slice(0, n), edges: placed.edges.slice(0, input.edges.length) }
  if (input.placementOnly) return result
  if (!lifted.size && input.maximumEdgeStrokeWidth === undefined) return result
  const measured = { ...input, nodes: input.nodes.map((node, i) => ({ ...node, ...(result.nodes[i]!.width === undefined ? {} : { width: result.nodes[i]!.width!, height: result.nodes[i]!.height! }) })) }
  return routeCrossHierarchy(measured, result, owners, lifted, Array(g + 1).fill(input.direction), work, limit, fail, undefined, true)
}

interface NestVertex { rank: number; crossSize: number; mainSize: number; incoming: number[]; outgoing: number[] }

/** Add per-rank side segments after rank-only nesting constraints have served
 * their purpose. Each frame side is one coordinate variable across all ranks. */
export function prepareNestingBands(
  nesting: Nesting, vertices: NestVertex[], rank: Uint32Array, chains: readonly number[][],
  work: ChannelWork, limit: number, fail: (reason: string) => never,
) {
  const { input, parent, top, bottom } = nesting, groups = input.groups!, n = input.nodes.length, g = groups.length
  const horizontal = input.direction === 'LR' || input.direction === 'RL'
  let count = 0
  for (let i = 0; i < g; i++) count += 2 * (rank[bottom[i]!]! - rank[top[i]!]! + 1)
  if (!Number.isSafeInteger(count) || vertices.length + count > limit) fail('agentic local compound-expansion limit')
  work.arcs -= count + 5 * (vertices.length + count) + 5 * g + n
  work.pairs -= count + vertices.length
  if (work.arcs < 0 || work.pairs < 0) fail('agentic global border work limit')
  const ownership = new Int32Array(vertices.length + count).fill(-1), key = new Float64Array(ownership.length)
  const left = new Int32Array(g).fill(-1), right = new Int32Array(g).fill(-1), variable = new Int32Array(ownership.length)
  const side = new Int8Array(ownership.length), chainAnchor = new Int32Array(ownership.length).fill(-1)
  for (let i = 0; i < parent.length; i++) { ownership[i] = parent[i]!; key[i] = i < n ? i : nesting.order[parent[i]!] ?? i }
  work.pairs -= 64 * g
  if (work.pairs < 0) fail('agentic global ancestry work limit')
  let maxDepth = 0
  for (let i = 0; i < g; i++) {
    let depth = 0
    for (let p = i; p >= 0; p = groups[p]!.parent ?? -1) depth++
    maxDepth = Math.max(maxDepth, depth)
  }
  work.pairs -= (g + input.edges.length) * (2 * maxDepth + 4) + 4 * (g + n)
  if (work.pairs < 0) fail('agentic global ancestry work limit')
  // A connected direct-leaf component cannot be interleaved with an unrelated
  // child container. Otherwise a same-scope edge can enter that child's frame
  // without ever becoming a lifted boundary connection.
  work.arcs -= n; work.pairs -= n + 4 * input.edges.length
  if (work.pairs < 0 || work.arcs < 0) fail('agentic global sibling component work limit')
  const component = Int32Array.from({ length: n }, (_, i) => i)
  const representative = (leaf: number): number => {
    while (component[leaf] !== leaf) {
      if (--work.pairs < 0) fail('agentic global sibling component work limit')
      component[leaf] = component[component[leaf]!]!; leaf = component[leaf]!
    }
    return leaf
  }
  for (const edge of input.edges) if (parent[edge.source] === parent[edge.target]) {
    const a = representative(edge.source), b = representative(edge.target)
    component[Math.max(a, b)] = Math.min(a, b)
  }
  for (let leaf = 0; leaf < n; leaf++) component[leaf] = representative(leaf)
  const members: number[][] = Array.from({ length: g + 1 }, () => [])
  for (let i = 0; i < n; i++) members[parent[i]! + 1]!.push(i)
  for (let i = 0; i < g; i++) members[(groups[i]!.parent ?? -1) + 1]!.push(n + i)
  const entry = new Float64Array(g), exit = new Float64Array(g)
  let sequence = 0
  const visit = (owner: number): void => {
    if (owner >= 0) entry[owner] = ++sequence
    let bucket = sequence + .5
    const children = members[owner + 1]!
    children.sort((a, b) => (a < n ? component[a]! : nesting.order[a - n]!) - (b < n ? component[b]! : nesting.order[b - n]!) || a - b)
    for (const child of children) {
      if (child < n) key[child] = bucket
      else { visit(child - n); bucket = sequence + .5 }
    }
    if (owner >= 0) exit[owner] = ++sequence
  }
  visit(-1)
  for (let i = n; i < parent.length; i++) key[i] = parent[i]! < 0 ? -1 : entry[parent[i]!]! + .5
  const ancestors = new Uint32Array(g)
  let epoch = 0
  const lca = (a: number, b: number): number => {
    epoch++
    for (let p = a; p >= 0; p = groups[p]!.parent ?? -1) ancestors[p] = epoch
    while (b >= 0 && ancestors[b] !== epoch) b = groups[b]!.parent ?? -1
    return b
  }
  for (let i = 0; i < input.edges.length; i++) {
    const edge = input.edges[i]!, owner = lca(parent[edge.source]!, parent[edge.target]!)
    let child = parent[edge.source]!
    if (child !== owner) while ((groups[child]!.parent ?? -1) !== owner) child = groups[child]!.parent ?? -1
    const slot = child === owner ? key[edge.source]! : exit[child]! + .5
    const chain = chains[i]!
    // Subdivision vertices traverse the source ancestry, LCA, then target
    // ancestry. Assigning the entire chain to its LCA cuts frame headers.
    work.pairs -= (3 * maxDepth + 4) * chain.length
    work.arcs -= 2 * maxDepth
    if (work.pairs < 0 || work.arcs < 0) fail('agentic global chain ownership work limit')
    const sourcePath: number[] = [], targetPath: number[] = []
    for (let p = parent[edge.source]!; p !== owner; p = groups[p]!.parent ?? -1) sourcePath.push(p)
    for (let p = parent[edge.target]!; p !== owner; p = groups[p]!.parent ?? -1) targetPath.push(p)
    targetPath.reverse()
    let previousOwner = -2, anchor = -1
    for (let cursor = 1; cursor + 1 < chain.length; cursor++) {
      const v = chain[cursor]!, row = vertices[v]!.rank
      let actual = owner
      for (const p of sourcePath) if (row <= rank[bottom[p]!]!) { actual = p; break }
      if (actual === owner) for (const p of targetPath) { if (row >= rank[top[p]!]! && (row > rank[top[p]!]! || vertices[v]!.mainSize === 0)) actual = p; else break }
      ownership[v] = actual
      const internal = parent[edge.source] === actual && parent[edge.target] === actual
      const targetSide = actual >= 0 && targetPath.includes(actual)
      key[v] = actual === owner ? slot + .05 * i / (input.edges.length + 1) : entry[actual]! + (targetSide ? .1 : .6) + .2 * i / (input.edges.length + 1)
      if (internal) key[v] = slot
      else {
        if (actual !== previousOwner) anchor = v
        chainAnchor[v] = anchor
      }
      previousOwner = actual
    }
  }
  for (let group = 0; group < g; group++) for (let row = rank[top[group]!]!; row <= rank[bottom[group]!]!; row++) {
    for (const sign of [-1, 1]) {
      const id = vertices.length
      vertices.push({ rank: row, crossSize: 0, mainSize: 0, incoming: [], outgoing: [] })
      ownership[id] = group; side[id] = sign; key[id] = sign < 0 ? entry[group]! : exit[group]!
      const bank = sign < 0 ? left : right
      if (bank[group] === -1) bank[group] = id
      variable[id] = bank[group]!
    }
  }
  for (let i = 0; i < vertices.length; i++) if (!side[i]) variable[i] = chainAnchor[i]! < 0 ? i : chainAnchor[i]!
  const canonicalize = (band: number[]): void => {
    work.pairs -= 4 * band.length * (Math.ceil(Math.log2(Math.max(1, band.length))) + 1)
    if (work.pairs < 0) fail('agentic global interval ordering work limit')
    // Stable numeric keys pin frame intervals across ranks. Barycenter order
    // remains free within each gap between sibling containers.
    band.sort((a, b) => key[a]! - key[b]!)
  }
  const coordinates = (bands: readonly number[][], cross: Float64Array): number => {
    const constraints = bands.reduce((sum, band) => sum + Math.max(0, band.length - 1), g)
    work.pairs -= 7 * vertices.length + 4 * constraints + 3 * g
    work.arcs -= 3 * vertices.length + 4 * constraints + 3 * g
    if (work.pairs < 0 || work.arcs < 0) fail('agentic global coordinate work limit')
    // A container with one ordinary chain vertex per rank can share a cross
    // coordinate. Keep its leaves and internal subdivision points aligned,
    // rather than compacting every empty rank independently against a border.
    // Branches and nested children retain separate coordinate variables.
    const alignable = new Uint8Array(g).fill(1), seenRank = new Int32Array(g).fill(-1), aligned = new Int32Array(g).fill(-1)
    for (const group of groups) if (group.parent !== undefined) alignable[group.parent] = 0
    const eligible = (v: number) => !side[v] && chainAnchor[v]! < 0 && (v < n || v >= parent.length)
    for (let row = 0; row < bands.length; row++) for (const v of bands[row]!) {
      const owner = ownership[v]!
      if (owner < 0 || !eligible(v)) continue
      if (seenRank[owner] === row) alignable[owner] = 0
      seenRank[owner] = row
      if (aligned[owner] === -1) aligned[owner] = v
    }
    for (let v = 0; v < vertices.length; v++) {
      const owner = ownership[v]!
      if (owner >= 0 && alignable[owner] && eligible(v)) variable[v] = aligned[owner]!
    }
    const from: number[] = [], to: number[] = [], distance: number[] = []
    const add = (a: number, b: number, gap: number): void => { from.push(variable[a]!); to.push(variable[b]!); distance.push(gap) }
    const before = (group: number) => horizontal ? groups[group]!.padding.top : groups[group]!.padding.left
    const after = (group: number) => horizontal ? groups[group]!.padding.bottom : groups[group]!.padding.right
    for (const band of bands) for (let i = 1; i < band.length; i++) {
      const a = band[i - 1]!, b = band[i]!, ga = ownership[a]!, gb = ownership[b]!
      const gap = side[a] === -1 && side[b] === 1 && ga === gb ? before(ga) + after(gb)
        : side[a] === -1 ? before(ga) : side[b] === 1 ? after(gb) : input.nodeSpacing
      add(a, b, vertices[a]!.crossSize / 2 + vertices[b]!.crossSize / 2 + gap)
    }
    for (let i = 0; i < g; i++) add(left[i]!, right[i]!, horizontal ? groups[i]!.padding.top + groups[i]!.padding.bottom : groups[i]!.minWidth)
    const out: number[][] = Array.from({ length: vertices.length }, () => []), degree = new Uint32Array(vertices.length)
    for (let i = 0; i < from.length; i++) { out[from[i]!]!.push(i); degree[to[i]!] = degree[to[i]!]! + 1 }
    const queue: number[] = []
    for (let i = 0; i < vertices.length; i++) { cross[i] = 0; if (!degree[i]) queue.push(i) }
    for (let i = 0; i < vertices.length; i++) cross[variable[i]!] = Math.max(cross[variable[i]!]!, vertices[i]!.crossSize / 2)
    for (let cursor = 0; cursor < queue.length; cursor++) for (const edge of out[queue[cursor]!]!) {
      const target = to[edge]!
      cross[target] = Math.max(cross[target]!, cross[from[edge]!]! + distance[edge]!); degree[target] = degree[target]! - 1
      if (!degree[target]) queue.push(target)
    }
    if (queue.length !== vertices.length) fail('agentic global nesting order is inconsistent')
    let extent = 0
    for (let i = 0; i < vertices.length; i++) { cross[i] = cross[variable[i]!]!; extent = Math.max(extent, cross[i]! + vertices[i]!.crossSize / 2) }
    return extent
  }
  return { canonicalize, coordinates, left, right }
}
