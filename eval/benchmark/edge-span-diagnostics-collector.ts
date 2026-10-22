// Evaluator-only module: imported exclusively by the source-transform plugin.
// Heap snapshots are advisory under GC/contention, never allocation totals.
interface Model {
  nodes: readonly { id: string }[]
  edges: readonly { source: number; target: number; minSpan: number; visible?: boolean; label?: unknown }[]
  groups?: readonly unknown[]
  direction: string
  compactPrivateRanks?: boolean
  authoredCycleOrder?: boolean
  cycleOriented?: boolean
}
type Work = Record<string, unknown>
interface Snapshot { atMs: number; heapUsed: number; external: number; arrayBuffers: number; rss: number; work: unknown; workIdentities: Record<string, string> }
export interface Frame {
  id: number; parentId: number | null; kind: string; model: unknown
  phases: { name: string; snapshot: Snapshot; data?: unknown }[]
  events: { name: string; data: unknown }[]
  work: Work; ended?: Snapshot
}
export interface Trace { metadata: unknown; frames: Frame[]; events: { name: string; data: unknown }[] }
let active: Trace | undefined
const stack: Frame[] = []
let workObjects = new WeakMap<object, number>(), nextWorkObject = 0
function workIdentities(work: Work): Record<string, string> {
  const result: Record<string, string> = {}
  const visit = (value: object, prefix: string): void => {
    let id = workObjects.get(value)
    if (id === undefined) { id = nextWorkObject++; workObjects.set(value, id) }
    for (const [key, item] of Object.entries(value)) {
      const path = prefix ? `${prefix}.${key}` : key
      if (typeof item === "number") result[path] = `${id}:${key}`
      else if (item && typeof item === "object") visit(item, path)
    }
  }
  visit(work, ""); return result
}
function snapshot(work: Work): Snapshot {
  const memory = process.memoryUsage()
  return { atMs: performance.now(), heapUsed: memory.heapUsed, external: memory.external,
    arrayBuffers: memory.arrayBuffers, rss: memory.rss, work: structuredClone(work), workIdentities: workIdentities(work) }
}
export function withExpansionTrace<T>(metadata: unknown, run: () => T): { value: T; trace: Trace } {
  if (active || stack.length) throw new Error('Expansion diagnostics require isolated synchronous calls')
  const trace: Trace = { metadata, frames: [], events: [] }
  workObjects = new WeakMap(); nextWorkObject = 0
  active = trace
  try { return { value: run(), trace } } finally { active = undefined; stack.length = 0 }
}
export function traceEvent(name: string, data: unknown): void { active?.events.push({ name, data }) }
export function begin(kind: string, input: Model, work: Work): Frame {
  if (!active) throw new Error('Instrumented solver invoked outside diagnostic scope')
  const frame: Frame = { id: active.frames.length, parentId: stack.at(-1)?.id ?? null, kind, work,
    model: { nodes: input.nodes.length, nodeIds: input.nodes.map(node => node.id), edges: input.edges.length,
      edgeTuples: input.edges.map(e => [e.source, e.target, e.minSpan, !!e.label, e.visible !== false]),
      labelledEdges: input.edges.filter(e => e.label).length, selfLoops: input.edges.filter(e => e.source === e.target).length,
      minSpanSum: input.edges.reduce((s, e) => s + e.minSpan, 0), groups: input.groups?.length ?? 0,
      direction: input.direction, compactPrivateRanks: !!input.compactPrivateRanks,
      authoredCycleOrder: !!input.authoredCycleOrder, cycleOriented: !!input.cycleOriented }, phases: [], events: [] }
  active.frames.push(frame); stack.push(frame); phase(frame, 'entry'); return frame
}
export function phase(frame: Frame, name: string, data?: unknown): void {
  frame.phases.push({ name, snapshot: snapshot(frame.work), ...(data === undefined ? {} : { data }) })
}
export function event(frame: Frame, name: string, data: unknown): void { frame.events.push({ name, data }) }
export function expansion(frame: Frame, input: Model, rank: ArrayLike<number>, predictedExpanded: number): void {
  const spans = input.edges.map(edge => rank[edge.target]! - rank[edge.source]!)
  const histogram: Record<string, number> = {}
  for (const span of spans) histogram[span] = (histogram[span] ?? 0) + 1
  const totalRankSpan = spans.reduce((s, v) => s + v, 0), privateVertices = totalRankSpan - input.edges.length
  phase(frame, 'normalization', { totalRankSpan, privateVertices, predictedExpanded,
    expectedExpanded: input.nodes.length + privateVertices, expandedArcs: totalRankSpan,
    minRequiredSpan: input.edges.reduce((s, e) => s + e.minSpan * (input.compactPrivateRanks && !e.label ? 1 : 2), 0),
    maxRank: Math.max(0, ...Array.from(rank)), occupiedRanks: new Set(Array.from(rank)).size,
    spanHistogram: histogram, maxSpan: Math.max(0, ...spans) })
}
export function normalized(frame: Frame, nodes: number, vertices: number, labels: number, chains: readonly number[][]): void {
  event(frame, 'normalized', { actualExpanded: vertices, actualPrivate: vertices - nodes,
    labelVertices: labels, nonLabelPrivate: vertices - nodes - labels,
    actualExpandedArcs: chains.reduce((s, c) => s + c.length - 1, 0), chainEntries: chains.reduce((s, c) => s + c.length, 0) })
}
export function end(frame: Frame): void {
  frame.ended = snapshot(frame.work)
  if (stack.pop() !== frame) throw new Error('Unbalanced diagnostic frame')
  // Avoid retaining mutable work objects in the returned trace.
  frame.work = {}
}

