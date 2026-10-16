import type { PositionedMessage, SequenceBounds } from './types.ts'

interface LabelArea extends SequenceBounds { key: string }
interface IntervalNode { area: LabelArea; end: number; left?: IntervalNode; right?: IntervalNode }
export interface VisibleSpan { top: number; bottom: number; after?: string }

/** Remove structural ink beneath labels without replacing the surface behind
 * them. Layout's measured display text (including numbering and all lines) is
 * the sole authority; this helper never measures or changes message geometry.
 * Index both axes: lifelines query a narrow column, activations a short row
 * range, so successive activations don't each scan every message. */
export function messageLabelOcclusion(messages: readonly PositionedMessage[]) {
  const occurrences = new Map<string, number>()
  const areas: LabelArea[] = []
  for (const message of messages) {
    const pair = `${message.from}->${message.to}`
    const occurrence = occurrences.get(pair) ?? 0
    occurrences.set(pair, occurrence + 1)
    if (!message.labelPosition.text.trim()) continue
    const bounds = message.labelPosition.bounds
    areas.push({
      key: `${pair}#${occurrence}`,
      x: bounds.x - 2,
      y: bounds.y - 2,
      width: bounds.width + 4,
      height: bounds.height + 4,
    })
  }
  const index = (axis: 'x' | 'y') => {
    const size = axis === 'x' ? 'width' : 'height'
    const sorted = [...areas].sort((a, b) => a[axis] - b[axis])
    const build = (low: number, high: number): IntervalNode | undefined => {
      if (low >= high) return undefined
      const mid = (low + high) >>> 1
      const area = sorted[mid]!
      const left = build(low, mid)
      const right = build(mid + 1, high)
      return { area, left, right, end: Math.max(area[axis] + area[size], left?.end ?? -Infinity, right?.end ?? -Infinity) }
    }
    const root = build(0, sorted.length)
    return (bounds: SequenceBounds): LabelArea[] => {
      const found: LabelArea[] = []
      const visit = (node: IntervalNode | undefined): void => {
        if (!node || node.end < bounds[axis]) return
        visit(node.left)
        const area = node.area
        if (area[axis] > bounds[axis] + bounds[size]) return
        if (area.x <= bounds.x + bounds.width && area.x + area.width >= bounds.x &&
            area.y <= bounds.y + bounds.height && area.y + area.height >= bounds.y) found.push(area)
        visit(node.right)
      }
      visit(root)
      return found
    }
  }
  const byX = index('x')
  const byY = index('y')
  return (bounds: SequenceBounds, axis: 'x' | 'y'): VisibleSpan[] => {
    const hits = (axis === 'x' ? byX : byY)(bounds).sort((a, b) => a.y - b.y)
    const spans: VisibleSpan[] = []
    const bottom = bounds.y + bounds.height
    let cursor = bounds.y
    let after: string | undefined
    for (const area of hits) {
      const top = Math.max(bounds.y, area.y)
      if (top > cursor) spans.push({ top: cursor, bottom: top, after })
      const end = Math.min(bottom, area.y + area.height)
      if (end > cursor) { cursor = end; after = area.key }
    }
    if (cursor < bottom) spans.push({ top: cursor, bottom, after })
    return spans
  }
}
