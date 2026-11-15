import { feedbackOrder } from './cycle-order.ts'

export interface ChannelStep {
  sourceCross: number
  targetCross: number
  offset: number
  track: number
  targetEscape?: number
  targetExit?: number
}

export interface ChannelWork { pairs: number; arcs: number; swaps: number }

/** Order horizontal runs by their vertical constraints. Intersecting runs
 * receive separate tracks; a cyclic terminal constraint gets a visible dogleg
 * rather than concealing a crossing in coincident vertical ink. */
export function assignChannelTracks(
  segments: ChannelStep[],
  baseGap: number,
  spacing: number,
  extent: number,
  work: ChannelWork,
  unsupported: (reason: string) => never,
  minimumTerminalLead?: number,
): number {
  const epsilon = 0.01
  const active = segments.filter(step => Math.abs(step.sourceCross - step.targetCross) > epsilon)
  if (!active.length) return baseGap
  work.pairs -= active.length * segments.length
  if (work.pairs < 0) unsupported('agentic local channel-pair limit')
  const low = (step: ChannelStep) => Math.min(step.sourceCross, step.targetCross)
  const high = (step: ChannelStep) => Math.max(step.sourceCross, step.targetCross)
  const overlap = (a: ChannelStep, b: ChannelStep) => Math.min(high(a), high(b)) >= Math.max(low(a), low(b)) - 0.5
  const inside = (value: number, step: ChannelStep) => value >= low(step) - epsilon && value <= high(step) + epsilon
  const incoming: number[][] = active.map(() => []), outgoing: number[][] = active.map(() => [])
  const constraints: { source: number; target: number; minSpan: number }[] = []
  const add = (source: number, target: number): void => {
    if (--work.arcs < 0) unsupported('agentic local channel-constraint limit')
    const index = constraints.length
    constraints.push({ source, target, minSpan: 1 })
    outgoing[source]!.push(index); incoming[target]!.push(index)
  }
  for (let i = 0; i < active.length; i++) for (let j = i + 1; j < active.length; j++) {
    const a = active[i]!, b = active[j]!
    if (!overlap(a, b)) continue
    if (inside(b.sourceCross, a) && Math.abs(b.sourceCross - a.sourceCross) > epsilon) add(j, i)
    if (inside(b.targetCross, a) && Math.abs(b.targetCross - a.targetCross) > epsilon) add(i, j)
    if (inside(a.sourceCross, b) && Math.abs(a.sourceCross - b.sourceCross) > epsilon) add(i, j)
    if (inside(a.targetCross, b) && Math.abs(a.targetCross - b.targetCross) > epsilon) add(j, i)
  }
  const order = feedbackOrder(incoming, outgoing, constraints)
  const ranked = active.map((_, index) => index).sort((a, b) => order[a]! - order[b]! || a - b)
  let maxTrack = 0
  for (let index = 0; index < ranked.length; index++) {
    const step = active[ranked[index]!]!
    for (let previous = 0; previous < index; previous++) {
      const other = active[ranked[previous]!]!
      if (overlap(step, other)) step.track = Math.max(step.track, other.track + 1)
    }
    maxTrack = Math.max(maxTrack, step.track)
  }
  let escapes = false
  const terminalClearance = Math.max(1, Math.min(2, spacing / 2))
  const columns = segments.flatMap(other => [other.sourceCross, other.targetCross]).sort((a, b) => a - b)
  for (const step of active) {
    if (!segments.some(other => other !== step && Math.abs(other.sourceCross - step.targetCross) <= 0.5
      && (Math.abs(other.sourceCross - other.targetCross) <= epsilon || other.track >= step.track))) continue
    // A nearly coincident column is occupied too. Search beyond the whole
    // cluster rather than squeezing an escape into its subpixel gaps.
    let left = step.targetCross - spacing, right = step.targetCross + spacing
    for (let index = columns.length - 1; index >= 0; index--) {
      const column = columns[index]!
      if (Math.abs(column - left) < terminalClearance) left = column - terminalClearance
    }
    for (const column of columns) if (Math.abs(column - right) < terminalClearance) right = column + terminalClearance
    const leftDistance = left >= 0 ? step.targetCross - left : Infinity
    const rightDistance = right <= extent ? right - step.targetCross : Infinity
    if (!Number.isFinite(Math.min(leftDistance, rightDistance))) unsupported('agentic local channel-terminal clearance')
    step.targetEscape = rightDistance < leftDistance || (rightDistance === leftDistance && step.sourceCross > step.targetCross) ? right : left
    escapes = true
  }
  const margin = Math.max(12, spacing, minimumTerminalLead ?? 0)
  const needed = 2 * margin + maxTrack * spacing + (escapes ? spacing : 0)
  const gap = Math.max(baseGap, needed), slack = (gap - needed) / 2
  for (const step of segments) {
    step.offset = margin + slack + step.track * spacing
    if (step.targetEscape !== undefined) step.targetExit = gap - margin
  }
  return gap
}