function numericLeaves(value: unknown, prefix = ''): Record<string, number> {
  if (!value || typeof value !== 'object') return {}
  return Object.fromEntries(Object.entries(value).flatMap(([key, item]) => {
    const path = prefix ? `${prefix}.${key}` : key
    return typeof item === 'number' ? [[path, item] as const] : Object.entries(numericLeaves(item, path))
  }))
}
export function summarizeExpansionTrace(trace: Trace) {
  const phases = trace.frames.flatMap(frame => frame.phases.flatMap((phase, index) => {
    const end = frame.phases[index + 1]?.snapshot ?? frame.ended
    if (!end) return []
    const children = trace.frames.filter(child => child.parentId === frame.id && child.ended)
    const childMs = children.reduce((sum, child) => sum + Math.max(0,
      Math.min(end.atMs, child.ended!.atMs) - Math.max(phase.snapshot.atMs, child.phases[0]!.snapshot.atMs)), 0)
    const before = numericLeaves(phase.snapshot.work), after = numericLeaves(end.work)
    const inclusiveWorkUsed = Object.fromEntries(Object.entries(before).map(([key, value]) => [key, value - (after[key] ?? value)]))
    const exclusiveWorkUsed = { ...inclusiveWorkUsed }
    for (const child of children) {
      const first = child.phases[0]!.snapshot
      if (first.atMs < phase.snapshot.atMs || child.ended!.atMs > end.atMs) continue
      const childBefore = numericLeaves(first.work), childAfter = numericLeaves(child.ended!.work)
      // Subtract only the identical shared budget object, not a different
      // optional routing budget that happens to have the same field names.
      for (const key of Object.keys(exclusiveWorkUsed)) {
        const identity = phase.snapshot.workIdentities[key]
        const childKey = Object.keys(childBefore).find(k => first.workIdentities[k] === identity)
        if (childKey) exclusiveWorkUsed[key]! -= childBefore[childKey]! - (childAfter[childKey] ?? childBefore[childKey]!)
      }
    }
    return [{ frameId: frame.id, kind: frame.kind, phase: phase.name,
      inclusiveMs: end.atMs - phase.snapshot.atMs, exclusiveMs: end.atMs - phase.snapshot.atMs - childMs,
      observedHeapDelta: end.heapUsed - phase.snapshot.heapUsed,
      inclusiveWorkUsed, exclusiveWorkUsed }]
  }))
  const normalized = trace.frames.flatMap(frame => frame.events.filter(event => event.name === 'normalized').map(event => event.data as {
    actualExpanded: number; actualPrivate: number; labelVertices: number; actualExpandedArcs: number
  }))
  return { frames: trace.frames.length, physicalNormalizations: normalized.length,
    physicalExpandedVertices: normalized.reduce((sum, event) => sum + event.actualExpanded, 0),
    physicalPrivateVertices: normalized.reduce((sum, event) => sum + event.actualPrivate, 0),
    physicalLabelVertices: normalized.reduce((sum, event) => sum + event.labelVertices, 0),
    physicalExpandedArcs: normalized.reduce((sum, event) => sum + event.actualExpandedArcs, 0),
    maxPrivateVertices: Math.max(0, ...normalized.map(event => event.actualPrivate)),
    candidateAttempts: trace.frames.reduce((sum, frame) => sum + frame.events.filter(event => event.name === 'candidate-attempt').length, 0),
    candidateDeclines: trace.frames.reduce((sum, frame) => sum + frame.events.filter(event => event.name === 'candidate-declined').length, 0),
    fastPaths: trace.frames.flatMap(frame => frame.events.filter(event => event.name === 'fast-path').map(event => event.data)), phases }
}
